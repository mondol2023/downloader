import type { Express } from 'express';
import { startDbHealthProbe } from './features/persistence/index.js';
import { app } from './app.js';

/**
 * Vercel entry: the same Express app, plus only the DB health probe, started once per warm instance.
 * The runtime policy store (restrictions) is deliberately not started here: `getPolicy()` serves the
 * code defaults. Timers that `index.ts` runs (token prune, CMS publish) are Vercel Cron routes instead.
 */
let booted = false;

export function getServerlessApp(): Express {
  if (!booted) {
    booted = true;
    startDbHealthProbe();
  }
  return app;
}

export { pruneExpiredRefreshTokens } from './services/token.service.js';
export { publishDuePages } from './features/cms/index.js';
