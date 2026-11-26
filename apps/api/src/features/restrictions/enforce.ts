import {
  TIER_POLICIES,
  TIERS,
  type FormatConstraintInput,
  type LockReason,
  type Tier,
  type TierPolicy,
} from '@media/shared';
import { AppError } from '../../lib/errors.js';
import { refusalError } from '../eligibility/refusal.js';
import { maxDurationOf } from './builtins.js';
import { getPolicy } from './policy.current.js';
import { PLATFORM_IDS, type EffectivePolicy, type PlatformId } from './policy.schema.js';

export type PlatformAction = 'extract' | 'download' | 'playback';

function knownPlatform(platform: string): platform is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(platform);
}

/**
 * Throws 403 SOURCE_PLATFORM_DISABLED when the admin has switched the platform (or the action on
 * it) off. Platforms the policy has no entry for (the long tail of yt-dlp sites) are allowed.
 */
export function assertPlatformAllowed(platform: string, action: PlatformAction): void {
  if (!knownPlatform(platform)) return;
  const cfg = getPolicy().platforms[platform];
  const allowed =
    cfg.enabled && (action === 'extract' || (action === 'download' ? cfg.download : cfg.playback));
  if (!allowed) throw refusalError('SOURCE_PLATFORM_DISABLED');
}

/** 503 EXTRACTION_DISABLED when the admin has paused extraction. Maintenance mode does not stop it. */
export function assertExtractionOpen(): void {
  if (!getPolicy().global.extractionEnabled) {
    throw new AppError(503, 'EXTRACTION_DISABLED', 'Link lookup is paused right now. Please try again shortly.');
  }
}

/** 503 MAINTENANCE or DOWNLOADS_PAUSED. Called before any quota is touched. */
export function assertDownloadsOpen(): void {
  const { global } = getPolicy();
  if (global.maintenanceMode) {
    throw new AppError(
      503,
      'MAINTENANCE',
      global.maintenanceMessage || 'We are down for maintenance. Please try again shortly.',
    );
  }
  if (!global.downloadsEnabled) {
    throw new AppError(503, 'DOWNLOADS_PAUSED', 'Downloads are paused right now. Please try again shortly.');
  }
}

/** 422 SOURCE_TOO_LONG. An unknown duration is let through: yt-dlp does not always report one. */
export function assertDurationAllowed(durationSeconds: number | null | undefined): void {
  if (durationSeconds == null) return;
  const max = maxDurationOf(getPolicy());
  if (max !== null && durationSeconds > max) {
    const minutes = Math.floor(max / 60);
    throw new AppError(
      422,
      'SOURCE_TOO_LONG',
      `This media is longer than the ${minutes}-minute limit, so it can't be downloaded.`,
    );
  }
}

/**
 * The limits a tier gets right now: the admin-tunable fields come from the runtime policy, the
 * static ones (label, queue priority) from @media/shared. With `platform`, the platform's own
 * `maxHeight` is intersected with the tier's, so the stricter of the two wins.
 */
export function tierPolicyFor(tier: Tier, platform?: string): TierPolicy {
  return tierPolicyIn(getPolicy(), tier, platform);
}

/** `tierPolicyFor` against an explicit policy; the admin preview runs it on a draft. */
export function tierPolicyIn(policy: EffectivePolicy, tier: Tier, platform?: string): TierPolicy {
  const base = TIER_POLICIES[tier];
  const soft = policy.tiers[tier];
  let maxHeight = soft.maxHeight;
  if (platform && knownPlatform(platform)) {
    const cap = policy.platforms[platform].maxHeight;
    if (cap != null) maxHeight = Math.min(maxHeight, cap);
  }
  return { ...base, ...soft, maxHeight };
}

/** Same contract as `evaluateFormatAccess` in @media/shared, but against the runtime policy. */
export function evaluateAccess(
  tier: Tier,
  input: FormatConstraintInput,
  platform?: string,
): { allowed: boolean; reason: LockReason | null } {
  return evaluateAccessIn(getPolicy(), tier, input, platform);
}

export function evaluateAccessIn(
  policy: EffectivePolicy,
  tier: Tier,
  input: FormatConstraintInput,
  platform?: string,
): { allowed: boolean; reason: LockReason | null } {
  const p = tierPolicyIn(policy, tier, platform);
  if (input.height != null && input.height > p.maxHeight) return { allowed: false, reason: 'RESOLUTION' };
  if (input.fps != null && input.fps > p.maxFps) return { allowed: false, reason: 'FPS' };
  if (input.sizeBytes != null && input.sizeBytes > p.maxFileSizeBytes) return { allowed: false, reason: 'FILE_SIZE' };
  if (input.audioFormat && !p.audioFormats.includes(input.audioFormat)) {
    return { allowed: false, reason: 'AUDIO_FORMAT' };
  }
  if (input.requiresTranscode && !p.allowTranscode) return { allowed: false, reason: 'TRANSCODE' };
  return { allowed: true, reason: null };
}

/** The lowest tier that may use a rendition under the runtime policy; PRO if none can. */
export function requiredTierFor(input: FormatConstraintInput, platform?: string): Tier {
  for (const tier of TIERS) {
    if (evaluateAccess(tier, input, platform).allowed) return tier;
  }
  return 'PRO';
}
