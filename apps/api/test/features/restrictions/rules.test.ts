import { describe, expect, it } from 'vitest';
import { INELIGIBLE_COPY, type Rule } from '@media/shared';
import {
  defaultRuleMessage,
  evaluateRules,
  globMatch,
  ruleHeightCap,
  type RuleContext,
} from '../../../src/features/restrictions/rules.js';

let n = 0;
function rule<R extends Rule>(r: Omit<R, 'id' | 'name' | 'enabled'> & Partial<Pick<R, 'id' | 'name' | 'enabled'>>): Rule {
  n += 1;
  return { id: `r${n}`, name: `Rule ${n}`, enabled: true, ...r } as Rule;
}
const pol = (...rules: Rule[]) => ({ rules });

const source = (over: Partial<Extract<RuleContext, { stage: 'source' }>> = {}): RuleContext => ({
  stage: 'source',
  tier: 'GUEST',
  url: 'https://www.youtube.com/watch?v=abc',
  host: 'www.youtube.com',
  platform: 'youtube',
  ...over,
});
const metadata = (over: Partial<Extract<RuleContext, { stage: 'metadata' }>> = {}): RuleContext => ({
  stage: 'metadata',
  tier: 'GUEST',
  platform: 'youtube',
  durationSeconds: 60,
  ageLimit: 0,
  title: 'A title',
  uploader: 'A channel',
  ...over,
});
const action = (over: Partial<Extract<RuleContext, { stage: 'action' }>> = {}): RuleContext => ({
  stage: 'action',
  tier: 'GUEST',
  action: 'download',
  host: 'www.youtube.com',
  platform: 'youtube',
  ...over,
});

describe('globMatch', () => {
  it('* matches any run of characters over the whole string', () => {
    expect(globMatch('*/shorts/*', 'youtube.com/shorts/abc')).toBe(true);
    expect(globMatch('*/shorts/*', 'youtube.com/watch?v=1')).toBe(false);
    expect(globMatch('youtube.com/*', 'youtube.com/')).toBe(true);
    expect(globMatch('*', '')).toBe(true);
  });

  it('is anchored at both ends', () => {
    expect(globMatch('shorts', 'youtube.com/shorts/abc')).toBe(false);
    expect(globMatch('youtube.com', 'youtube.com/x')).toBe(false);
  });

  it('treats every other character literally', () => {
    expect(globMatch('a.b', 'axb')).toBe(false);
    expect(globMatch('a.b', 'a.b')).toBe(true);
    expect(globMatch('a?b', 'axb')).toBe(false);
    expect(globMatch('a+b', 'a+b')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(globMatch('*/SHORTS/*', 'YouTube.com/shorts/ABC')).toBe(true);
  });

  it('does not hang on the non-matching many-star case (ReDoS)', () => {
    const start = performance.now();
    const hit = globMatch('*a*a*a*a*c', 'a'.repeat(2048));
    expect(hit).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('defaultRuleMessage', () => {
  it('max_duration names the minute limit', () => {
    expect(defaultRuleMessage(rule({ type: 'max_duration', params: { seconds: 600 } }))).toBe(
      'Longer than the 10-minute limit.',
    );
  });
  it('tier_only names the plan', () => {
    expect(defaultRuleMessage(rule({ type: 'tier_only', params: { minTier: 'PRO', platforms: ['youtube'] } }))).toBe(
      'This is available on the PRO plan and above.',
    );
  });
  it('other types use the stock body', () => {
    expect(defaultRuleMessage(rule({ type: 'block_url_pattern', params: { pattern: '*' } }))).toBe(
      INELIGIBLE_COPY.SOURCE_RULE_BLOCKED.body,
    );
  });
});

describe('evaluateRules — list handling', () => {
  it('returns null with no rules', () => {
    expect(evaluateRules(pol(), source())).toBeNull();
  });

  it('the first enabled matching rule in list order wins', () => {
    const a = rule({ type: 'block_host', params: { hosts: ['youtube.com'] }, name: 'first' });
    const b = rule({ type: 'block_platform', params: { platform: 'youtube', actions: ['extract'] }, name: 'second' });
    expect(evaluateRules(pol(a, b), source())?.rule.name).toBe('first');
    expect(evaluateRules(pol(b, a), source())?.rule.name).toBe('second');
  });

  it('skips disabled rules', () => {
    const r = rule({ type: 'block_host', params: { hosts: ['youtube.com'] }, enabled: false });
    expect(evaluateRules(pol(r), source())).toBeNull();
  });

  it("returns the rule's own message, else the default", () => {
    const own = rule({ type: 'block_host', params: { hosts: ['youtube.com'] }, message: 'Nope.' });
    const stock = rule({ type: 'block_host', params: { hosts: ['youtube.com'] } });
    expect(evaluateRules(pol(own), source())?.message).toBe('Nope.');
    expect(evaluateRules(pol(stock), source())?.message).toBe(INELIGIBLE_COPY.SOURCE_RULE_BLOCKED.body);
  });
});

describe('block_host', () => {
  const r = rule({ type: 'block_host', params: { hosts: ['example.com', 'foo.org'] } });
  it('hits the host and its subdomains at source', () => {
    expect(evaluateRules(pol(r), source({ host: 'example.com' }))).not.toBeNull();
    expect(evaluateRules(pol(r), source({ host: 'cdn.Example.com.' }))).not.toBeNull();
    expect(evaluateRules(pol(r), source({ host: 'foo.org' }))).not.toBeNull();
  });
  it('misses on a label boundary and other hosts', () => {
    expect(evaluateRules(pol(r), source({ host: 'notexample.com' }))).toBeNull();
    expect(evaluateRules(pol(r), source({ host: 'example.com.evil.net' }))).toBeNull();
  });
  it('also hits at the action stage, and never at metadata', () => {
    expect(evaluateRules(pol(r), action({ host: 'example.com' }))).not.toBeNull();
    expect(evaluateRules(pol(r), action({ host: 'other.com' }))).toBeNull();
    expect(evaluateRules(pol(r), metadata())).toBeNull();
  });
});

describe('block_platform', () => {
  const r = rule({ type: 'block_platform', params: { platform: 'tiktok', actions: ['extract', 'playback'] } });
  it('hits at source only when extract is listed', () => {
    expect(evaluateRules(pol(r), source({ platform: 'tiktok' }))).not.toBeNull();
    expect(evaluateRules(pol(r), source({ platform: 'youtube' }))).toBeNull();
    const dl = rule({ type: 'block_platform', params: { platform: 'tiktok', actions: ['download'] } });
    expect(evaluateRules(pol(dl), source({ platform: 'tiktok' }))).toBeNull();
  });
  it('hits at action only for the listed action', () => {
    expect(evaluateRules(pol(r), action({ platform: 'tiktok', action: 'playback' }))).not.toBeNull();
    expect(evaluateRules(pol(r), action({ platform: 'tiktok', action: 'download' }))).toBeNull();
    expect(evaluateRules(pol(r), action({ platform: 'youtube', action: 'playback' }))).toBeNull();
  });
  it('never hits at metadata', () => {
    expect(evaluateRules(pol(r), metadata({ platform: 'tiktok' }))).toBeNull();
  });
});

describe('block_url_pattern', () => {
  const r = rule({ type: 'block_url_pattern', params: { pattern: '*/shorts/*' } });
  it('matches host + path + query of the url at source', () => {
    expect(evaluateRules(pol(r), source({ url: 'https://www.youtube.com/shorts/abc123' }))).not.toBeNull();
    expect(evaluateRules(pol(r), source({ url: 'https://www.youtube.com/watch?v=abc' }))).toBeNull();
    const q = rule({ type: 'block_url_pattern', params: { pattern: '*/watch?v=*&list=*' } });
    expect(evaluateRules(pol(q), source({ url: 'https://youtube.com/watch?v=1&list=PL1' }))).not.toBeNull();
  });
  it('matches case-insensitively', () => {
    expect(evaluateRules(pol(r), source({ url: 'https://YouTube.com/SHORTS/abc' }))).not.toBeNull();
  });
  it('an unparseable url is a miss, not a throw', () => {
    expect(evaluateRules(pol(r), source({ url: 'not a url' }))).toBeNull();
  });
  it('does not apply at other stages', () => {
    expect(evaluateRules(pol(r), metadata())).toBeNull();
    expect(evaluateRules(pol(r), action())).toBeNull();
  });
  it('many-star pattern against a 2048-char url finishes fast', () => {
    const p = rule({ type: 'block_url_pattern', params: { pattern: '*a*a*a*a*c' } });
    const start = performance.now();
    const hit = evaluateRules(pol(p), source({ url: `https://a.com/${'a'.repeat(2048)}` }));
    expect(hit).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('block_keyword', () => {
  it('matches the title case-insensitively', () => {
    const r = rule({ type: 'block_keyword', params: { text: 'Leak', fields: ['title'] } });
    expect(evaluateRules(pol(r), metadata({ title: 'Big LEAKED video' }))).not.toBeNull();
    expect(evaluateRules(pol(r), metadata({ title: 'Fine' }))).toBeNull();
  });
  it('matches the channel only when channel is listed', () => {
    const r = rule({ type: 'block_keyword', params: { text: 'acme', fields: ['channel'] } });
    expect(evaluateRules(pol(r), metadata({ uploader: 'ACME Corp' }))).not.toBeNull();
    expect(evaluateRules(pol(r), metadata({ title: 'acme', uploader: 'Other' }))).toBeNull();
  });
  it('a null uploader is a miss, not a throw', () => {
    const r = rule({ type: 'block_keyword', params: { text: 'acme', fields: ['channel'] } });
    expect(evaluateRules(pol(r), metadata({ uploader: null }))).toBeNull();
  });
  it('an empty title never matches a non-empty keyword', () => {
    const r = rule({ type: 'block_keyword', params: { text: 'x', fields: ['title', 'channel'] } });
    expect(evaluateRules(pol(r), metadata({ title: '', uploader: null }))).toBeNull();
  });
  it('does not apply at source or action', () => {
    const r = rule({ type: 'block_keyword', params: { text: 'a', fields: ['title'] } });
    expect(evaluateRules(pol(r), source())).toBeNull();
    expect(evaluateRules(pol(r), action())).toBeNull();
  });
});

describe('max_duration', () => {
  const r = rule({ type: 'max_duration', params: { seconds: 600 } });
  it('hits above the limit at metadata, not at or below it', () => {
    expect(evaluateRules(pol(r), metadata({ durationSeconds: 601 }))).not.toBeNull();
    expect(evaluateRules(pol(r), metadata({ durationSeconds: 600 }))).toBeNull();
  });
  it('a null duration never hits', () => {
    expect(evaluateRules(pol(r), metadata({ durationSeconds: null }))).toBeNull();
  });
  it('honours tier and platform scope', () => {
    const scoped = rule({ type: 'max_duration', params: { seconds: 60, tiers: ['GUEST'], platforms: ['youtube'] } });
    expect(evaluateRules(pol(scoped), metadata({ durationSeconds: 120 }))).not.toBeNull();
    expect(evaluateRules(pol(scoped), metadata({ durationSeconds: 120, tier: 'PRO' }))).toBeNull();
    expect(evaluateRules(pol(scoped), metadata({ durationSeconds: 120, platform: 'tiktok' }))).toBeNull();
  });
  it('a platform outside the known ids with a platform-scoped rule is a miss', () => {
    const scoped = rule({ type: 'max_duration', params: { seconds: 60, platforms: ['youtube'] } });
    expect(evaluateRules(pol(scoped), metadata({ durationSeconds: 120, platform: 'somesite' }))).toBeNull();
  });
  it('an unscoped rule applies to an unknown platform', () => {
    expect(evaluateRules(pol(r), metadata({ durationSeconds: 9999, platform: 'somesite' }))).not.toBeNull();
  });
});

describe('age_limit', () => {
  const r = rule({ type: 'age_limit', params: { max: 12 } });
  it('hits above the max at metadata', () => {
    expect(evaluateRules(pol(r), metadata({ ageLimit: 13 }))).not.toBeNull();
    expect(evaluateRules(pol(r), metadata({ ageLimit: 12 }))).toBeNull();
    expect(evaluateRules(pol(r), metadata({ ageLimit: 0 }))).toBeNull();
  });
  it('does not apply at source', () => {
    expect(evaluateRules(pol(r), source())).toBeNull();
  });
});

describe('tier_only', () => {
  const r = rule({ type: 'tier_only', params: { minTier: 'FREE', platforms: ['tiktok'] } });
  it('orders GUEST < FREE < PRO', () => {
    expect(evaluateRules(pol(r), source({ platform: 'tiktok', tier: 'GUEST' }))).not.toBeNull();
    expect(evaluateRules(pol(r), source({ platform: 'tiktok', tier: 'FREE' }))).toBeNull();
    expect(evaluateRules(pol(r), source({ platform: 'tiktok', tier: 'PRO' }))).toBeNull();
  });
  it('hits at the action stage too', () => {
    expect(evaluateRules(pol(r), action({ platform: 'tiktok', tier: 'GUEST' }))).not.toBeNull();
    expect(evaluateRules(pol(r), action({ platform: 'tiktok', tier: 'FREE' }))).toBeNull();
  });
  it('scopes by platform or by host; neither matching is a miss', () => {
    expect(evaluateRules(pol(r), source({ platform: 'youtube' }))).toBeNull();
    const h = rule({ type: 'tier_only', params: { minTier: 'PRO', hosts: ['vimeo.com'] } });
    expect(evaluateRules(pol(h), source({ host: 'player.vimeo.com', platform: 'vimeo' }))).not.toBeNull();
    expect(evaluateRules(pol(h), source({ host: 'youtube.com' }))).toBeNull();
  });
  it('an unknown platform with a platform-scoped rule is a miss', () => {
    expect(evaluateRules(pol(r), source({ platform: 'somesite' }))).toBeNull();
  });
  it('does not apply at metadata', () => {
    expect(evaluateRules(pol(r), metadata({ platform: 'tiktok' }))).toBeNull();
  });
});

describe('max_height never refuses', () => {
  it('has no hit at any stage', () => {
    const r = rule({ type: 'max_height', params: { height: 480 } });
    expect(evaluateRules(pol(r), source())).toBeNull();
    expect(evaluateRules(pol(r), metadata())).toBeNull();
    expect(evaluateRules(pol(r), action())).toBeNull();
  });
});

describe('ruleHeightCap', () => {
  it('is Infinity with no matching rule', () => {
    expect(ruleHeightCap(pol(), 'FREE', 'youtube')).toBe(Infinity);
    expect(ruleHeightCap(pol(rule({ type: 'block_host', params: { hosts: ['a.com'] } })), 'FREE')).toBe(Infinity);
  });
  it('is the minimum of the matching enabled rules', () => {
    const a = rule({ type: 'max_height', params: { height: 720 } });
    const b = rule({ type: 'max_height', params: { height: 480 } });
    const off = rule({ type: 'max_height', params: { height: 144 }, enabled: false });
    expect(ruleHeightCap(pol(a, b, off), 'FREE', 'youtube')).toBe(480);
  });
  it('honours tier and platform scope', () => {
    const r = rule({ type: 'max_height', params: { height: 360, tiers: ['FREE'], platforms: ['youtube'] } });
    expect(ruleHeightCap(pol(r), 'FREE', 'youtube')).toBe(360);
    expect(ruleHeightCap(pol(r), 'PRO', 'youtube')).toBe(Infinity);
    expect(ruleHeightCap(pol(r), 'FREE', 'tiktok')).toBe(Infinity);
    expect(ruleHeightCap(pol(r), 'FREE', 'somesite')).toBe(Infinity);
  });
  it('a platform-scoped rule does not apply when the platform is unknown to the caller', () => {
    const r = rule({ type: 'max_height', params: { height: 360, platforms: ['youtube'] } });
    expect(ruleHeightCap(pol(r), 'FREE')).toBe(Infinity);
  });
  it('an unscoped rule applies without a platform', () => {
    const r = rule({ type: 'max_height', params: { height: 360 } });
    expect(ruleHeightCap(pol(r), 'FREE')).toBe(360);
  });
});
