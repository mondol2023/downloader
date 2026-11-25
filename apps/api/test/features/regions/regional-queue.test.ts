import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Regional extraction queue: BullMQ plumbing, and which failures may surface as a geo-block. */

const queueNames: string[] = [];
const workerNames: string[] = [];
const processors: Array<(job: { data: { sourceUrl: string } }) => Promise<unknown>> = [];
let waitImpl: () => Promise<unknown> = async () => ({});

// Real BullMQ 5 refuses ':' in a queue name; the fake does too so the naming is exercised.
function checkName(name: string) {
  if (name.includes(':')) throw new Error('Queue name cannot contain :');
}

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      checkName(name);
      queueNames.push(name);
    }
    async add() {
      return { waitUntilFinished: () => waitImpl() };
    }
  },
  QueueEvents: class {
    constructor(name: string) {
      checkName(name);
    }
  },
  Worker: class {
    constructor(name: string, processor: (job: { data: { sourceUrl: string } }) => Promise<unknown>) {
      checkName(name);
      workerNames.push(name);
      processors.push(processor);
    }
  },
}));
vi.mock('../../../src/config/env.js', () => ({ env: { REGION: 'bd', WORKER_CONCURRENCY: 1 } }));
vi.mock('../../../src/lib/redis.js', () => ({ createQueueConnection: () => ({}) }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { extractViaRegionalQueue, startRegionalExtractWorker } = await import(
  '../../../src/queue/regional-queue.js'
);
const { AppError } = await import('../../../src/lib/errors.js');

const source = { canonical: 'https://example.com/v/1' } as never;

beforeEach(() => {
  queueNames.length = 0;
  workerNames.length = 0;
  processors.length = 0;
});

describe('regional queue naming', () => {
  it('producer and worker use a BullMQ-legal name (no colon)', async () => {
    waitImpl = async () => ({ media: {} });
    await extractViaRegionalQueue('extract:bd', source);
    startRegionalExtractWorker(async () => ({}) as never);
    expect(queueNames[0]).toBe(workerNames[0]);
    expect(queueNames[0]).not.toContain(':');
  });
});

describe('extractViaRegionalQueue failures', () => {
  it('a timeout stays SOURCE_TIMEOUT', async () => {
    waitImpl = async () => {
      throw new Error('Job wait extract timed out before finishing');
    };
    await expect(extractViaRegionalQueue('extract:bd', source)).rejects.toMatchObject({
      status: 504,
      code: 'SOURCE_TIMEOUT',
    });
  });

  it('an arbitrary regional failure is NOT turned into SOURCE_GEOBLOCKED', async () => {
    waitImpl = async () => {
      throw new Error('ECONNRESET talking to redis');
    };
    const err = await extractViaRegionalQueue('extract:bd', source).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).not.toBe('SOURCE_GEOBLOCKED');
    expect(err.status).toBe(502);
  });

  it('a genuine geo-block raised by the regional worker keeps SOURCE_GEOBLOCKED', async () => {
    startRegionalExtractWorker(async () => {
      throw new AppError(451, 'SOURCE_GEOBLOCKED', 'blocked');
    });
    const wire = await processors[0]!({ data: { sourceUrl: 'https://example.com/v/1' } }).catch((e) => e);
    waitImpl = async () => {
      throw wire;
    };
    await expect(extractViaRegionalQueue('extract:bd', source)).rejects.toMatchObject({
      status: 451,
      code: 'SOURCE_GEOBLOCKED',
    });
  });

  it('a typed non-geo refusal from the regional worker keeps its own code', async () => {
    startRegionalExtractWorker(async () => {
      throw new AppError(403, 'SOURCE_PRIVATE', 'private');
    });
    const wire = await processors[0]!({ data: { sourceUrl: 'https://example.com/v/1' } }).catch((e) => e);
    waitImpl = async () => {
      throw wire;
    };
    await expect(extractViaRegionalQueue('extract:bd', source)).rejects.toMatchObject({
      status: 403,
      code: 'SOURCE_PRIVATE',
    });
  });
});
