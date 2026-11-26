import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/lib/errors.js';
import {
  assertStorageAvailable,
  directorySizeBytes,
  gbToBytes,
  readStorageUsage,
  STORAGE_USAGE_KEY,
  sweepExpiredArtifacts,
  writeStorageUsage,
} from '../../../src/features/maintenance/index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'storage-cap-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(rel: string, bytes: number) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.alloc(bytes));
  return file;
}

describe('directorySizeBytes', () => {
  it('sums every file under the storage dir, nested ones included', async () => {
    await put('job1/video.mp4', 1000);
    await put('job2/a/b/audio.m4a', 250);
    await put('policy.snapshot.json', 50);
    expect(await directorySizeBytes(root)).toBe(1300);
  });

  it('a storage dir that does not exist yet is empty, not an error', async () => {
    expect(await directorySizeBytes(path.join(root, 'nope'))).toBe(0);
  });
});

describe('assertStorageAvailable', () => {
  it('refuses new jobs with STORAGE_FULL once usage reaches the cap', async () => {
    await put('job1/video.mp4', 2048);
    const used = await directorySizeBytes(root);

    expect(() => assertStorageAvailable(used, 4096)).not.toThrow();
    let caught: unknown;
    try {
      assertStorageAvailable(used, 2048);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('STORAGE_FULL');
    expect((caught as AppError).status).toBe(503);
  });

  it('unknown usage (never measured) does not block downloads', () => {
    expect(() => assertStorageAvailable(null, 1)).not.toThrow();
  });

  it('STORAGE_MAX_GB is in GiB', () => {
    expect(gbToBytes(20)).toBe(20 * 1024 ** 3);
  });
});

describe('storage usage in Redis', () => {
  it('round-trips the measured size and treats garbage as unknown', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
    };
    expect(await readStorageUsage(redis)).toBeNull();
    await writeStorageUsage(redis, 12345);
    expect(await readStorageUsage(redis)).toBe(12345);
    store.set(STORAGE_USAGE_KEY, 'abc');
    expect(await readStorageUsage(redis)).toBeNull();
  });

  it('a Redis error reads as unknown rather than failing the request', async () => {
    const redis = { get: vi.fn(async () => Promise.reject(new Error('down'))), set: vi.fn() };
    expect(await readStorageUsage(redis)).toBeNull();
  });
});

describe('sweepExpiredArtifacts', () => {
  it('deletes expired artifacts inside the storage dir and clears their rows', async () => {
    const expiredFile = await put('job-old/video.mp4', 500);
    const keptFile = await put('job-new/video.mp4', 500);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'outside-'));
    const outsideFile = path.join(outside, 'secret.txt');
    await writeFile(outsideFile, 'x');

    const update = vi.fn(async () => ({}));
    const findMany = vi.fn(async () => [
      { id: 'job-old', artifactPath: expiredFile },
      { id: 'job-evil', artifactPath: outsideFile },
    ]);
    const log = { info: vi.fn(), error: vi.fn() };

    const removed = await sweepExpiredArtifacts({ root, db: { job: { findMany, update } }, log });

    expect(removed).toBe(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artifactPath: { not: null }, expiresAt: { lt: expect.any(Date) } },
      }),
    );
    await expect(stat(path.dirname(expiredFile))).rejects.toThrow();
    expect((await stat(keptFile)).isFile()).toBe(true);
    expect((await stat(outsideFile)).isFile()).toBe(true); // never unlink outside storage
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'job-old' },
      data: { artifactPath: null, artifactBytes: null },
    });
    expect(log.error).toHaveBeenCalledTimes(1);
    await rm(outside, { recursive: true, force: true });
  });
});
