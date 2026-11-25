import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Admin guard. The role is read from Postgres on every request — never from the JWT — so a
 * demotion or disable takes effect on the very next call instead of when the token expires.
 * ADMIN is always allowed in addition to the listed roles.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  const allowed = new Set<Role>([...roles, 'ADMIN']);
  return async (req, _res, next) => {
    try {
      const userId = req.identity?.userId;
      if (!userId) {
        next(AppError.unauthorized());
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, disabledAt: true },
      });
      if (!user) {
        next(AppError.unauthorized('Account no longer exists'));
        return;
      }
      if (user.disabledAt) {
        next(new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled'));
        return;
      }
      if (!allowed.has(user.role)) {
        next(AppError.forbidden('You do not have access to this area'));
        return;
      }
      req.adminRole = user.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Safety rules for changing a user's role or disabling them: an admin can't demote or disable
 * themselves, and the last active ADMIN can't be demoted or disabled.
 * Call before applying `PATCH /admin/users/:id`.
 */
export async function assertCanChangeUser(change: {
  actorId: string;
  targetId: string;
  role?: Role;
  disable?: boolean;
}): Promise<void> {
  const { actorId, targetId, role, disable } = change;
  const demoting = role !== undefined && role !== 'ADMIN';
  if (!demoting && !disable) return;

  if (actorId === targetId) {
    throw AppError.conflict("You can't demote or disable your own account");
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true, disabledAt: true },
  });
  if (!target) throw AppError.notFound('User not found');
  if (target.role !== 'ADMIN' || target.disabledAt) return;

  const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', disabledAt: null } });
  if (activeAdmins <= 1) {
    throw AppError.conflict('This is the last admin — promote another admin first');
  }
}
