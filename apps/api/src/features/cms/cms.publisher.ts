import type { SchedulerQueue } from '../maintenance/index.js';
import { prisma } from '../../lib/prisma.js';
import { notifyWeb } from './cms.revalidate.js';

export const CMS_PUBLISH_JOB = 'cms-publish-due';
export const CMS_PUBLISH_EVERY_MS = 60_000;

/** Flips every SCHEDULED page whose time has come to PUBLISHED. Idempotent; returns how many moved. */
export async function publishDuePages(now: Date = new Date(), db: Pick<typeof prisma, 'cmsPage'> = prisma): Promise<number> {
  const where = { status: 'SCHEDULED' as const, publishAt: { lte: now } };
  const due = await db.cmsPage.findMany({ where, select: { slug: true } });
  const { count } = await db.cmsPage.updateMany({ where, data: { status: 'PUBLISHED', publishedAt: now } });
  if (count > 0) await Promise.all(due.map((p) => notifyWeb({ slug: p.slug })));
  return count;
}

export async function scheduleCmsPublish(queue: SchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(
    CMS_PUBLISH_JOB,
    { every: CMS_PUBLISH_EVERY_MS },
    { name: CMS_PUBLISH_JOB, opts: { removeOnComplete: { count: 5 }, removeOnFail: { count: 20 } } },
  );
}
