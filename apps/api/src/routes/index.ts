import { Router, type RequestHandler } from 'express';
import { requireDatabase } from '../features/persistence/index.js';
import authRoutes from './auth.routes.js';
import billingRoutes from './billing.routes.js';
import jobsRoutes from './jobs.routes.js';
import mediaRoutes from './media.routes.js';
import policyRoutes from '../features/restrictions/policy.routes.js';

/**
 * Versioned API surface.
 *
 * Everything the browser touches goes through Next.js, which forwards to these
 * paths verbatim — keeping the version prefix in one place means the proxy is a
 * dumb pass-through and cannot drift from the routes it forwards to.
 *
 * The Stripe webhook is *not* mounted here: it needs the raw request body, so it
 * is attached directly in `index.ts` ahead of the JSON parser.
 */
const router = Router();

/**
 * Degraded mode: auth, billing and anything that creates or mutates a job live
 * only in Postgres, so they 503 immediately while it is down. `/media/*` (guest
 * extraction, Redis-cached) and the read-only job routes (artifact download,
 * status) deliberately stay open.
 */
const writesNeedDatabase: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  requireDatabase(req, res, next);
};

// Path must stay `/auth` — the refresh cookie is scoped to `/api/v1/auth`.
router.use('/auth', requireDatabase, authRoutes);
router.use('/media', mediaRoutes);
// Public, read-only and served from memory, so it stays up while Postgres is down.
router.use('/policy', policyRoutes);
router.use('/jobs', writesNeedDatabase, jobsRoutes);
router.use('/billing', requireDatabase, billingRoutes);

export default router;
