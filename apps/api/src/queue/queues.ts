import { Queue, type JobsOptions } from 'bullmq';
import type { AudioFormat, Tier } from '@media/shared';
import { policyFor } from '@media/shared';
import { createQueueConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { isRegionalRegion, regionalQueueName } from '../features/regions/region.js';

/**
 * One queue, priority-ordered.
 *
 * Separate per-tier queues would need separate workers and would leave Pro
 * capacity idle whenever the Pro queue drained. BullMQ's priority field gives
 * the same "Pro jumps the line" behaviour with a single pool: lower number wins,
 * and `queuePriority` in the tier matrix is the only place that ordering is
 * defined (PRO 1 < FREE 5 < GUEST 10).
 */

export const MEDIA_QUEUE_NAME = 'media-jobs';

export interface MediaJobPayload {
  /** Also the Job row id and the quota reservation id — one id end to end. */
  jobId: string;
  subject: string;
  userId: string | null;
  guestKey: string | null;
  tier: Tier;
  mediaId: string;
  /** Canonical page URL. The worker re-extracts rather than trusting a stale CDN URL. */
  sourceUrl: string;
  formatId: string;
  audioFormat?: AudioFormat;
  embedSubtitles: boolean;
  subtitleLang?: string;
  ipHash: string;
  userAgent: string | null;
}

const connection = createQueueConnection('queue-producer');

function buildQueue(name: string): Queue<MediaJobPayload> {
  const queue = new Queue<MediaJobPayload>(name, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
      // Keep a short tail for debugging; the Job table is the real history.
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86_400, count: 500 },
    },
  });
  queue.on('error', (err) => logger.error({ err, queue: name }, 'Media queue error'));
  return queue;
}

export const mediaQueue = buildQueue(MEDIA_QUEUE_NAME);

/**
 * A job whose source needed the user's own region is downloaded there: it goes to that region's
 * queue (`media-jobs-<region>`), consumed only by a download worker whose REGION matches.
 */
const regionalQueues = new Map<string, Queue<MediaJobPayload>>();

function queueFor(region: string | null | undefined): Queue<MediaJobPayload> {
  if (!isRegionalRegion(region)) return mediaQueue;
  let queue = regionalQueues.get(region);
  if (!queue) regionalQueues.set(region, (queue = buildQueue(regionalQueueName(MEDIA_QUEUE_NAME, region))));
  return queue;
}

export async function enqueueMediaJob(payload: MediaJobPayload, region?: string | null): Promise<void> {
  const options: JobsOptions = {
    jobId: payload.jobId,
    priority: policyFor(payload.tier).queuePriority,
  };
  await queueFor(region).add('process-media', payload, options);
  logger.info(
    { jobId: payload.jobId, tier: payload.tier, priority: options.priority, region: region ?? null },
    'Media job enqueued',
  );
}

/** Best-effort cancellation. A running job is stopped via the abort flag instead. */
export async function removeQueuedJob(jobId: string, region?: string | null): Promise<boolean> {
  // The row's region says where it was queued; the main queue is the fallback for a stale value.
  const queues = isRegionalRegion(region) ? [queueFor(region), mediaQueue] : [mediaQueue];
  for (const queue of queues) {
    const job = await queue.getJob(jobId);
    if (!job) continue;
    const state = await job.getState();
    if (state === 'active') return false;
    await job.remove();
    return true;
  }
  return false;
}

export async function closeQueue(): Promise<void> {
  for (const queue of [mediaQueue, ...regionalQueues.values()]) {
    await queue.close().catch((err: unknown) => logger.error({ err }, 'Queue close failed'));
  }
  await connection.quit().catch(() => undefined);
}
