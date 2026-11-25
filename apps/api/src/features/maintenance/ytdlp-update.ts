import { getToolVersions, readToolVersion, setToolVersion, type VersionRunner } from '../health/index.js';

/**
 * Keeping yt-dlp fresh. Site extractors break about weekly and yt-dlp ships the fix within days,
 * so a stale binary is the most common reason downloads start failing.
 *
 * The daily tick fires once per deployment (a BullMQ job scheduler), but every process that runs
 * yt-dlp has its own copy of the binary: the API extracts, the worker downloads, and each replica
 * lives in its own container. So the tick only broadcasts on Redis, and each process updates itself.
 */

export const YTDLP_UPDATE_CHANNEL = 'tools:ytdlp-update';
/** A self-update downloads a ~3 MB release; give a slow network plenty of room. */
export const YTDLP_UPDATE_TIMEOUT_MS = 120_000;

interface UpdateLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

export interface SelfUpdateDeps {
  enabled: boolean;
  ytDlpPath: string;
  run?: VersionRunner;
  log: UpdateLog;
}

export interface SelfUpdateResult {
  ran: boolean;
  ok: boolean;
  version: string | null;
}

async function defaultRunner(command: string, args: string[], timeoutMs: number): Promise<string> {
  const { runCommand } = await import('../../lib/exec.js');
  const { stdout } = await runCommand(command, { args, timeoutMs, maxOutputBytes: 256 * 1024 });
  return stdout;
}

/** `yt-dlp -U`, then re-read the version so /healthz shows what is actually installed. Never throws. */
export async function runYtDlpSelfUpdate(deps: SelfUpdateDeps): Promise<SelfUpdateResult> {
  if (!deps.enabled) return { ran: false, ok: false, version: null };
  const run = deps.run ?? defaultRunner;

  let ok = true;
  try {
    const out = await run(deps.ytDlpPath, ['-U'], YTDLP_UPDATE_TIMEOUT_MS);
    deps.log.info({ output: out.trim().slice(0, 500) }, 'yt-dlp self-update finished');
  } catch (err) {
    ok = false;
    // pip/apt installs refuse `-U`; that is an image problem, not a crash.
    deps.log.warn(
      { err: err instanceof Error ? err.message : String(err), command: deps.ytDlpPath },
      'yt-dlp self-update failed; keeping the installed version',
    );
  }

  const read = await readToolVersion('ytDlp', deps.ytDlpPath, { run });
  // A slow or failed re-read must not turn a known-good version into "missing" (which would refuse
  // every job); keep what we had and say so.
  const previous = getToolVersions().ytDlp;
  if (read == null && previous != null) {
    deps.log.warn({ previous }, 'Could not re-read the yt-dlp version after the update; keeping the previous one');
    return { ran: true, ok, version: previous };
  }
  setToolVersion('ytDlp', read);
  return { ran: true, ok, version: read };
}

export interface UpdateSubscriber {
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  subscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface ListenerDeps {
  subscriber: UpdateSubscriber;
  update: () => Promise<unknown>;
  log: UpdateLog;
}

/** Runs `update` on every broadcast tick. A tick that arrives mid-update is dropped, not queued. */
export function startYtDlpUpdateListener(deps: ListenerDeps): () => Promise<void> {
  let running = false;

  deps.subscriber.on('message', (channel) => {
    if (channel !== YTDLP_UPDATE_CHANNEL || running) return;
    running = true;
    void deps
      .update()
      .catch((err: unknown) => deps.log.warn({ err }, 'yt-dlp update listener failed'))
      .finally(() => {
        running = false;
      });
  });

  void Promise.resolve(deps.subscriber.subscribe(YTDLP_UPDATE_CHANNEL)).catch((err: unknown) =>
    deps.log.warn({ err }, `Could not subscribe to ${YTDLP_UPDATE_CHANNEL}; yt-dlp will not auto-update here`),
  );

  return async () => {
    await deps.subscriber.quit().catch(() => undefined);
  };
}
