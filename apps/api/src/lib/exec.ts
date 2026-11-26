import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { AppError } from './errors.js';
import { logger } from './logger.js';

/**
 * Thin wrapper around `spawn`.
 *
 * Every call site passes an argv *array* and this module never sets `shell:
 * true`. That is the single most important property here: user-supplied URLs
 * reach yt-dlp as one opaque argv slot, so there is no shell to inject into.
 * Argument values are additionally checked for a leading `-` where they could
 * otherwise be read as a flag.
 */

export interface RunOptions {
  args: string[];
  timeoutMs: number;
  /** Hard ceiling on captured stdout. yt-dlp JSON for a long playlist is big. */
  maxOutputBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Called for each stderr line — used for progress parsing. */
  onStderrLine?: (line: string) => void;
  onStdoutLine?: (line: string) => void;
  /** Aborts the child early (client disconnect, job cancellation). */
  signal?: AbortSignal;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly stderr: string,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

const DEFAULT_MAX_OUTPUT = 32 * 1024 * 1024;

/**
 * Rejects values that a CLI would parse as an option. yt-dlp URLs are always
 * absolute http(s), so anything starting with `-` is either a mistake or an
 * attempt to smuggle in `--exec`.
 */
export function assertNotFlag(value: string, label: string): void {
  if (value.startsWith('-')) {
    throw AppError.badRequest(`${label} must not begin with "-"`);
  }
}

export function runCommand(command: string, options: RunOptions): Promise<RunResult> {
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return new Promise<RunResult>((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(command, options.args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        // Never `shell: true`.
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new CommandError(`Failed to start ${command}`, -1, String(err)));
      return;
    }

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let settled = false;
    let timedOut = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const kill = (reason: string) => {
      child.kill('SIGTERM');
      // yt-dlp/ffmpeg occasionally ignore SIGTERM mid-write; escalate.
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5_000).unref();
      logger.warn({ command, reason }, 'Terminating child process');
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill('timeout');
    }, options.timeoutMs);
    timer.unref();

    const onAbort = () => kill('aborted');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > maxOutput) {
        kill('stdout limit exceeded');
        return;
      }
      stdout += chunk;
      if (options.onStdoutLine) {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n|\r/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) options.onStdoutLine(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Keep only the tail — a failing extractor can emit megabytes of warnings.
      stderr = (stderr + chunk).slice(-16_384);
      if (options.onStderrLine) {
        stderrBuffer += chunk;
        // yt-dlp writes progress with \r, so split on both.
        const lines = stderrBuffer.split(/\r?\n|\r/);
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) options.onStderrLine(line);
      }
    });

    child.on('error', (err) => {
      finish(() =>
        reject(
          new CommandError(
            `${command} could not be executed (${err.message}). Is it installed and on PATH?`,
            -1,
            stderr,
          ),
        ),
      );
    });

    child.on('close', (code) => {
      finish(() => {
        if (options.onStdoutLine && stdoutBuffer) options.onStdoutLine(stdoutBuffer);
        if (options.onStderrLine && stderrBuffer) options.onStderrLine(stderrBuffer);

        if (timedOut) {
          reject(new CommandError(`${command} timed out`, code ?? -1, stderr, true));
          return;
        }
        if (code !== 0) {
          reject(new CommandError(`${command} exited with code ${code}`, code ?? -1, stderr));
          return;
        }
        resolve({ stdout, stderr, code: 0 });
      });
    });
  });
}
