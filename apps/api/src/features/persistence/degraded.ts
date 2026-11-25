import type { RequestHandler } from 'express';
import { AppError } from '../../lib/errors.js';
import { getDbHealth } from './db-health.js';

const RETRY_AFTER_SECONDS = 10;

/**
 * Guards routes whose data lives only in Postgres (auth, billing, new download
 * jobs). While the probe says the database is down they fail immediately with a
 * calm, typed 503 instead of hanging on a Prisma timeout.
 */
export const requireDatabase: RequestHandler = (_req, _res, next) => {
  if (getDbHealth().up) {
    next();
    return;
  }
  next(
    new AppError(
      503,
      'DEGRADED',
      'This feature is temporarily unavailable while we restore our database. Browsing and previewing still work — please try again in a moment.',
      { retryAfterSeconds: RETRY_AFTER_SECONDS },
    ),
  );
};
