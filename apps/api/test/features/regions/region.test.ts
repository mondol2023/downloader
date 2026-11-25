import { describe, expect, it } from 'vitest';
import {
  pickRegionalQueue,
  resolveUserRegion,
  type RegionConfig,
} from '../../../src/features/regions/region.js';

const cfg: RegionConfig = {
  REGION: 'us',
  WORKER_REGIONS: ['us', 'eu', 'in', 'bd'],
  COUNTRY_HEADER: 'cf-ipcountry',
  COUNTRY_TO_REGION: { BD: 'bd', IN: 'in', DE: 'eu', US: 'us' },
  TRUST_PROXY: true,
};

const req = (country?: string) => ({
  headers: country === undefined ? {} : { 'cf-ipcountry': country },
  ip: '203.0.113.9',
});

describe('resolveUserRegion', () => {
  it('ignores the country header when TRUST_PROXY is false', () => {
    expect(resolveUserRegion(req('BD'), { ...cfg, TRUST_PROXY: false })).toBeNull();
  });

  it('maps BD -> bd', () => {
    expect(resolveUserRegion(req('BD'), cfg)).toBe('bd');
  });

  it('is case-insensitive on the country code and header name', () => {
    expect(resolveUserRegion(req('de'), cfg)).toBe('eu');
    expect(
      resolveUserRegion({ headers: { 'CF-IPCountry': 'IN' } as never, ip: '1.1.1.1' }, cfg),
    ).toBe('in');
  });

  it('unknown country -> null', () => {
    expect(resolveUserRegion(req('ZZ'), cfg)).toBeNull();
    expect(resolveUserRegion(req('XX'), cfg)).toBeNull();
  });

  it('missing or malformed header -> null', () => {
    expect(resolveUserRegion(req(), cfg)).toBeNull();
    expect(resolveUserRegion(req(''), cfg)).toBeNull();
    expect(resolveUserRegion({ headers: { 'cf-ipcountry': ['BD', 'IN'] }, ip: '1.1.1.1' }, cfg)).toBeNull();
  });
});

describe('pickRegionalQueue', () => {
  it('returns extract:<region> for a served, different region', () => {
    expect(pickRegionalQueue('bd', cfg)).toBe('extract:bd');
  });

  it('same region as server -> null so extraction runs locally', () => {
    expect(pickRegionalQueue('us', cfg)).toBeNull();
  });

  it('null or unserved region -> null', () => {
    expect(pickRegionalQueue(null, cfg)).toBeNull();
    expect(pickRegionalQueue('jp', cfg)).toBeNull();
  });

  it("never returns a region different from the user's (every pair)", () => {
    const all = ['us', 'eu', 'in', 'bd', 'jp', 'br'];
    for (const server of all) {
      for (const user of [...all, null]) {
        const c = { ...cfg, REGION: server };
        const q = pickRegionalQueue(user, c);
        if (q !== null) {
          expect(q).toBe(`extract:${user}`);
          expect(user).not.toBe(server);
          expect(c.WORKER_REGIONS).toContain(user);
        }
      }
    }
  });
});
