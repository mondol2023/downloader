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
  TRUSTED_PROXY_CIDRS: ['10.0.0.0/8', '2001:db8::/32', '203.0.113.7'],
};

const req = (country?: string, peer = '10.1.2.3') => ({
  headers: country === undefined ? {} : { 'cf-ipcountry': country },
  ip: '203.0.113.9',
  socket: { remoteAddress: peer },
});

describe('resolveUserRegion', () => {
  it('ignores the country header when TRUST_PROXY is false', () => {
    expect(resolveUserRegion(req('BD'), { ...cfg, TRUST_PROXY: false })).toBeNull();
  });

  it('honours the header from a trusted peer (CIDR, IPv6 CIDR, exact IP, IPv4-mapped)', () => {
    expect(resolveUserRegion(req('BD', '10.9.9.9'), cfg)).toBe('bd');
    expect(resolveUserRegion(req('BD', '2001:db8::5'), cfg)).toBe('bd');
    expect(resolveUserRegion(req('BD', '203.0.113.7'), cfg)).toBe('bd');
    expect(resolveUserRegion(req('BD', '::ffff:10.1.2.3'), cfg)).toBe('bd');
  });

  it('ignores a spoofed header from an untrusted peer even with TRUST_PROXY=true', () => {
    expect(resolveUserRegion(req('BD', '198.51.100.20'), cfg)).toBeNull();
    expect(resolveUserRegion(req('BD', '::ffff:198.51.100.20'), cfg)).toBeNull();
    expect(resolveUserRegion({ headers: { 'cf-ipcountry': 'BD' }, ip: '1.1.1.1' }, cfg)).toBeNull();
  });

  it('fails closed when TRUSTED_PROXY_CIDRS is empty', () => {
    expect(resolveUserRegion(req('BD'), { ...cfg, TRUSTED_PROXY_CIDRS: [] })).toBeNull();
  });

  it('maps BD -> bd', () => {
    expect(resolveUserRegion(req('BD'), cfg)).toBe('bd');
  });

  it('is case-insensitive on the country code and header name', () => {
    expect(resolveUserRegion(req('de'), cfg)).toBe('eu');
    expect(
      resolveUserRegion(
        { headers: { 'CF-IPCountry': 'IN' } as never, ip: '1.1.1.1', socket: { remoteAddress: '10.0.0.1' } },
        cfg,
      ),
    ).toBe('in');
  });

  it('unknown country -> null', () => {
    expect(resolveUserRegion(req('ZZ'), cfg)).toBeNull();
    expect(resolveUserRegion(req('XX'), cfg)).toBeNull();
  });

  it('missing or malformed header -> null', () => {
    expect(resolveUserRegion(req(), cfg)).toBeNull();
    expect(resolveUserRegion(req(''), cfg)).toBeNull();
    expect(
      resolveUserRegion(
        { headers: { 'cf-ipcountry': ['BD', 'IN'] }, ip: '1.1.1.1', socket: { remoteAddress: '10.0.0.1' } },
        cfg,
      ),
    ).toBeNull();
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
