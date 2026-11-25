import { describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_SWEEP_EVERY_MS,
  YTDLP_UPDATE_CRON,
  scheduleMaintenance,
} from '../../../src/features/maintenance/index.js';

function fakeQueue() {
  return { upsertJobScheduler: vi.fn(async () => ({})), removeJobScheduler: vi.fn(async () => true) };
}

describe('scheduleMaintenance', () => {
  it('registers the 15-minute sweep and the daily 04:00 yt-dlp update when auto-update is on', async () => {
    const queue = fakeQueue();
    await scheduleMaintenance(queue, { ytDlpAutoUpdate: true });

    expect(ARTIFACT_SWEEP_EVERY_MS).toBe(15 * 60 * 1000);
    expect(YTDLP_UPDATE_CRON).toBe('0 4 * * *');
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'artifact-sweep',
      { every: ARTIFACT_SWEEP_EVERY_MS },
      expect.objectContaining({ name: 'artifact-sweep' }),
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'ytdlp-update',
      { pattern: '0 4 * * *' },
      expect.objectContaining({ name: 'ytdlp-update' }),
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('removes a previously registered yt-dlp update when auto-update is turned off', async () => {
    const queue = fakeQueue();
    await scheduleMaintenance(queue, { ytDlpAutoUpdate: false });

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('ytdlp-update');
  });
});
