export interface DbHealth {
  up: boolean;
  /** When `up` last changed (or when the probe module loaded). */
  since: Date;
  lastError: string | null;
}

const DEFAULT_INTERVAL_MS = 5000;
const PROBE_TIMEOUT_MS = 2000;

/**
 * Optimistic until the first probe lands: the probe runs immediately on start,
 * so the window in which we guess is a few milliseconds, and guessing "down"
 * would 503 real traffic during every boot.
 */
let state: DbHealth = { up: true, since: new Date(), lastError: null };

const changeListeners = new Set<(health: DbHealth, previous: DbHealth) => void>();

export function getDbHealth(): DbHealth {
  return { ...state };
}

/** Called on every up/down transition. Used by the outbox to drain on recovery. */
export function onDbHealthChange(
  listener: (health: DbHealth, previous: DbHealth) => void,
): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/**
 * Prisma only reads `connect_timeout` from the URL. Without it a dead Postgres
 * makes every query hang for the driver default (~30 s) instead of failing fast.
 */
export function withConnectTimeout(databaseUrl: string, seconds = 5): string {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', String(seconds));
  }
  return url.toString();
}

async function defaultProbe(): Promise<void> {
  // Lazy: keeps this module free of env/Prisma side effects for unit tests,
  // and avoids an import cycle with lib/prisma.ts.
  const { prisma } = await import('../../lib/prisma.js');
  await prisma.$queryRaw`SELECT 1`;
}

function withTimeout(run: () => Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`database probe timed out after ${ms}ms`)), ms);
    let p: Promise<void>;
    try {
      p = run();
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    p.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function setState(up: boolean, lastError: string | null): void {
  const previous = state;
  if (previous.up === up) {
    state = { ...previous, lastError };
    return;
  }
  state = { up, since: new Date(), lastError };
  for (const listener of changeListeners) {
    try {
      listener({ ...state }, { ...previous });
    } catch {
      // A misbehaving listener must never break the probe loop.
    }
  }
}

/** Starts probing the database. Returns `stop()`. */
export function startDbHealthProbe(
  opts: { intervalMs?: number; probe?: () => Promise<void> } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const probe = opts.probe ?? defaultProbe;
  let stopped = false;
  let inFlight = false;

  const check = async (): Promise<void> => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      await withTimeout(probe, PROBE_TIMEOUT_MS);
      if (!stopped) setState(true, null);
    } catch (err) {
      if (!stopped) setState(false, err instanceof Error ? err.message : String(err));
    } finally {
      inFlight = false;
    }
  };

  void check();
  const timer = setInterval(() => void check(), intervalMs);
  timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
