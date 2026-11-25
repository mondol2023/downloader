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

const queues = new Map<string, { queue: Queue; events: QueueEvents }>();

function regional(name: string) {
  let q = queues.get(name);
  if (!q) {
    q = {
      queue: new Queue(name, {
        connection: createQueueConnection('regional-producer'),
        defaultJobOptions: { attempts: 1, removeOnComplete: { age: 300 }, removeOnFail: { age: 600 } },
      }),
      events: new QueueEvents(name, { connection: createQueueConnection('regional-events') }),
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
    if (err instanceof Error && /timed out/i.test(err.message)) {
      throw new AppError(504, 'SOURCE_TIMEOUT', 'The regional extraction took too long.');
    }
    throw new AppError(451, 'SOURCE_GEOBLOCKED', 'That media is not available in your region.');
  }
}

/** Consumes this deployment's own `extract:<REGION>` queue. Started only when WORKER_ROLE includes `extract`. */
export function startRegionalExtractWorker(
  run: (sourceUrl: string) => Promise<ExtractionRecord>,
): Worker<RegionalExtractPayload> {
  return new Worker<RegionalExtractPayload>(
    `extract:${env.REGION}`,
    async (job) => ({ ...(await run(job.data.sourceUrl)), region: env.REGION }),
    { connection: createQueueConnection('regional-worker'), concurrency: env.WORKER_CONCURRENCY },
  );
}
