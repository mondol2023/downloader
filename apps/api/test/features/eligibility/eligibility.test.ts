import { describe, expect, it } from 'vitest';
import { INELIGIBLE_CODES, INELIGIBLE_COPY } from '@media/shared';
import {
  evaluateEligibility,
  isBlockedHost,
  type EligibilityInput,
} from '../../../src/features/eligibility/index.js';
import { DEFAULT_POLICY, mergePolicy } from '../../../src/features/restrictions/index.js';

const policy = mergePolicy(DEFAULT_POLICY, {}, 1);

function input(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return { availability: 'public', liveStatus: 'not_live', ageLimit: 0, formatDrm: [false], host: 'www.youtube.com', ...over };
}

describe('evaluateEligibility — policy table', () => {
  it.each([
    ['public', 'availability = public'],
    ['unlisted', 'availability = unlisted'],
    [null, 'availability = null'],
  ])('%s → eligible (%s)', (availability) => {
    expect(evaluateEligibility(input({ availability }))).toEqual({ eligible: true, dropFormatIndexes: [] });
  });

  it.each([
    [{ availability: 'private' }, 'SOURCE_PRIVATE'],
    [{ availability: 'premium_only' }, 'SOURCE_MEMBERS_ONLY'],
    [{ availability: 'subscriber_only' }, 'SOURCE_MEMBERS_ONLY'],
    [{ availability: 'needs_auth' }, 'SOURCE_NEEDS_LOGIN'],
    [{ formatDrm: [true, true] }, 'SOURCE_DRM'],
    [{ ageLimit: 18 }, 'SOURCE_AGE_RESTRICTED'],
    [{ liveStatus: 'is_live' }, 'SOURCE_LIVE'],
    [{ liveStatus: 'is_upcoming' }, 'SOURCE_LIVE'],
    [{ host: 'www.netflix.com' }, 'SOURCE_BLOCKED_DOMAIN'],
  ] as Array<[Partial<EligibilityInput>, string]>)('%j → refuse %s', (over, code) => {
    expect(evaluateEligibility(input(over))).toEqual({ eligible: false, code });
  });

  it('unlisted → eligible', () => {
    expect(evaluateEligibility(input({ availability: 'unlisted' })).eligible).toBe(true);
  });

  it('null availability → eligible', () => {
    expect(evaluateEligibility(input({ availability: null })).eligible).toBe(true);
  });

  it('an unrecognised availability string is not a refusal', () => {
    expect(evaluateEligibility(input({ availability: 'something_new' })).eligible).toBe(true);
  });

  it('formatDrm [true,false,true] → eligible, dropFormatIndexes [0,2]', () => {
    expect(evaluateEligibility(input({ formatDrm: [true, false, true] }))).toEqual({
      eligible: true,
      dropFormatIndexes: [0, 2],
    });
  });

  it('formatDrm [true,true] → SOURCE_DRM', () => {
    expect(evaluateEligibility(input({ formatDrm: [true, true] }))).toEqual({ eligible: false, code: 'SOURCE_DRM' });
  });

  it('no formats at all is not a DRM refusal', () => {
    expect(evaluateEligibility(input({ formatDrm: [] }))).toEqual({ eligible: true, dropFormatIndexes: [] });
  });

  it('age_limit 17 → eligible; 18 → SOURCE_AGE_RESTRICTED', () => {
    expect(evaluateEligibility(input({ ageLimit: 17 })).eligible).toBe(true);
    expect(evaluateEligibility(input({ ageLimit: 18 }))).toEqual({ eligible: false, code: 'SOURCE_AGE_RESTRICTED' });
  });

  it('live_status was_live → eligible', () => {
    expect(evaluateEligibility(input({ liveStatus: 'was_live' })).eligible).toBe(true);
  });

  it('a stricter admin ageLimitMax tightens the age check', () => {
    const strict = mergePolicy(DEFAULT_POLICY, { global: { ageLimitMax: 12 } }, 2);
    expect(evaluateEligibility(input({ ageLimit: 13 }), strict)).toEqual({ eligible: false, code: 'SOURCE_AGE_RESTRICTED' });
    expect(evaluateEligibility(input({ ageLimit: 12 }), strict).eligible).toBe(true);
  });

  it('an admin extra blocked host is refused', () => {
    const p = mergePolicy(DEFAULT_POLICY, { global: { extraBlockedHosts: ['bad.example'] } }, 2);
    expect(evaluateEligibility(input({ host: 'cdn.bad.example' }), p)).toEqual({
      eligible: false,
      code: 'SOURCE_BLOCKED_DOMAIN',
    });
  });

  describe('check order: blocked host → private → members → needs_auth → age → live → DRM', () => {
    it('blocked host beats everything', () => {
      const all = input({ host: 'netflix.com', availability: 'private', ageLimit: 18, liveStatus: 'is_live', formatDrm: [true] });
      expect(evaluateEligibility(all)).toEqual({ eligible: false, code: 'SOURCE_BLOCKED_DOMAIN' });
    });
    it('private beats age, live and DRM', () => {
      const all = input({ availability: 'private', ageLimit: 18, liveStatus: 'is_live', formatDrm: [true] });
      expect(evaluateEligibility(all)).toEqual({ eligible: false, code: 'SOURCE_PRIVATE' });
    });
    it('age beats live and DRM', () => {
      expect(evaluateEligibility(input({ ageLimit: 18, liveStatus: 'is_live', formatDrm: [true] }))).toEqual({
        eligible: false,
        code: 'SOURCE_AGE_RESTRICTED',
      });
    });
    it('live beats DRM', () => {
      expect(evaluateEligibility(input({ liveStatus: 'is_live', formatDrm: [true] }))).toEqual({
        eligible: false,
        code: 'SOURCE_LIVE',
      });
    });
  });
});

describe('isBlockedHost', () => {
  it('www.netflix.com → true', () => expect(isBlockedHost('www.netflix.com', policy)).toBe(true));
  it('netflix.com → true', () => expect(isBlockedHost('netflix.com', policy)).toBe(true));
  it('notnetflix.com → false (suffix match is on a label boundary)', () =>
    expect(isBlockedHost('notnetflix.com', policy)).toBe(false));
  it('netflix.com.evil.example → false', () => expect(isBlockedHost('netflix.com.evil.example', policy)).toBe(false));
  it('is case-insensitive and ignores a trailing dot', () => {
    expect(isBlockedHost('WWW.Netflix.COM.', policy)).toBe(true);
  });
  it('tv.apple.com is blocked but apple.com is not', () => {
    expect(isBlockedHost('tv.apple.com', policy)).toBe(true);
    expect(isBlockedHost('apple.com', policy)).toBe(false);
  });
  it('youtube.com → false', () => expect(isBlockedHost('www.youtube.com', policy)).toBe(false));
  it('extraBlockedHosts adds to the floor', () => {
    const p = mergePolicy(DEFAULT_POLICY, { global: { extraBlockedHosts: ['bad.example'] } }, 2);
    expect(isBlockedHost('bad.example', p)).toBe(true);
    expect(isBlockedHost('netflix.com', p)).toBe(true);
  });
});

describe('shared eligibility copy', () => {
  it('has copy for every code', () => {
    expect(INELIGIBLE_CODES).toHaveLength(8);
    for (const code of INELIGIBLE_CODES) {
      expect(INELIGIBLE_COPY[code].title.length).toBeGreaterThan(0);
      expect(INELIGIBLE_COPY[code].body.length).toBeGreaterThan(0);
    }
  });
});
