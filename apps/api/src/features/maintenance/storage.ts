import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../lib/errors.js';

/**
 * Storage cap and artifact expiry.
 *
 * The worker owns the volume: it measures `STORAGE_DIR` after every sweep and publishes the total
 * to Redis, so the API can refuse new jobs with `STORAGE_FULL` before reserving quota — the API
 * container may not even mount the volume.
 */

export const STORAGE_USAGE_KEY = 'storage:used-bytes';

export function gbToBytes(gb: number): number {
  return gb * 1024 ** 3;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Total bytes of regular files under `dir`. Symlinks are not followed; a missing dir is 0. */
export async function directorySizeBytes(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return 0;
    throw err;
  }

  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySizeBytes(full);
    } else if (entry.isFile()) {
      // A file can vanish between readdir and lstat (a sweep or a finished job); skip it.
      total += await lstat(full).then(
        (s) => s.size,
        (err: unknown) => {
          if (isMissing(err)) return 0;
          throw err;
        },
      );
    }
  }
  return total;
}

/**
 * Unknown usage (never measured, or Redis unreadable) does not block: the cap protects the disk,
 * it is not a security control, and the next sweep fills the number in within 15 minutes.
 */
export function assertStorageAvailable(usedBytes: number | null, maxBytes: number): void {
  if (usedBytes == null || usedBytes < maxBytes) return;
  throw new AppError(
    503,
    'STORAGE_FULL',
    'Downloads are paused while server storage is cleared. Please try again in a few minutes.',
  );
}

interface UsageStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

export async function readStorageUsage(store: UsageStore): Promise<number | null> {
  try {
    const raw = await store.get(STORAGE_USAGE_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export async function writeStorageUsage(store: UsageStore, bytes: number): Promise<void> {
  await store.set(STORAGE_USAGE_KEY, String(Math.round(bytes)));
}

interface SweepDb {
  job: {
    findMany(args: {
      where: { artifactPath: { not: null }; expiresAt: { lt: Date } };
      select: { id: true; artifactPath: true };
      take: number;
    }): Promise<Array<{ id: string; artifactPath: string | null }>>;
    update(args: {
      where: { id: string };
      data: { artifactPath: null; artifactBytes: null };
    }): Promise<unknown>;
  };
}

export interface SweepDeps {
  root: string;
  db: SweepDb;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  batch?: number;
}

/** Deletes artifacts whose `Job.expiresAt` has passed. Returns how many were removed. */
export async function sweepExpiredArtifacts(deps: SweepDeps): Promise<number> {
  const root = path.resolve(deps.root);
  const expired = await deps.db.job.findMany({
    where: { artifactPath: { not: null }, expiresAt: { lt: new Date() } },
    select: { id: true, artifactPath: true },
    take: deps.batch ?? 200,
  });

  let removed = 0;
  for (const job of expired) {
    if (!job.artifactPath) continue;
    const dir = path.dirname(path.resolve(job.artifactPath));
    // Same confinement rule as the download route, and never the root itself.
    if (!dir.startsWith(root + path.sep)) {
      deps.log.error({ jobId: job.id, dir }, 'Refusing to sweep path outside storage root');
      continue;
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await deps.db.job
      .update({ where: { id: job.id }, data: { artifactPath: null, artifactBytes: null } })
      .catch(() => undefined);
    removed += 1;
  }

  if (removed > 0) deps.log.info({ removed }, 'Swept expired artifacts');
  return removed;
}
