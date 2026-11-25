import type { RequestHandler } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

export interface AdminAuditEntry {
  action: string;
  target?: string;
  before?: unknown;
  after?: unknown;
}

/** Handlers describe their change here; `auditMutations` persists it once the response succeeds. */
export function setAudit(res: { locals: Record<string, unknown> }, entry: AdminAuditEntry): void {
  res.locals.audit = entry;
}

/**
 * Every mutating admin request writes an AuditEvent { actorId, action, target, before, after }.
 * Handlers call `setAudit`; if one forgets, a generic `METHOD path` row is still written so
 * nothing slips through unrecorded. Failed requests (status >= 400) changed nothing and aren't logged.
 */
export const auditMutations: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const entry = (res.locals.audit as AdminAuditEntry | undefined) ?? {
      action: `${req.method} ${req.baseUrl}${req.path}`,
    };
    prisma.auditEvent
      .create({
        data: {
          actorId: req.identity?.userId ?? null,
          userId: req.identity?.userId ?? null,
          action: entry.action,
          outcome: 'ok',
          target: entry.target ?? null,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          ip: req.ip ?? null,
          userAgent: req.header('user-agent')?.slice(0, 255) ?? null,
        },
      })
      .catch((err: unknown) => logger.error({ err, action: entry.action }, 'Failed to write admin audit event'));
  });
  next();
};
