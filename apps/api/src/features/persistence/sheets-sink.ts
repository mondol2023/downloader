import { createHash } from 'node:crypto';
import type { OutboxKind, OutboxRecord } from './outbox.js';

/**
 * Optional, best-effort mirror of the ledger (download log, audit trail) into a
 * Google Sheet for people who want to eyeball rows without a SQL client.
 *
 * Postgres (plus the outbox) stays the source of truth; this is a one-way copy.
 * Rows are queued in memory by `recordLedger()` and flushed on a timer, so a slow
 * or rate-limited Sheets API never sits on a user-facing request path, and a
 * restart can lose at most one flush interval of *mirror* rows, never ledger rows.
 *
 * Personal data never leaves the database: `ip` and `userAgent` are dropped and
 * `guestKey` is replaced by a short sha256 prefix (enough to group a guest's rows).
 */

export interface LedgerSink {
  /**
   * Rejects if some rows could not be written. An error carrying `remaining`
   * (see `SheetsWriteError`) says exactly which rows are still unsent.
   */
  write(batch: OutboxRecord[]): Promise<void>;
}

/** The slice of the `googleapis` Sheets client this file uses; tests pass a fake. */
export interface SheetsClientLike {
  spreadsheets: {
    values: {
      append(params: {
        spreadsheetId: string;
        range: string;
        valueInputOption: 'RAW';
        requestBody: { values: string[][] };
      }): Promise<unknown>;
      get(params: {
        spreadsheetId: string;
        range: string;
      }): Promise<{ data: { values?: unknown[][] | null } }>;
    };
  };
}

export class SheetsWriteError extends Error {
  constructor(
    message: string,
    /** Records that were not appended; safe to queue again without duplicating rows. */
    readonly remaining: OutboxRecord[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SheetsWriteError';
  }
}

export interface SheetsSinkConfig {
  spreadsheetId: string;
  keyFile: string;
  client?: SheetsClientLike;
  /** Injectable for tests so backoff does not take real time. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_ROWS_PER_APPEND = 500;
const MAX_TRIES = 5;
const BASE_BACKOFF_MS = 1_000;
const HASH_PREFIX_LEN = 12;

type Cell = (rec: OutboxRecord) => string;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const field =
  (key: string): Cell =>
  (r) =>
    text(r.data[key]);
const guestHash: Cell = (r) => {
  const key = r.data.guestKey;
  return typeof key === 'string' && key
    ? createHash('sha256').update(key).digest('hex').slice(0, HASH_PREFIX_LEN)
    : '';
};

/**
 * One tab per kind. The column list is an allowlist: a field added to the ledger
 * later stays out of the sheet until someone decides it is safe to publish there.
 * (`metadata` on audit events is deliberately absent: it is free-form and may hold PII.)
 */
const TABS: Record<OutboxKind, { header: string[]; cells: Cell[] }> = {
  download_log: {
    header: ['id', 'at', 'jobId', 'userId', 'tier', 'guestKeyHash', 'platform', 'mediaId', 'formatId', 'bytes'],
    cells: [
      (r) => r.id,
      (r) => r.at,
      field('jobId'),
      field('userId'),
      field('tier'),
      guestHash,
      field('platform'),
      field('mediaId'),
      field('formatId'),
      field('bytes'),
    ],
  },
  audit_event: {
    header: ['id', 'at', 'userId', 'guestKeyHash', 'action', 'outcome'],
    cells: [(r) => r.id, (r) => r.at, field('userId'), guestHash, field('action'), field('outcome')],
  },
};

type LogFn = (obj: Record<string, unknown>, msg: string) => void;
/** Lazy for the same reason as in outbox.ts: keep env validation out of the import graph. */
function log(level: 'info' | 'warn' | 'error', obj: Record<string, unknown>, msg: string): void {
  void import('../../lib/logger.js').then(
    ({ logger }) => (logger[level] as LogFn).call(logger, obj, msg),
    () => undefined,
  );
}

function isRateLimited(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  return e?.code === 429 || e?.status === 429 || e?.response?.status === 429;
}

async function defaultClient(keyFile: string): Promise<SheetsClientLike> {
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth }) as unknown as SheetsClientLike;
}

export function createSheetsSink(cfg: SheetsSinkConfig): LedgerSink {
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let clientPromise: Promise<SheetsClientLike> | undefined;
  const client = (): Promise<SheetsClientLike> =>
    (clientPromise ??= cfg.client ? Promise.resolve(cfg.client) : defaultClient(cfg.keyFile));
  const headerDone = new Set<OutboxKind>();

  /** Runs `fn`, retrying 429s with exponential backoff (1s, 2s, 4s, 8s), max 5 tries in all. */
  async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!isRateLimited(err) || attempt >= MAX_TRIES) throw err;
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }

  async function ensureHeader(kind: OutboxKind): Promise<void> {
    if (headerDone.has(kind)) return;
    const values = (await client()).spreadsheets.values;
    const existing = await values.get({ spreadsheetId: cfg.spreadsheetId, range: `${kind}!A1:A1` });
    if (!existing.data.values?.length) {
      await values.append({
        spreadsheetId: cfg.spreadsheetId,
        range: kind,
        valueInputOption: 'RAW',
        requestBody: { values: [TABS[kind].header] },
      });
    }
    headerDone.add(kind);
  }

  return {
    async write(batch) {
      const chunks: { kind: OutboxKind; recs: OutboxRecord[] }[] = [];
      for (const kind of Object.keys(TABS) as OutboxKind[]) {
        const ofKind = batch.filter((r) => r.kind === kind);
        for (let i = 0; i < ofKind.length; i += MAX_ROWS_PER_APPEND) {
          chunks.push({ kind, recs: ofKind.slice(i, i + MAX_ROWS_PER_APPEND) });
        }
      }

      for (const [i, { kind, recs }] of chunks.entries()) {
        try {
          await withBackoff(async () => {
            await ensureHeader(kind);
            await (await client()).spreadsheets.values.append({
              spreadsheetId: cfg.spreadsheetId,
              range: kind,
              valueInputOption: 'RAW',
              requestBody: { values: recs.map((r) => TABS[kind].cells.map((cell) => cell(r))) },
            });
          });
        } catch (err) {
          const remaining = chunks.slice(i).flatMap((c) => c.recs);
          const reason = err instanceof Error ? err.message : String(err);
          throw new SheetsWriteError(reason, remaining, { cause: err });
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory queue + flush timer
// ---------------------------------------------------------------------------

/** Mirror rows are a convenience copy; past this, drop the oldest rather than grow without bound. */
const MAX_QUEUE = 50_000;

let queue: OutboxRecord[] | null = null;

/** Called by `recordLedger()` after a successful write. A no-op unless a mirror is running. */
export function enqueueMirror(rec: OutboxRecord): void {
  if (!queue) return;
  queue.push(rec);
  if (queue.length > MAX_QUEUE) {
    const dropped = queue.length - MAX_QUEUE;
    queue.splice(0, dropped);
    log('warn', { dropped }, 'Sheets mirror queue full; dropped oldest rows');
  }
}

/**
 * Starts the mirror iff `SHEETS_SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_FILE` are
 * both set; otherwise returns a no-op `stop()`. Read straight from process.env, like
 * STORAGE_DIR in outbox.ts, so unit tests don't pull in the validated env schema.
 */
export function startSheetsMirrorFromEnv(): () => void {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!spreadsheetId || !keyFile) return () => undefined;
  log('info', { spreadsheetId }, 'Google Sheets ledger mirror enabled');
  return startSheetsMirror(createSheetsSink({ spreadsheetId, keyFile }));
}

/** Starts flushing queued ledger rows to `sink`. Returns `stop()`; queued rows are discarded on stop. */
export function startSheetsMirror(
  sink: LedgerSink,
  opts: { flushMs?: number; maxBatch?: number } = {},
): () => void {
  const flushMs = opts.flushMs ?? 30_000;
  const maxBatch = opts.maxBatch ?? MAX_ROWS_PER_APPEND;
  const mine: OutboxRecord[] = [];
  queue = mine;
  let flushing = false;

  const flush = async (): Promise<void> => {
    if (flushing) return;
    flushing = true;
    try {
      while (mine.length > 0) {
        const batch = mine.splice(0, maxBatch);
        try {
          await sink.write(batch);
        } catch (err) {
          const remaining = (err as { remaining?: OutboxRecord[] }).remaining ?? batch;
          mine.unshift(...remaining);
          log('warn', { err, requeued: remaining.length }, 'Sheets mirror write failed; will retry next flush');
          return; // wait for the next tick instead of hammering a failing API
        }
      }
    } finally {
      flushing = false;
    }
  };

  const timer = setInterval(() => void flush(), flushMs);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    if (queue === mine) queue = null;
  };
}
