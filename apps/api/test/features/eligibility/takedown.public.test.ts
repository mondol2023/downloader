import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, any>> })); // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock('../../../src/config/env.js', () => ({ env: { REGION: 'test' }, isProd: false }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));
vi.mock('../../../src/lib/redis.js', () => ({ keys: {}, redis: {} }));
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    auditEvent: { create: vi.fn(async () => undefined) },
    takedown: {
      findUnique: vi.fn(async ({ where }: { where: { mediaId: string } }) => db.rows.find((r) => r.mediaId === where.mediaId) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => void db.rows.push({ id: `t${db.rows.length + 1}`, ...data })), // eslint-disable-line @typescript-eslint/no-explicit-any
    },
  },
}));

import router from '../../../src/features/eligibility/takedown.public.js';
import { call } from '../admin/harness.js';

const valid = {
  sourceUrl: 'https://www.youtube.com/watch?v=abc123',
  requesterName: 'Ada Rights',
  requesterEmail: 'ada@example.com',
  reason: 'I am the copyright owner of this video and did not license it.',
  goodFaith: true,
};

describe('POST /takedowns (public DMCA intake)', () => {
  beforeEach(() => {
    db.rows.length = 0;
  });

  it('creates a PENDING takedown, never an effective one', async () => {
    const res = await call(router, 'POST', '/', { ...valid, status: 'ACTIVE' });
    expect(res.status).toBe(202);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ status: 'PENDING', requesterEmail: 'ada@example.com' });
    expect(db.rows[0]!.reason).toContain('Ada Rights');
  });

  it('replies identically when the source was already reported, without a second row', async () => {
    const first = await call(router, 'POST', '/', valid);
    const second = await call(router, 'POST', '/', valid);
    expect(second).toEqual(first);
    expect(db.rows).toHaveLength(1);
  });

  it('requires the good-faith statement, a real email and a described reason', async () => {
    expect((await call(router, 'POST', '/', { ...valid, goodFaith: false })).status).toBe(422);
    expect((await call(router, 'POST', '/', { ...valid, requesterEmail: 'nope' })).status).toBe(422);
    expect((await call(router, 'POST', '/', { ...valid, reason: 'too short' })).status).toBe(422);
    expect(db.rows).toHaveLength(0);
  });

  it('refuses private-network sources', async () => {
    const res = await call(router, 'POST', '/', { ...valid, sourceUrl: 'http://169.254.169.254/latest' });
    expect(res.status).toBe(400);
    expect(db.rows).toHaveLength(0);
  });
});
