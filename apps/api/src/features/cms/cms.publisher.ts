import type { SchedulerQueue } from '../maintenance/index.js';
import { prisma } from '../../lib/prisma.js';

export const CMS_PUBLISH_JOB = 'cms-publish-due';
export const CMS_PUBLISH_EVERY_MS = 60_000;

/** Flips every SCHEDULED page whose time has come to PUBLISHED. Idempotent; returns how many moved. */
export async function publishDuePages(now: Date = new Date(), db: Pick<typeof prisma, 'cmsPage'> = prisma): Promise<number> {
  const { count } = await db.cmsPage.updateMany({
    where: { status: 'SCHEDULED', publishAt: { lte: now } },
    data: { status: 'PUBLISHED', publishedAt: now },
  });
  return count;
}

export async function scheduleCmsPublish(queue: SchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(
    CMS_PUBLISH_JOB,
    { every: CMS_PUBLISH_EVERY_MS },
    { name: CMS_PUBLISH_JOB, opts: { removeOnComplete: { count: 5 }, removeOnFail: { count: 20 } } },
  );
}
