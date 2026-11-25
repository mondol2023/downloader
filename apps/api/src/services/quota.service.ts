import { randomUUID } from 'node:crypto';
import type { QuotaSnapshot, Tier } from '@media/shared';
import { formatCount, isUnlimited, policyFor } from '@media/shared';
import type { RequestIdentity } from '../types/express.js';
import { keys, redis } from '../lib/redis.js';
import { getDbHealth } from '../features/persistence/index.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Quota enforcement.
 *
 * Two stores, deliberately:
 *   - Redis holds the hot rolling-24h window and the live concurrency set, so
 *     the check on the enqueue path costs one round trip.
 *   - Postgres `DownloadLog` is the append-only source of truth. If Redis is
 *     flushed or replaced, the window is rehydrated from the ledger rather than
 *     silently resetting everyone's allowance to zero-used.
 *
 * Both reservations are made *before* the job is enqueued and released if the
 * job never runs, so a failed extraction does not burn a guest's 3 downloads.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
/** A job still "active" after this long is assumed dead; it stops leaking slots. */
const CONCURRENCY_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Guests are keyed on a cookie they can simply delete. The cookie stays the
 * primary key (it keeps honest shared-IP users apart), with a coarser per-IP
 * ceiling behind it so clearing cookies in a loop does not mint unlimited
 * allowances. The multiplier leaves room for genuine NAT/household sharing.
 */
const GUEST_IP_MULTIPLIER = 3;

/** Reserve a slot in the rolling window, atomically. Returns retry timing on failure. */
const RESERVE_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local used = redis.call('ZCARD', key)
if used >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = now
  if oldest[2] then oldestScore = tonumber(oldest[2]) end
  return { 0, used, oldestScore }
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return { 1, used + 1, 0 }
`;

/** Claim one of the tier's concurrent job slots. */
const RESERVE_SLOT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local staleMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - staleMs)
local active = redis.call('ZCARD', key)
if active >= max then return { 0, active } end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, staleMs)
return { 1, active + 1 }
`;

function toNumbers(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.map((v) => Number(v)) : [];
}

/**
 * Rebuilds the Redis window from the ledger the first time we see a cold key.
 * Members are the ledger's job/log ids, so a concurrent hydration by another
 * process is idempotent rather than double-counting.
 */
async function hydrateWindow(subject: string, identity: QuotaIdentity): Promise<void> {
  const key = keys.quotaWindow(subject);
  if ((await redis.exists(key)) === 1) return;

  // Degraded mode: the ledger is unreachable, so start from an empty window
  // rather than failing guest extraction (which only reads the snapshot).
  if (!getDbHealth().up) return;

  const since = new Date(Date.now() - WINDOW_MS);
  const where =
    identity.userId != null
      ? { userId: identity.userId, createdAt: { gte: since } }
      : { guestKey: identity.guestKey, createdAt: { gte: since } };

  let rows;
  try {
    rows = await prisma.downloadLog.findMany({
      where,
      select: { id: true, jobId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  } catch (err) {
    // The DB can die between probes; an unreadable ledger must not take the
    // quota snapshot (and therefore extraction) down with it.
    logger.warn({ err, subject }, 'Quota window rehydrate failed; using empty window');
    return;
  }

  if (rows.length === 0) return;

  const pipeline = redis.multi();
  for (const row of rows) {
    pipeline.zadd(key, row.createdAt.getTime(), row.jobId ?? row.id);
  }
  pipeline.pexpire(key, WINDOW_MS);
  await pipeline.exec();

  logger.debug({ subject, restored: rows.length }, 'Rehydrated download window from ledger');
}

export interface QuotaIdentity {
  userId: string | null;
  guestKey: string;
  subject: string;
  tier: Tier;
  ipHash: string;
}

export function quotaIdentity(identity: RequestIdentity): QuotaIdentity {
  return {
    userId: identity.userId,
    guestKey: identity.guestKey,
    subject: identity.subject,
    tier: identity.tier,
    ipHash: identity.ipHash,
  };
}

export interface QuotaReservation {
  /** Pass this as the Job id so releases and the ledger line up. */
  id: string;
  subject: string;
  /** Secondary guest key, released alongside the primary one. */
  ipSubject: string | null;
}

/**
 * Enforces, in order: rolling 24h downloads, the per-IP guest ceiling, and
 * concurrent jobs. Throws AppError(429/403) carrying `requiredTier` so the UI
 * can deep-link the right upsell.
 */
export async function reserveDownload(identity: QuotaIdentity): Promise<QuotaReservation> {
  const policy = policyFor(identity.tier);
  const reservationId = randomUUID();
  const reservation: QuotaReservation = {
    id: reservationId,
    subject: identity.subject,
    ipSubject: identity.userId ? null : `ip:${identity.ipHash}`,
  };

  // Pro is uncapped on both axes; skip the round trips entirely.
  const unlimitedDownloads = isUnlimited(policy.dailyDownloads);
  const unlimitedConcurrency = isUnlimited(policy.maxConcurrentJobs);

  if (!unlimitedDownloads) {
    await hydrateWindow(identity.subject, identity);

    const [ok, used, oldestScore] = toNumbers(
      await redis.eval(
        RESERVE_WINDOW,
        1,
        keys.quotaWindow(identity.subject),
        Date.now(),
        WINDOW_MS,
        policy.dailyDownloads,
        reservationId,
      ),
    );

    if (ok !== 1) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((oldestScore ?? Date.now()) + WINDOW_MS - Date.now()) / 1000),
      );
      throw AppError.tooManyRequests(
        `You have used all ${formatCount(policy.dailyDownloads)} downloads available on the ${policy.label} plan in the last 24 hours (${used ?? policy.dailyDownloads} used).`,
        retryAfterSeconds,
        identity.tier === 'GUEST' ? 'FREE' : 'PRO',
      );
    }

    if (reservation.ipSubject) {
      const [ipOk] = toNumbers(
        await redis.eval(
          RESERVE_WINDOW,
          1,
          keys.quotaWindow(reservation.ipSubject),
          Date.now(),
          WINDOW_MS,
          policy.dailyDownloads * GUEST_IP_MULTIPLIER,
          reservationId,
        ),
      );
      if (ipOk !== 1) {
        await releaseWindow(identity.subject, reservationId);
        throw AppError.tooManyRequests(
          'This network has reached the guest download limit. Create a free account to continue.',
          3600,
          'FREE',
        );
      }
    }
  }

  if (!unlimitedConcurrency) {
    const [ok, active] = toNumbers(
      await redis.eval(
        RESERVE_SLOT,
        1,
        keys.activeJobs(identity.subject),
        Date.now(),
        CONCURRENCY_STALE_MS,
        policy.maxConcurrentJobs,
        reservationId,
      ),
    );

    if (ok !== 1) {
      await release(reservation);
      throw AppError.tooManyRequests(
        `The ${policy.label} plan allows ${formatCount(policy.maxConcurrentJobs)} job${policy.maxConcurrentJobs === 1 ? '' : 's'} at a time (${active ?? 0} running). Wait for one to finish or upgrade for unlimited concurrent downloads.`,
        30,
        'PRO',
      );
    }
  }

  return reservation;
}

async function releaseWindow(subject: string, member: string): Promise<void> {
  await redis.zrem(keys.quotaWindow(subject), member);
}

/** Gives back everything a reservation took. Safe to call twice. */
export async function release(reservation: QuotaReservation): Promise<void> {
  try {
    const pipeline = redis.multi();
    pipeline.zrem(keys.quotaWindow(reservation.subject), reservation.id);
    pipeline.zrem(keys.activeJobs(reservation.subject), reservation.id);
    if (reservation.ipSubject) {
      pipeline.zrem(keys.quotaWindow(reservation.ipSubject), reservation.id);
    }
    await pipeline.exec();
  } catch (err) {
    // A leaked reservation self-heals: the window entry ages out in 24h and the
    // concurrency entry after CONCURRENCY_STALE_MS.
    logger.error({ err, reservationId: reservation.id }, 'Failed to release quota reservation');
  }
}

/** Frees only the concurrency slot — used when a job finishes but the download counts. */
export async function releaseSlot(subject: string, jobId: string): Promise<void> {
  try {
    await redis.zrem(keys.activeJobs(subject), jobId);
  } catch (err) {
    logger.error({ err, jobId }, 'Failed to release concurrency slot');
  }
}

/**
 * Writes the ledger line once bytes have actually been delivered. The Redis
 * window was already decremented at reservation time; this is what makes the
 * count survive a cache flush.
 */
export async function commitDownload(input: {
  jobId: string;
  userId: string | null;
  guestKey: string | null;
  tier: Tier;
  platform: string;
  mediaId: string;
  formatId: string;
  bytes: number;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.downloadLog.upsert({
      where: { jobId: input.jobId },
      create: {
        jobId: input.jobId,
        userId: input.userId,
        guestKey: input.guestKey,
        tier: input.tier,
        platform: input.platform,
        mediaId: input.mediaId,
        formatId: input.formatId,
        bytes: BigInt(Math.max(0, Math.round(input.bytes))),
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      },
      update: { bytes: BigInt(Math.max(0, Math.round(input.bytes))) },
    });
  } catch (err) {
    // Never fail a completed download because the ledger write failed.
    logger.error({ err, jobId: input.jobId }, 'Failed to write download ledger entry');
  }
}

export async function getQuotaSnapshot(identity: QuotaIdentity): Promise<QuotaSnapshot> {
  const policy = policyFor(identity.tier);

  if (isUnlimited(policy.dailyDownloads) && isUnlimited(policy.maxConcurrentJobs)) {
    return {
      tier: identity.tier,
      downloadsUsed: 0,
      downloadsLimit: policy.dailyDownloads,
      windowResetsAt: null,
      activeJobs: 0,
      concurrencyLimit: policy.maxConcurrentJobs,
      maxHeight: policy.maxHeight,
      maxFileSizeBytes: policy.maxFileSizeBytes,
    };
  }

  await hydrateWindow(identity.subject, identity);

  const now = Date.now();
  const windowKey = keys.quotaWindow(identity.subject);
  const activeKey = keys.activeJobs(identity.subject);

  const results = await redis
    .multi()
    .zremrangebyscore(windowKey, 0, now - WINDOW_MS)
    .zcard(windowKey)
    .zrange(windowKey, 0, 0, 'WITHSCORES')
    .zremrangebyscore(activeKey, 0, now - CONCURRENCY_STALE_MS)
    .zcard(activeKey)
    .exec();

  const downloadsUsed = Number(results?.[1]?.[1] ?? 0);
  const oldest = results?.[2]?.[1] as string[] | undefined;
  const activeJobs = Number(results?.[4]?.[1] ?? 0);

  return {
    tier: identity.tier,
    downloadsUsed,
    downloadsLimit: policy.dailyDownloads,
    windowResetsAt:
      oldest?.[1] != null ? new Date(Number(oldest[1]) + WINDOW_MS).toISOString() : null,
    activeJobs,
    concurrencyLimit: policy.maxConcurrentJobs,
    maxHeight: policy.maxHeight,
    maxFileSizeBytes: policy.maxFileSizeBytes,
  };
}

/**
 * Size gate. yt-dlp's pre-download estimate is what we have at enqueue time, so
 * the worker re-checks the real Content-Length before writing bytes to disk.
 */
export function assertSizeAllowed(tier: Tier, sizeBytes: number | null): void {
  const policy = policyFor(tier);
  if (sizeBytes == null || isUnlimited(policy.maxFileSizeBytes)) return;
  if (sizeBytes > policy.maxFileSizeBytes) {
    throw AppError.payloadTooLarge(
      `This file is larger than the ${policy.label} plan limit.`,
      tier === 'GUEST' ? 'FREE' : 'PRO',
    );
  }
}
