import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isPrivateHostname } from '@media/shared';

const lookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookup(...args) }));

import { assertHostResolvesPublic } from '../../src/lib/dns-guard.js';

describe('isPrivateHostname', () => {
  it.each([
    'localhost',
    'metadata.internal',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '198.18.0.1', // benchmarking range
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::1',
    '::',
    '[::1]',
    'fe80::1',
    'febf::1', // fe80::/10 runs to febf
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1', // the same address as URL.hostname serialises it
    '[::ffff:a9fe:a9fe]', // mapped 169.254.169.254
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1', // NAT64 wrapping 127.0.0.1
  ])('treats %s as private', (host) => {
    expect(isPrivateHostname(host)).toBe(true);
  });

  it.each(['example.com', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', 'fcbarcelona.com', '172.32.0.1'])(
    'treats %s as public',
    (host) => {
      expect(isPrivateHostname(host)).toBe(false);
    },
  );
});

describe('assertHostResolvesPublic (DNS-rebinding guard)', () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  it('passes when every resolved address is public', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertHostResolvesPublic('example.com')).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });

  it('refuses a public-looking name that resolves to an internal address', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(assertHostResolvesPublic('rebind.example')).rejects.toMatchObject({ status: 400 });
  });

  it('refuses when ANY of several records is private', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '::ffff:169.254.169.254', family: 6 },
    ]);
    await expect(assertHostResolvesPublic('mixed.example')).rejects.toThrow(/not reachable/i);
  });

  it('fails closed when the name does not resolve', async () => {
    lookup.mockImplementation(async () => {
      throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
    });
    await expect(assertHostResolvesPublic('nx.example')).rejects.toMatchObject({ status: 400 });
  });

  it('skips lookup for IP literals (already vetted by isPrivateHostname)', async () => {
    await expect(assertHostResolvesPublic('8.8.8.8')).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});
