import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { refusalError } from './refusal.js';

/** True when an ACTIVE takedown exists for this media id. */
export async function isTakenDown(mediaId: string): Promise<boolean> {
  try {
    const row = await prisma.takedown.findUnique({ where: { mediaId }, select: { status: true } });
    return row?.status === 'ACTIVE';
  } catch (err) {
    // Degraded mode keeps extraction open while Postgres is down; the next lookup after recovery
    // enforces it again, and activating a takedown also drops the cached record.
    logger.warn({ err, mediaId }, 'Takedown lookup failed; treating as not taken down');
    return false;
  }
}

/** Throws 403 SOURCE_TAKEN_DOWN. */
export async function assertNotTakenDown(mediaId: string): Promise<void> {
  if (await isTakenDown(mediaId)) throw refusalError('SOURCE_TAKEN_DOWN');
}
