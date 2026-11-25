import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { mergePolicy } from './merge.js';
import { getPolicy, setCurrentPolicy } from './policy.current.js';
import { PolicyOverridesSchema, type EffectivePolicy } from './policy.schema.js';
import { DEFAULT_POLICY } from './restrictions.config.js';

/**
 * Where the effective policy comes from at runtime.
 *
 *   boot:    active PolicyVersion row  →  last-known-good snapshot file  →  DEFAULT_POLICY
 *   change:  `policy:changed` on Redis wakes every process; a 60 s poll covers a missed message
 *
 * Every path goes through `mergePolicy`, so an invalid or empty document can never become the
 * live policy, and the hard floor in restrictions.config.ts is always layered back in. When
 * nothing can be loaded the code defaults apply: the system gets no more permissive than the
 * file in the repository.
 */

export const POLICY_CHANNEL = 'policy:changed';
const DEFAULT_POLL_MS = 60_000;

export interface PolicyStoreDeps {
  prisma: PrismaClient;
  redis: Redis;
  snapshotPath: string;
  /** Poll interval in ms; 0 disables the poll (tests). */
  pollMs?: number;
  /** Hosts to seed into the very first version. Defaults to BLOCKED_HOSTS_EXTRA. */
  seedBlockedHosts?: string[];
}

export interface PolicyStore {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPolicy(): EffectivePolicy;
  publish(overrides: unknown, note: string, actorId: string): Promise<EffectivePolicy>;
  activate(version: number, actorId: string): Promise<EffectivePolicy>;
}

interface StoredPolicy {
  version: number;
  overrides: unknown;
}

function defaultsWith(extraHosts: string[]): EffectivePolicy {
  if (extraHosts.length > 0) {
    try {
      return mergePolicy(DEFAULT_POLICY, { global: { extraBlockedHosts: extraHosts } }, 0);
    } catch {
      /* fall through to plain defaults */
    }
  }
  return mergePolicy(DEFAULT_POLICY, {}, 0);
}

/** Keeps only the hosts the schema accepts, normalised the way the schema normalises them. */
function validHosts(hosts: readonly string[]): string[] {
  const out: string[] = [];
  for (const host of hosts) {
    const parsed = PolicyOverridesSchema.safeParse({ global: { extraBlockedHosts: [host] } });
    if (parsed.success) {
      const [normalised] = parsed.data.global?.extraBlockedHosts ?? [];
      if (normalised && !out.includes(normalised)) out.push(normalised);
    } else {
      logger.warn({ host }, 'Ignoring invalid host in BLOCKED_HOSTS_EXTRA');
    }
  }
  return out;
}

export function createPolicyStore(
  deps: PolicyStoreDeps,
  options: { mirrorToGlobal?: boolean } = {},
): PolicyStore {
  const { prisma, redis, snapshotPath } = deps;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const seedHosts = validHosts(deps.seedBlockedHosts ?? env.BLOCKED_HOSTS_EXTRA ?? []);

  let current: EffectivePolicy = defaultsWith(seedHosts);
  let subscriber: ReturnType<Redis['duplicate']> | null = null;
  let timer: NodeJS.Timeout | null = null;
  /** Refreshes started by a message or the poll; stop() drains them so no snapshot write outlives the store. */
  const inflight = new Set<Promise<void>>();
  function trackRefresh(): void {
    const p = refresh().finally(() => inflight.delete(p));
    inflight.add(p);
  }

  function apply(next: EffectivePolicy): void {
    current = next;
    if (options.mirrorToGlobal) setCurrentPolicy(next);
  }

  if (options.mirrorToGlobal) setCurrentPolicy(current);

  async function readActive(): Promise<StoredPolicy | null> {
    const row = await prisma.policyVersion.findFirst({ where: { active: true }, orderBy: { version: 'desc' } });
    return row ? { version: row.version, overrides: row.overrides } : null;
  }

  /** First boot against an empty table: turn BLOCKED_HOSTS_EXTRA into version 1. */
  async function seedFirstVersion(): Promise<StoredPolicy | null> {
    if (seedHosts.length === 0) return null;
    if ((await prisma.policyVersion.count()) > 0) return null;
    const overrides = { global: { extraBlockedHosts: seedHosts } };
    const row = await prisma.policyVersion.create({
      data: { version: 1, overrides, note: 'Seeded from BLOCKED_HOSTS_EXTRA', active: true },
    });
    logger.info({ hosts: seedHosts.length }, 'Seeded policy version 1 from BLOCKED_HOSTS_EXTRA');
    return { version: row.version, overrides: row.overrides };
  }

  async function readSnapshot(): Promise<EffectivePolicy | null> {
    try {
      const parsed = JSON.parse(await readFile(snapshotPath, 'utf8')) as Partial<StoredPolicy>;
      if (typeof parsed.version !== 'number' || !Number.isInteger(parsed.version) || parsed.version < 0) return null;
      return mergePolicy(DEFAULT_POLICY, parsed.overrides, parsed.version);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err, snapshotPath }, 'Policy snapshot is unreadable; ignoring it');
      }
      return null;
    }
  }

  async function writeSnapshot(policyVersion: number, overrides: unknown): Promise<void> {
    try {
      await mkdir(path.dirname(snapshotPath), { recursive: true });
      const tmp = `${snapshotPath}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: policyVersion, overrides, savedAt: new Date().toISOString() }));
      await rename(tmp, snapshotPath);
    } catch (err) {
      // The database already has the version; the snapshot is only the outage fallback.
      logger.warn({ err, snapshotPath }, 'Could not write the policy snapshot');
    }
  }

  async function announce(version: number): Promise<void> {
    try {
      await redis.publish(POLICY_CHANNEL, String(version));
    } catch (err) {
      logger.warn({ err }, 'Could not publish policy:changed; other processes will catch up on their next poll');
    }
  }

  /** Picks up the active version from the database if it differs from what this process runs. */
  async function refresh(): Promise<void> {
    try {
      const stored = await readActive();
      if (!stored || stored.version === current.version) return;
      const next = mergePolicy(DEFAULT_POLICY, stored.overrides, stored.version);
      apply(next);
      await writeSnapshot(stored.version, stored.overrides);
      logger.info({ version: next.version }, 'Policy updated');
    } catch (err) {
      logger.warn({ err }, 'Policy refresh failed; keeping the current policy');
    }
  }

  async function boot(): Promise<void> {
    try {
      const stored = (await readActive()) ?? (await seedFirstVersion());
      if (stored) {
        apply(mergePolicy(DEFAULT_POLICY, stored.overrides, stored.version));
        await writeSnapshot(stored.version, stored.overrides);
        logger.info({ version: current.version, source: 'database' }, 'Policy loaded');
        return;
      }
      apply(defaultsWith(seedHosts));
      logger.info({ version: 0, source: 'defaults' }, 'Policy loaded (no version published yet)');
      return;
    } catch (err) {
      logger.warn({ err }, 'Could not load the policy from the database');
    }

    const snapshot = await readSnapshot();
    if (snapshot) {
      apply(snapshot);
      logger.warn({ version: snapshot.version, source: 'snapshot' }, 'Policy loaded from the last-known-good snapshot');
      return;
    }
    apply(defaultsWith(seedHosts));
    logger.warn({ version: 0, source: 'defaults' }, 'Policy loaded from the code defaults');
  }

  /** Imported lazily: the audit service pulls in auth and billing code the store does not otherwise need. */
async function audit(input: { userId: string; action: string; metadata: Record<string, unknown> }): Promise<void> {
  const { recordAudit } = await import('../../services/user.service.js');
  await recordAudit({ ...input, outcome: 'success' });
}

function dbUnavailable(err: unknown): never {
    if (err instanceof AppError) throw err;
    logger.error({ err }, 'Policy database write failed');
    throw AppError.unavailable('The policy could not be saved because the database is unavailable.');
  }

  return {
    async start() {
      await boot();

      try {
        subscriber = redis.duplicate();
        subscriber.on('error', (err: unknown) => logger.warn({ err }, 'Policy subscriber error'));
        subscriber.on('message', (channel: string) => {
          if (channel === POLICY_CHANNEL) trackRefresh();
        });
        void Promise.resolve(subscriber.subscribe(POLICY_CHANNEL)).catch((err: unknown) =>
          logger.warn({ err }, 'Could not subscribe to policy:changed; relying on polling'),
        );
      } catch (err) {
        logger.warn({ err }, 'Could not subscribe to policy:changed; relying on polling');
      }

      if (pollMs > 0) {
        timer = setInterval(trackRefresh, pollMs);
        timer.unref();
      }
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      const sub = subscriber;
      subscriber = null;
      if (sub) await Promise.resolve(sub.quit()).catch(() => sub.disconnect());
      await Promise.all([...inflight]);
    },

    getPolicy: () => current,

    async publish(overrides, note, actorId) {
      // Round-trip through JSON first: what is stored must be exactly what validates.
      const stored: unknown = JSON.parse(JSON.stringify(overrides ?? {}));
      mergePolicy(DEFAULT_POLICY, stored, 0); // 422 POLICY_INVALID, nothing written

      let version: number;
      try {
        const row = await prisma.$transaction(async (tx) => {
          const agg = await tx.policyVersion.aggregate({ _max: { version: true } });
          const next = (agg._max.version ?? 0) + 1;
          await tx.policyVersion.updateMany({ where: { active: true }, data: { active: false } });
          return tx.policyVersion.create({
            data: {
              version: next,
              overrides: stored as object,
              note: note.slice(0, 500),
              active: true,
              createdById: actorId,
            },
          });
        });
        version = row.version;
      } catch (err) {
        return dbUnavailable(err);
      }

      const effective = mergePolicy(DEFAULT_POLICY, stored, version);
      apply(effective);
      await writeSnapshot(version, stored);
      await announce(version);
      await audit({ userId: actorId, action: 'policy.publish', metadata: { version, note: note.slice(0, 500) } });
      return effective;
    },

    async activate(version, actorId) {
      let row;
      try {
        row = await prisma.policyVersion.findUnique({ where: { version } });
      } catch (err) {
        return dbUnavailable(err);
      }
      if (!row) throw AppError.notFound(`Policy version ${version} does not exist`);

      const effective = mergePolicy(DEFAULT_POLICY, row.overrides, row.version); // 422 if it no longer validates

      try {
        await prisma.$transaction(async (tx) => {
          await tx.policyVersion.updateMany({ where: { active: true }, data: { active: false } });
          await tx.policyVersion.update({ where: { version }, data: { active: true } });
        });
      } catch (err) {
        return dbUnavailable(err);
      }

      apply(effective);
      await writeSnapshot(row.version, row.overrides);
      await announce(row.version);
      await audit({ userId: actorId, action: 'policy.activate', metadata: { version } });
      return effective;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Process-wide instance: what the API and the worker use.
// ---------------------------------------------------------------------------------------------

let instance: PolicyStore | null = null;

function requireStore(): PolicyStore {
  if (!instance) throw AppError.unavailable('The policy store has not started yet.');
  return instance;
}

export async function startPolicyStore(deps: PolicyStoreDeps): Promise<void> {
  if (instance) await instance.stop();
  instance = createPolicyStore(deps, { mirrorToGlobal: true });
  await instance.start();
}

export async function stopPolicyStore(): Promise<void> {
  await instance?.stop();
  instance = null;
}

export function publishPolicy(overrides: unknown, note: string, actorId: string): Promise<EffectivePolicy> {
  return requireStore().publish(overrides, note, actorId);
}

export function activatePolicyVersion(version: number, actorId: string): Promise<EffectivePolicy> {
  return requireStore().activate(version, actorId);
}

export { getPolicy };
