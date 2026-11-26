import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Rule } from '@media/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Admin rules at every enforcement point: the pure guards, the height cap folded into the tier
 * policy, and the real media/jobs routers (including the cached lookups that never call
 * `extractMedia`, so a published rule cannot be bypassed by reloading a media page).
 */

const strings = new Map<string, string>();
const redisMock = {
  get: vi.fn(async (k: string) => strings.get(k) ?? null),
  set: vi.fn(async (k: string, v: string, ...rest: unknown[]) => {
    if (rest.includes('NX') && strings.has(k)) return null;
    strings.set(k, v);
    return 'OK';
  }),
  del: vi.fn(async (k: string) => (strings.delete(k) ? 1 : 0)),
  exists: vi.fn(async (k: string) => (strings.has(k) ? 1 : 0)),
  eval: vi.fn(async () => [1, 1, null]),
  zrem: vi.fn(async () => 1),
  multi() {
    const chain: Record<string, unknown> = {};
    const noop = () => chain;
    for (const name of ['zrem', 'zremrangebyscore', 'zcard', 'zadd', 'zrange', 'pexpire']) chain[name] = noop;
    chain.exec = async () => [];
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
vi.mock('../../../src/queue/queues.js', () => ({
  enqueueMediaJob: vi.fn(async () => undefined),
  removeQueuedJob: vi.fn(),
}));
vi.mock('../../../src/services/user.service.js', () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock('../../../src/services/stream.service.js', () => ({
  assertFetchableUrl: vi.fn(() => new URL('https://upstream.invalid/subs.vtt')),
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
const { normaliseSourceUrl } = await import('../../../src/lib/source-url.js');
const { DEFAULT_POLICY } = await import('../../../src/features/restrictions/restrictions.config.js');
const { mergePolicy } = await import('../../../src/features/restrictions/merge.js');
const { setCurrentPolicy } = await import('../../../src/features/restrictions/policy.current.js');
const enforce = await import('../../../src/features/restrictions/enforce.js');

let n = 0;
function rule(r: Record<string, unknown>): Rule {
  n += 1;
  return { id: `r${n}`, name: `Rule ${n}`, enabled: true, ...r } as Rule;
}
function useRules(...rules: Rule[]): void {
  setCurrentPolicy(mergePolicy(DEFAULT_POLICY, { rules } as never, 1));
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}
const BLOCKED = { status: 403, code: 'SOURCE_RULE_BLOCKED' };

const YT = 'https://www.youtube.com/watch?v=abc';
const ytSource = { canonical: YT, host: 'www.youtube.com', platform: 'youtube' };
const media = {
  platform: 'youtube',
  durationSeconds: 600,
  ageLimit: 0,
  title: 'A cooking show',
  uploader: 'Some Channel',
};

beforeEach(() => {
  useRules();
});

describe('assertRulesAllowSource', () => {
  it('refuses a matching rule with its own message, passes otherwise', () => {
    useRules(rule({ type: 'block_platform', params: { platform: 'youtube', actions: ['extract'] }, message: 'Not here' }));
    expect(thrown(() => enforce.assertRulesAllowSource(ytSource, 'GUEST'))).toMatchObject({ ...BLOCKED, message: 'Not here' });
    expect(() => enforce.assertRulesAllowSource({ ...ytSource, platform: 'vimeo' }, 'GUEST')).not.toThrow();
  });

  it('skips a disabled rule and an unknown platform', () => {
    useRules(rule({ type: 'block_platform', enabled: false, params: { platform: 'youtube', actions: ['extract'] } }));
    expect(() => enforce.assertRulesAllowSource(ytSource, 'GUEST')).not.toThrow();
    useRules(rule({ type: 'block_platform', params: { platform: 'youtube', actions: ['extract'] } }));
    expect(() => enforce.assertRulesAllowSource({ canonical: 'https://x.example.org/a', host: 'x.example.org', platform: 'somesite' }, 'GUEST')).not.toThrow();
  });

  it('applies tier_only by tier', () => {
    useRules(rule({ type: 'tier_only', params: { minTier: 'PRO', platforms: ['youtube'] } }));
    expect(thrown(() => enforce.assertRulesAllowSource(ytSource, 'FREE'))).toMatchObject(BLOCKED);
    expect(() => enforce.assertRulesAllowSource(ytSource, 'PRO')).not.toThrow();
  });
});

describe('assertRulesAllowMedia', () => {
  it('refuses on a keyword in the title and on duration, passes a clean record', () => {
    useRules(rule({ type: 'block_keyword', params: { text: 'cooking', fields: ['title'] } }));
    expect(thrown(() => enforce.assertRulesAllowMedia(media, 'GUEST'))).toMatchObject(BLOCKED);
    expect(() => enforce.assertRulesAllowMedia({ ...media, title: 'Gardening' }, 'GUEST')).not.toThrow();

    useRules(rule({ type: 'max_duration', params: { seconds: 300 } }));
    expect(thrown(() => enforce.assertRulesAllowMedia(media, 'GUEST'))).toMatchObject({ ...BLOCKED, message: 'Longer than the 5-minute limit.' });
    expect(() => enforce.assertRulesAllowMedia({ ...media, durationSeconds: null }, 'GUEST')).not.toThrow();
  });
});

describe('assertRulesAllowAction', () => {
  it('derives the host from the canonical url and honours the blocked action', () => {
    useRules(rule({ type: 'block_host', params: { hosts: ['youtube.com'] } }));
    expect(thrown(() => enforce.assertRulesAllowAction({ action: 'download', platform: 'youtube', canonicalUrl: YT }, 'FREE'))).toMatchObject(BLOCKED);

    useRules(rule({ type: 'block_platform', params: { platform: 'youtube', actions: ['download'] } }));
    expect(thrown(() => enforce.assertRulesAllowAction({ action: 'download', platform: 'youtube', canonicalUrl: YT }, 'FREE'))).toMatchObject(BLOCKED);
    expect(() => enforce.assertRulesAllowAction({ action: 'playback', platform: 'youtube', canonicalUrl: YT }, 'FREE')).not.toThrow();
  });
});

describe('max_height rule in the tier policy', () => {
  it('lowers maxHeight only for the scoped tier and platform', () => {
    useRules(rule({ type: 'max_height', params: { height: 360, tiers: ['FREE'], platforms: ['youtube'] } }));
    expect(enforce.tierPolicyFor('FREE', 'youtube').maxHeight).toBe(360);
    expect(enforce.tierPolicyFor('PRO', 'youtube').maxHeight).not.toBe(360);
    expect(enforce.tierPolicyFor('FREE', 'tiktok').maxHeight).not.toBe(360);
    expect(enforce.evaluateAccess('FREE', { height: 720 }, 'youtube')).toEqual({ allowed: false, reason: 'RESOLUTION' });
  });
});

describe('assertRulesAllowRecord', () => {
  const record = (over: Record<string, unknown> = {}) =>
    ({ media: { ...media, id: 'm1', sourceUrl: YT, ...over }, formats: [], urls: {}, subtitleSources: {} }) as never;

  it('refuses a cached record by url pattern and by keyword', () => {
    useRules(rule({ type: 'block_url_pattern', params: { pattern: '*/watch?v=abc' } }));
    expect(thrown(() => enforce.assertRulesAllowRecord(record(), 'GUEST'))).toMatchObject(BLOCKED);

    useRules(rule({ type: 'block_keyword', params: { text: 'cooking', fields: ['title'] } }));
    expect(thrown(() => enforce.assertRulesAllowRecord(record(), 'GUEST'))).toMatchObject(BLOCKED);

    useRules();
    expect(() => enforce.assertRulesAllowRecord(record(), 'GUEST')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// Through the real routers
// ---------------------------------------------------------------------------------------------

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.identity = { userId: 'u1', guestKey: 'g1', subject: 'user:u1', tier: 'FREE', email: null, ipHash: 'h1' };
    next();
  });
  app.use('/media', mediaRoutes);
  app.use('/jobs', jobsRoutes);
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

async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeEach(() => {
  strings.clear();
  runCommand.mockReset();
  runCommand.mockImplementation(async () => ({ stdout: JSON.stringify(fixture()) }));
  jobCreate.mockClear();
});

describe('POST /media/extract with rules', () => {
  it('a source-stage rule refuses before yt-dlp and leaves no refusal-cache entry', async () => {
    useRules(rule({ id: 'blk', type: 'block_url_pattern', params: { pattern: '*/watch?v=abc' } }));
    const res = await send('POST', '/media/extract', { url: YT });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('SOURCE_RULE_BLOCKED');
    expect(runCommand).not.toHaveBeenCalled();
    expect([...strings.keys()].some((k) => k.startsWith('elig:'))).toBe(false);

    useRules(rule({ id: 'blk', type: 'block_url_pattern', enabled: false, params: { pattern: '*/watch?v=abc' } }));
    expect((await send('POST', '/media/extract', { url: YT })).status).toBe(200);
  });

  it('a metadata-stage rule applies to a record that was cached before it existed', async () => {
    expect((await send('POST', '/media/extract', { url: YT })).status).toBe(200);
    useRules(rule({ type: 'max_duration', params: { seconds: 300 } }));
    const res = await send('POST', '/media/extract', { url: YT });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('SOURCE_RULE_BLOCKED');
  });
});

describe('POST /jobs with rules', () => {
  it('a platform blocked for download is refused and no job is created', async () => {
    useRules(rule({ type: 'block_platform', params: { platform: 'youtube', actions: ['download'] } }));
    const res = await send('POST', '/jobs', { url: YT, formatId: 'clear-360' });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('SOURCE_RULE_BLOCKED');
    expect(jobCreate).not.toHaveBeenCalled();
  });
});

describe('cached lookups apply rules too', () => {
  const seed = () => {
    const id = normaliseSourceUrl(YT).mediaId;
    const rec = {
      media: { ...media, id, sourceUrl: YT, canonicalUrl: YT, subtitles: [], chapters: [] },
      formats: [],
      urls: {},
      subtitleSources: { en: { url: 'https://upstream.invalid/subs.vtt', ext: 'vtt', auto: false, label: 'English' } },
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    strings.set(`media:extract:${id}`, JSON.stringify(rec));
    return id;
  };

  it('GET /media/:mediaId returns 403 once a matching rule is published', async () => {
    const id = seed();
    expect((await send('GET', `/media/${id}`)).status).toBe(200);
    useRules(rule({ type: 'block_keyword', params: { text: 'cooking', fields: ['title'] } }));
    const res = await send('GET', `/media/${id}`);
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('SOURCE_RULE_BLOCKED');
  });

  it('GET /media/:mediaId/subtitles/:lang returns 403 before fetching upstream', async () => {
    const id = seed();
    useRules(rule({ type: 'block_url_pattern', params: { pattern: '*/watch?v=abc' } }));
    const res = await send('GET', `/media/${id}/subtitles/en`);
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('SOURCE_RULE_BLOCKED');
  });
});
