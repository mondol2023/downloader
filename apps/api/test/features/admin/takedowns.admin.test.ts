import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  takedowns: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  audit: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  deleted: [] as string[],
  seq: 0,
}));

vi.mock('../../../src/config/env.js', () => ({ env: { REGION: 'test' }, isProd: false }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));
vi.mock('../../../src/lib/redis.js', () => ({
  keys: { extraction: (id: string) => `media:extract:${id}` },
  redis: { del: vi.fn(async (key: string) => void db.deleted.push(key)) },
}));
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    auditEvent: { create: vi.fn(async ({ data }: { data: Record<string, any> }) => void db.audit.push(data)) },
    takedown: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; mediaId?: string } }) =>
        structuredClone(db.takedowns.find((t) => (where.id ? t.id === where.id : t.mediaId === where.mediaId)) ?? null),
      ),
      findMany: vi.fn(async (args: { where: { status?: string }; take: number; cursor?: { id: string }; skip?: number }) => {
        const sorted = db.takedowns
          .filter((t) => !args.where.status || t.status === args.where.status)
          .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
        const start = args.cursor ? sorted.findIndex((t) => t.id === args.cursor!.id) + (args.skip ?? 0) : 0;
        return sorted.slice(start, start + args.take);
      }),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const row = { id: `t${++db.seq}`, createdAt: new Date(2026, 0, 1, 0, 0, db.seq), ...data };
        db.takedowns.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const row = db.takedowns.find((t) => t.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import router from '../../../src/features/admin/takedowns.admin.js';
import { call } from './harness.js';

const URL1 = 'https://www.youtube.com/watch?v=abc123';

beforeEach(() => {
  db.takedowns.length = 0;
  db.audit.length = 0;
  db.deleted.length = 0;
  db.seq = 0;
});

describe('POST /takedowns', () => {
  it('creates a PENDING takedown keyed on the normalised media id and writes an audit row', async () => {
    const res = await call(router, 'POST', '/', { sourceUrl: `${URL1}&utm_source=x`, reason: 'DMCA #1', requesterEmail: 'a@b.co' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', reason: 'DMCA #1', requesterEmail: 'a@b.co' });
    expect(res.body.data.mediaId).toMatch(/^[0-9a-f]{24}$/);
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toMatchObject({ action: 'takedown.create', actorId: 'admin', target: `takedown:${res.body.data.id}` });
  });

  it('an ACTIVE takedown drops the cached record straight away', async () => {
    const res = await call(router, 'POST', '/', { sourceUrl: URL1, reason: 'r', status: 'ACTIVE' });
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', decidedById: 'admin' });
    expect(db.deleted).toEqual([`media:extract:${res.body.data.mediaId}`]);
  });

  it('works even for a platform the live policy has switched off', async () => {
    const res = await call(router, 'POST', '/', { sourceUrl: 'https://www.tiktok.com/@a/video/1', reason: 'r' });
    expect(res.status).toBe(201);
  });

  it('validation → 422, nothing written', async () => {
    const res = await call(router, 'POST', '/', { sourceUrl: URL1 });
    expect(res.status).toBe(422);
    expect(db.takedowns).toHaveLength(0);
    expect(db.audit).toHaveLength(0);
  });

  it('a second takedown for the same source → 409', async () => {
    await call(router, 'POST', '/', { sourceUrl: URL1, reason: 'r' });
    const res = await call(router, 'POST', '/', { sourceUrl: `${URL1}&utm_medium=y`, reason: 'again' });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /takedowns/:id', () => {
  it('approve → ACTIVE, records the decider, audits before/after, drops the cache', async () => {
    const created = await call(router, 'POST', '/', { sourceUrl: URL1, reason: 'r' });
    db.audit.length = 0;
    const res = await call(router, 'PATCH', `/${created.body.data.id}`, { status: 'ACTIVE' }, 'boss');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', decidedById: 'boss' });
    expect(db.audit[0]).toMatchObject({
      action: 'takedown.approve',
      actorId: 'boss',
      before: { status: 'PENDING' },
      after: { status: 'ACTIVE' },
    });
    expect(db.deleted).toHaveLength(1);
  });

  it('reject → REJECTED', async () => {
    const created = await call(router, 'POST', '/', { sourceUrl: URL1, reason: 'r' });
    const res = await call(router, 'PATCH', `/${created.body.data.id}`, { status: 'REJECTED' });
    expect(res.body.data.status).toBe('REJECTED');
    expect(db.audit.at(-1)?.action).toBe('takedown.reject');
  });

  it('unknown id → 404; same status → 409; bad status → 422', async () => {
    expect((await call(router, 'PATCH', '/nope', { status: 'ACTIVE' })).status).toBe(404);
    const created = await call(router, 'POST', '/', { sourceUrl: URL1, reason: 'r', status: 'ACTIVE' });
    expect((await call(router, 'PATCH', `/${created.body.data.id}`, { status: 'ACTIVE' })).status).toBe(409);
    expect((await call(router, 'PATCH', `/${created.body.data.id}`, { status: 'PENDING' })).status).toBe(422);
  });
});

describe('GET /takedowns', () => {
  it('filters by status and pages with a stable cursor', async () => {
    for (let i = 1; i <= 5; i++) {
      await call(router, 'POST', '/', { sourceUrl: `https://vimeo.com/${i}`, reason: `r${i}`, status: i % 2 ? 'ACTIVE' : 'PENDING' });
    }
    const active = await call(router, 'GET', '/?status=ACTIVE');
    expect(active.body.data.items).toHaveLength(3);

    const first = await call(router, 'GET', '/?limit=2');
    expect(first.body.data.items.map((t: { reason: string }) => t.reason)).toEqual(['r5', 'r4']);
    expect(first.body.data.nextCursor).toBe(first.body.data.items[1].id);

    // A new row arrives between pages: the next page must not shift or repeat.
    await call(router, 'POST', '/', { sourceUrl: 'https://vimeo.com/99', reason: 'r99' });
    const second = await call(router, 'GET', `/?limit=2&cursor=${first.body.data.nextCursor}`);
    expect(second.body.data.items.map((t: { reason: string }) => t.reason)).toEqual(['r3', 'r2']);
    const third = await call(router, 'GET', `/?limit=2&cursor=${second.body.data.nextCursor}`);
    expect(third.body.data.items.map((t: { reason: string }) => t.reason)).toEqual(['r1']);
    expect(third.body.data.nextCursor).toBeNull();
  });

  it('a read writes no audit row', async () => {
    await call(router, 'GET', '/');
    expect(db.audit).toHaveLength(0);
  });
});
