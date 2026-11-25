import { Router } from 'express';
import { requireDatabase } from '../persistence/index.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { auditMutations } from './audit.js';
import { requireRole } from './require-role.js';

/** 60 requests / minute / admin user, on top of the global per-IP limiter. */
export const adminRateLimit = rateLimit({
  bucket: 'admin',
  windowSeconds: 60,
  max: 60,
  message: 'Too many admin requests, slow down',
});

/** Everything under /admin/cms is open to EDITOR and ADMIN (Phase 9). */
export const cmsRouter = Router();
cmsRouter.use(requireRole('EDITOR'));

/** Everything else under /admin is ADMIN only (task 8.2 mounts its routers here). */
export const adminOnlyRouter = Router();
adminOnlyRouter.use(requireRole());

const adminRouter = Router();
adminRouter.use(requireDatabase, adminRateLimit, auditMutations);
adminRouter.use('/cms', cmsRouter);
adminRouter.use(adminOnlyRouter);

export default adminRouter;
