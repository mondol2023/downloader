import type { AuthUser, ExtractionResult, JobSummary, MediaMetadata, QuotaSnapshot, SubtitleTrack, Tier } from "@media/shared";

/** `POST /media/extract` adds the caller's effective policy and quota to the gated result. */
export interface ExtractResponse extends ExtractionResult {
  quota?: QuotaSnapshot;
}

export interface PlaybackGrantResponse {
  formatId: string;
  playbackUrl: string;
  protocol: "https" | "hls" | "dash" | "m3u8_native";
  mimeType: string;
  expiresAt: string;
  mediaId: string;
  title: string;
  durationSeconds: number | null;
  poster: string | null;
  subtitles: SubtitleTrack[];
  isLive: boolean;
}

export interface MeResponse {
  user: AuthUser | null;
  tier: Tier;
  quota: QuotaSnapshot;
}

/** Tier limits as the API serialises them: `Infinity` arrives as `null`. */
export interface PlanTier {
  tier: Tier;
  label: string;
  maxHeight: number | null;
  maxFileSizeBytes: number | null;
  dailyDownloads: number | null;
  maxConcurrentJobs: number | null;
  audioFormats: string[];
}
export interface PlanPrice {
  id: "pro-monthly" | "pro-yearly";
  label: string;
  interval: string;
  amount: number | null;
  currency: string;
}
export interface PlansResponse {
  tiers: PlanTier[];
  plans: PlanPrice[];
  billingEnabled: boolean;
}
export interface SubscriptionResponse {
  status: string;
  priceId: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export type { JobSummary, MediaMetadata };
