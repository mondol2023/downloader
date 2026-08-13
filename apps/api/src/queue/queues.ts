import { Queue, type JobsOptions } from 'bullmq';
import type { AudioFormat, Tier } from '@media/shared';
import { policyFor } from '@media/shared';
import { createQueueConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

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

export const mediaQueue = new Queue<MediaJobPayload>(MEDIA_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    // Keep a short tail for debugging; the Job table is the real history.
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86_400, count: 500 },
  },
});

mediaQueue.on('error', (err) => logger.error({ err }, 'Media queue error'));

export async function enqueueMediaJob(payload: MediaJobPayload): Promise<void> {
  const options: JobsOptions = {
    jobId: payload.jobId,
    priority: policyFor(payload.tier).queuePriority,
  };
  await mediaQueue.add('process-media', payload, options);
  logger.info(
    { jobId: payload.jobId, tier: payload.tier, priority: options.priority },
    'Media job enqueued',
  );
}

/** Best-effort cancellation. A running job is stopped via the abort flag instead. */
export async function removeQueuedJob(jobId: string): Promise<boolean> {
  const job = await mediaQueue.getJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  if (state === 'active') return false;
  await job.remove();
  return true;
}

export async function closeQueue(): Promise<void> {
  await mediaQueue.close().catch((err: unknown) => logger.error({ err }, 'Queue close failed'));
  await connection.quit().catch(() => undefined);
}
