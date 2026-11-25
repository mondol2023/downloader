import { Router } from 'express';
import { requireDatabase } from '../persistence/index.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { auditMutations } from './audit.js';
import { requireRole } from './require-role.js';
import policyAdmin from './policy.admin.js';
import takedownsAdmin from './takedowns.admin.js';
import usersAdmin from './users.admin.js';
import jobsAdmin from './jobs.admin.js';
import auditAdmin from './audit.admin.js';
import statsAdmin from './stats.admin.js';
import cmsAdmin from '../cms/cms.admin.js';

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
cmsRouter.use(cmsAdmin);

/** Everything else under /admin is ADMIN only. */
export const adminOnlyRouter = Router();
adminOnlyRouter.use(requireRole());
adminOnlyRouter.use('/policy', policyAdmin);
adminOnlyRouter.use('/takedowns', takedownsAdmin);
adminOnlyRouter.use('/users', usersAdmin);
adminOnlyRouter.use('/jobs', jobsAdmin);
adminOnlyRouter.use('/audit', auditAdmin);
adminOnlyRouter.use('/stats', statsAdmin);

const adminRouter = Router();
adminRouter.use(requireDatabase, adminRateLimit, auditMutations);
adminRouter.use('/cms', cmsRouter);
adminRouter.use(adminOnlyRouter);

export default adminRouter;
