/**
 * Repeatable maintenance jobs. BullMQ job schedulers are idempotent and fire once per tick for the
 * whole deployment, however many worker replicas call `upsertJobScheduler` at boot.
 */

export const MAINTENANCE_QUEUE_NAME = 'maintenance';
export const ARTIFACT_SWEEP_JOB = 'artifact-sweep';
export const YTDLP_UPDATE_JOB = 'ytdlp-update';
export const ARTIFACT_SWEEP_EVERY_MS = 15 * 60 * 1000;
/** 04:00 in the worker's local time zone (BullMQ uses the process TZ when none is given). */
export const YTDLP_UPDATE_CRON = '0 4 * * *';

export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { every: number } | { pattern: string },
    template: { name: string; opts?: Record<string, unknown> },
  ): Promise<unknown>;
  removeJobScheduler(id: string): Promise<unknown>;
}

const KEEP = { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } };

export async function scheduleMaintenance(
  queue: SchedulerQueue,
  opts: { ytDlpAutoUpdate: boolean },
): Promise<void> {
  await queue.upsertJobScheduler(
    ARTIFACT_SWEEP_JOB,
    { every: ARTIFACT_SWEEP_EVERY_MS },
    { name: ARTIFACT_SWEEP_JOB, opts: KEEP },
  );
  if (opts.ytDlpAutoUpdate) {
    await queue.upsertJobScheduler(
      YTDLP_UPDATE_JOB,
      { pattern: YTDLP_UPDATE_CRON },
      { name: YTDLP_UPDATE_JOB, opts: KEEP },
    );
  } else {
    // Turning the flag off must also stop a schedule an earlier boot registered.
    await queue.removeJobScheduler(YTDLP_UPDATE_JOB);
  }
}
