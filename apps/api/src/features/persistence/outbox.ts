import { appendFile, mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getDbHealth, onDbHealthChange } from './db-health.js';
import { enqueueMirror } from './sheets-sink.js';

/**
 * Durable fallback for ledger-style writes (download log, audit trail).
 *
 * These rows are append-only facts about something that already happened, so
 * losing one to a Postgres outage is worse than writing it late. While the DB is
 * unreachable they are appended to `<STORAGE_DIR>/outbox/<day>.jsonl`; once the
 * DB is back `drainOutbox()` replays them. The record `id` is the primary key, so
 * replays are idempotent.
 */

export type OutboxKind = 'download_log' | 'audit_event';

export interface OutboxRecord {
  kind: OutboxKind;
  /** Becomes the row's primary key — this is what makes a drain idempotent. */
  id: string;
  /** ISO timestamp of the event; also picks the day file and the row's createdAt. */
  at: string;
  data: Record<string, unknown>;
}

const DRAINING = '.draining';

/**
 * Lazy for the same reason as the Prisma import in db-health.ts: the barrel
 * re-exports this file, and a static logger import would drag env validation
 * (and process.exit on a missing secret) into anything that touches the barrel.
 */
type LogFn = (obj: Record<string, unknown>, msg: string) => void;
function log(level: 'info' | 'warn' | 'error', obj: Record<string, unknown>, msg: string): void {
  void import('../../lib/logger.js').then(
    ({ logger }) => (logger[level] as LogFn).call(logger, obj, msg),
    () => undefined,
  );
}

/**
 * Read lazily and straight from process.env (same default as config/env.ts):
 * importing the validated config would drag the whole env schema into every
 * unit test that touches the outbox.
 */
function outboxDir(): string {
  return path.resolve(process.env.STORAGE_DIR ?? './storage', 'outbox');
}

function dayFile(at: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(at)?.[0] ?? new Date().toISOString().slice(0, 10);
  return `${day}.jsonl`;
}

/** BigInt is not JSON-serialisable; byte counts can exceed 2^53, so keep them exact as strings. */
function serialize(rec: OutboxRecord): string {
  return JSON.stringify(rec, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

function parse(line: string): OutboxRecord {
  const rec = JSON.parse(line) as OutboxRecord;
  if (
    !rec ||
    typeof rec.id !== 'string' ||
    (rec.kind !== 'download_log' && rec.kind !== 'audit_event') ||
    typeof rec.data !== 'object' ||
    rec.data === null
  ) {
    throw new Error('not an outbox record');
  }
  if (rec.kind === 'download_log' && typeof rec.data.bytes === 'string') {
    rec.data.bytes = BigInt(rec.data.bytes);
  }
  return rec;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Inserts one record; a row that already exists (same id or jobId) is left alone. */
async function writeToDb(rec: OutboxRecord): Promise<void> {
  const { prisma } = await import('../../lib/prisma.js');
  const d = rec.data;
  const createdAt = new Date(rec.at);

  if (rec.kind === 'download_log') {
    const bytes = typeof d.bytes === 'bigint' ? d.bytes : BigInt(Math.round(Number(d.bytes ?? 0)));
    await prisma.downloadLog.createMany({
      skipDuplicates: true,
      data: [
        {
          id: rec.id,
          jobId: str(d.jobId),
          userId: str(d.userId),
          guestKey: str(d.guestKey),
          tier: d.tier as 'GUEST' | 'FREE' | 'PRO',
          platform: String(d.platform),
          mediaId: String(d.mediaId),
          formatId: String(d.formatId),
          bytes,
          ip: str(d.ip),
          userAgent: str(d.userAgent),
          createdAt,
        },
      ],
    });
    return;
  }

  await prisma.auditEvent.createMany({
    skipDuplicates: true,
    data: [
      {
        id: rec.id,
        userId: str(d.userId),
        guestKey: str(d.guestKey),
        action: String(d.action),
        outcome: String(d.outcome),
        ip: str(d.ip),
        userAgent: str(d.userAgent),
        metadata: (d.metadata ?? {}) as object,
        createdAt,
      },
    ],
  });
}

async function appendToOutbox(rec: OutboxRecord): Promise<void> {
  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, dayFile(rec.at)), `${serialize(rec)}\n`, 'utf8');
}

/**
 * Writes a ledger record to Postgres, or to the outbox if that is not possible.
 * Rejects only when *both* fail (e.g. disk full) — callers log and carry on,
 * because a ledger problem must never fail the user-facing action.
 */
export async function recordLedger(rec: OutboxRecord): Promise<'db' | 'outbox'> {
  // Known-down: skip the doomed query (and its connect timeout) entirely.
  if (getDbHealth().up) {
    try {
      await writeToDb(rec);
      enqueueMirror(rec);
      return 'db';
    } catch (err) {
      log('warn', { err, kind: rec.kind, id: rec.id }, 'Ledger DB write failed; using outbox');
    }
  }
  await appendToOutbox(rec);
  // Mirrored when first recorded, not when the outbox later drains, so the sheet isn't delayed by an outage.
  enqueueMirror(rec);
  return 'outbox';
}

let draining: Promise<{ drained: number; failed: number }> | null = null;

/**
 * Replays outbox files through `write` (default: insert into Postgres).
 *
 * Crash-safe: a file is renamed to `*.draining` before it is read, so records
 * appended during the drain land in a fresh file, and a crash mid-drain leaves a
 * `*.draining` file that the next drain picks up. Lines whose write failed are
 * appended back to the day file; everything else is dropped with the file.
 */
export function drainOutbox(
  write: (r: OutboxRecord) => Promise<void> = writeToDb,
): Promise<{ drained: number; failed: number }> {
  // One drain at a time per process; a second caller shares the running one.
  draining ??= drainOnce(write).finally(() => {
    draining = null;
  });
  return draining;
}

async function drainOnce(
  write: (r: OutboxRecord) => Promise<void>,
): Promise<{ drained: number; failed: number }> {
  const dir = outboxDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { drained: 0, failed: 0 }; // nothing was ever queued
  }

  // Leftovers from a crashed drain go first, then claim the live day files.
  const claimed = names.filter((n) => n.endsWith(DRAINING));
  for (const name of names.filter((n) => n.endsWith('.jsonl')).sort()) {
    const target = claimed.includes(name + DRAINING) ? `${name}.${Date.now()}${DRAINING}` : name + DRAINING;
    try {
      await rename(path.join(dir, name), path.join(dir, target));
      claimed.push(target);
    } catch (err) {
      // Another process claimed it first — that's fine.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  let drained = 0;
  let failed = 0;
  for (const name of claimed.sort()) {
    const file = path.join(dir, name);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue; // claimed and finished by another process
    }

    const retry: string[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let rec: OutboxRecord;
      try {
        rec = parse(line);
      } catch (err) {
        // A torn or corrupt line can never succeed; keeping it would wedge the file forever.
        log('error', { err, line: line.slice(0, 200) }, 'Dropping unreadable outbox line');
        continue;
      }
      try {
        await write(rec);
        drained++;
      } catch (err) {
        failed++;
        retry.push(line);
        log('warn', { err, kind: rec.kind, id: rec.id }, 'Outbox replay failed; keeping line');
      }
    }

    if (retry.length > 0) {
      // Base day file = draining name minus any ".<ts>.draining" / ".draining" suffix.
      const base = name.replace(/(\.\d+)?\.draining$/, '');
      await appendFile(path.join(dir, base), `${retry.join('\n')}\n`, 'utf8');
    }
    await unlink(file).catch(() => undefined);
  }

  if (drained || failed) log('info', { drained, failed }, 'Outbox drained');
  return { drained, failed };
}

/**
 * Drains once at start-up (covers records left by a previous run) and again every
 * time the DB goes from down to up. Returns `stop()`.
 */
export function startOutboxDrainer(): () => void {
  const run = (): void => {
    drainOutbox().catch((err) => log('error', { err }, 'Outbox drain failed'));
  };
  if (getDbHealth().up) run();
  return onDbHealthChange((health, previous) => {
    if (health.up && !previous.up) run();
  });
}
