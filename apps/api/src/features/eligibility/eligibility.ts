import type { IneligibleCode } from '@media/shared';
import { HARD_FLOOR } from '../restrictions/restrictions.config.js';
import type { EffectivePolicy } from '../restrictions/policy.schema.js';
import { isBlockedHost } from './blocked-hosts.js';

export interface EligibilityInput {
  /** yt-dlp `availability`; null on most non-YouTube sites. */
  availability: string | null;
  /** yt-dlp `live_status`. */
  liveStatus: string | null;
  ageLimit: number;
  /** One entry per format, in the order yt-dlp returned them: true if that format is DRM-protected. */
  formatDrm: boolean[];
  host: string;
  /** True when an ACTIVE takedown exists for this media (looked up by the caller; this stays pure). */
  takenDown?: boolean;
}

export type EligibilityVerdict =
  | { eligible: true; dropFormatIndexes: number[] }
  | { eligible: false; code: IneligibleCode };

const refuse = (code: IneligibleCode): EligibilityVerdict => ({ eligible: false, code });

/**
 * Decides whether a source may be shown and downloaded, from the fields yt-dlp reports.
 * Pure. Check order: blocked host → taken down → private → members → needs_auth → age → live → DRM.
 *
 * Without `policy` only the code-only hard floor applies; with it, the admin's extra
 * blocked hosts and a stricter age cap apply too. A policy can tighten, never loosen.
 */
export function evaluateEligibility(
  input: EligibilityInput,
  policy?: Pick<EffectivePolicy, 'global'>,
): EligibilityVerdict {
  if (isBlockedHost(input.host, policy)) return refuse('SOURCE_BLOCKED_DOMAIN');

  if (input.takenDown) return refuse('SOURCE_TAKEN_DOWN');

  switch (input.availability) {
    case 'private':
      return refuse('SOURCE_PRIVATE');
    case 'premium_only':
    case 'subscriber_only':
      return refuse('SOURCE_MEMBERS_ONLY');
    case 'needs_auth':
      return refuse('SOURCE_NEEDS_LOGIN');
    default:
      break; // public, unlisted, null and anything yt-dlp adds later are not refusals.
  }

  const ageCap = Math.min(policy?.global.ageLimitMax ?? HARD_FLOOR.maxAgeLimit, HARD_FLOOR.maxAgeLimit);
  if (input.ageLimit > ageCap) return refuse('SOURCE_AGE_RESTRICTED');

  if (input.liveStatus === 'is_live' || input.liveStatus === 'is_upcoming') return refuse('SOURCE_LIVE');

  const dropFormatIndexes = input.formatDrm.flatMap((drm, i) => (drm ? [i] : []));
  if (input.formatDrm.length > 0 && dropFormatIndexes.length === input.formatDrm.length) {
    return refuse('SOURCE_DRM');
  }
  return { eligible: true, dropFormatIndexes };
}
