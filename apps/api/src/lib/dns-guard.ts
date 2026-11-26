import { lookup } from 'node:dns/promises';
import { isPrivateHostname } from '@media/shared';
import { AppError } from './errors.js';

/**
 * DNS-rebinding guard. `isPrivateHostname` only sees the literal host; a public-looking name can
 * resolve to 127.0.0.1 or 169.254.169.254. Resolve first and refuse if ANY record is internal, and
 * fail closed when the name does not resolve (yt-dlp could not fetch it either).
 *
 * Residual risk: yt-dlp resolves again itself, and follows redirects, so a rebinding attacker can
 * still win the race. The container-level backstop is network egress policy that blocks RFC1918 and
 * link-local ranges from the worker; see docs/superpowers/plans (Phase 10.3).
 */
export async function assertHostResolvesPublic(host: string): Promise<void> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) return; // literals were vetted by isPrivateHostname

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(bare, { all: true, verbatim: true });
  } catch {
    throw AppError.badRequest('That host could not be resolved');
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateHostname(a.address))) {
    throw AppError.badRequest('That host is not reachable from this service');
  }
}
