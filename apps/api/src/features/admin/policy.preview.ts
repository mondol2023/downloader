import { INELIGIBLE_COPY, type IneligibleCode, type Tier } from '@media/shared';
import { isBlockedHost } from '../eligibility/blocked-hosts.js';
import { evaluateEligibility } from '../eligibility/eligibility.js';
import { maxDurationOf } from '../restrictions/builtins.js';
import { evaluateAccessIn } from '../restrictions/enforce.js';
import { evaluateRules, type RuleHit } from '../restrictions/rules.js';
import type { EffectivePolicy, PlatformId } from '../restrictions/policy.schema.js';
import { PLATFORM_IDS } from '../restrictions/policy.schema.js';

export interface PreviewMedia {
  platform: string;
  durationSeconds: number | null;
  availability: string | null;
  isLive: boolean;
  ageLimit: number;
  title: string;
  uploader: string | null;
  formats: Array<{ height: number | null; fps: number | null; sizeBytes: number | null }>;
}

export interface PreviewSource {
  host: string;
  platform: string;
  /** The user's canonical URL (what URL-pattern rules match against). */
  url: string;
  takenDown: boolean;
}

export interface Verdict {
  allowed: boolean;
  /** The first refusal, as the user would see it. */
  refusal: { code: string; message: string } | null;
  /** Null when the URL has not been extracted recently, so the per-format limits can't be judged. */
  formats: { total: number; allowed: number; locked: number } | null;
  /** The custom rule that caused the refusal. Admin-only: never sent to end users. */
  rule: { id: string; name: string } | null;
  /** Actions (not lookup) that a rule would refuse for this link. */
  blockedActions: Array<'download' | 'playback'>;
}

function refusal(code: IneligibleCode | string, message?: string, rule: RuleHit['rule'] | null = null): Verdict {
  return {
    allowed: false,
    refusal: { code, message: message ?? INELIGIBLE_COPY[code as IneligibleCode]?.body ?? code },
    formats: null,
    rule: rule ? { id: rule.id, name: rule.name } : null,
    blockedActions: [],
  };
}

const ruleRefusal = (hit: RuleHit): Verdict => refusal('SOURCE_RULE_BLOCKED', hit.message, hit.rule);

/**
 * What `policy` would do with this URL for `tier`: the same checks extraction runs (extraction
 * switch, blocked host, platform switch, takedown, eligibility, duration cap, per-format limits),
 * against cached metadata only. Pure, so it can be run on the active and the draft policy alike.
 */
export function verdictFor(
  policy: EffectivePolicy,
  tier: Tier,
  source: PreviewSource,
  media: PreviewMedia | null,
): Verdict {
  if (!policy.global.extractionEnabled) {
    return refusal('EXTRACTION_DISABLED', 'Link lookup is paused right now.');
  }
  if (isBlockedHost(source.host, policy)) return refusal('SOURCE_BLOCKED_DOMAIN');
  if ((PLATFORM_IDS as readonly string[]).includes(source.platform)) {
    if (!policy.platforms[source.platform as PlatformId].enabled) return refusal('SOURCE_PLATFORM_DISABLED');
  }
  const sourceHit = evaluateRules(policy, {
    stage: 'source',
    tier,
    url: source.url,
    host: source.host,
    platform: source.platform,
  });
  if (sourceHit) return ruleRefusal(sourceHit);
  if (source.takenDown) return refusal('SOURCE_TAKEN_DOWN');

  const blockedActions = (['download', 'playback'] as const).filter(
    (action) =>
      evaluateRules(policy, { stage: 'action', tier, action, host: source.host, platform: source.platform }) !== null,
  );
  if (!media) return { allowed: true, refusal: null, formats: null, rule: null, blockedActions };

  const eligibility = evaluateEligibility(
    {
      availability: media.availability,
      liveStatus: media.isLive ? 'is_live' : null,
      ageLimit: media.ageLimit,
      formatDrm: [], // the cached record already had DRM renditions dropped
      host: source.host,
    },
    policy,
  );
  if (!eligibility.eligible) return refusal(eligibility.code);

  const maxDuration = maxDurationOf(policy);
  if (maxDuration !== null && media.durationSeconds != null && media.durationSeconds > maxDuration) {
    return refusal('SOURCE_TOO_LONG', `Longer than the ${Math.floor(maxDuration / 60)}-minute limit.`);
  }

  const mediaHit = evaluateRules(policy, {
    stage: 'metadata',
    tier,
    platform: media.platform,
    durationSeconds: media.durationSeconds,
    ageLimit: media.ageLimit,
    title: media.title,
    uploader: media.uploader,
  });
  if (mediaHit) return ruleRefusal(mediaHit);

  const results = media.formats.map((f) => evaluateAccessIn(policy, tier, f, media.platform).allowed);
  const allowedCount = results.filter(Boolean).length;
  return {
    allowed: true,
    refusal: null,
    formats: { total: results.length, allowed: allowedCount, locked: results.length - allowedCount },
    rule: null,
    blockedActions,
  };
}
