import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const redisMock = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => {
    store.set(k, v);
    return 'OK';
  }),
  del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
};

vi.mock('../../../src/config/env.js', () => ({
  env: { YTDLP_PATH: 'yt-dlp', YTDLP_COOKIES_FILE: undefined, EXTRACTION_TIMEOUT_MS: 1000 },
}));
vi.mock('../../../src/lib/redis.js', () => ({
  redis: redisMock,
  keys: {
    extraction: (id: string) => `media:extract:${id}`,
    extractionLock: (id: string) => `media:extract:lock:${id}`,
    eligibilityRefusal: (id: string) => `elig:${id}`,
  },
}));
vi.mock('../../../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../../src/features/persistence/index.js', () => ({ getDbHealth: () => ({ up: false }) }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const runCommand = vi.fn();
vi.mock('../../../src/lib/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/exec.js')>('../../../src/lib/exec.js');
  return { ...actual, runCommand };
});

const { buildRecord, extractMedia, translateExtractionError } = await import(
  '../../../src/services/extraction.service.js'
);
const { normaliseSourceUrl } = await import('../../../src/lib/source-url.js');
const { CommandError } = await import('../../../src/lib/exec.js');
const { AppError } = await import('../../../src/lib/errors.js');

function fixture(name: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`../../fixtures/ytdlp/${name}.json`, import.meta.url), 'utf8'));
}

const yt = normaliseSourceUrl('https://www.youtube.com/watch?v=abc');
const generic = normaliseSourceUrl('https://video.example.com/watch/ghi');

function refusal(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('buildRecord eligibility', () => {
  it('private.json → SOURCE_PRIVATE / 403', () => {
    const err = refusal(() => buildRecord(yt, fixture('private')));
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 403, code: 'SOURCE_PRIVATE' });
  });

  it('members.json → SOURCE_MEMBERS_ONLY / 403', () => {
    const err = refusal(() => buildRecord(yt, fixture('members')));
    expect(err).toMatchObject({ status: 403, code: 'SOURCE_MEMBERS_ONLY' });
  });

  it('drm-mixed.json → record with the DRM format removed', () => {
    const rec = buildRecord(generic, fixture('drm-mixed'));
    const ids = rec.formats.map((f: { id: string }) => f.id);
    expect(ids).toContain('clear-360');
    expect(ids).toContain('clear-1080');
    expect(ids).not.toContain('drm-720');
    expect(rec.urls['drm-720']).toBeUndefined();
  });

  it('every format DRM → SOURCE_DRM', () => {
    const payload = fixture('drm-mixed');
    for (const f of payload.formats) f.has_drm = true;
    expect(refusal(() => buildRecord(generic, payload))).toMatchObject({ code: 'SOURCE_DRM' });
  });

  it('age_limit 18 → SOURCE_AGE_RESTRICTED; live → SOURCE_LIVE', () => {
    const aged = { ...fixture('drm-mixed'), age_limit: 18 };
    expect(refusal(() => buildRecord(generic, aged))).toMatchObject({ code: 'SOURCE_AGE_RESTRICTED' });
    const live = { ...fixture('drm-mixed'), live_status: 'is_live', is_live: true };
    expect(refusal(() => buildRecord(generic, live))).toMatchObject({ code: 'SOURCE_LIVE' });
  });

  it('records availability on the metadata', () => {
    const rec = buildRecord(generic, fixture('drm-mixed'));
    expect(rec.media.availability).toBe('public');
    const bare = fixture('drm-mixed');
    delete bare.availability;
    expect(buildRecord(generic, bare).media.availability).toBeNull();
  });
});

describe('normaliseSourceUrl blocked hosts', () => {
  it('netflix → SOURCE_BLOCKED_DOMAIN / 403', () => {
    const err = refusal(() => normaliseSourceUrl('https://www.netflix.com/watch/1'));
    expect(err).toMatchObject({ status: 403, code: 'SOURCE_BLOCKED_DOMAIN' });
  });

  it('a look-alike host is not blocked', () => {
    expect(() => normaliseSourceUrl('https://notnetflix.com/watch/1')).not.toThrow();
  });
});

describe('translateExtractionError', () => {
  const run = (stderr: string) =>
    translateExtractionError(new CommandError('boom', 1, stderr), yt);

  it.each([
    'ERROR: This video is available to this channel\'s members-only',
    'ERROR: Join this channel to get access to members-only content',
    'ERROR: This video is only available for Music Premium members',
  ])('maps %s → SOURCE_MEMBERS_ONLY', (stderr) => {
    expect(run(stderr)).toMatchObject({ status: 403, code: 'SOURCE_MEMBERS_ONLY' });
  });

  it('still maps private video → SOURCE_PRIVATE', () => {
    expect(run('ERROR: Private video. Sign in if you\'ve been granted access')).toMatchObject({
      code: 'SOURCE_PRIVATE',
    });
  });
});

describe('extractMedia refusal cache', () => {
  it('caches a refusal under elig:{mediaId} for 600s and skips yt-dlp on repeat', async () => {
    runCommand.mockResolvedValue({ stdout: JSON.stringify(fixture('private')) });

    await expect(extractMedia('https://www.youtube.com/watch?v=abc')).rejects.toMatchObject({
      code: 'SOURCE_PRIVATE',
    });
    expect(runCommand).toHaveBeenCalledTimes(1);

    const eligCall = redisMock.set.mock.calls.find(([k]) => k === `elig:${yt.mediaId}`);
    expect(eligCall).toBeTruthy();
    expect(eligCall!.slice(2)).toEqual(['EX', 600]);

    await expect(extractMedia('https://www.youtube.com/watch?v=abc')).rejects.toMatchObject({
      status: 403,
      code: 'SOURCE_PRIVATE',
    });
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the refusal cache', async () => {
    store.set(`elig:${yt.mediaId}`, JSON.stringify({ code: 'SOURCE_PRIVATE' }));
    runCommand.mockResolvedValue({ stdout: JSON.stringify(fixture('drm-mixed')) });
    await expect(extractMedia('https://www.youtube.com/watch?v=abc', { force: true })).resolves.toBeTruthy();
  });

  it('does not cache transient failures', async () => {
    runCommand.mockRejectedValue(new CommandError('boom', 1, 'HTTP Error 500'));
    await expect(extractMedia('https://www.youtube.com/watch?v=abc')).rejects.toBeTruthy();
    expect(store.has(`elig:${yt.mediaId}`)).toBe(false);
  });

  it('passes --xff never to yt-dlp', async () => {
    runCommand.mockResolvedValue({ stdout: JSON.stringify(fixture('drm-mixed')) });
    await extractMedia('https://www.youtube.com/watch?v=abc', { force: true });
    const args: string[] = runCommand.mock.calls[0]![1].args;
    expect(args.slice(args.indexOf('--xff'), args.indexOf('--xff') + 2)).toEqual(['--xff', 'never']);
  });
});
