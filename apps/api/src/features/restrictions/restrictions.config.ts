/**
 * The restriction file: the one place site and download restrictions are decided.
 *
 * Edit this file to change defaults. Runtime changes go through Admin → Restrictions.
 *
 * HARD_FLOOR is code-only and can never be loosened at runtime (the override
 * schema has no key for it). DEFAULT_POLICY is what runs when no admin override
 * exists, and what the store falls back to when the database is down.
 */
import { TIER_POLICIES, TIERS, type IneligibleCode, type Tier } from '@media/shared';
import { PLATFORM_IDS, type PlatformId, type PlatformPolicy, type SoftPolicy, type TierSoftKey } from './policy.schema.js';

/** The refusal codes the floor always applies (the codes themselves live in @media/shared). */
export type HardRefuseCode = Extract<
  IneligibleCode,
  'SOURCE_PRIVATE' | 'SOURCE_MEMBERS_ONLY' | 'SOURCE_NEEDS_LOGIN' | 'SOURCE_DRM'
>;

export const HARD_FLOOR: Readonly<{
  refuse: readonly HardRefuseCode[];
  blockedHosts: readonly string[];
  maxAgeLimit: 17;
}> = Object.freeze({
  refuse: Object.freeze<HardRefuseCode[]>(['SOURCE_PRIVATE', 'SOURCE_MEMBERS_ONLY', 'SOURCE_NEEDS_LOGIN', 'SOURCE_DRM']),
  // DRM-only platforms: nothing on them can be downloaded without circumventing DRM.
  blockedHosts: Object.freeze([
    'netflix.com',
    'disneyplus.com',
    'primevideo.com',
    'hulu.com',
    'max.com',
    'hbomax.com',
    'tv.apple.com',
    'music.apple.com',
    'spotify.com',
    'crunchyroll.com',
    'tidal.com',
    'deezer.com',
  ]),
  // Media rated 18+ is not refused here: it goes through the birthdate gate (age-gate.ts) unless
  // an admin turns `global.adultGateEnabled` off, which restores the outright refusal.
  maxAgeLimit: 17,
});

const TIER_SOFT_KEYS: readonly TierSoftKey[] = [
  'maxHeight', 'maxFps', 'maxFileSizeBytes', 'dailyDownloads', 'maxConcurrentJobs',
  'audioFormats', 'allowTranscode', 'allowStreaming', 'maxPlaylistItems', 'hourlyExtractions',
];

function defaultTiers(): SoftPolicy['tiers'] {
  const out = {} as SoftPolicy['tiers'];
  for (const tier of TIERS as readonly Tier[]) {
    const src = TIER_POLICIES[tier];
    const picked: Record<string, unknown> = {};
    for (const key of TIER_SOFT_KEYS) {
      const value = src[key];
      picked[key] = Array.isArray(value) ? [...value] : value;
    }
    out[tier] = picked as SoftPolicy['tiers'][Tier];
  }
  return out;
}

function defaultPlatforms(): SoftPolicy['platforms'] {
  const out = {} as Record<PlatformId, PlatformPolicy>;
  for (const id of PLATFORM_IDS) {
    out[id] = { enabled: true, download: true, playback: true, maxHeight: null, note: '' };
  }
  return out;
}

export const DEFAULT_POLICY: SoftPolicy = {
  global: {
    maintenanceMode: false,
    maintenanceMessage: '',
    extractionEnabled: true,
    downloadsEnabled: true,
    maxDurationSec: 4 * 60 * 60,
    allowLiveVod: true,
    ageLimitMax: HARD_FLOOR.maxAgeLimit,
    adultGateEnabled: true,
    extraBlockedHosts: [],
  },
  tiers: defaultTiers(),
  platforms: defaultPlatforms(),
  rules: [],
  disabledBuiltins: [],
};
