import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/lib/errors.js';
import { extractWithRegionalFallback } from '../../../src/features/regions/regional-extract.js';

const source = { mediaId: 'yt:abc', canonical: 'https://example.com/v/abc', platform: 'example' } as never;
const cfg = { REGION: 'us', WORKER_REGIONS: ['us', 'bd'] };
const record = { media: { id: 'yt:abc' }, formats: [], urls: {}, subtitleSources: {} } as never;
const geo = () => new AppError(451, 'SOURCE_GEOBLOCKED', 'blocked');

describe('extractWithRegionalFallback', () => {
  it('geo-blocked + user region has worker -> returns regional result', async () => {
    const regional = vi.fn().mockResolvedValue(record);
    const out = await extractWithRegionalFallback(source, 'bd', {
      cfg,
      local: async () => { throw geo(); },
      regional,
    });
    expect(out).toBe(record);
    expect(regional).toHaveBeenCalledWith('extract:bd', source);
  });

  it('geo-blocked + no regional worker -> 451 SOURCE_GEOBLOCKED', async () => {
    const regional = vi.fn();
    await expect(
      extractWithRegionalFallback(source, 'jp', { cfg, local: async () => { throw geo(); }, regional }),
    ).rejects.toMatchObject({ status: 451, code: 'SOURCE_GEOBLOCKED' });
    expect(regional).not.toHaveBeenCalled();
  });

  it('regional timeout -> 504 SOURCE_TIMEOUT', async () => {
    await expect(
      extractWithRegionalFallback(source, 'bd', {
        cfg,
        local: async () => { throw geo(); },
        regional: () => new Promise(() => undefined),
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ status: 504, code: 'SOURCE_TIMEOUT' });
  });

  it('non-geo errors never trigger regional retry', async () => {
    const regional = vi.fn();
    await expect(
      extractWithRegionalFallback(source, 'bd', {
        cfg,
        local: async () => { throw new AppError(403, 'SOURCE_PRIVATE', 'x'); },
        regional,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_PRIVATE' });
    expect(regional).not.toHaveBeenCalled();
  });

  it('local success never touches the regional queue', async () => {
    const regional = vi.fn();
    const out = await extractWithRegionalFallback(source, 'bd', { cfg, local: async () => record, regional });
    expect(out).toBe(record);
    expect(regional).not.toHaveBeenCalled();
  });
});
