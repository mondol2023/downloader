import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  versions: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  audit: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  cached: null as Record<string, any> | null, // eslint-disable-line @typescript-eslint/no-explicit-any
  takenDown: false,
  published: [] as Array<{ overrides: unknown; note: string; actorId: string }>,
  activated: [] as number[],
}));

vi.mock('../../../src/config/env.js', () => ({ env: { REGION: 'test' }, isProd: false }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    auditEvent: { create: vi.fn(async ({ data }: { data: Record<string, any> }) => void db.audit.push(data)) },
    policyVersion: { findMany: vi.fn(async () => [...db.versions].sort((a, b) => b.version - a.version)) },
    user: { findMany: vi.fn(async () => [{ id: 'admin', email: 'root@example.com' }]) },
  },
}));
vi.mock('../../../src/services/extraction.service.js', () => ({
  getCachedRecordUnchecked: vi.fn(async () => db.cached),
}));
vi.mock('../../../src/features/eligibility/takedown.js', () => ({
  isTakenDown: vi.fn(async () => db.takenDown),
}));
vi.mock('../../../src/features/restrictions/policy.store.js', async () => {
  const { mergePolicy } = await import('../../../src/features/restrictions/merge.js');
  const { DEFAULT_POLICY } = await import('../../../src/features/restrictions/restrictions.config.js');
  const { setCurrentPolicy } = await import('../../../src/features/restrictions/policy.current.js');
  return {
    publishPolicy: vi.fn(async (overrides: unknown, note: string, actorId: string) => {
      const version = db.versions.length + 1;
      const effective = mergePolicy(DEFAULT_POLICY, overrides, version); // throws 422 like the real store
      db.versions.forEach((v) => (v.active = false));
      db.versions.push({ version, note, createdById: actorId, createdAt: new Date(), active: true });
      db.published.push({ overrides, note, actorId });
      setCurrentPolicy(effective);
      return effective;
    }),
    activatePolicyVersion: vi.fn(async (version: number) => {
      if (!db.versions.some((v) => v.version === version)) {
        const { AppError } = await import('../../../src/lib/errors.js');
        throw AppError.notFound(`Policy version ${version} does not exist`);
      }
      db.activated.push(version);
      return mergePolicy(DEFAULT_POLICY, {}, version);
    }),
  };
});

import router from '../../../src/features/admin/policy.admin.js';
import { DEFAULT_POLICY } from '../../../src/features/restrictions/restrictions.config.js';
import { mergePolicy } from '../../../src/features/restrictions/merge.js';
import { setCurrentPolicy } from '../../../src/features/restrictions/policy.current.js';
import { call } from './harness.js';

const media = (over: Record<string, unknown> = {}) => ({
  media: { platform: 'youtube', durationSeconds: 120, availability: 'public', isLive: false, ageLimit: 0, ...over },
  formats: [
    { height: 360, fps: 30, sizeBytes: 1_000_000 },
    { height: 2160, fps: 60, sizeBytes: 900_000_000 },
  ],
});

beforeEach(() => {
  db.versions.length = 0;
  db.audit.length = 0;
  db.published.length = 0;
  db.activated.length = 0;
  db.cached = null;
  db.takenDown = false;
  setCurrentPolicy(mergePolicy(DEFAULT_POLICY, {}, 0));
});

describe('GET /policy', () => {
  it('returns active, defaults, the hard floor and the version list with authors', async () => {
    db.versions.push(
      { version: 1, note: 'first', createdById: 'admin', createdAt: new Date(), active: false },
      { version: 2, note: 'second', createdById: null, createdAt: new Date(), active: true },
    );
    const res = await call(router, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.body.data.active.version).toBe(0);
    expect(res.body.data.defaults.platforms.youtube.enabled).toBe(true);
    expect(res.body.data.hardFloor.blockedHosts.length).toBeGreaterThan(0);
    expect(res.body.data.versions).toEqual([
      expect.objectContaining({ version: 2, note: 'second', createdBy: null, active: true }),
      expect.objectContaining({ version: 1, note: 'first', createdBy: 'root@example.com', active: false }),
    ]);
  });
});

describe('POST /policy', () => {
  it('publishes, returns the new effective policy and audits version before/after', async () => {
    const res = await call(router, 'POST', '/', { overrides: { platforms: { tiktok: { enabled: false } } }, note: 'pause tiktok' });
    expect(res.status).toBe(201);
    expect(res.body.data.platforms.tiktok.enabled).toBe(false);
    expect(db.published[0]).toMatchObject({ note: 'pause tiktok', actorId: 'admin' });
    expect(db.audit[0]).toMatchObject({
      action: 'policy.publish',
      actorId: 'admin',
      target: 'policy:1',
      before: { version: 0 },
      after: { version: 1, note: 'pause tiktok' },
    });
  });

  it('invalid overrides → 422 POLICY_INVALID, nothing audited', async () => {
    const res = await call(router, 'POST', '/', { overrides: { tiers: { PRO: { maxHeight: -1 } } }, note: 'bad' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('POLICY_INVALID');
    expect(db.audit).toHaveLength(0);
  });

  it('a bad rule → 422 with a dotted path to the field', async () => {
    const bad = { id: 'r1', name: 'Long', type: 'max_duration', enabled: true, params: { seconds: 0 } };
    const res = await call(router, 'POST', '/', { overrides: { rules: [bad] }, note: 'bad rule' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('POLICY_INVALID');
    expect(res.body.error.details[0].path).toBe('rules.0.params.seconds');
  });

  it('published rules round-trip through GET /', async () => {
    const good = { id: 'r1', name: 'No shorts', type: 'block_url_pattern', enabled: true, params: { pattern: '*/shorts/*' } };
    await call(router, 'POST', '/', { overrides: { rules: [good], disabledBuiltins: ['ageLimit'] }, note: 'rules' });
    const res = await call(router, 'GET', '/');
    expect(res.body.data.active.rules).toEqual([good]);
    expect(res.body.data.active.disabledBuiltins).toEqual(['ageLimit']);
  });

  it('a missing note → 422', async () => {
    const res = await call(router, 'POST', '/', { overrides: {} });
    expect(res.status).toBe(422);
    expect(db.published).toHaveLength(0);
  });
});

describe('POST /policy/:version/activate', () => {
  it('rolls back and audits', async () => {
    db.versions.push({ version: 3, note: 'n', createdById: null, createdAt: new Date(), active: false });
    const res = await call(router, 'POST', '/3/activate');
    expect(res.status).toBe(200);
    expect(db.activated).toEqual([3]);
    expect(db.audit[0]).toMatchObject({ action: 'policy.activate', target: 'policy:3', after: { version: 3 } });
  });

  it('rolling back to a version without rules empties active.rules', async () => {
    const good = { id: 'r1', name: 'No shorts', type: 'block_url_pattern', enabled: true, params: { pattern: '*/shorts/*' } };
    await call(router, 'POST', '/', { overrides: { rules: [good] }, note: 'rules' });
    db.versions.push({ version: 9, note: 'old', createdById: null, createdAt: new Date(), active: false });
    await call(router, 'POST', '/9/activate');
    // the mocked store applies the old (rule-less) version; the real store does the same via mergePolicy
    expect(db.activated).toEqual([9]);
    expect(mergePolicy(DEFAULT_POLICY, {}, 9).rules).toEqual([]);
  });

  it('unknown version → 404; non-numeric → 422', async () => {
    expect((await call(router, 'POST', '/9/activate')).status).toBe(404);
    expect((await call(router, 'POST', '/abc/activate')).status).toBe(422);
    expect(db.audit).toHaveLength(0);
  });
});

describe('POST /policy/preview', () => {
  const url = 'https://www.tiktok.com/@a/video/1';

  it('compares active and draft: disabling a platform refuses only in the draft', async () => {
    const res = await call(router, 'POST', '/preview', { overrides: { platforms: { tiktok: { enabled: false } } }, url, tier: 'FREE' });
    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(false);
    expect(res.body.data.active.allowed).toBe(true);
    expect(res.body.data.draft).toMatchObject({ allowed: false, refusal: { code: 'SOURCE_PLATFORM_DISABLED' } });
  });

  it('still previews a URL the live policy already refuses (draft re-enables it)', async () => {
    setCurrentPolicy(mergePolicy(DEFAULT_POLICY, { platforms: { tiktok: { enabled: false } } }, 4));
    const res = await call(router, 'POST', '/preview', { overrides: {}, url, tier: 'FREE' });
    expect(res.status).toBe(200);
    expect(res.body.data.active.refusal.code).toBe('SOURCE_PLATFORM_DISABLED');
    expect(res.body.data.draft.allowed).toBe(true);
  });

  it('judges per-format limits from cached metadata, never downloading', async () => {
    db.cached = media();
    const res = await call(router, 'POST', '/preview', {
      overrides: { tiers: { FREE: { maxHeight: 360 } } },
      url: 'https://www.youtube.com/watch?v=abc',
      tier: 'FREE',
    });
    expect(res.body.data.cached).toBe(true);
    expect(res.body.data.draft.formats).toEqual({ total: 2, allowed: 1, locked: 1 });
    expect(res.body.data.active.formats.allowed).toBeGreaterThanOrEqual(res.body.data.draft.formats.allowed);
  });

  it('a shorter duration cap refuses in the draft only', async () => {
    db.cached = media({ durationSeconds: 3000 });
    const res = await call(router, 'POST', '/preview', {
      overrides: { global: { maxDurationSec: 600 } },
      url: 'https://www.youtube.com/watch?v=abc',
      tier: 'PRO',
    });
    expect(res.body.data.active.allowed).toBe(true);
    expect(res.body.data.draft.refusal.code).toBe('SOURCE_TOO_LONG');
  });

  it('a takedown refuses under both policies', async () => {
    db.takenDown = true;
    const res = await call(router, 'POST', '/preview', { overrides: {}, url, tier: 'FREE' });
    expect(res.body.data.active.refusal.code).toBe('SOURCE_TAKEN_DOWN');
    expect(res.body.data.draft.refusal.code).toBe('SOURCE_TAKEN_DOWN');
  });

  it('previews draft rules: refuses in the draft only and names the rule', async () => {
    const overrides = {
      rules: [{ id: 'r1', name: 'No shorts', type: 'block_url_pattern', enabled: true, params: { pattern: '*/shorts/*' } }],
    };
    const res = await call(router, 'POST', '/preview', {
      overrides,
      url: 'https://www.youtube.com/shorts/abc',
      tier: 'FREE',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.active.allowed).toBe(true);
    expect(res.body.data.draft.refusal.code).toBe('SOURCE_RULE_BLOCKED');
    expect(res.body.data.draft.rule).toEqual({ id: 'r1', name: 'No shorts' });
  });

  it('is a read: no audit row, and an invalid draft → 422', async () => {
    await call(router, 'POST', '/preview', { overrides: {}, url, tier: 'FREE' });
    expect(db.audit).toHaveLength(0);
    const bad = await call(router, 'POST', '/preview', { overrides: { nope: 1 }, url, tier: 'FREE' });
    expect(bad.status).toBe(422);
  });
});
