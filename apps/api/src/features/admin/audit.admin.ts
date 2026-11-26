import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { pageArgs, pageQuery, toPage } from './http.js';

const listQuery = pageQuery.extend({
  actor: z.string().trim().min(1).max(64).optional(),
  /** Exact action, or a prefix ending in `.` such as `policy.`. */
  action: z.string().trim().min(1).max(100).optional(),
});

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await prisma.auditEvent.findMany({
      where: {
        ...(q.actor ? { actorId: q.actor } : {}),
        ...(q.action ? (q.action.endsWith('.') ? { action: { startsWith: q.action } } : { action: q.action }) : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(q),
    });
    res.json({ data: toPage(rows, q.limit) });
  }),
);

export default router;
