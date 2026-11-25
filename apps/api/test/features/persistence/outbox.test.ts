import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// recordLedger's DB path goes through this mock; individual tests make it fail.
const createMany = vi.fn();
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    downloadLog: { createMany: (...a: unknown[]) => createMany(...a) },
    auditEvent: { createMany: (...a: unknown[]) => createMany(...a) },
  },
}));

// The real logger loads the validated env schema; irrelevant here.
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  drainOutbox,
  recordLedger,
  type OutboxRecord,
} from '../../../src/features/persistence/outbox.js';

let dir: string;
const prevStorage = process.env.STORAGE_DIR;

const rec = (id: string, extra: Partial<OutboxRecord> = {}): OutboxRecord => ({
  kind: 'download_log',
  id,
  at: '2026-11-25T10:00:00.000Z',
  data: { jobId: id, bytes: 123n },
  ...extra,
});

async function outboxFiles(): Promise<string[]> {
  return (await readdir(path.join(dir, 'outbox'))).sort();
}

async function lines(file: string): Promise<string[]> {
  const text = await readFile(path.join(dir, 'outbox', file), 'utf8');
  return text.split('\n').filter(Boolean);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'outbox-'));
  process.env.STORAGE_DIR = dir;
  createMany.mockReset();
});

afterEach(async () => {
  if (prevStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = prevStorage;
  await rm(dir, { recursive: true, force: true });
});

describe('recordLedger', () => {
  it('writes straight to the db when it is up', async () => {
    createMany.mockResolvedValue({ count: 1 });
    await expect(recordLedger(rec('job-1'))).resolves.toBe('db');
    expect(createMany).toHaveBeenCalledOnce();
    await expect(readdir(path.join(dir, 'outbox'))).rejects.toThrow();
  });

  it('writes to outbox when db is down', async () => {
    createMany.mockRejectedValue(new Error('P1001 db unreachable'));
    await expect(recordLedger(rec('job-1'))).resolves.toBe('outbox');

    expect(await outboxFiles()).toEqual(['2026-11-25.jsonl']);
    const l = await lines('2026-11-25.jsonl');
    expect(l).toHaveLength(1);
    expect(JSON.parse(l[0]!).id).toBe('job-1');
  });
});

describe('drainOutbox', () => {
  it('is idempotent: draining twice does not duplicate rows', async () => {
    createMany.mockRejectedValueOnce(new Error('down'));
    await recordLedger(rec('job-1'));

    // Behaves like Postgres with skipDuplicates: keyed by record id.
    const stored = new Map<string, OutboxRecord>();
    const write = async (r: OutboxRecord): Promise<void> => {
      if (!stored.has(r.id)) stored.set(r.id, r);
    };

    await expect(drainOutbox(write)).resolves.toEqual({ drained: 1, failed: 0 });
    await expect(drainOutbox(write)).resolves.toEqual({ drained: 0, failed: 0 });
    expect(stored.size).toBe(1);
  });

  it('default writer uses createMany with skipDuplicates', async () => {
    createMany.mockRejectedValueOnce(new Error('down'));
    await recordLedger(rec('job-1'));

    createMany.mockReset();
    createMany.mockResolvedValue({ count: 1 });
    await drainOutbox();

    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true });
  });

  it('keeps lines that failed', async () => {
    createMany.mockRejectedValue(new Error('down'));
    await recordLedger(rec('a'));
    await recordLedger(rec('b'));
    await recordLedger(rec('c'));

    const write = async (r: OutboxRecord): Promise<void> => {
      if (r.id === 'b') throw new Error('still failing');
    };
    await expect(drainOutbox(write)).resolves.toEqual({ drained: 2, failed: 1 });

    expect(await outboxFiles()).toEqual(['2026-11-25.jsonl']);
    const l = await lines('2026-11-25.jsonl');
    expect(l).toHaveLength(1);
    expect(JSON.parse(l[0]!).id).toBe('b');
  });

  it('preserves records appended while a drain is running', async () => {
    createMany.mockRejectedValue(new Error('down'));
    await recordLedger(rec('a'));

    const write = async (): Promise<void> => {
      // A request lands mid-drain; it must go to a fresh file, not be lost.
      await recordLedger(rec('late'));
    };
    await drainOutbox(write);

    const files = await outboxFiles();
    const all = (await Promise.all(files.map(lines))).flat().map((l) => JSON.parse(l).id);
    expect(all).toEqual(['late']);
  });

  it('recovers a .draining file left by a crashed drain', async () => {
    createMany.mockRejectedValue(new Error('down'));
    await recordLedger(rec('a'));
    // Simulate a crash after the rename but before the writes finished.
    const { rename } = await import('node:fs/promises');
    await rename(
      path.join(dir, 'outbox', '2026-11-25.jsonl'),
      path.join(dir, 'outbox', '2026-11-25.jsonl.draining'),
    );

    const seen: string[] = [];
    await drainOutbox(async (r) => {
      seen.push(r.id);
    });
    expect(seen).toEqual(['a']);
    expect(await outboxFiles()).toEqual([]);
  });

  it('skips corrupt lines instead of wedging the queue', async () => {
    createMany.mockRejectedValue(new Error('down'));
    await recordLedger(rec('a'));
    const { appendFile } = await import('node:fs/promises');
    await appendFile(path.join(dir, 'outbox', '2026-11-25.jsonl'), '{not json\n');

    const seen: string[] = [];
    const out = await drainOutbox(async (r) => {
      seen.push(r.id);
    });
    expect(seen).toEqual(['a']);
    expect(out.failed).toBe(0);
    expect(await outboxFiles()).toEqual([]);
  });
});

describe('BigInt round trip', () => {
  it('bytes is serialized as a string, then parsed back to bigint', async () => {
    createMany.mockRejectedValue(new Error('down'));
    const big = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    await recordLedger(rec('job-1', { data: { jobId: 'job-1', bytes: big } }));

    const raw = JSON.parse((await lines('2026-11-25.jsonl'))[0]!);
    expect(raw.data.bytes).toBe('9007199254740993');

    const got: OutboxRecord[] = [];
    await drainOutbox(async (r) => {
      got.push(r);
    });
    expect(got[0]!.data.bytes).toBe(big);
  });
});
