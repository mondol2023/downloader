import type { NextFunction, Request, Response } from 'express';
import { tierPolicyFor } from '../features/restrictions/enforce.js';
import { keys, redis } from '../lib/redis.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Sliding-window limiter backed by a Redis sorted set.
 *
 * A fixed-window counter lets a caller fire 2x the limit across a boundary; for
 * an endpoint that shells out to yt-dlp that burst is expensive, so the extra
 * ZSET cost is worth paying. All four commands run in one pipeline.
 */
export interface RateLimitOptions {
  bucket: string;
  windowSeconds: number;
  /** Fixed ceiling, or a per-tier function. */
  max: number | ((req: Request) => number);
  /** Defaults to the quota subject (user or guest). */
  keyFn?: (req: Request) => string;
  message?: string;
}

export async function consumeRateLimit(
  bucket: string,
  subject: string,
  max: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  if (!Number.isFinite(max)) {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0 };
  }

  const key = keys.rateLimit(bucket, subject);
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, now - windowMs)
    .zadd(key, now, member)
    .zcard(key)
    .pexpire(key, windowMs)
    .exec();

  const countEntry = results?.[2];
  const count = typeof countEntry?.[1] === 'number' ? countEntry[1] : 0;

  if (count > max) {
    // Roll back this attempt so a blocked caller cannot extend their own window.
    await redis.zrem(key, member);
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const oldestScore = oldest[1] ? Number(oldest[1]) : now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  return { allowed: true, remaining: Math.max(0, max - count), retryAfterSeconds: 0 };
}

export function rateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const subject = options.keyFn?.(req) ?? req.identity.subject;
      const max = typeof options.max === 'function' ? options.max(req) : options.max;

      const result = await consumeRateLimit(options.bucket, subject, max, options.windowSeconds);

      if (Number.isFinite(max)) {
        res.setHeader('x-ratelimit-limit', String(max));
        res.setHeader('x-ratelimit-remaining', String(result.remaining));
      }

      if (!result.allowed) {
        res.setHeader('retry-after', String(result.retryAfterSeconds));
        next(
          AppError.tooManyRequests(
            options.message ?? 'Too many requests, please slow down',
            result.retryAfterSeconds,
            req.identity.tier === 'PRO' ? undefined : 'PRO',
          ),
        );
        return;
      }
      next();
    } catch (err) {
      // Redis being down must not take the API with it. Log loudly and fail open
      // — the per-tier quota checks in Postgres remain in force.
      logger.error({ err, bucket: options.bucket }, 'Rate limiter unavailable, failing open');
      next();
    }
  };
}

/** Extraction is the expensive path; its ceiling comes from the tier policy. */
export const extractionRateLimit = rateLimit({
  bucket: 'extract',
  windowSeconds: 3600,
  max: (req) => tierPolicyFor(req.identity.tier).hourlyExtractions,
  message: 'Extraction rate limit reached for your plan',
});

/** Credential endpoints are limited per IP, not per session — the session is what is being attacked. */
export const authRateLimit = rateLimit({
  bucket: 'auth',
  windowSeconds: 900,
  max: 20,
  keyFn: (req) => `ip:${req.identity.ipHash}`,
  message: 'Too many authentication attempts, try again shortly',
});

export const globalRateLimit = rateLimit({
  bucket: 'global',
  windowSeconds: 60,
  max: 300,
  keyFn: (req) => `ip:${req.identity.ipHash}`,
});
