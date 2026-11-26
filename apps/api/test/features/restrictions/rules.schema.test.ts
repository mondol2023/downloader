import { describe, expect, it } from 'vitest';
import type { Rule } from '@media/shared';
import { AppError } from '../../../src/lib/errors.js';
import { DEFAULT_POLICY, mergePolicy } from '../../../src/features/restrictions/index.js';

function catchPolicyError(overrides: unknown): AppError {
  try {
    mergePolicy(DEFAULT_POLICY, overrides, 1);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected mergePolicy to throw');
}

const paths = (e: AppError) => ((e.details as Array<{ path: string }> | undefined) ?? []).map((d) => d.path);

const base = { id: 'r1', name: 'Rule', enabled: true };
const VALID: Rule[] = [
  { ...base, id: 'a', type: 'block_host', params: { hosts: ['example.com'] } },
  { ...base, id: 'b', type: 'block_platform', params: { platform: 'tiktok', actions: ['extract', 'download'] } },
  { ...base, id: 'c', type: 'block_url_pattern', params: { pattern: '*/shorts/*' }, message: 'No shorts', note: 'n' },
  { ...base, id: 'd', type: 'block_keyword', params: { text: 'leak', fields: ['title', 'channel'] } },
  { ...base, id: 'e', type: 'max_duration', params: { seconds: 600, tiers: ['FREE'], platforms: ['youtube'] } },
  { ...base, id: 'f', type: 'max_height', params: { height: 720 } },
  { ...base, id: 'g', type: 'age_limit', params: { max: 12 } },
  { ...base, id: 'h', type: 'tier_only', params: { minTier: 'PRO', platforms: ['twitch'] } },
];

const rule = (over: Record<string, unknown> = {}, params: Record<string, unknown> = { seconds: 60 }) => ({
  ...base,
  type: 'max_duration',
  params,
  ...over,
});

describe('rules in the policy schema', () => {
  it('a valid rule of each of the 8 types merges unchanged', () => {
    const p = mergePolicy(DEFAULT_POLICY, { rules: VALID }, 1);
    expect(p.rules).toEqual(VALID);
  });

  it('empty overrides → empty rules and disabledBuiltins', () => {
    const p = mergePolicy(DEFAULT_POLICY, {}, 1);
    expect(p.rules).toEqual([]);
    expect(p.disabledBuiltins).toEqual([]);
  });

  it('rules replace rather than merge', () => {
    const withRules = { ...DEFAULT_POLICY, rules: VALID };
    const p = mergePolicy(withRules, { rules: [] }, 1);
    expect(p.rules).toEqual([]);
  });

  it('disabledBuiltins accepts known toggles', () => {
    const p = mergePolicy(DEFAULT_POLICY, { disabledBuiltins: ['maxDuration', 'ageLimit', 'blockedHosts'] }, 1);
    expect(p.disabledBuiltins).toEqual(['maxDuration', 'ageLimit', 'blockedHosts']);
  });

  it('201 rules → 422 POLICY_INVALID', () => {
    const many = Array.from({ length: 201 }, (_, i) => rule({ id: `r${i}` }));
    const err = catchPolicyError({ rules: many });
    expect(err.status).toBe(422);
    expect(err.code).toBe('POLICY_INVALID');
  });

  it('200 rules is fine', () => {
    const many = Array.from({ length: 200 }, (_, i) => rule({ id: `r${i}` }));
    expect(mergePolicy(DEFAULT_POLICY, { rules: many }, 1).rules).toHaveLength(200);
  });

  it('duplicate ids → path under rules', () => {
    const err = catchPolicyError({ rules: [rule({ id: 'x' }), rule({ id: 'x' })] });
    expect(err.code).toBe('POLICY_INVALID');
    expect(paths(err).some((p) => p.startsWith('rules'))).toBe(true);
  });

  it('empty name → rules.0.name', () => {
    expect(paths(catchPolicyError({ rules: [rule({ name: '' })] }))).toContain('rules.0.name');
  });

  it('max_duration seconds 0 → rules.0.params.seconds', () => {
    expect(paths(catchPolicyError({ rules: [rule({}, { seconds: 0 })] }))).toContain('rules.0.params.seconds');
  });

  it('empty tiers scope → rules.0.params.tiers', () => {
    expect(paths(catchPolicyError({ rules: [rule({}, { seconds: 60, tiers: [] })] }))).toContain('rules.0.params.tiers');
  });

  it('unknown type → 422', () => {
    expect(catchPolicyError({ rules: [rule({ type: 'nope' })] }).status).toBe(422);
  });

  it('unknown key on a rule → unknown key', () => {
    const err = catchPolicyError({ rules: [rule({ extra: 1 })] });
    expect(err.status).toBe(422);
    expect(paths(err)).toContain('rules.0.extra');
    expect((err.details as Array<{ message: string }>).some((d) => d.message === 'unknown key')).toBe(true);
  });

  it('unknown key in params → 422', () => {
    expect(catchPolicyError({ rules: [rule({}, { seconds: 60, bogus: 1 })] }).status).toBe(422);
  });

  it('age_limit.max 18 → 422', () => {
    const r = { ...base, type: 'age_limit', params: { max: 18 } };
    expect(catchPolicyError({ rules: [r] }).status).toBe(422);
  });

  it('url pattern with 6 stars or 201 chars → 422', () => {
    const mk = (pattern: string) => ({ ...base, type: 'block_url_pattern', params: { pattern } });
    expect(catchPolicyError({ rules: [mk('*a*a*a*a*a*')] }).status).toBe(422);
    expect(catchPolicyError({ rules: [mk('a'.repeat(201))] }).status).toBe(422);
    expect(mergePolicy(DEFAULT_POLICY, { rules: [mk('*a*a*a*a*a')] }, 1).rules).toHaveLength(1);
  });

  it('tier_only with neither platforms nor hosts → 422', () => {
    const r = { ...base, type: 'tier_only', params: { minTier: 'PRO' } };
    expect(catchPolicyError({ rules: [r] }).status).toBe(422);
  });

  it("disabledBuiltins ['bogus'] → 422", () => {
    expect(catchPolicyError({ disabledBuiltins: ['bogus'] }).status).toBe(422);
  });
});
