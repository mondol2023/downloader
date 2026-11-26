import { Router } from 'express';
import { getPolicy } from './policy.current.js';
import { toPublicPolicy } from './merge.js';

/**
 * What anonymous clients may see: tier limits and which platforms are on. The web pricing page
 * reads its numbers from here rather than from constants, so an admin change shows up within
 * the cache window. Admin routes (publish, rollback) arrive with the admin console.
 */
const router = Router();

router.get('/public', (_req, res) => {
  res.setHeader('cache-control', 'public, max-age=30');
  res.json({ data: toPublicPolicy(getPolicy()) });
});

export default router;
