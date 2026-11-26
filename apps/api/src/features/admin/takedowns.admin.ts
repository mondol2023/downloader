import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { redis, keys } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { normaliseSourceUrl } from '../../lib/source-url.js';
import { setAudit } from './audit.js';
import { actorId, pageArgs, pageQuery, toPage } from './http.js';

const STATUSES = ['PENDING', 'ACTIVE', 'REJECTED'] as const;

const listQuery = pageQuery.extend({ status: z.enum(STATUSES).optional() });
const createBody = z.object({
  sourceUrl: z.string().trim().min(1).max(2048),
  reason: z.string().trim().min(1).max(1000),
  requesterEmail: z.string().trim().email().max(254).optional(),
  /** An admin filing a takedown may make it effective immediately. */
  status: z.enum(['PENDING', 'ACTIVE']).default('PENDING'),
});
const decideBody = z.object({ status: z.enum(['ACTIVE', 'REJECTED']) });

/** A cached record of removed media must stop serving the moment the takedown takes effect. */
async function dropCachedRecord(mediaId: string): Promise<void> {
  await redis
    .del(keys.extraction(mediaId))
    .catch((err: unknown) => logger.warn({ err, mediaId }, 'Could not drop the cached record of a taken-down source'));
}

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await prisma.takedown.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(q),
    });
    res.json({ data: toPage(rows, q.limit) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
    const source = normaliseSourceUrl(body.sourceUrl, { skipPolicy: true });

    const existing = await prisma.takedown.findUnique({ where: { mediaId: source.mediaId } });
    if (existing) throw AppError.conflict('A takedown for this source already exists');

    const row = await prisma.takedown.create({
      data: {
        mediaId: source.mediaId,
        sourceUrl: source.canonical,
        reason: body.reason,
        status: body.status,
        requesterEmail: body.requesterEmail ?? null,
        decidedById: body.status === 'ACTIVE' ? actorId(req) : null,
      },
    });
    if (row.status === 'ACTIVE') await dropCachedRecord(row.mediaId);

    setAudit(res, { action: 'takedown.create', target: `takedown:${row.id}`, after: row });
    res.status(201).json({ data: row });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = decideBody.parse(req.body);
    const id = String(req.params.id);
    const before = await prisma.takedown.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('Takedown not found');
    if (before.status === status) throw AppError.conflict(`That takedown is already ${status.toLowerCase()}`);

    const row = await prisma.takedown.update({ where: { id }, data: { status, decidedById: actorId(req) } });
    if (row.status === 'ACTIVE') await dropCachedRecord(row.mediaId);

    setAudit(res, {
      action: status === 'ACTIVE' ? 'takedown.approve' : 'takedown.reject',
      target: `takedown:${id}`,
      before: { status: before.status },
      after: { status: row.status },
    });
    res.json({ data: row });
  }),
);

export default router;
