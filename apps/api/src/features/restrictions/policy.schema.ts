import { z } from 'zod';
import { TIERS, type BuiltinToggleId, type Rule, type Tier, type TierPolicy } from '@media/shared';
import type { HARD_FLOOR } from './restrictions.config.js';
import { PLATFORM_IDS, disabledBuiltinsSchema, hostname, rulesSchema } from './rules.schema.js';

export { PLATFORM_IDS };

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type TierSoftKey =
  | 'maxHeight' | 'maxFps' | 'maxFileSizeBytes' | 'dailyDownloads' | 'maxConcurrentJobs'
  | 'audioFormats' | 'allowTranscode' | 'allowStreaming' | 'maxPlaylistItems' | 'hourlyExtractions';

export interface PlatformPolicy {
  enabled: boolean;
  download: boolean;
  playback: boolean;
  maxHeight: number | null;
  note: string;
}

/** The admin-tunable part of the policy. Everything here may be overridden at runtime. */
export interface SoftPolicy {
  global: {
    maintenanceMode: boolean;
    maintenanceMessage: string;
    extractionEnabled: boolean;
    downloadsEnabled: boolean;
    maxDurationSec: number;
    allowLiveVod: boolean;
    /** ≤ 17: the hard floor always refuses age_limit >= 18. */
    ageLimitMax: number;
    extraBlockedHosts: string[];
  };
  tiers: Record<Tier, Pick<TierPolicy, TierSoftKey>>;
  platforms: Record<PlatformId, PlatformPolicy>;
  /** Admin-managed deny rules; replaced wholesale on publish. */
  rules: Rule[];
  /** Built-in limits switched off (their configured values are kept). */
  disabledBuiltins: BuiltinToggleId[];
}

export interface EffectivePolicy extends SoftPolicy {
  hardFloor: typeof HARD_FLOOR;
  version: number;
}

export interface PublicPolicy {
  version: number;
  tiers: SoftPolicy['tiers'];
  platforms: Record<PlatformId, Pick<PlatformPolicy, 'enabled' | 'download'>>;
}

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

// Limits may be Infinity (PRO is unlimited) but never negative or NaN.
const positive = z.number().positive();
const nonNegative = z.number().nonnegative();
const AUDIO = z.enum(['mp3', 'aac', 'opus', 'flac', 'wav']);

const globalSchema = z
  .object({
    maintenanceMode: z.boolean(),
    maintenanceMessage: z.string().max(500),
    extractionEnabled: z.boolean(),
    downloadsEnabled: z.boolean(),
    maxDurationSec: positive,
    allowLiveVod: z.boolean(),
    ageLimitMax: z.number().int().min(0).max(17),
    extraBlockedHosts: z.array(hostname).max(500),
  })
  .partial()
  .strict();

const tierSchema = z
  .object({
    maxHeight: positive,
    maxFps: positive,
    maxFileSizeBytes: positive,
    dailyDownloads: nonNegative,
    maxConcurrentJobs: positive,
    audioFormats: z.array(AUDIO).max(AUDIO.options.length),
    allowTranscode: z.boolean(),
    allowStreaming: z.boolean(),
    maxPlaylistItems: nonNegative,
    hourlyExtractions: nonNegative,
  })
  .partial()
  .strict();

const platformSchema = z
  .object({
    enabled: z.boolean(),
    download: z.boolean(),
    playback: z.boolean(),
    maxHeight: positive.nullable(),
    note: z.string().max(500),
  })
  .partial()
  .strict();

const tiersSchema = z
  .object(Object.fromEntries(TIERS.map((t) => [t, tierSchema.optional()])) as Record<Tier, z.ZodOptional<typeof tierSchema>>)
  .strict();

const platformsSchema = z
  .object(
    Object.fromEntries(PLATFORM_IDS.map((p) => [p, platformSchema.optional()])) as Record<
      PlatformId,
      z.ZodOptional<typeof platformSchema>
    >,
  )
  .strict();

export const PolicyOverridesSchema = z
  .object({
    global: globalSchema.optional(),
    tiers: tiersSchema.optional(),
    platforms: platformsSchema.optional(),
    rules: rulesSchema.optional(),
    disabledBuiltins: disabledBuiltinsSchema.optional(),
  })
  .strict() as unknown as z.ZodType<DeepPartial<SoftPolicy>>;
