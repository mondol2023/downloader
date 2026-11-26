import { Queue, QueueEvents, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { createQueueConnection } from '../lib/redis.js';
import type { NormalisedSource } from '../lib/source-url.js';
import type { ExtractionRecord } from '../services/extraction.service.js';

/** One extraction queue per region: `extract:<region>`. Jobs only ever go to the user's own region. */
export interface RegionalExtractPayload {
  sourceUrl: string;
}

/** BullMQ refuses ':' in a queue name, so the logical `extract:<region>` id is stored as `extract-<region>`. */
export function bullQueueName(logical: string): string {
  return logical.replace(/:/g, '-');
}

const WIRE_PREFIX = 'AppError:';

/** BullMQ carries only `failedReason` (a string) back to the producer, so typed errors ride in it. */
export function toWireError(err: unknown): Error {
  if (err instanceof AppError) {
    return new Error(
      `${WIRE_PREFIX}${JSON.stringify({ status: err.status, code: err.code, message: err.message })}`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

function fromWireError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith(WIRE_PREFIX)) {
    try {
      const { status, code, message: text } = JSON.parse(message.slice(WIRE_PREFIX.length)) as {
        status: number;
        code: string;
        message: string;
      };
      if (typeof status === 'number' && typeof code === 'string') return new AppError(status, code, String(text));
    } catch {
      /* fall through to the generic mapping */
    }
  }
  if (/timed out/i.test(message)) {
    return new AppError(504, 'SOURCE_TIMEOUT', 'The regional extraction took too long.');
  }
  // Only a worker that itself saw a geo-block may say so; anything else is just a failed lookup.
  return AppError.upstream('The regional extraction failed. Please try again.');
}

const queues = new Map<string, { queue: Queue; events: QueueEvents }>();

function regional(name: string) {
  let q = queues.get(name);
  if (!q) {
    q = {
      queue: new Queue(bullQueueName(name), {
        connection: createQueueConnection('regional-producer'),
        defaultJobOptions: { attempts: 1, removeOnComplete: { age: 300 }, removeOnFail: { age: 600 } },
      }),
      events: new QueueEvents(bullQueueName(name), { connection: createQueueConnection('regional-events') }),
    };
    queues.set(name, q);
  }
  return q;
}

export async function extractViaRegionalQueue(
  queueName: string,
  source: NormalisedSource,
): Promise<ExtractionRecord> {
  const { queue, events } = regional(queueName);
  const job = await queue.add('extract', { sourceUrl: source.canonical } satisfies RegionalExtractPayload);
  try {
    return (await job.waitUntilFinished(events, 25_000)) as ExtractionRecord;
  } catch (err) {
    logger.warn({ err, queueName }, 'Regional extraction failed');
    throw fromWireError(err);
  }
}

/** Consumes this deployment's own `extract:<REGION>` queue. Started only when WORKER_ROLE includes `extract`. */
export function startRegionalExtractWorker(
  run: (sourceUrl: string) => Promise<ExtractionRecord>,
): Worker<RegionalExtractPayload> {
  return new Worker<RegionalExtractPayload>(
    bullQueueName(`extract:${env.REGION}`),
    async (job) => {
      try {
        return { ...(await run(job.data.sourceUrl)), region: env.REGION };
      } catch (err) {
        throw toWireError(err);
      }
    },
    { connection: createQueueConnection('regional-worker'), concurrency: env.WORKER_CONCURRENCY },
  );
}
