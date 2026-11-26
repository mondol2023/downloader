import { describe, expect, it } from 'vitest';
import { verdictFor, type PreviewMedia, type PreviewSource } from '../../../src/features/admin/policy.preview.js';
import { mergePolicy } from '../../../src/features/restrictions/merge.js';
import { DEFAULT_POLICY } from '../../../src/features/restrictions/restrictions.config.js';

const policy = (overrides: Record<string, unknown> = {}) => mergePolicy(DEFAULT_POLICY, overrides, 1);

const source = (over: Partial<PreviewSource> = {}): PreviewSource => ({
  host: 'www.youtube.com',
  platform: 'youtube',
  takenDown: false,
  url: 'https://www.youtube.com/shorts/abc',
  ...over,
});

const media = (over: Partial<PreviewMedia> = {}): PreviewMedia => ({
  platform: 'youtube',
  durationSeconds: 120,
  availability: 'public',
  isLive: false,
  ageLimit: 0,
  title: 'A video',
  uploader: 'Someone',
  formats: [
    { height: 360, fps: 30, sizeBytes: 1_000_000 },
    { height: 1080, fps: 30, sizeBytes: 50_000_000 },
  ],
  ...over,
});

const rule = (over: Record<string, unknown>) => ({ id: 'r1', name: 'Rule one', enabled: true, ...over });

describe('verdictFor with rules', () => {
  it('a url-pattern rule refuses with the rule named', () => {
    const p = policy({
      rules: [rule({ type: 'block_url_pattern', params: { pattern: '*/shorts/*' }, message: 'No shorts.' })],
    });
    const v = verdictFor(p, 'FREE', source(), null);
    expect(v.allowed).toBe(false);
    expect(v.refusal).toEqual({ code: 'SOURCE_RULE_BLOCKED', message: 'No shorts.' });
    expect(v.rule).toEqual({ id: 'r1', name: 'Rule one' });
    expect(verdictFor(policy(), 'FREE', source(), null).rule).toBeNull();
  });

  it('a keyword rule refuses on cached metadata', () => {
    const p = policy({
      rules: [rule({ type: 'block_keyword', params: { text: 'leak', fields: ['title'] } })],
    });
    expect(verdictFor(p, 'FREE', source(), media({ title: 'Big LEAK' })).refusal?.code).toBe('SOURCE_RULE_BLOCKED');
    expect(verdictFor(p, 'FREE', source(), media()).allowed).toBe(true);
  });

  it('a max_height rule lowers the allowed formats', () => {
    const before = verdictFor(policy(), 'FREE', source(), media());
    const p = policy({ rules: [rule({ type: 'max_height', params: { height: 360 } })] });
    const after = verdictFor(p, 'FREE', source(), media());
    expect(after.formats!.allowed).toBeLessThan(before.formats!.allowed);
    expect(after.formats).toEqual({ total: 2, allowed: 1, locked: 1 });
  });

  it('a platform rule limited to download stays allowed but lists the blocked action', () => {
    const p = policy({
      rules: [rule({ type: 'block_platform', params: { platform: 'youtube', actions: ['download'] } })],
    });
    const v = verdictFor(p, 'FREE', source(), media());
    expect(v.allowed).toBe(true);
    expect(v.blockedActions).toEqual(['download']);
    expect(verdictFor(policy(), 'FREE', source(), media()).blockedActions).toEqual([]);
  });

  it('a disabled maxDuration built-in lets a 10-hour record through', () => {
    const long = media({ durationSeconds: 10 * 3600 });
    expect(verdictFor(policy(), 'PRO', source(), long).refusal?.code).toBe('SOURCE_TOO_LONG');
    const off = policy({ disabledBuiltins: ['maxDuration'] });
    expect(verdictFor(off, 'PRO', source(), long).allowed).toBe(true);
  });

  it('a disabled rule does nothing', () => {
    const p = policy({
      rules: [rule({ enabled: false, type: 'block_url_pattern', params: { pattern: '*/shorts/*' } })],
    });
    expect(verdictFor(p, 'FREE', source(), null).allowed).toBe(true);
  });
});
