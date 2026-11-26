import { Router } from 'express';
import { TIERS } from '@media/shared';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { setAudit } from './audit.js';
import { actorId, pageArgs, pageQuery, toPage } from './http.js';
import { assertCanChangeUser } from './require-role.js';

const ROLES = ['USER', 'EDITOR', 'ADMIN'] as const;

const listQuery = pageQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  tier: z.enum(TIERS).optional(),
  role: z.enum(ROLES).optional(),
});
const patchBody = z
  .object({
    tier: z.enum(TIERS).optional(),
    role: z.enum(ROLES).optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

/** Never `passwordHash` or Stripe ids. */
const SAFE = {
  id: true,
  email: true,
  displayName: true,
  tier: true,
  role: true,
  emailVerified: true,
  disabledAt: true,
  disabledReason: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await prisma.user.findMany({
      where: {
        ...(q.tier ? { tier: q.tier } : {}),
        ...(q.role ? { role: q.role } : {}),
        ...(q.q
          ? {
              OR: [
                { email: { contains: q.q, mode: 'insensitive' } },
                { displayName: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: SAFE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(q),
    });
    res.json({ data: toPage(rows, q.limit) });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = patchBody.parse(req.body);
    const targetId = String(req.params.id);
    const actor = actorId(req);

    const before = await prisma.user.findUnique({ where: { id: targetId }, select: SAFE });
    if (!before) throw AppError.notFound('User not found');

    await assertCanChangeUser({
      actorId: actor,
      targetId,
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.disabled === true ? { disable: true } : {}),
    });

    const data: Record<string, unknown> = {};
    if (body.tier !== undefined) data.tier = body.tier;
    if (body.role !== undefined) data.role = body.role;
    if (body.disabled === true) {
      data.disabledAt = new Date();
      data.disabledReason = body.disabledReason ?? null;
    } else if (body.disabled === false) {
      data.disabledAt = null;
      data.disabledReason = null;
    }

    const after = await prisma.user.update({ where: { id: targetId }, data, select: SAFE });

    if (body.disabled === true) {
      // A disabled account keeps no live sessions.
      await prisma.refreshToken.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    setAudit(res, { action: 'user.update', target: `user:${targetId}`, before, after });
    res.json({ data: after });
  }),
);

export default router;
