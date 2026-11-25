import os from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a worker process starts depends on WORKER_ROLE and REGION:
 *  - the media download worker only with the `download` role, on its own region's queue;
 *  - maintenance (sweep, storage gauge, scheduler) only on the main deployment's download worker;
 *  - the yt-dlp update listener everywhere;
 *  - the regional extraction worker uses the lock-free extraction path.
 */

const workers: Array<{ name: string }> = [];
const queues: string[] = [];
const scheduleMaintenance = vi.fn(async () => undefined);
const sweepExpiredArtifacts = vi.fn(async () => 0);
const writeStorageUsage = vi.fn(async () => undefined);
const startYtDlpUpdateListener = vi.fn(() => async () => undefined);
const startRegionalExtractWorker = vi.fn((_run: (url: string) => Promise<unknown>) => ({ close: async () => {} }));
const extractMedia = vi.fn(async () => ({ media: { platform: 'youtube' } }));
const extractMediaDirect = vi.fn(async () => ({ media: { platform: 'youtube' } }));

async function load(env: { WORKER_ROLE: string[]; REGION: string }) {
  vi.resetModules();
  for (const m of [workers, queues]) m.length = 0;
  vi.clearAllMocks();

  vi.doMock('bullmq', () => ({
    Worker: class {
      constructor(name: string) {
        workers.push({ name });
      }
      on() {
        return this;
      }
      async close() {}
    },
    Queue: class {
      constructor(name: string) {
        queues.push(name);
      }
      on() {
        return this;
      }
      async close() {}
    },
    DelayedError: class DelayedError extends Error {},
  }));
  vi.doMock('../../../src/features/maintenance/index.js', () => ({
    ARTIFACT_SWEEP_JOB: 'artifact-sweep',
    MAINTENANCE_QUEUE_NAME: 'maintenance',
    YTDLP_UPDATE_CHANNEL: 'tools:ytdlp-update',
    YTDLP_UPDATE_JOB: 'ytdlp-update',
    directorySizeBytes: async () => 0,
    runYtDlpSelfUpdate: async () => ({ ran: false, ok: false, version: null }),
    scheduleMaintenance,
    startYtDlpUpdateListener,
    sweepExpiredArtifacts,
    writeStorageUsage,
  }));
  vi.doMock('../../../src/config/env.js', () => ({
    env: {
      STORAGE_DIR: `${os.tmpdir()}/worker-roles-test`,
      YTDLP_PATH: 'yt-dlp',
      FFMPEG_PATH: 'ffmpeg',
      FFPROBE_PATH: 'ffprobe',
      WORKER_CONCURRENCY: 2,
      WORKER_CONCURRENCY_PRO: 1,
      ARTIFACT_TTL: 3600,
      EXTRACTION_TIMEOUT_MS: 1000,
      YTDLP_AUTO_UPDATE: false,
      ...env,
    },
  }));
  vi.doMock('../../../src/lib/prisma.js', () => ({ prisma: { job: {} }, disconnectPrisma: vi.fn() }));
  vi.doMock('../../../src/lib/redis.js', () => ({
    createQueueConnection: () => ({ quit: vi.fn() }),
    disconnectRedis: vi.fn(),
    redis: { duplicate: () => ({}), publish: vi.fn() },
    keys: {},
  }));
  vi.doMock('../../../src/lib/logger.js', () => {
    const l: Record<string, unknown> = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return { logger: l };
  });
  vi.doMock('../../../src/services/quota.service.js', () => ({
    commitDownload: vi.fn(),
    release: vi.fn(),
    releaseSlot: vi.fn(),
  }));
  vi.doMock('../../../src/services/job.service.js', () => ({
    clearCancellation: vi.fn(),
    isCancellationRequested: vi.fn(async () => false),
    publishProgress: vi.fn(),
  }));
  vi.doMock('../../../src/features/persistence/index.js', () => ({
    getDbHealth: () => ({ up: true }),
    startDbHealthProbe: () => () => undefined,
    startOutboxDrainer: () => () => undefined,
    startSheetsMirrorFromEnv: () => () => undefined,
  }));
  vi.doMock('../../../src/features/health/index.js', () => ({
    assertEngineAvailable: () => undefined,
    ensureEngineAvailable: async () => undefined,
    initToolVersions: async () => ({ ytDlp: 't', ffmpeg: 't', ffprobe: 't' }),
  }));
  vi.doMock('../../../src/features/restrictions/policy.store.js', () => ({
    startPolicyStore: async () => undefined,
    stopPolicyStore: async () => undefined,
  }));
  vi.doMock('../../../src/features/restrictions/enforce.js', () => ({
    assertDownloadsOpen: () => undefined,
    assertPlatformAllowed: () => undefined,
    tierPolicyFor: () => ({}),
  }));
  vi.doMock('../../../src/services/extraction.service.js', () => ({
    extractMedia,
    extractMediaDirect,
    findFormat: vi.fn(),
    isIneligibleCode: () => false,
    translateExtractionError: vi.fn(),
  }));
  vi.doMock('../../../src/queue/queues.js', () => ({ MEDIA_QUEUE_NAME: 'media-jobs' }));
  vi.doMock('../../../src/queue/regional-queue.js', () => ({ startRegionalExtractWorker }));

  await import('../../../src/queue/worker.js');
  await new Promise((r) => setTimeout(r, 30)); // the boot sweep is fire-and-forget
}

beforeEach(() => vi.clearAllMocks());

describe('worker roles', () => {
  it('extract-only process creates no media download worker and no maintenance', async () => {
    await load({ WORKER_ROLE: ['extract'], REGION: 'bd' });
    expect(workers.map((w) => w.name).filter((n) => n.startsWith('media-jobs'))).toEqual([]);
    expect(workers.some((w) => w.name === 'maintenance')).toBe(false);
    expect(queues).not.toContain('maintenance');
    expect(scheduleMaintenance).not.toHaveBeenCalled();
    expect(sweepExpiredArtifacts).not.toHaveBeenCalled();
    expect(startYtDlpUpdateListener).toHaveBeenCalledTimes(1);
    expect(startRegionalExtractWorker).toHaveBeenCalledTimes(1);
  });

  it('main download worker consumes media-jobs and owns maintenance', async () => {
    await load({ WORKER_ROLE: ['download'], REGION: 'default' });
    expect(workers.map((w) => w.name)).toEqual(expect.arrayContaining(['media-jobs', 'maintenance']));
    expect(queues).toContain('maintenance');
    expect(scheduleMaintenance).toHaveBeenCalledTimes(1);
    expect(sweepExpiredArtifacts).toHaveBeenCalled();
    expect(startYtDlpUpdateListener).toHaveBeenCalledTimes(1);
  });

  it('regional download worker consumes only its region queue, with no maintenance', async () => {
    await load({ WORKER_ROLE: ['download', 'extract'], REGION: 'bd' });
    expect(workers.map((w) => w.name)).toEqual(['media-jobs-bd']);
    expect(queues).not.toContain('maintenance');
    expect(scheduleMaintenance).not.toHaveBeenCalled();
    expect(sweepExpiredArtifacts).not.toHaveBeenCalled();
    expect(writeStorageUsage).not.toHaveBeenCalled();
    expect(startYtDlpUpdateListener).toHaveBeenCalledTimes(1);
  });

  it('the regional extraction worker uses the lock-free extraction path', async () => {
    await load({ WORKER_ROLE: ['download', 'extract'], REGION: 'bd' });
    const run = startRegionalExtractWorker.mock.calls[0]![0];
    await run('https://example.com/v/1');
    expect(extractMediaDirect).toHaveBeenCalledWith('https://example.com/v/1');
    expect(extractMedia).not.toHaveBeenCalled();
  });
});
