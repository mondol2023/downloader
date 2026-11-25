import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { removeQueuedJob } from '../../queue/queues.js';
import { requestCancellation, TERMINAL_STATES } from '../../services/job.service.js';
import { release } from '../../services/quota.service.js';
import { setAudit } from './audit.js';
import { pageArgs, pageQuery, toPage } from './http.js';

const STATES = ['QUEUED', 'EXTRACTING', 'DOWNLOADING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;

const listQuery = pageQuery.extend({ state: z.enum(STATES).optional() });

/** No BigInt columns (not JSON-serialisable) and no artifact paths. */
const LIST_SELECT = {
  id: true,
  userId: true,
  type: true,
  state: true,
  platform: true,
  mediaTitle: true,
  sourceUrl: true,
  formatLabel: true,
  tierAtRequest: true,
  region: true,
  percent: true,
  stage: true,
  error: true,
  attempts: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const;

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await prisma.job.findMany({
      where: q.state ? { state: q.state } : {},
      select: LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(q),
    });
    res.json({ data: toPage(rows, q.limit) });
  }),
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.job.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Job not found');
    if (TERMINAL_STATES.includes(row.state)) throw AppError.conflict('That job has already finished');

    // Same two-step as the owner's cancel: pull it from the queue if it hasn't started,
    // otherwise set the flag the worker polls between stages.
    const removed = await removeQueuedJob(row.id, row.region);
    await requestCancellation(row.id);

    if (removed) {
      await prisma.job.update({ where: { id: row.id }, data: { state: 'CANCELLED', completedAt: new Date() } });
      await release({
        id: row.id,
        subject: row.userId ? `user:${row.userId}` : `guest:${row.guestKey ?? ''}`,
        ipSubject: null,
      });
    }

    const after = await prisma.job.findUniqueOrThrow({ where: { id }, select: LIST_SELECT });
    setAudit(res, {
      action: 'job.cancel',
      target: `job:${id}`,
      before: { state: row.state },
      after: { state: after.state, cancelRequested: true },
    });
    res.json({ data: after });
  }),
);

export default router;
