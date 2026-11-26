import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { OutboxRecord } from '../../../src/features/persistence/outbox.js';
import {
  createSheetsSink,
  enqueueMirror,
  startSheetsMirror,
  type LedgerSink,
  type SheetsClientLike,
} from '../../../src/features/persistence/sheets-sink.js';

interface AppendCall {
  spreadsheetId: string;
  range: string;
  valueInputOption: string;
  requestBody: { values: unknown[][] };
}

/** Records every call; `failures` lets a test make the next N appends reject. */
function fakeClient(opts: { headerPresent?: boolean; failures?: unknown[] } = {}) {
  const appends: AppendCall[] = [];
  const failures = [...(opts.failures ?? [])];
  const get = vi.fn(async () => ({
    data: { values: opts.headerPresent ? [['id']] : undefined },
  }));
  const client: SheetsClientLike = {
    spreadsheets: {
      values: {
        get,
        append: vi.fn(async (p: AppendCall) => {
          // Header appends (first row of a tab) never consume a scripted failure.
          const isHeader = p.requestBody.values.length === 1 && p.requestBody.values[0]![0] === 'id';
          if (!isHeader && failures.length > 0) throw failures.shift();
          appends.push(p);
          return {};
        }),
      },
    },
  };
  return { client, appends, get };
}

const dl = (id: string, extra: Partial<OutboxRecord['data']> = {}): OutboxRecord => ({
  kind: 'download_log',
  id,
  at: '2026-11-25T10:00:00.000Z',
  data: {
    jobId: id,
    userId: 'u1',
    guestKey: null,
    tier: 'FREE',
    platform: 'youtube',
    mediaId: 'abc',
    formatId: '137',
    bytes: 123n,
    ip: '203.0.113.9',
    userAgent: 'Mozilla/5.0',
    ...extra,
  },
});

const audit = (id: string): OutboxRecord => ({
  kind: 'audit_event',
  id,
  at: '2026-11-25T10:00:00.000Z',
  data: { userId: 'u1', action: 'login', outcome: 'ok', ip: '203.0.113.9', userAgent: 'x' },
});

const noSleep = async (): Promise<void> => undefined;
const rateLimited = (): unknown => Object.assign(new Error('Quota exceeded'), { code: 429 });

const cfg = (client: SheetsClientLike, extra: object = {}) => ({
  spreadsheetId: 'sheet-1',
  keyFile: 'unused.json',
  client,
  sleep: noSleep,
  ...extra,
});

/** Data rows only: skips the header append. */
const dataAppends = (appends: AppendCall[]): AppendCall[] =>
  appends.filter((a) => !(a.requestBody.values.length === 1 && a.requestBody.values[0]![0] === 'id'));

describe('createSheetsSink', () => {
  it('batches up to 500 rows per append call', async () => {
    const { client, appends } = fakeClient({ headerPresent: true });
    const sink = createSheetsSink(cfg(client));

    await sink.write(Array.from({ length: 1200 }, (_, i) => dl(`r${i}`)));

    expect(appends.map((a) => a.requestBody.values.length)).toEqual([500, 500, 200]);
    expect(appends.every((a) => a.valueInputOption === 'RAW')).toBe(true);
  });

  it('writes one tab per kind', async () => {
    const { client, appends } = fakeClient({ headerPresent: true });
    await createSheetsSink(cfg(client)).write([dl('a'), audit('b')]);

    expect(appends.map((a) => a.range).sort()).toEqual(['audit_event', 'download_log']);
  });

  it('writes the header row once per tab', async () => {
    const { client, appends } = fakeClient();
    const sink = createSheetsSink(cfg(client));

    await sink.write([dl('a')]);
    await sink.write([dl('b')]);

    const headers = appends.filter((a) => a.requestBody.values[0]![0] === 'id' && a.requestBody.values[0]!.includes('platform'));
    expect(headers).toHaveLength(1);
    expect(dataAppends(appends)).toHaveLength(2);
  });

  it('does not write a header when the tab already has one', async () => {
    const { client, appends } = fakeClient({ headerPresent: true });
    await createSheetsSink(cfg(client)).write([dl('a')]);
    expect(appends).toHaveLength(1);
    expect(appends[0]!.requestBody.values[0]![0]).toBe('a');
  });

  it('drops PII columns and hashes guestKey', async () => {
    const { client, appends } = fakeClient({ headerPresent: true });
    await createSheetsSink(cfg(client)).write([dl('a', { guestKey: 'guest-secret-123' })]);

    const row = appends[0]!.requestBody.values[0]!;
    const flat = JSON.stringify(row);
    expect(flat).not.toContain('203.0.113.9');
    expect(flat).not.toContain('Mozilla');
    expect(flat).not.toContain('guest-secret-123');
    const expected = createHash('sha256').update('guest-secret-123').digest('hex').slice(0, 12);
    expect(row).toContain(expected);
    // bytes (BigInt-safe) arrives as a plain string cell
    expect(row).toContain('123');
  });

  it('also strips PII from audit events', async () => {
    const { client, appends } = fakeClient({ headerPresent: true });
    await createSheetsSink(cfg(client)).write([audit('b')]);
    const flat = JSON.stringify(appends[0]!.requestBody.values);
    expect(flat).not.toContain('203.0.113.9');
    expect(flat).toContain('login');
  });

  it('a 429 response backs off exponentially and retries', async () => {
    const { client, appends } = fakeClient({
      headerPresent: true,
      failures: [rateLimited(), rateLimited()],
    });
    const sleep = vi.fn(async (_ms: number) => undefined);

    await createSheetsSink(cfg(client, { sleep })).write([dl('a')]);

    expect(appends).toHaveLength(1);
    const delays = sleep.mock.calls.map((c) => c[0]);
    expect(delays).toHaveLength(2);
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
  });

  it('gives up after 5 tries and reports the unsent rows', async () => {
    const { client, appends } = fakeClient({
      headerPresent: true,
      failures: Array.from({ length: 10 }, rateLimited),
    });
    const sink = createSheetsSink(cfg(client));

    const err = await sink.write([dl('a'), dl('b')]).catch((e: unknown) => e);

    expect((client.spreadsheets.values.append as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(5);
    expect(appends).toHaveLength(0);
    expect((err as { remaining: OutboxRecord[] }).remaining.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('does not retry non-429 errors', async () => {
    const { client } = fakeClient({ headerPresent: true, failures: [new Error('boom')] });
    await expect(createSheetsSink(cfg(client)).write([dl('a')])).rejects.toThrow('boom');
    expect((client.spreadsheets.values.append as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('only reports rows that were not yet appended when a later chunk fails', async () => {
    // chunk 1 (500) succeeds; chunk 2 fails with a non-retryable error
    const { client } = fakeClient({ headerPresent: true });
    let n = 0;
    (client.spreadsheets.values.append as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (++n === 2) throw new Error('boom');
      return {};
    });
    const rows = Array.from({ length: 600 }, (_, i) => dl(`r${i}`));

    const err = await createSheetsSink(cfg(client)).write(rows).catch((e: unknown) => e);

    const remaining = (err as { remaining: OutboxRecord[] }).remaining;
    expect(remaining).toHaveLength(100);
    expect(remaining[0]!.id).toBe('r500');
  });
});

describe('startSheetsMirror', () => {
  let stop: () => void = () => undefined;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  function recordingSink(): LedgerSink & { batches: OutboxRecord[][] } {
    const batches: OutboxRecord[][] = [];
    return { batches, write: vi.fn(async (b: OutboxRecord[]) => void batches.push(b)) };
  }

  it('flushes every 30_000 ms by default', async () => {
    const sink = recordingSink();
    stop = startSheetsMirror(sink);
    enqueueMirror(dl('a'));

    await vi.advanceTimersByTimeAsync(29_999);
    expect(sink.write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]!.map((r) => r.id)).toEqual(['a']);
  });

  it('does not call the sink when nothing is queued', async () => {
    const sink = recordingSink();
    stop = startSheetsMirror(sink);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(sink.write).not.toHaveBeenCalled();
  });

  it('splits a large queue into maxBatch-sized writes', async () => {
    const sink = recordingSink();
    stop = startSheetsMirror(sink, { maxBatch: 2 });
    for (const id of ['a', 'b', 'c']) enqueueMirror(dl(id));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(sink.batches.map((b) => b.map((r) => r.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('puts rows back in the queue when the sink fails, and retries on the next tick', async () => {
    const batches: OutboxRecord[][] = [];
    let fail = true;
    const sink: LedgerSink = {
      write: vi.fn(async (b: OutboxRecord[]) => {
        if (fail) throw Object.assign(new Error('429'), { remaining: b });
        batches.push(b);
      }),
    };
    stop = startSheetsMirror(sink, { flushMs: 1000 });
    enqueueMirror(dl('a'));
    enqueueMirror(dl('b'));

    await vi.advanceTimersByTimeAsync(1000);
    expect(batches).toHaveLength(0);

    fail = false;
    enqueueMirror(dl('c'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(batches.flat().map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('only requeues the unsent rows when the sink reports partial progress', async () => {
    const batches: OutboxRecord[][] = [];
    let first = true;
    const sink: LedgerSink = {
      write: vi.fn(async (b: OutboxRecord[]) => {
        if (first) {
          first = false;
          throw Object.assign(new Error('partial'), { remaining: b.slice(1) });
        }
        batches.push(b);
      }),
    };
    stop = startSheetsMirror(sink, { flushMs: 1000 });
    enqueueMirror(dl('a'));
    enqueueMirror(dl('b'));

    await vi.advanceTimersByTimeAsync(2000);

    expect(batches.flat().map((r) => r.id)).toEqual(['b']);
  });

  it('stop() ends flushing and enqueue becomes a no-op', async () => {
    const sink = recordingSink();
    stop = startSheetsMirror(sink);
    stop();
    enqueueMirror(dl('a'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sink.write).not.toHaveBeenCalled();
  });

  it('enqueue is a no-op when no mirror is running', () => {
    expect(() => enqueueMirror(dl('a'))).not.toThrow();
  });
});
