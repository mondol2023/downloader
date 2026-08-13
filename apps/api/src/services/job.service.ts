import type { Job as JobRow, JobState as DbJobState, JobType as DbJobType } from '@prisma/client';
import type { JobProgress, JobState, JobSummary, JobType } from '@media/shared';
import { prisma } from '../lib/prisma.js';
import { keys, redis } from '../lib/redis.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RequestIdentity } from '../types/express.js';

/**
 * Job read/ownership layer.
 *
 * Progress is written to Redis by the worker at high frequency and to Postgres
 * only on state transitions. Reads prefer Redis and fall back to the row, so a
 * poll never costs a write and a Redis flush degrades to coarse progress rather
 * than to "unknown".
 */

const DB_TO_API_STATE: Record<DbJobState, JobState> = {
  QUEUED: 'queued',
  EXTRACTING: 'extracting',
  DOWNLOADING: 'downloading',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const DB_TO_API_TYPE: Record<DbJobType, JobType> = {
  DOWNLOAD: 'download',
  TRANSCODE_AUDIO: 'transcode-audio',
  MUX: 'mux',
};

export const TERMINAL_STATES: DbJobState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export async function toJobSummary(row: JobRow): Promise<JobSummary> {
  const live = await readLiveProgress(row.id);

  const progress: JobProgress = live ?? {
    state: DB_TO_API_STATE[row.state],
    percent: row.percent,
    downloadedBytes: row.downloadedBytes != null ? Number(row.downloadedBytes) : null,
    totalBytes: row.totalBytes != null ? Number(row.totalBytes) : null,
    speedBytesPerSecond: null,
    etaSeconds: null,
    stage: row.stage,
  };

  // The row is authoritative for terminal states — a stale Redis entry must not
  // report "downloading" for a job the database says has failed.
  if (TERMINAL_STATES.includes(row.state)) {
    progress.state = DB_TO_API_STATE[row.state];
    progress.percent = row.state === 'COMPLETED' ? 100 : progress.percent;
  }

  const expired = row.expiresAt != null && row.expiresAt.getTime() <= Date.now();

  return {
    id: row.id,
    type: DB_TO_API_TYPE[row.type],
    state: DB_TO_API_STATE[row.state],
    progress,
    mediaTitle: row.mediaTitle,
    formatLabel: row.formatLabel,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    error: row.error,
    downloadUrl:
      row.state === 'COMPLETED' && row.artifactPath && !expired
        ? `/api/v1/jobs/${row.id}/artifact`
        : null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

async function readLiveProgress(jobId: string): Promise<JobProgress | null> {
  try {
    const raw = await redis.get(keys.jobProgress(jobId));
    return raw ? (JSON.parse(raw) as JobProgress) : null;
  } catch (err) {
    logger.debug({ err, jobId }, 'Live progress unavailable');
    return null;
  }
}

/**
 * Ownership check. Guests own jobs through their guest cookie, which is why the
 * cookie value is validated as a UUID before it ever reaches this query.
 */
export async function findOwnedJob(jobId: string, identity: RequestIdentity): Promise<JobRow> {
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(jobId)) throw AppError.badRequest('Invalid job id');

  const row = await prisma.job.findUnique({ where: { id: jobId } });
  if (!row) throw AppError.notFound('Job not found');

  const owned = identity.userId
    ? row.userId === identity.userId
    : row.userId === null && row.guestKey === identity.guestKey;

  // 404 rather than 403: existence of another user's job is not the caller's business.
  if (!owned) throw AppError.notFound('Job not found');

  return row;
}

export async function listJobs(identity: RequestIdentity, limit = 25): Promise<JobSummary[]> {
  const rows = await prisma.job.findMany({
    where: identity.userId ? { userId: identity.userId } : { userId: null, guestKey: identity.guestKey },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return Promise.all(rows.map(toJobSummary));
}

/** Sets the cancel flag the worker polls between stages. */
export async function requestCancellation(jobId: string): Promise<void> {
  await redis.set(`job:cancel:${jobId}`, '1', 'EX', 3600);
}

export async function isCancellationRequested(jobId: string): Promise<boolean> {
  return (await redis.exists(`job:cancel:${jobId}`)) === 1;
}

export async function clearCancellation(jobId: string): Promise<void> {
  await redis.del(`job:cancel:${jobId}`).catch(() => undefined);
}

export async function publishProgress(jobId: string, progress: JobProgress): Promise<void> {
  await redis
    .set(keys.jobProgress(jobId), JSON.stringify(progress), 'EX', 3600)
    .catch((err: unknown) => logger.debug({ err, jobId }, 'Progress publish failed'));
}
