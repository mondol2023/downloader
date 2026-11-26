import { INELIGIBLE_COPY, TIERS, type Rule, type Tier } from '@media/shared';
import type { EffectivePolicy } from './policy.schema.js';

/**
 * Pure evaluation of admin-managed restriction rules. No I/O and no policy lookup: callers pass
 * the policy and a context for one of three stages. Rules are deny-only and the first enabled
 * matching rule in list order wins.
 */
export type RuleContext =
  | { stage: 'source'; tier: Tier; url: string; host: string; platform: string }
  | {
      stage: 'metadata';
      tier: Tier;
      platform: string;
      durationSeconds: number | null;
      ageLimit: number;
      title: string;
      uploader: string | null;
    }
  | { stage: 'action'; tier: Tier; action: 'download' | 'playback'; host: string; platform: string };

export interface RuleHit {
  rule: Rule;
  message: string;
}

type RulesView = Pick<EffectivePolicy, 'rules'>;

export function defaultRuleMessage(rule: Rule): string {
  switch (rule.type) {
    case 'max_duration':
      return `Longer than the ${Math.floor(rule.params.seconds / 60)}-minute limit.`;
    case 'tier_only':
      return `This is available on the ${rule.params.minTier} plan and above.`;
    default:
      return INELIGIBLE_COPY.SOURCE_RULE_BLOCKED.body;
  }
}

/**
 * Whole-string, case-insensitive wildcard match: `*` is any run of characters, everything else
 * is literal. Iterative two-pointer, O(pattern × subject) worst case. Deliberately not a RegExp:
 * `.*`-per-star patterns backtrack polynomially on non-matching input.
 */
export function globMatch(pattern: string, subject: string): boolean {
  const p = pattern.toLowerCase();
  const s = subject.toLowerCase();
  let pi = 0;
  let si = 0;
  let star = -1;
  let anchor = 0;
  while (si < s.length) {
    if (pi < p.length && p[pi] === '*') {
      star = pi;
      anchor = si;
      pi += 1;
    } else if (pi < p.length && p[pi] === s[si]) {
      pi += 1;
      si += 1;
    } else if (star !== -1) {
      anchor += 1;
      si = anchor;
      pi = star + 1;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === '*') pi += 1;
  return pi === p.length;
}

function normaliseHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/** Label-boundary match: `example.com` matches itself and `*.example.com`, never `notexample.com`. */
function hostMatches(host: string, base: string): boolean {
  const h = normaliseHost(host);
  const b = normaliseHost(base);
  if (!h || !b) return false;
  return h === b || h.endsWith(`.${b}`);
}

const anyHostMatches = (host: string, bases: string[]): boolean => bases.some((b) => hostMatches(host, b));

/** Empty or missing scope applies to everything. */
const inScope = <T>(scope: T[] | undefined, value: T): boolean => !scope || scope.length === 0 || scope.includes(value);

function urlSubject(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

const tierRank = (t: Tier): number => TIERS.indexOf(t);

function matches(rule: Rule, ctx: RuleContext): boolean {
  switch (rule.type) {
    case 'block_host':
      return (ctx.stage === 'source' || ctx.stage === 'action') && anyHostMatches(ctx.host, rule.params.hosts);

    case 'block_platform':
      if (ctx.stage === 'source') {
        return ctx.platform === rule.params.platform && rule.params.actions.includes('extract');
      }
      if (ctx.stage === 'action') {
        return ctx.platform === rule.params.platform && rule.params.actions.includes(ctx.action);
      }
      return false;

    case 'block_url_pattern': {
      if (ctx.stage !== 'source') return false;
      const subject = urlSubject(ctx.url);
      return subject !== null && globMatch(rule.params.pattern, subject);
    }

    case 'block_keyword': {
      if (ctx.stage !== 'metadata') return false;
      const needle = rule.params.text.toLowerCase();
      if (!needle) return false;
      const { fields } = rule.params;
      if (fields.includes('title') && ctx.title.toLowerCase().includes(needle)) return true;
      return fields.includes('channel') && ctx.uploader !== null && ctx.uploader.toLowerCase().includes(needle);
    }

    case 'max_duration':
      return (
        ctx.stage === 'metadata' &&
        ctx.durationSeconds !== null &&
        ctx.durationSeconds > rule.params.seconds &&
        inScope(rule.params.tiers, ctx.tier) &&
        inScope(rule.params.platforms, ctx.platform)
      );

    case 'age_limit':
      return ctx.stage === 'metadata' && ctx.ageLimit > rule.params.max;

    case 'tier_only': {
      if (ctx.stage === 'metadata') return false;
      if (tierRank(ctx.tier) >= tierRank(rule.params.minTier)) return false;
      const { platforms, hosts } = rule.params;
      return (
        (platforms !== undefined && platforms.includes(ctx.platform)) ||
        (hosts !== undefined && anyHostMatches(ctx.host, hosts))
      );
    }

    case 'max_height':
      // Never refuses; it lowers the tier's height cap through ruleHeightCap.
      return false;
  }
}

export function evaluateRules(policy: RulesView, ctx: RuleContext): RuleHit | null {
  for (const rule of policy.rules) {
    if (rule.enabled && matches(rule, ctx)) {
      return { rule, message: rule.message ?? defaultRuleMessage(rule) };
    }
  }
  return null;
}

/**
 * Smallest height among enabled `max_height` rules that apply to this tier (and platform, when a
 * rule is platform-scoped and one is given). `Infinity` when none apply.
 */
export function ruleHeightCap(policy: RulesView, tier: Tier, platform?: string): number {
  let cap = Infinity;
  for (const rule of policy.rules) {
    if (!rule.enabled || rule.type !== 'max_height') continue;
    const { height, tiers, platforms } = rule.params;
    if (!inScope(tiers, tier)) continue;
    if (platforms && platforms.length > 0 && (platform === undefined || !platforms.includes(platform))) continue;
    cap = Math.min(cap, height);
  }
  return cap;
}
