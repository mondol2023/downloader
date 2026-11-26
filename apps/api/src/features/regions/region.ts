import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

/**
 * Region resolution. We only ever route a job to the user's OWN region: the goal is to fetch
 * content from where the user could legitimately watch it, never to reach into a region they
 * are not in. The country comes from the CDN/edge header and is trusted only behind a proxy.
 */

export type RegionCode = string;

export interface RegionConfig {
  /** This deployment's region. */
  REGION: RegionCode;
  /** Regions that have workers deployed. */
  WORKER_REGIONS: readonly RegionCode[];
  /** Header carrying the ISO country code, set by the edge (e.g. cf-ipcountry). */
  COUNTRY_HEADER: string;
  /** ISO country code (upper-case) -> region code. */
  COUNTRY_TO_REGION: Readonly<Record<string, RegionCode>>;
  /** Only when true is the country header believed. */
  TRUST_PROXY: boolean;
  /** IPv4/IPv6 CIDRs or exact IPs of the proxies/CDN edges allowed to set the header. Empty = trust none. */
  TRUSTED_PROXY_CIDRS: readonly string[];
}

/** True when `peer` (socket address, IPv4-mapped IPv6 tolerated) is in the allow-list. */
export function isTrustedPeer(peer: string | undefined, allow: readonly string[]): boolean {
  if (!peer || allow.length === 0) return false;
  const addr = peer.replace(/^::ffff:/i, '');
  const family = isIP(addr);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of allow) {
    try {
      const [ip, bits] = entry.split('/');
      const type = isIP(ip!) === 6 ? 'ipv6' : 'ipv4';
      if (!isIP(ip!)) continue;
      if (bits === undefined) list.addAddress(ip!, type);
      else list.addSubnet(ip!, Number(bits), type);
    } catch {
      /* malformed entry: ignore, fail closed */
    }
  }
  return list.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}

export function resolveUserRegion(
  req: Pick<Request, 'headers' | 'ip'> & { socket?: { remoteAddress?: string | undefined } },
  cfg: RegionConfig,
): RegionCode | null {
  if (!cfg.TRUST_PROXY) return null;
  // The header is only as good as the hop that set it: believe it solely from a known proxy.
  if (!isTrustedPeer(req.socket?.remoteAddress, cfg.TRUSTED_PROXY_CIDRS)) return null;

  const wanted = cfg.COUNTRY_HEADER.toLowerCase();
  let raw: string | string[] | undefined;
  for (const [name, value] of Object.entries(req.headers)) {
    if (name.toLowerCase() === wanted) {
      raw = value;
      break;
    }
  }
  if (typeof raw !== 'string') return null;

  const country = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return null;

  const map = Object.fromEntries(
    Object.entries(cfg.COUNTRY_TO_REGION).map(([k, v]) => [k.toUpperCase(), v]),
  );
  return Object.prototype.hasOwnProperty.call(map, country) ? map[country]! : null;
}

/** Queue name for the user's own region, or null when extraction should stay local. */
export function pickRegionalQueue(
  userRegion: RegionCode | null,
  cfg: Pick<RegionConfig, 'REGION' | 'WORKER_REGIONS'>,
): string | null {
  if (!userRegion) return null;
  if (userRegion === cfg.REGION) return null;
  if (!cfg.WORKER_REGIONS.includes(userRegion)) return null;
  return `extract:${userRegion}`;
}

/** The REGION of the main deployment. Only a regional VM sets REGION to something else. */
export const DEFAULT_REGION = 'default';

/** True for a real regional deployment/job region; false for the main one (or none). */
export function isRegionalRegion(region: string | null | undefined): region is string {
  return !!region && region !== DEFAULT_REGION;
}

/** Per-region variant of a BullMQ queue name (BullMQ forbids ':'), or the base name for main. */
export function regionalQueueName(base: string, region: string | null | undefined): string {
  return isRegionalRegion(region) ? `${base}-${region}` : base;
}
