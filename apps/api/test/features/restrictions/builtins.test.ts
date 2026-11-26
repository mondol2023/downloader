import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from '../../../src/features/restrictions/restrictions.config.js';
import { mergePolicy } from '../../../src/features/restrictions/merge.js';
import { setCurrentPolicy } from '../../../src/features/restrictions/policy.current.js';
import { assertDurationAllowed } from '../../../src/features/restrictions/enforce.js';
import {
  ageCapOf,
  extraBlockedHostsOf,
  maxDurationOf,
} from '../../../src/features/restrictions/builtins.js';
import { isBlockedHost } from '../../../src/features/eligibility/blocked-hosts.js';
import { evaluateEligibility } from '../../../src/features/eligibility/eligibility.js';

const policy = (overrides: Record<string, unknown> = {}) => mergePolicy(DEFAULT_POLICY, overrides as never, 1);

const media = { availability: null, liveStatus: null, formatDrm: [], host: 'youtube.com' };

describe('builtin helpers', () => {
  it('maxDurationOf returns the configured limit, or null when disabled', () => {
    const on = policy({ global: { maxDurationSec: 600 } });
    const off = policy({ global: { maxDurationSec: 600 }, disabledBuiltins: ['maxDuration'] });
    expect(maxDurationOf(on)).toBe(600);
    expect(maxDurationOf(off)).toBeNull();
    // The value is kept so re-enabling restores it.
    expect(off.global.maxDurationSec).toBe(600);
  });

  it('ageCapOf returns the stricter cap, or the floor 17 when disabled, never "no cap"', () => {
    expect(ageCapOf(policy({ global: { ageLimitMax: 12 } }))).toBe(12);
    expect(ageCapOf(policy({ global: { ageLimitMax: 12 }, disabledBuiltins: ['ageLimit'] }))).toBe(17);
    expect(ageCapOf(undefined)).toBe(17);
  });

  it('extraBlockedHostsOf returns the admin hosts, or [] when disabled', () => {
    const hosts = { global: { extraBlockedHosts: ['example.com'] } };
    expect(extraBlockedHostsOf(policy(hosts))).toEqual(['example.com']);
    expect(extraBlockedHostsOf(policy({ ...hosts, disabledBuiltins: ['blockedHosts'] }))).toEqual([]);
    expect(extraBlockedHostsOf(undefined)).toEqual([]);
  });

  it('accepts a partial policy with no disabledBuiltins key', () => {
    expect(maxDurationOf({ global: { ...DEFAULT_POLICY.global, maxDurationSec: 90 } })).toBe(90);
  });
});

describe('the hard floor survives disabled built-ins', () => {
  it('still refuses age 18 when the ageLimit built-in is off', () => {
    const p = policy({ global: { ageLimitMax: 12 }, disabledBuiltins: ['ageLimit'] });
    expect(evaluateEligibility({ ...media, ageLimit: 18 }, p)).toEqual({
      eligible: false,
      code: 'SOURCE_AGE_RESTRICTED',
    });
    // The admin's stricter 12 is off, so 16 passes, but the floor's 17 still holds.
    expect(evaluateEligibility({ ...media, ageLimit: 16 }, p)).toMatchObject({ eligible: true });
  });

  it('applies the admin age cap while the built-in is on', () => {
    const p = policy({ global: { ageLimitMax: 12 } });
    expect(evaluateEligibility({ ...media, ageLimit: 16 }, p)).toMatchObject({
      eligible: false,
      code: 'SOURCE_AGE_RESTRICTED',
    });
  });

  it('keeps blocking DRM hosts but stops blocking admin hosts when blockedHosts is off', () => {
    const p = policy({ global: { extraBlockedHosts: ['example.com'] }, disabledBuiltins: ['blockedHosts'] });
    expect(isBlockedHost('netflix.com', p)).toBe(true);
    expect(isBlockedHost('example.com', p)).toBe(false);
    expect(isBlockedHost('example.com', policy({ global: { extraBlockedHosts: ['example.com'] } }))).toBe(true);
  });
});

describe('assertDurationAllowed with the maxDuration built-in', () => {
  beforeEach(() => setCurrentPolicy(policy()));

  it('throws SOURCE_TOO_LONG while enabled', () => {
    setCurrentPolicy(policy({ global: { maxDurationSec: 3600 } }));
    expect(() => assertDurationAllowed(10 * 3600)).toThrowError(expect.objectContaining({ code: 'SOURCE_TOO_LONG' }));
  });

  it('lets any length through when disabled', () => {
    setCurrentPolicy(policy({ global: { maxDurationSec: 3600 }, disabledBuiltins: ['maxDuration'] }));
    expect(() => assertDurationAllowed(10 * 3600)).not.toThrow();
  });
});
