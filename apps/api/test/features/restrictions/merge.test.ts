import { describe, expect, it } from 'vitest';
import { TIER_POLICIES } from '@media/shared';
import { AppError } from '../../../src/lib/errors.js';
import {
  DEFAULT_POLICY,
  HARD_FLOOR,
  mergePolicy,
  toPublicPolicy,
} from '../../../src/features/restrictions/index.js';

function catchPolicyError(overrides: unknown): AppError {
  try {
    mergePolicy(DEFAULT_POLICY, overrides, 1);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected mergePolicy to throw');
}

describe('mergePolicy', () => {
  it('empty overrides → defaults', () => {
    const p = mergePolicy(DEFAULT_POLICY, {}, 3);
    expect(p.version).toBe(3);
    expect(p.hardFloor).toBe(HARD_FLOOR);
    expect(p.global).toEqual(DEFAULT_POLICY.global);
    expect(p.tiers).toEqual(DEFAULT_POLICY.tiers);
    expect(p.platforms).toEqual(DEFAULT_POLICY.platforms);
  });

  it('null / undefined overrides behave like empty', () => {
    expect(mergePolicy(DEFAULT_POLICY, null, 1).tiers).toEqual(DEFAULT_POLICY.tiers);
    expect(mergePolicy(DEFAULT_POLICY, undefined, 1).tiers).toEqual(DEFAULT_POLICY.tiers);
  });

  it('tier defaults come from TIER_POLICIES', () => {
    expect(DEFAULT_POLICY.tiers.FREE.maxHeight).toBe(TIER_POLICIES.FREE.maxHeight);
    expect(DEFAULT_POLICY.tiers.PRO.dailyDownloads).toBe(TIER_POLICIES.PRO.dailyDownloads);
    expect(DEFAULT_POLICY.tiers.GUEST.audioFormats).toEqual(TIER_POLICIES.GUEST.audioFormats);
  });

  it('override tiers.FREE.maxHeight 720 → effective 720, siblings untouched', () => {
    const p = mergePolicy(DEFAULT_POLICY, { tiers: { FREE: { maxHeight: 720 } } }, 2);
    expect(p.tiers.FREE.maxHeight).toBe(720);
    expect(p.tiers.FREE.maxFps).toBe(TIER_POLICIES.FREE.maxFps);
    expect(p.tiers.GUEST.maxHeight).toBe(TIER_POLICIES.GUEST.maxHeight);
  });

  it('does not mutate the defaults', () => {
    const before = structuredClone(DEFAULT_POLICY);
    mergePolicy(DEFAULT_POLICY, { tiers: { FREE: { maxHeight: 360 } }, platforms: { tiktok: { enabled: false } } }, 2);
    expect(DEFAULT_POLICY).toEqual(before);
  });

  it('arrays replace rather than merge', () => {
    const p = mergePolicy(DEFAULT_POLICY, { tiers: { FREE: { audioFormats: ['mp3'] } } }, 2);
    expect(p.tiers.FREE.audioFormats).toEqual(['mp3']);
  });

  it('platform overrides merge per platform', () => {
    const p = mergePolicy(DEFAULT_POLICY, { platforms: { tiktok: { enabled: false, note: 'paused' } } }, 2);
    expect(p.platforms.tiktok).toMatchObject({ enabled: false, note: 'paused', download: true });
    expect(p.platforms.youtube.enabled).toBe(true);
  });

  it('override containing key hardFloor → POLICY_INVALID', () => {
    const err = catchPolicyError({ hardFloor: { blockedHosts: [] } });
    expect(err.code).toBe('POLICY_INVALID');
    expect(err.status).toBe(422);
    expect(err.message).toContain('hardFloor');
  });

  it('ageLimitMax 18 → POLICY_INVALID', () => {
    const err = catchPolicyError({ global: { ageLimitMax: 18 } });
    expect(err.code).toBe('POLICY_INVALID');
    expect(err.message).toContain('global.ageLimitMax');
  });

  it("unknown platform key 'netflix' → POLICY_INVALID", () => {
    const err = catchPolicyError({ platforms: { netflix: { enabled: true } } });
    expect(err.code).toBe('POLICY_INVALID');
    expect(err.message).toContain('platforms');
  });

  it('unknown keys are rejected at every level', () => {
    expect(catchPolicyError({ bogus: 1 }).code).toBe('POLICY_INVALID');
    expect(catchPolicyError({ global: { bogus: 1 } }).code).toBe('POLICY_INVALID');
    expect(catchPolicyError({ tiers: { FREE: { bogus: 1 } } }).code).toBe('POLICY_INVALID');
    expect(catchPolicyError({ tiers: { ENTERPRISE: {} } }).code).toBe('POLICY_INVALID');
    expect(catchPolicyError({ platforms: { tiktok: { bogus: 1 } } }).code).toBe('POLICY_INVALID');
  });

  it('non-object overrides → POLICY_INVALID', () => {
    expect(catchPolicyError('nope').code).toBe('POLICY_INVALID');
    expect(catchPolicyError([]).code).toBe('POLICY_INVALID');
  });

  it('extraBlockedHosts adds to, never replaces, HARD_FLOOR.blockedHosts', () => {
    const p = mergePolicy(DEFAULT_POLICY, { global: { extraBlockedHosts: ['example.org'] } }, 2);
    expect(p.global.extraBlockedHosts).toEqual(['example.org']);
    expect(p.hardFloor.blockedHosts).toContain('netflix.com');
    expect(p.hardFloor.blockedHosts).not.toContain('example.org');
    expect(() => mergePolicy(DEFAULT_POLICY, { global: { extraBlockedHosts: ['not a host'] } }, 2)).toThrow(AppError);
  });

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['string', '5'],
  ])('%s limit → POLICY_INVALID', (_label, value) => {
    expect(catchPolicyError({ tiers: { FREE: { dailyDownloads: value } } }).code).toBe('POLICY_INVALID');
    expect(catchPolicyError({ tiers: { FREE: { maxHeight: value } } }).code).toBe('POLICY_INVALID');
    expect(catchPolicyError({ global: { maxDurationSec: value } }).code).toBe('POLICY_INVALID');
    expect(catchPolicyError({ platforms: { youtube: { maxHeight: value } } }).code).toBe('POLICY_INVALID');
  });

  it('platform maxHeight may be null (no cap)', () => {
    const p = mergePolicy(DEFAULT_POLICY, { platforms: { youtube: { maxHeight: null } } }, 2);
    expect(p.platforms.youtube.maxHeight).toBeNull();
  });
});

describe('HARD_FLOOR', () => {
  it('lists the always-refused codes, DRM platforms and age ceiling', () => {
    expect(HARD_FLOOR.refuse).toEqual(['SOURCE_PRIVATE', 'SOURCE_MEMBERS_ONLY', 'SOURCE_NEEDS_LOGIN', 'SOURCE_DRM']);
    expect(HARD_FLOOR.maxAgeLimit).toBe(17);
    for (const host of ['netflix.com', 'disneyplus.com', 'primevideo.com', 'hulu.com', 'spotify.com', 'tidal.com', 'deezer.com']) {
      expect(HARD_FLOOR.blockedHosts).toContain(host);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(HARD_FLOOR)).toBe(true);
    expect(Object.isFrozen(HARD_FLOOR.blockedHosts)).toBe(true);
  });
});

describe('toPublicPolicy', () => {
  it('exposes tiers and per-platform enabled/download only', () => {
    const p = mergePolicy(DEFAULT_POLICY, { platforms: { tiktok: { enabled: false, note: 'internal' } } }, 7);
    const pub = toPublicPolicy(p);
    expect(pub.version).toBe(7);
    expect(pub.tiers.FREE.maxHeight).toBe(p.tiers.FREE.maxHeight);
    expect(pub.platforms.tiktok).toEqual({ enabled: false, download: true });
    expect(Object.keys(pub).sort()).toEqual(['platforms', 'tiers', 'version']);
  });
});
