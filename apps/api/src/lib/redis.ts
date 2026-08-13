import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const baseOptions: RedisOptions = {
  lazyConnect: false,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
};

function build(name: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, { ...baseOptions, ...overrides });
  client.on('error', (err) => logger.error({ err, client: name }, 'Redis connection error'));
  client.on('reconnecting', () => logger.warn({ client: name }, 'Redis reconnecting'));
  return client;
}

/** General purpose client: cache, counters, rate limit windows. */
export const redis = build('app');

/**
 * BullMQ blocks on its connection (BRPOPLPUSH), so queues and workers must not
 * share the app client. It also requires maxRetriesPerRequest to be null.
 */
export function createQueueConnection(name: string): Redis {
  return build(name, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch (err) {
    logger.error({ err }, 'Failed to close Redis cleanly');
  }
}

export const keys = {
  extraction: (mediaId: string) => `media:extract:${mediaId}`,
  extractionLock: (mediaId: string) => `media:extract:lock:${mediaId}`,
  quotaWindow: (subject: string) => `quota:downloads:${subject}`,
  activeJobs: (subject: string) => `quota:active:${subject}`,
  rateLimit: (bucket: string, subject: string) => `rl:${bucket}:${subject}`,
  jobProgress: (jobId: string) => `job:progress:${jobId}`,
  refreshBlock: (jti: string) => `auth:revoked:${jti}`,
} as const;
