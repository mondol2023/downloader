import { AppError } from '../../lib/errors.js';

/**
 * Versions of the external binaries the engine shells out to. Read once at boot (and again after a
 * yt-dlp self-update); `null` means the binary is missing or did not answer within the timeout.
 */
export interface ToolVersions {
  ytDlp: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
}

export type ToolName = keyof ToolVersions;

export type ToolPaths = Record<ToolName, string>;

export const TOOL_VERSION_TIMEOUT_MS = 5_000;

/** yt-dlp takes `--version`; ffmpeg/ffprobe document `-version`. */
const VERSION_ARGS: Record<ToolName, string[]> = {
  ytDlp: ['--version'],
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
};

export type VersionRunner = (command: string, args: string[], timeoutMs: number) => Promise<string>;

export interface LoadToolDeps {
  run?: VersionRunner;
  warn?: (tool: ToolName, command: string, err: unknown) => void;
}

/** First line of `--version` output: `2026.11.01` (yt-dlp) or `ffmpeg version 7.1 Copyright…`. */
export function parseToolVersion(output: string): string | null {
  const line = output.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const m = /\bversion\s+(\S+)/i.exec(line);
  return m?.[1] ?? line.split(/\s+/)[0] ?? null;
}

async function defaultRunner(command: string, args: string[], timeoutMs: number): Promise<string> {
  const { runCommand } = await import('../../lib/exec.js');
  const { stdout } = await runCommand(command, { args, timeoutMs, maxOutputBytes: 64 * 1024 });
  return stdout;
}

export async function readToolVersion(
  tool: ToolName,
  command: string,
  deps: LoadToolDeps = {},
): Promise<string | null> {
  const run = deps.run ?? defaultRunner;
  try {
    return parseToolVersion(await run(command, VERSION_ARGS[tool], TOOL_VERSION_TIMEOUT_MS));
  } catch (err) {
    deps.warn?.(tool, command, err);
    return null;
  }
}

export async function loadToolVersions(paths: ToolPaths, deps: LoadToolDeps = {}): Promise<ToolVersions> {
  const [ytDlp, ffmpeg, ffprobe] = await Promise.all([
    readToolVersion('ytDlp', paths.ytDlp, deps),
    readToolVersion('ffmpeg', paths.ffmpeg, deps),
    readToolVersion('ffprobe', paths.ffprobe, deps),
  ]);
  return { ytDlp, ffmpeg, ffprobe };
}

/** Process-wide snapshot, filled at boot. Starts as "unknown" (all null) until loaded. */
let current: ToolVersions = { ytDlp: null, ffmpeg: null, ffprobe: null };

interface WarnLogger {
  warn: (obj: object, msg: string) => void;
}

/** Boot-time load: fills the snapshot and logs a startup warning per missing tool. Never throws. */
export async function initToolVersions(
  paths: ToolPaths,
  log: WarnLogger,
  run?: VersionRunner,
): Promise<ToolVersions> {
  const versions = await loadToolVersions(paths, {
    run,
    warn: (tool, command, err) =>
      log.warn(
        { tool, command, err: err instanceof Error ? err.message : String(err) },
        'Startup warning: media tool not available; jobs needing it will be refused with ENGINE_UNAVAILABLE',
      ),
  });
  setToolVersions(versions);
  return versions;
}

export function getToolVersions(): ToolVersions {
  return current;
}

export function setToolVersions(next: ToolVersions): void {
  current = { ...next };
}

export function setToolVersion(tool: ToolName, version: string | null): void {
  current = { ...current, [tool]: version };
}

/** Tools a download job cannot run without. ffprobe is only used for optional probing. */
const REQUIRED_FOR_JOBS: ToolName[] = ['ytDlp', 'ffmpeg'];

export function missingJobTools(versions: ToolVersions = current): ToolName[] {
  return REQUIRED_FOR_JOBS.filter((t) => versions[t] == null);
}

/** The worker calls this before each job: a missing engine binary is a typed refusal, not a crash. */
export function assertEngineAvailable(versions: ToolVersions = current): void {
  const missing = missingJobTools(versions);
  if (missing.length > 0) {
    throw new AppError(
      503,
      'ENGINE_UNAVAILABLE',
      'The media engine is temporarily unavailable. Please try again later.',
      { details: { missing } },
    );
  }
}
