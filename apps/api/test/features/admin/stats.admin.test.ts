import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  hashes: new Map<string, Record<string, string>>(),
  queue: { waiting: 4, active: 1, delayed: 0, failed: 2 } as Record<string, number>,
}));

vi.mock('../../../src/config/env.js', () => ({ env: { REGION: 'eu-test' }, isProd: false }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));
vi.mock('../../../src/lib/redis.js', () => ({
  keys: {},
  redis: {
    ping: vi.fn(async () => 'PONG'),
    pipeline: () => {
      const calls: string[] = [];
      const p = {
        hgetall: (key: string) => (calls.push(key), p),
        exec: async () => calls.map((k) => [null, state.hashes.get(k) ?? {}]),
      };
      return p;
    },
    multi: () => {
      const ops: Array<() => void> = [];
      let key = '';
      const m = {
        hincrby: (k: string, field: string, n: number) => {
          key = k;
          ops.push(() => {
            const h = state.hashes.get(k) ?? {};
            h[field] = String(Number(h[field] ?? 0) + n);
            state.hashes.set(k, h);
          });
          return m;
        },
        expire: () => m,
        exec: async () => (ops.forEach((o) => o()), void key, []),
      };
      return m;
    },
  },
}));
vi.mock('../../../src/queue/queues.js', () => ({ mediaQueue: { getJobCounts: vi.fn(async () => state.queue) } }));
vi.mock('../../../src/features/health/index.js', () => ({
  getToolVersions: () => ({ ytDlp: '2026.1.1', ffmpeg: '7.0', ffprobe: '7.0' }),
}));
vi.mock('../../../src/features/persistence/index.js', () => ({ getDbHealth: () => ({ up: true }) }));
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    job: {
      groupBy: vi.fn(async () => [
        { state: 'COMPLETED', _count: { _all: 7 } },
        { state: 'FAILED', _count: { _all: 1 } },
      ]),
    },
  },
}));

import router from '../../../src/features/admin/stats.admin.js';
import { bumpStat, statKey } from '../../../src/features/admin/stats-counters.js';
import { call } from './harness.js';

beforeEach(() => state.hashes.clear());

describe('GET /stats', () => {
  it('summarises jobs today, extracts, refusals (24 h), queue depth and health', async () => {
    bumpStat('refusals', 'SOURCE_DRM');
    bumpStat('refusals', 'SOURCE_DRM');
    bumpStat('refusals', 'SOURCE_PRIVATE');
    bumpStat('extracts', 'youtube');
    // Outside the 24 h window: must not be counted.
    bumpStat('refusals', 'SOURCE_LIVE', Date.now() - 30 * 3_600_000);

    const res = await call(router, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      jobsToday: { COMPLETED: 7, FAILED: 1 },
      extractsByPlatform: { youtube: 1 },
      refusalsByCode: { SOURCE_DRM: 2, SOURCE_PRIVATE: 1 },
      queueDepth: { waiting: 4, active: 1, delayed: 0, failed: 2 },
      health: { status: 'ok', db: 'up', redis: 'up', region: 'eu-test' },
    });
    expect(res.body.data.refusalsByCode.SOURCE_LIVE).toBeUndefined();
  });

  it('buckets by UTC hour', () => {
    expect(statKey('refusals', Date.UTC(2026, 10, 25, 7, 30))).toBe('stats:refusals:2026112507');
  });
});
