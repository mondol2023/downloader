import { HARD_FLOOR } from '../restrictions/restrictions.config.js';
import type { EffectivePolicy } from '../restrictions/policy.schema.js';

function normalise(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * True when `host` equals, or is a subdomain of, a blocked host. The match is on a
 * label boundary, so `notnetflix.com` is not blocked by `netflix.com`.
 * The code-only hard floor always applies; admins can only add to it.
 */
export function isBlockedHost(host: string, policy?: Pick<EffectivePolicy, 'global'>): boolean {
  const h = normalise(host);
  if (!h) return false;
  const blocked = [...HARD_FLOOR.blockedHosts, ...(policy?.global.extraBlockedHosts ?? [])];
  return blocked.some((b) => {
    const base = normalise(b);
    return h === base || h.endsWith(`.${base}`);
  });
}
