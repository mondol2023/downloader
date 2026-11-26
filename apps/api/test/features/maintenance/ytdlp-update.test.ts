import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getToolVersions, setToolVersions } from '../../../src/features/health/index.js';
import {
  YTDLP_UPDATE_CHANNEL,
  YTDLP_UPDATE_TIMEOUT_MS,
  runYtDlpSelfUpdate,
  startYtDlpUpdateListener,
} from '../../../src/features/maintenance/index.js';

const log = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  setToolVersions({ ytDlp: '2026.10.01', ffmpeg: '7.1', ffprobe: '7.1' });
});

describe('runYtDlpSelfUpdate', () => {
  it('does nothing when YTDLP_AUTO_UPDATE is off', async () => {
    const run = vi.fn();
    const result = await runYtDlpSelfUpdate({ enabled: false, ytDlpPath: 'yt-dlp', run, log });
    expect(run).not.toHaveBeenCalled();
    expect(result.ran).toBe(false);
  });

  it('runs yt-dlp -U then re-reads the version for /healthz', async () => {
    const run = vi.fn(async (_cmd: string, args: string[]) =>
      args[0] === '-U' ? 'Updated yt-dlp to 2026.11.20' : '2026.11.20\n',
    );
    const result = await runYtDlpSelfUpdate({ enabled: true, ytDlpPath: '/usr/bin/yt-dlp', run, log });

    expect(run).toHaveBeenNthCalledWith(1, '/usr/bin/yt-dlp', ['-U'], YTDLP_UPDATE_TIMEOUT_MS);
    expect(run).toHaveBeenNthCalledWith(2, '/usr/bin/yt-dlp', ['--version'], 5_000);
    expect(result).toEqual({ ran: true, ok: true, version: '2026.11.20' });
    expect(getToolVersions().ytDlp).toBe('2026.11.20');
    expect(getToolVersions().ffmpeg).toBe('7.1');
  });

  it('a failed update logs a warning and still refreshes the version', async () => {
    const run = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === '-U') throw new Error('network unreachable');
      return '2026.10.01';
    });
    const result = await runYtDlpSelfUpdate({ enabled: true, ytDlpPath: 'yt-dlp', run, log });

    expect(result).toEqual({ ran: true, ok: false, version: '2026.10.01' });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(getToolVersions().ytDlp).toBe('2026.10.01');
  });

  it('a re-read that fails after -U keeps the previously known version and warns', async () => {
    const run = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === '-U') return 'ok';
      throw new Error('timed out after 5000ms');
    });
    const result = await runYtDlpSelfUpdate({ enabled: true, ytDlpPath: 'yt-dlp', run, log });
    expect(result.version).toBe('2026.10.01');
    expect(getToolVersions().ytDlp).toBe('2026.10.01');
    expect(log.warn).toHaveBeenCalled();
  });
});

class FakeSubscriber extends EventEmitter {
  subscribe = vi.fn(async () => 1);
  quit = vi.fn(async () => 'OK');
}

describe('startYtDlpUpdateListener', () => {
  it('every process self-updates when the daily tick is broadcast, and overlapping ticks coalesce', async () => {
    const sub = new FakeSubscriber();
    let finish!: () => void;
    const update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = startYtDlpUpdateListener({ subscriber: sub, update, log });

    expect(sub.subscribe).toHaveBeenCalledWith(YTDLP_UPDATE_CHANNEL);
    sub.emit('message', YTDLP_UPDATE_CHANNEL, '1');
    sub.emit('message', YTDLP_UPDATE_CHANNEL, '1'); // still running → ignored
    sub.emit('message', 'policy:changed', '1'); // other channel → ignored
    expect(update).toHaveBeenCalledTimes(1);

    finish();
    await new Promise((r) => setImmediate(r));
    sub.emit('message', YTDLP_UPDATE_CHANNEL, '1');
    expect(update).toHaveBeenCalledTimes(2);

    await stop();
    expect(sub.quit).toHaveBeenCalled();
  });
});
