import { PrismaClient } from '@prisma/client';
import { env, isDev } from '../config/env.js';
import { withConnectTimeout } from '../features/persistence/db-health.js';
import { logger } from './logger.js';

// `tsx watch` reloads the module graph on every save; without the global cache
// each reload would open a new pool and exhaust Postgres connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Fail fast when Postgres is down instead of hanging for the driver default.
    datasourceUrl: withConnectTimeout(env.DATABASE_URL),
    log: isDev ? ['warn', 'error'] : ['error'],
  });

if (isDev) globalForPrisma.prisma = prisma;

export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, 'Failed to disconnect Prisma cleanly');
  }
}

/** BigInt columns (byte counts) are not JSON-serialisable by default. */
export function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v)),
  ) as T;
}
