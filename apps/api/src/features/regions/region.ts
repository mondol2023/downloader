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
}

export function resolveUserRegion(
  req: Pick<Request, 'headers' | 'ip'>,
  cfg: RegionConfig,
): RegionCode | null {
  if (!cfg.TRUST_PROXY) return null;

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
