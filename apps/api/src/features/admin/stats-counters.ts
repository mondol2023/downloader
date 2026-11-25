import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

/**
 * Hourly Redis counters behind /admin/stats. Fire-and-forget: a counter that can't be written
 * must never fail the request that triggered it. Buckets live 26 h so a 24 h window is complete.
 */
export type StatKind = 'refusals' | 'extracts';

const HOUR_MS = 3_600_000;
const TTL_SECONDS = 26 * 3600;

export function statKey(kind: StatKind, at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `stats:${kind}:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
}

export function bumpStat(kind: StatKind, field: string, now = Date.now()): void {
  try {
    const key = statKey(kind, now);
    redis
      .multi()
      .hincrby(key, field, 1)
      .expire(key, TTL_SECONDS)
      .exec()
      .catch((err: unknown) => logger.warn({ err, kind, field }, 'Stat counter write failed'));
  } catch (err) {
    logger.warn({ err, kind, field }, 'Stat counter write failed');
  }
}

/** Sums the last 24 hourly buckets into { field: count }. */
export async function readStats(kind: StatKind, now = Date.now()): Promise<Record<string, number>> {
  const pipeline = redis.pipeline();
  for (let i = 0; i < 24; i++) pipeline.hgetall(statKey(kind, now - i * HOUR_MS));
  const results = (await pipeline.exec()) ?? [];
  const totals: Record<string, number> = {};
  for (const [err, hash] of results) {
    if (err || !hash) continue;
    for (const [field, count] of Object.entries(hash as Record<string, string>)) {
      totals[field] = (totals[field] ?? 0) + Number(count);
    }
  }
  return totals;
}
