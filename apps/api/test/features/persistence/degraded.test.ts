import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/lib/errors.js';
import {
  getDbHealth,
  requireDatabase,
  startDbHealthProbe,
} from '../../../src/features/persistence/index.js';

const INTERVAL = 5000;

let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

/** Lets the probe's promise chain settle after advancing fake time. */
async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function run(): { err: unknown; called: boolean } {
  const out = { err: undefined as unknown, called: false };
  const next: NextFunction = (e?: unknown) => {
    out.called = true;
    out.err = e;
  };
  requireDatabase({} as Request, {} as Response, next);
  return out;
}

describe('requireDatabase', () => {
  it('returns 503 DEGRADED when probe fails', async () => {
    stop = startDbHealthProbe({
      intervalMs: INTERVAL,
      probe: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });
    await tick(0); // initial probe runs immediately

    const { err } = run();
    expect(err).toBeInstanceOf(AppError);
    const e = err as AppError;
    expect(e.status).toBe(503);
    expect(e.code).toBe('DEGRADED');
    expect(e.message).toMatch(/temporarily unavailable/i);
    expect(e.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('passes through when probe succeeds', async () => {
    stop = startDbHealthProbe({ intervalMs: INTERVAL, probe: () => Promise.resolve() });
    await tick(0);

    const out = run();
    expect(out.called).toBe(true);
    expect(out.err).toBeUndefined();
  });
});

describe('health probe', () => {
  it('flips back to up after a successful probe', async () => {
    let fail = true;
    stop = startDbHealthProbe({
      intervalMs: INTERVAL,
      probe: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve()),
    });
    await tick(0);
    expect(getDbHealth().up).toBe(false);
    expect(getDbHealth().lastError).toBe('down');

    fail = false;
    await tick(INTERVAL);
    expect(getDbHealth().up).toBe(true);
    expect(getDbHealth().lastError).toBeNull();
    expect(run().err).toBeUndefined();
  });

  it('probe failure is detected within 2 intervals', async () => {
    let fail = false;
    stop = startDbHealthProbe({
      intervalMs: INTERVAL,
      probe: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve()),
    });
    await tick(0);
    expect(getDbHealth().up).toBe(true);

    fail = true;
    await tick(INTERVAL * 2);
    expect(getDbHealth().up).toBe(false);
  });

  it('a hanging probe is treated as down instead of blocking forever', async () => {
    stop = startDbHealthProbe({
      intervalMs: INTERVAL,
      probe: () => new Promise<void>(() => {}), // never settles
    });
    await tick(2500); // past the 2000 ms race timeout
    expect(getDbHealth().up).toBe(false);
    expect(getDbHealth().lastError).toMatch(/timed out/i);
  });

  it('keeps `since` stable while the state does not change', async () => {
    stop = startDbHealthProbe({ intervalMs: INTERVAL, probe: () => Promise.resolve() });
    await tick(0);
    const first = getDbHealth().since;
    await tick(INTERVAL * 3);
    expect(getDbHealth().since).toEqual(first);
  });
});
