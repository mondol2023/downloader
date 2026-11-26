import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Enforcement points. The first block exercises the pure guards; the second drives the real
 * Express routers (extraction, quota, jobs) against an in-memory Redis so a policy change is
 * proven to change what a request gets back.
 */

const strings = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();

function zset(key: string): Map<string, number> {
  let z = zsets.get(key);
  if (!z) zsets.set(key, (z = new Map()));
  return z;
}
function sorted(key: string): Array<[string, number]> {
  return [...zset(key).entries()].sort((a, b) => a[1] - b[1]);
}
const ops = {
  zrem: (key: string, member: string) => (zset(key).delete(member) ? 1 : 0),
  zremrangebyscore: (key: string, _min: number, max: number) => {
    let n = 0;
    for (const [m, s] of [...zset(key)]) if (s <= max) (zset(key).delete(m), n++);
    return n;
  },
  zcard: (key: string) => zset(key).size,
  zadd: (key: string, score: number, member: string) => (zset(key).set(member, Number(score)), 1),
  zrange: (key: string, _a: number, _b: number, withScores?: string) => {
    const first = sorted(key)[0];
    return first ? (withScores ? [first[0], String(first[1])] : [first[0]]) : [];
  },
  pexpire: () => 1,
};

const redisMock = {
  get: vi.fn(async (k: string) => strings.get(k) ?? null),
  set: vi.fn(async (k: string, v: string, ...rest: unknown[]) => {
    if (rest.includes('NX') && strings.has(k)) return null;
    strings.set(k, v);
    return 'OK';
  }),
  del: vi.fn(async (k: string) => (strings.delete(k) ? 1 : 0)),
  exists: vi.fn(async (k: string) => (strings.has(k) || zset(k).size > 0 ? 1 : 0)),
  zrem: vi.fn(async (k: string, m: string) => ops.zrem(k, m)),
  /** Stands in for both reserve scripts, which share the shape (now, windowMs, limit, member). */
  eval: vi.fn(async (_script: string, _n: number, key: string, now: number, windowMs: number, limit: number, member: string) => {
    ops.zremrangebyscore(key, 0, Number(now) - Number(windowMs));
    const used = ops.zcard(key);
    const oldest = sorted(key)[0]?.[1] ?? null;
    if (used >= Number(limit)) return [0, used, oldest];
    ops.zadd(key, Number(now), member);
    return [1, used + 1, oldest];
  }),
  multi() {
    const queue: Array<() => unknown> = [];
    const chain: Record<string, (...args: never[]) => unknown> = {};
    for (const name of Object.keys(ops) as Array<keyof typeof ops>) {
      chain[name] = ((...args: unknown[]) => {
        queue.push(() => (ops[name] as (...a: unknown[]) => unknown)(...args));
        return chain;
      }) as never;
    }
    chain.exec = (async () => queue.map((run) => [null, run()])) as never;
    return chain as never;
  },
};

vi.mock('../../../src/config/env.js', () => ({
  env: {
    YTDLP_PATH: 'yt-dlp',
    YTDLP_COOKIES_FILE: undefined,
    EXTRACTION_TIMEOUT_MS: 1000,
    ARTIFACT_TTL: 3600,
    STORAGE_DIR: './storage',
  },
  isProd: false,
}));
vi.mock('../../../src/lib/redis.js', () => ({
  redis: redisMock,
  keys: {
    extraction: (id: string) => `media:extract:${id}`,
    extractionLock: (id: string) => `media:extract:lock:${id}`,
    eligibilityRefusal: (id: string) => `elig:${id}`,
    quotaWindow: (s: string) => `quota:downloads:${s}`,
    activeJobs: (s: string) => `quota:active:${s}`,
    rateLimit: (b: string, s: string) => `rl:${b}:${s}`,
    jobProgress: (id: string) => `job:progress:${id}`,
  },
}));
const jobCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }));
vi.mock('../../../src/lib/prisma.js', () => ({ prisma: { job: { create: jobCreate }, downloadLog: { findMany: vi.fn(async () => []) } } }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/features/persistence/index.js', () => ({
  getDbHealth: () => ({ up: false }),
  recordLedger: vi.fn(async () => undefined),
}));
vi.mock('../../../src/middleware/identity.js', () => ({
  refreshTierFromDb: (_req: unknown, _res: unknown, next: () => void) => next(),
  clientIp: () => '127.0.0.1',
}));
vi.mock('../../../src/middleware/rate-limit.js', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { rateLimit: () => pass, extractionRateLimit: pass };
});
vi.mock('../../../src/services/job.service.js', () => ({
  findOwnedJob: vi.fn(),
  listJobs: vi.fn(),
  requestCancellation: vi.fn(),
  toJobSummary: async (row: { id: string }) => ({ id: row.id }),
}));
const enqueueMediaJob = vi.fn(async (_payload: unknown) => undefined);
vi.mock('../../../src/queue/queues.js', () => ({ enqueueMediaJob, removeQueuedJob: vi.fn() }));
vi.mock('../../../src/services/user.service.js', () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock('../../../src/services/stream.service.js', () => ({
  assertFetchableUrl: vi.fn(),
  mintPlaybackGrant: vi.fn(() => ({ url: 'grant' })),
}));
const runCommand = vi.fn();
vi.mock('../../../src/lib/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/exec.js')>('../../../src/lib/exec.js');
  return { ...actual, runCommand };
});

const { default: express } = await import('express');
const { errorHandler } = await import('../../../src/middleware/error-handler.js');
const { default: mediaRoutes } = await import('../../../src/routes/media.routes.js');
const { default: jobsRoutes } = await import('../../../src/routes/jobs.routes.js');
const { default: policyRoutes } = await import('../../../src/features/restrictions/policy.routes.js');
const { normaliseSourceUrl } = await import('../../../src/lib/source-url.js');
const { DEFAULT_POLICY } = await import('../../../src/features/restrictions/restrictions.config.js');
const { mergePolicy } = await import('../../../src/features/restrictions/merge.js');
const { setCurrentPolicy } = await import('../../../src/features/restrictions/policy.current.js');
const enforce = await import('../../../src/features/restrictions/enforce.js');

function usePolicy(overrides: unknown = {}): void {
  setCurrentPolicy(mergePolicy(DEFAULT_POLICY, overrides, 1));
}

function code(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

beforeEach(() => {
  usePolicy({});
});

describe('assertPlatformAllowed', () => {
  it('passes when the platform is enabled and for platforms the policy does not know', () => {
    expect(() => enforce.assertPlatformAllowed('youtube', 'extract')).not.toThrow();
    expect(() => enforce.assertPlatformAllowed('some-niche-site', 'download')).not.toThrow();
  });

  it('disabled platform → 403 SOURCE_PLATFORM_DISABLED for every action', () => {
    usePolicy({ platforms: { tiktok: { enabled: false } } });
    for (const action of ['extract', 'download', 'playback'] as const) {
      expect(code(() => enforce.assertPlatformAllowed('tiktok', action))).toMatchObject({
        status: 403,
        code: 'SOURCE_PLATFORM_DISABLED',
      });
    }
  });

  it('download:false blocks only downloads; playback:false blocks only playback', () => {
    usePolicy({ platforms: { vimeo: { download: false }, twitch: { playback: false } } });
    expect(() => enforce.assertPlatformAllowed('vimeo', 'extract')).not.toThrow();
    expect(() => enforce.assertPlatformAllowed('vimeo', 'playback')).not.toThrow();
    expect(code(() => enforce.assertPlatformAllowed('vimeo', 'download'))).toMatchObject({ code: 'SOURCE_PLATFORM_DISABLED' });
    expect(() => enforce.assertPlatformAllowed('twitch', 'download')).not.toThrow();
    expect(code(() => enforce.assertPlatformAllowed('twitch', 'playback'))).toMatchObject({ code: 'SOURCE_PLATFORM_DISABLED' });
  });
});

describe('global switches', () => {
  it('maintenanceMode → 503 MAINTENANCE carrying the configured message', () => {
    usePolicy({ global: { maintenanceMode: true, maintenanceMessage: 'Back at 5' } });
    expect(code(() => enforce.assertDownloadsOpen())).toMatchObject({ status: 503, code: 'MAINTENANCE', message: 'Back at 5' });
    expect(() => enforce.assertExtractionOpen()).not.toThrow();
  });

  it('downloadsEnabled=false → 503 DOWNLOADS_PAUSED', () => {
    usePolicy({ global: { downloadsEnabled: false } });
    expect(code(() => enforce.assertDownloadsOpen())).toMatchObject({ status: 503, code: 'DOWNLOADS_PAUSED' });
  });

  it('extractionEnabled=false → 503 EXTRACTION_DISABLED', () => {
    usePolicy({ global: { extractionEnabled: false } });
    expect(code(() => enforce.assertExtractionOpen())).toMatchObject({ status: 503, code: 'EXTRACTION_DISABLED' });
  });

  it('maxDurationSec rejects longer media and accepts unknown durations', () => {
    usePolicy({ global: { maxDurationSec: 60 } });
    expect(code(() => enforce.assertDurationAllowed(61))).toMatchObject({ status: 422, code: 'SOURCE_TOO_LONG' });
    expect(() => enforce.assertDurationAllowed(60)).not.toThrow();
    expect(() => enforce.assertDurationAllowed(null)).not.toThrow();
  });
});

describe('effective tier limits', () => {
  it('tierPolicyFor reads quotas from the policy and keeps static metadata', () => {
    usePolicy({ tiers: { FREE: { dailyDownloads: 1 } } });
    const free = enforce.tierPolicyFor('FREE');
    expect(free.dailyDownloads).toBe(1);
    expect(free.label).toBe('Free');
    expect(free.queuePriority).toBe(5);
  });

  it('platform maxHeight is intersected with the tier maxHeight', () => {
    usePolicy({ platforms: { youtube: { maxHeight: 480 } } });
    expect(enforce.tierPolicyFor('FREE', 'youtube').maxHeight).toBe(480);
    expect(enforce.tierPolicyFor('FREE', 'vimeo').maxHeight).toBe(1080);
    expect(enforce.tierPolicyFor('GUEST', 'youtube').maxHeight).toBe(480);
    usePolicy({ platforms: { youtube: { maxHeight: 4000 } } });
    expect(enforce.tierPolicyFor('GUEST', 'youtube').maxHeight).toBe(720);
  });

  it('evaluateAccess locks a rendition above the platform cap and names the tier that could use it', () => {
    usePolicy({ platforms: { youtube: { maxHeight: 480 } } });
    expect(enforce.evaluateAccess('PRO', { height: 1080 }, 'youtube')).toEqual({ allowed: false, reason: 'RESOLUTION' });
    expect(enforce.evaluateAccess('PRO', { height: 1080 }, 'vimeo')).toEqual({ allowed: true, reason: null });
    expect(enforce.evaluateAccess('FREE', { height: 360 }, 'youtube').allowed).toBe(true);
  });
});

describe('source URL checks', () => {
  it('a disabled platform is refused when the URL is normalised', () => {
    usePolicy({ platforms: { tiktok: { enabled: false } } });
    expect(code(() => normaliseSourceUrl('https://www.tiktok.com/@a/video/1'))).toMatchObject({
      status: 403,
      code: 'SOURCE_PLATFORM_DISABLED',
    });
  });

  it('admin extraBlockedHosts are refused as SOURCE_BLOCKED_DOMAIN', () => {
    usePolicy({ global: { extraBlockedHosts: ['bad.example.com'] } });
    expect(code(() => normaliseSourceUrl('https://cdn.bad.example.com/x'))).toMatchObject({
      status: 403,
      code: 'SOURCE_BLOCKED_DOMAIN',
    });
    expect(() => normaliseSourceUrl('https://good.example.com/x')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// Through the real routers
// ---------------------------------------------------------------------------------------------

let server: Server;
let base = '';
let tier: 'GUEST' | 'FREE' | 'PRO' = 'FREE';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.identity = { userId: 'u1', guestKey: 'g1', subject: 'user:u1', tier, email: null, ipHash: 'h1' };
    next();
  });
  app.use('/media', mediaRoutes);
  app.use('/jobs', jobsRoutes);
  app.use('/policy', policyRoutes);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fixture(): Record<string, unknown> {
  const payload = JSON.parse(readFileSync(new URL('../../fixtures/ytdlp/drm-mixed.json', import.meta.url), 'utf8'));
  return { ...payload, duration: 600 };
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const YT = 'https://www.youtube.com/watch?v=abc';

beforeEach(() => {
  strings.clear();
  zsets.clear();
  tier = 'FREE';
  runCommand.mockReset();
  runCommand.mockImplementation(async () => ({ stdout: JSON.stringify(fixture()) }));
  jobCreate.mockClear();
  enqueueMediaJob.mockClear();
});

describe('POST /media/extract', () => {
  it('platform tiktok disabled → POST /media/extract with a TikTok URL → 403 SOURCE_PLATFORM_DISABLED', async () => {
    usePolicy({ platforms: { tiktok: { enabled: false } } });
    const res = await post('/media/extract', { url: 'https://www.tiktok.com/@a/video/123' });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('SOURCE_PLATFORM_DISABLED');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('maintenanceMode leaves extraction working', async () => {
    usePolicy({ global: { maintenanceMode: true } });
    const res = await post('/media/extract', { url: YT });
    expect(res.status).toBe(200);
  });

  it('extractionEnabled=false → 503 EXTRACTION_DISABLED, even for a cached record', async () => {
    expect((await post('/media/extract', { url: YT })).status).toBe(200);
    usePolicy({ global: { extractionEnabled: false } });
    const res = await post('/media/extract', { url: YT });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('EXTRACTION_DISABLED');
  });

  it('media longer than maxDurationSec → 422 SOURCE_TOO_LONG, including from the cache', async () => {
    expect((await post('/media/extract', { url: YT })).status).toBe(200);
    usePolicy({ global: { maxDurationSec: 300 } });
    const res = await post('/media/extract', { url: YT });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('SOURCE_TOO_LONG');
  });

  it('platform maxHeight locks taller renditions in the response', async () => {
    usePolicy({ platforms: { youtube: { maxHeight: 480 } } });
    const res = await post('/media/extract', { url: YT });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.json.data.formats.map((f: { id: string; allowed: boolean }) => [f.id, f.allowed]));
    expect(byId['clear-360']).toBe(true);
    expect(byId['clear-1080']).toBe(false);
  });
});

describe('POST /jobs', () => {
  it('maintenanceMode → POST /jobs → 503 MAINTENANCE and no quota is spent', async () => {
    usePolicy({ global: { maintenanceMode: true, maintenanceMessage: 'Back soon' } });
    const res = await post('/jobs', { url: YT, formatId: 'clear-360' });
    expect(res.status).toBe(503);
    expect(res.json.error).toMatchObject({ code: 'MAINTENANCE', message: 'Back soon' });
    expect(zsets.size).toBe(0);
    expect(jobCreate).not.toHaveBeenCalled();
  });

  it('downloadsEnabled=false → 503 DOWNLOADS_PAUSED', async () => {
    usePolicy({ global: { downloadsEnabled: false } });
    const res = await post('/jobs', { url: YT, formatId: 'clear-360' });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('DOWNLOADS_PAUSED');
  });

  it('platform download:false → 403 SOURCE_PLATFORM_DISABLED while extraction still works', async () => {
    usePolicy({ platforms: { youtube: { download: false } } });
    expect((await post('/media/extract', { url: YT })).status).toBe(200);
    const res = await post('/jobs', { url: YT, formatId: 'clear-360' });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('SOURCE_PLATFORM_DISABLED');
    expect(jobCreate).not.toHaveBeenCalled();
  });

  it('a rendition above the platform maxHeight is refused', async () => {
    usePolicy({ platforms: { youtube: { maxHeight: 480 } } });
    const res = await post('/jobs', { url: YT, formatId: 'clear-1080' });
    expect(res.status).toBe(403);
    expect(jobCreate).not.toHaveBeenCalled();
    expect((await post('/jobs', { url: YT, formatId: 'clear-360' })).status).toBe(202);
  });

  it('FREE dailyDownloads overridden to 1 → second job → 429', async () => {
    usePolicy({ tiers: { FREE: { dailyDownloads: 1 } } });
    const first = await post('/jobs', { url: YT, formatId: 'clear-360' });
    expect(first.status).toBe(202);
    const second = await post('/jobs', { url: YT, formatId: 'clear-360' });
    expect(second.status).toBe(429);
    expect(second.json.error.code).toBe('TOO_MANY_REQUESTS');
    expect(jobCreate).toHaveBeenCalledTimes(1);
  });

  it('with the default policy FREE still gets its default allowance', async () => {
    expect((await post('/jobs', { url: YT, formatId: 'clear-360' })).status).toBe(202);
    expect((await post('/jobs', { url: YT, formatId: 'clear-360' })).status).toBe(202);
  });
});

describe('GET /policy/public', () => {
  it('serves the effective tier limits and platform switches, cacheable for 30 s', async () => {
    usePolicy({ tiers: { FREE: { dailyDownloads: 1 } }, platforms: { tiktok: { enabled: false } } });
    const res = await fetch(`${base}/policy/public`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=30');
    const { data } = await res.json();
    expect(data.version).toBe(1);
    expect(data.tiers.FREE.dailyDownloads).toBe(1);
    expect(data.platforms.tiktok).toEqual({ enabled: false, download: true });
    expect(JSON.stringify(data)).not.toContain('hardFloor');
    expect(JSON.stringify(data)).not.toContain('extraBlockedHosts');
  });
});
