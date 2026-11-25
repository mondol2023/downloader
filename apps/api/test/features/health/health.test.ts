import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  createHealthRouter,
  ensureEngineAvailable,
  getToolVersions,
  loadToolVersions,
  parseToolVersion,
  setToolVersions,
  type ToolVersions,
} from '../../../src/features/health/index.js';

const allTools: ToolVersions = { ytDlp: '2026.11.01', ffmpeg: '7.1', ffprobe: '7.1' };

async function getHealth(deps: Parameters<typeof createHealthRouter>[0]) {
  const app = express();
  app.use(createHealthRouter(deps));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe('GET /healthz', () => {
  it('reports ok when everything is up', async () => {
    const { status, body } = await getHealth({
      dbUp: () => true,
      redisPing: async () => undefined,
      tools: () => allTools,
      region: 'eu',
    });
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok', db: 'up', redis: 'up', tools: allTools, region: 'eu' });
  });

  it('reports degraded when db down', async () => {
    const { status, body } = await getHealth({
      dbUp: () => false,
      redisPing: async () => undefined,
      tools: () => allTools,
      region: 'default',
    });
    expect(status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('down');
    expect(body.redis).toBe('up');
  });

  it('reports down when db and redis are both down', async () => {
    const { status, body } = await getHealth({
      dbUp: () => false,
      redisPing: async () => {
        throw new Error('ECONNREFUSED');
      },
      tools: () => allTools,
      region: 'default',
    });
    expect(status).toBe(503);
    expect(body.status).toBe('down');
  });

  it('reports tool missing as null version', async () => {
    const { body } = await getHealth({
      dbUp: () => true,
      redisPing: async () => undefined,
      tools: () => ({ ...allTools, ffmpeg: null }),
      region: 'default',
    });
    expect(body.status).toBe('degraded');
    expect((body.tools as ToolVersions).ffmpeg).toBeNull();
  });

  it('does not hang when redis ping never resolves', async () => {
    const { body } = await getHealth({
      dbUp: () => true,
      redisPing: () => new Promise(() => undefined),
      tools: () => allTools,
      region: 'default',
      pingTimeoutMs: 50,
    });
    expect(body.redis).toBe('down');
  });
});

describe('loadToolVersions', () => {
  it('reports tool missing as null version and warns once per tool', async () => {
    const warn = vi.fn();
    const run = vi.fn(async (cmd: string) => {
      if (cmd === 'ffmpeg') throw new Error('spawn ffmpeg ENOENT');
      if (cmd === 'yt-dlp') return '2026.11.01\n';
      return 'ffprobe version 7.1-full_build Copyright (c) 2007-2024\n';
    });
    const versions = await loadToolVersions(
      { ytDlp: 'yt-dlp', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
      { run, warn },
    );
    expect(versions).toEqual({ ytDlp: '2026.11.01', ffmpeg: null, ffprobe: '7.1-full_build' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('yt-dlp', ['--version'], 5_000);
    expect(run).toHaveBeenCalledWith('ffmpeg', ['-version'], 5_000);
  });
});

describe('parseToolVersion', () => {
  it('reads yt-dlp and ffmpeg style output', () => {
    expect(parseToolVersion('2026.11.01\n')).toBe('2026.11.01');
    expect(parseToolVersion('ffmpeg version 7.1 Copyright (c) 2000-2024')).toBe('7.1');
    expect(parseToolVersion('   \n')).toBeNull();
  });
});

describe('ensureEngineAvailable (sticky null probe)', () => {
  const paths = { ytDlp: 'yt-dlp', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

  it('re-probes a required tool that probed null at boot, then lets the job through', async () => {
    setToolVersions({ ytDlp: null, ffmpeg: '7.1', ffprobe: '7.1' });
    const run = vi.fn(async () => '2026.11.01');
    await expect(ensureEngineAvailable(paths, { run, now: () => 1_000_000 })).resolves.toBeUndefined();
    expect(getToolVersions().ytDlp).toBe('2026.11.01');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still refuses with ENGINE_UNAVAILABLE when the tool is really missing, and throttles to 1 probe / 30 s / tool', async () => {
    setToolVersions({ ytDlp: '2026.11.01', ffmpeg: null, ffprobe: '7.1' });
    const run = vi.fn(async () => {
      throw new Error('spawn ffmpeg ENOENT');
    });
    let t = 5_000_000;
    const deps = { run, now: () => t };

    await expect(ensureEngineAvailable(paths, deps)).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
    t += 10_000;
    await expect(ensureEngineAvailable(paths, deps)).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
    expect(run).toHaveBeenCalledTimes(1);

    t += 25_000; // 35 s after the first probe
    await expect(ensureEngineAvailable(paths, deps)).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not probe at all when every required tool is known', async () => {
    setToolVersions({ ytDlp: '1', ffmpeg: '1', ffprobe: null });
    const run = vi.fn();
    await ensureEngineAvailable(paths, { run, now: () => 9_000_000 });
    expect(run).not.toHaveBeenCalled();
  });
});
