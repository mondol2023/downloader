import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import type { ApiError } from '@media/shared';
import { AppError, isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`No route matches ${req.method} ${req.path}`));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Streaming responses can fail after headers are flushed; the only correct
  // move then is to destroy the socket, not to write a JSON body.
  if (res.headersSent) {
    logger.error({ err, requestId: req.requestId }, 'Error after response started');
    res.destroy();
    return;
  }

  const normalised = normalise(err);

  const payload: ApiError = {
    error: {
      code: normalised.code,
      message: normalised.message,
      ...(normalised.requiredTier ? { requiredTier: normalised.requiredTier } : {}),
      ...(normalised.retryAfterSeconds != null
        ? { retryAfterSeconds: normalised.retryAfterSeconds }
        : {}),
      ...(normalised.details !== undefined ? { details: normalised.details } : {}),
    },
  };

  const logPayload = {
    err,
    requestId: req.requestId,
    userId: req.identity?.userId ?? null,
    path: req.path,
    method: req.method,
    status: normalised.status,
  };

  if (normalised.status >= 500) logger.error(logPayload, normalised.message);
  else logger.warn(logPayload, normalised.message);

  if (normalised.retryAfterSeconds != null) {
    res.setHeader('retry-after', String(normalised.retryAfterSeconds));
  }

  res.status(normalised.status).json(payload);
  void next;
}

function normalise(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (err instanceof ZodError) {
    return AppError.unprocessable(
      'Request validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
      return AppError.conflict(`That ${target} is already in use`);
    }
    if (err.code === 'P2025') return AppError.notFound('Record not found');
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return AppError.badRequest('Request body is not valid JSON');
  }

  // Unknown failure: never surface the raw message in production.
  const message =
    !isProd && err instanceof Error ? err.message : 'An unexpected error occurred';
  return new AppError(500, 'INTERNAL_ERROR', message);
}

/** Wraps async handlers so rejected promises reach the error middleware. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
