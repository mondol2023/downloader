import type { BuiltinToggleId, Rule } from "@media/shared";

export const PLATFORM_IDS = [
  "youtube", "facebook", "instagram", "x", "tiktok", "reddit", "vimeo", "twitch",
  "dailymotion", "soundcloud", "bilibili", "pinterest", "linkedin", "tumblr",
] as const;
export const TIERS = ["GUEST", "FREE", "PRO"] as const;
export type Tier = (typeof TIERS)[number];

/** Mirrors the API's SoftPolicy. `Infinity` limits arrive as `null` (JSON). */
export interface SoftPolicy {
  global: {
    maintenanceMode: boolean;
    maintenanceMessage: string;
    extractionEnabled: boolean;
    downloadsEnabled: boolean;
    maxDurationSec: number;
    allowLiveVod: boolean;
    ageLimitMax: number;
    extraBlockedHosts: string[];
  };
  rules: Rule[];
  disabledBuiltins: BuiltinToggleId[];
  tiers: Record<string, Record<string, number | boolean | string[] | null>>;
  platforms: Record<string, { enabled: boolean; download: boolean; playback: boolean; maxHeight: number | null; note: string }>;
}
export type EffectivePolicy = SoftPolicy & { version: number };

export interface PolicyVersionRow {
  version: number;
  note: string;
  createdBy: string | null;
  createdAt: string;
  active: boolean;
}
export interface PolicyAdminResponse {
  active: EffectivePolicy;
  defaults: EffectivePolicy;
  hardFloor: { refuse: string[]; blockedHosts: string[]; maxAgeLimit: number };
  versions: PolicyVersionRow[];
}

export interface Verdict {
  allowed: boolean;
  refusal: { code: string; message: string } | null;
  formats: { total: number; allowed: number; locked: number } | null;
  rule: { id: string; name: string } | null;
  blockedActions: Array<"download" | "playback">;
}
export interface PreviewResponse {
  mediaId: string;
  cached: boolean;
  active: Verdict;
  draft: Verdict;
}
