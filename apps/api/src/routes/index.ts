import { Router } from 'express';
import authRoutes from './auth.routes.js';
import billingRoutes from './billing.routes.js';
import jobsRoutes from './jobs.routes.js';
import mediaRoutes from './media.routes.js';

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

// Path must stay `/auth` — the refresh cookie is scoped to `/api/v1/auth`.
router.use('/auth', authRoutes);
router.use('/media', mediaRoutes);
router.use('/jobs', jobsRoutes);
router.use('/billing', billingRoutes);

export default router;
