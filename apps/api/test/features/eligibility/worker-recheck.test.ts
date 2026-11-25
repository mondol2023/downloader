import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The media can change between extraction and download. When yt-dlp's stderr says
 * the source went private, the worker must fail the job with the same typed
 * refusal the API uses, and must not charge the user for it.
 */

const processors: Array<(job: unknown, token?: string) => Promise<void>> = [];

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_name: string, processor: (job: unknown, token?: string) => Promise<void>) {
      processors.push(processor);
    }
    on() {
      return this;
    }
    async close() {}
  },
  DelayedError: class DelayedError extends Error {},
}));

vi.mock('../../../src/config/env.js', () => ({
  env: {
    STORAGE_DIR: './tmp-worker-recheck-test',
    YTDLP_PATH: 'yt-dlp',
    YTDLP_COOKIES_FILE: undefined,
    FFMPEG_PATH: 'ffmpeg',
    WORKER_CONCURRENCY: 2,
    WORKER_CONCURRENCY_PRO: 1,
    ARTIFACT_TTL: 3600,
    EXTRACTION_TIMEOUT_MS: 1000,
    WORKER_ROLE: ['download'],
  },
}));

const jobUpdate = vi.fn(async () => ({}));
const jobFindUnique = vi.fn();
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    job: { findUnique: jobFindUnique, update: jobUpdate, findMany: vi.fn(async () => []) },
  },
  disconnectPrisma: vi.fn(),
}));
vi.mock('../../../src/lib/redis.js', () => ({
  createQueueConnection: () => ({ quit: vi.fn() }),
  disconnectRedis: vi.fn(),
  redis: {},
  keys: {
    extraction: (id: string) => `media:extract:${id}`,
    extractionLock: (id: string) => `media:extract:lock:${id}`,
    eligibilityRefusal: (id: string) => `elig:${id}`,
  },
}));
vi.mock('../../../src/lib/logger.js', () => {
  const l: Record<string, unknown> = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  l.child = () => l;
  return { logger: l };
});

const commitDownload = vi.fn();
const release = vi.fn(async () => undefined);
vi.mock('../../../src/services/quota.service.js', () => ({
  commitDownload,
  release,
  releaseSlot: vi.fn(),
}));
vi.mock('../../../src/services/job.service.js', () => ({
  clearCancellation: vi.fn(),
  isCancellationRequested: vi.fn(async () => false),
  publishProgress: vi.fn(),
}));
vi.mock('../../../src/features/persistence/index.js', () => ({
  getDbHealth: () => ({ up: true }),
  startDbHealthProbe: () => () => undefined,
  startOutboxDrainer: () => () => undefined,
  startSheetsMirrorFromEnv: () => () => undefined,
}));

const runCommand = vi.fn();
vi.mock('../../../src/lib/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/exec.js')>(
    '../../../src/lib/exec.js',
  );
  return { ...actual, runCommand };
});

vi.mock('../../../src/services/extraction.service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/extraction.service.js')
  >('../../../src/services/extraction.service.js');
  return {
    ...actual,
    extractMedia: vi.fn(async () => ({ media: { platform: 'youtube' } })),
    findFormat: vi.fn(() => ({ id: '18', track: 'video', requiresMux: false })),
  };
});

vi.mock('../../../src/queue/queues.js', () => ({ MEDIA_QUEUE_NAME: 'media-jobs' }));

await import('../../../src/queue/worker.js');
const { CommandError } = await import('../../../src/lib/exec.js');

const payload = {
  jobId: 'job1',
  subject: 'user:u1',
  userId: 'u1',
  guestKey: null,
  tier: 'FREE',
  mediaId: 'm1',
  sourceUrl: 'https://www.youtube.com/watch?v=abc',
  formatId: '18',
  embedSubtitles: false,
  ipHash: 'h',
  userAgent: null,
};

function bullJob() {
  return { data: payload, attemptsMade: 0, opts: { attempts: 2 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  jobFindUnique.mockResolvedValue({
    id: 'job1',
    state: 'QUEUED',
    percent: 0,
    startedAt: null,
    mediaTitle: 'Some video',
  });
});

describe('worker re-check', () => {
  it('job fails with SOURCE_PRIVATE and no quota charge when download stderr says private', async () => {
    runCommand.mockRejectedValue(new CommandError('exit 1', 1, 'ERROR: Private video'));

    await processors[0]!(bullJob(), 'tok');

    const failed = jobUpdate.mock.calls
      .map(([arg]) => (arg as { data: { state?: string; error?: string } }).data)
      .find((d) => d.state === 'FAILED');
    expect(failed).toBeDefined();
    expect(failed!.error!.startsWith('SOURCE_PRIVATE')).toBe(true);
    expect(failed!.error).toMatch(/^SOURCE_PRIVATE: .+/);

    // The ledger line is only written by commitDownload; the reservation is handed back.
    expect(commitDownload).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('members-only stderr maps to SOURCE_MEMBERS_ONLY', async () => {
    runCommand.mockRejectedValue(
      new CommandError('exit 1', 1, 'ERROR: Join this channel to get access to members-only content'),
    );

    await processors[0]!(bullJob(), 'tok');

    const failed = jobUpdate.mock.calls
      .map(([arg]) => (arg as { data: { state?: string; error?: string } }).data)
      .find((d) => d.state === 'FAILED');
    expect(failed!.error).toMatch(/^SOURCE_MEMBERS_ONLY: /);
    expect(commitDownload).not.toHaveBeenCalled();
  });
});
