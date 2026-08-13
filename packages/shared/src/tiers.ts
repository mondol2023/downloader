/**
 * Single source of truth for tiered access control.
 *
 * This module is imported by BOTH the Express microservice (which enforces the
 * limits) and the Next.js frontend (which renders them and disables UI that the
 * server would reject anyway). The frontend copy is advisory only — every value
 * here is re-checked server side before a format is unlocked or a job enqueued.
 */

export const TIERS = ['GUEST', 'FREE', 'PRO'] as const;
export type Tier = (typeof TIERS)[number];

export const UNLIMITED = Number.POSITIVE_INFINITY;

export interface TierPolicy {
  readonly id: Tier;
  readonly label: string;
  /** Tallest video the tier may select, in pixels. */
  readonly maxHeight: number;
  /** Highest frame rate the tier may select. */
  readonly maxFps: number;
  /** Largest single artifact, in bytes. */
  readonly maxFileSizeBytes: number;
  /** Completed downloads permitted inside a rolling 24h window. */
  readonly dailyDownloads: number;
  /** Jobs the tier may have running at once. */
  readonly maxConcurrentJobs: number;
  /** BullMQ priority — lower number is served first. */
  readonly queuePriority: number;
  /** Audio containers the tier may request. */
  readonly audioFormats: readonly AudioFormat[];
  /** May request server-side remux/transcode rather than a progressive stream. */
  readonly allowTranscode: boolean;
  /** May play media in-app without downloading it. */
  readonly allowStreaming: boolean;
  /** Playlist items accepted per submission. */
  readonly maxPlaylistItems: number;
  /** Extraction API calls per rolling hour. */
  readonly hourlyExtractions: number;
}

export const AUDIO_FORMATS = ['mp3', 'aac', 'opus', 'flac', 'wav'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

const MB = 1024 * 1024;

export const TIER_POLICIES: Readonly<Record<Tier, TierPolicy>> = {
  GUEST: {
    id: 'GUEST',
    label: 'Guest',
    maxHeight: 720,
    maxFps: 30,
    maxFileSizeBytes: 50 * MB,
    dailyDownloads: 3,
    maxConcurrentJobs: 1,
    queuePriority: 10,
    audioFormats: ['mp3', 'aac'],
    allowTranscode: false,
    allowStreaming: true,
    maxPlaylistItems: 1,
    hourlyExtractions: 20,
  },
  FREE: {
    id: 'FREE',
    label: 'Free',
    maxHeight: 1080,
    maxFps: 60,
    maxFileSizeBytes: 250 * MB,
    dailyDownloads: 10,
    maxConcurrentJobs: 2,
    queuePriority: 5,
    audioFormats: ['mp3', 'aac', 'opus'],
    allowTranscode: true,
    allowStreaming: true,
    maxPlaylistItems: 10,
    hourlyExtractions: 120,
  },
  PRO: {
    id: 'PRO',
    label: 'Pro',
    maxHeight: UNLIMITED,
    maxFps: UNLIMITED,
    maxFileSizeBytes: UNLIMITED,
    dailyDownloads: UNLIMITED,
    maxConcurrentJobs: UNLIMITED,
    queuePriority: 1,
    audioFormats: [...AUDIO_FORMATS],
    allowTranscode: true,
    allowStreaming: true,
    maxPlaylistItems: 200,
    hourlyExtractions: 2000,
  },
} as const;

export function policyFor(tier: Tier): TierPolicy {
  return TIER_POLICIES[tier];
}

export function isUnlimited(value: number): boolean {
  return !Number.isFinite(value);
}

/** Human-readable cap, e.g. `1080p` / `Unlimited`. */
export function formatHeightCap(policy: TierPolicy): string {
  return isUnlimited(policy.maxHeight) ? 'Unlimited (8K)' : `${policy.maxHeight}p`;
}

export function formatBytes(bytes: number, precision = 1): string {
  if (!Number.isFinite(bytes)) return 'Unlimited';
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : precision)} ${units[exponent]}`;
}

export function formatCount(value: number): string {
  return isUnlimited(value) ? 'Unlimited' : String(value);
}

/**
 * Why a format is locked for a tier. `null` means the tier may use it.
 * Kept as a discriminated reason so the UI can render an accurate upsell
 * instead of a generic "upgrade" toast.
 */
export type LockReason = 'RESOLUTION' | 'FPS' | 'FILE_SIZE' | 'AUDIO_FORMAT' | 'TRANSCODE';

export interface FormatConstraintInput {
  height?: number | null;
  fps?: number | null;
  sizeBytes?: number | null;
  audioFormat?: AudioFormat | null;
  requiresTranscode?: boolean;
}

export function evaluateFormatAccess(
  tier: Tier,
  input: FormatConstraintInput,
): { allowed: boolean; reason: LockReason | null } {
  const policy = policyFor(tier);

  if (input.height != null && input.height > policy.maxHeight) {
    return { allowed: false, reason: 'RESOLUTION' };
  }
  if (input.fps != null && input.fps > policy.maxFps) {
    return { allowed: false, reason: 'FPS' };
  }
  if (input.sizeBytes != null && input.sizeBytes > policy.maxFileSizeBytes) {
    return { allowed: false, reason: 'FILE_SIZE' };
  }
  if (input.audioFormat && !policy.audioFormats.includes(input.audioFormat)) {
    return { allowed: false, reason: 'AUDIO_FORMAT' };
  }
  if (input.requiresTranscode && !policy.allowTranscode) {
    return { allowed: false, reason: 'TRANSCODE' };
  }
  return { allowed: true, reason: null };
}

export const LOCK_MESSAGES: Record<LockReason, string> = {
  RESOLUTION: 'This resolution is above your plan limit.',
  FPS: 'High frame rate output requires a higher plan.',
  FILE_SIZE: 'This file exceeds your plan size limit.',
  AUDIO_FORMAT: 'This audio format requires a higher plan.',
  TRANSCODE: 'Server-side conversion requires a registered account.',
};

/** The tier a locked item would need. Drives the "Upgrade to X" call to action. */
export function minimumTierFor(input: FormatConstraintInput): Tier {
  for (const tier of TIERS) {
    if (evaluateFormatAccess(tier, input).allowed) return tier;
  }
  return 'PRO';
}
