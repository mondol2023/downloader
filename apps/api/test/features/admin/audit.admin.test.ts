import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  events: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
}));

vi.mock('../../../src/config/env.js', () => ({ env: { REGION: 'test' }, isProd: false }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    auditEvent: {
      findMany: vi.fn(async (args: { where: Record<string, any>; take: number; cursor?: { id: string }; skip?: number }) => {
        const { actorId, action } = args.where;
        const sorted = db.events
          .filter((e) => (!actorId || e.actorId === actorId))
          .filter((e) => !action || (typeof action === 'string' ? e.action === action : e.action.startsWith(action.startsWith)))
          .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
        const start = args.cursor ? sorted.findIndex((e) => e.id === args.cursor!.id) + (args.skip ?? 0) : 0;
        return sorted.slice(start, start + args.take);
      }),
    },
  },
}));

import router from '../../../src/features/admin/audit.admin.js';
import { call } from './harness.js';

beforeEach(() => {
  db.events.length = 0;
  const actions = ['policy.publish', 'user.update', 'policy.activate', 'takedown.create', 'user.update'];
  actions.forEach((action, i) =>
    db.events.push({ id: `e${i}`, actorId: i < 3 ? 'a1' : 'a2', action, createdAt: new Date(2026, 0, 1, 0, 0, i) }),
  );
});

describe('GET /audit', () => {
  it('newest first, filtered by actor', async () => {
    const res = await call(router, 'GET', '/?actor=a2');
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((e: { id: string }) => e.id)).toEqual(['e4', 'e3']);
  });

  it('filters by exact action, or by a prefix ending in a dot', async () => {
    expect((await call(router, 'GET', '/?action=user.update')).body.data.items).toHaveLength(2);
    expect((await call(router, 'GET', '/?action=policy.')).body.data.items).toHaveLength(2);
  });

  it('pages with a stable cursor even when a new event lands mid-read', async () => {
    const first = await call(router, 'GET', '/?limit=2');
    expect(first.body.data.items.map((e: { id: string }) => e.id)).toEqual(['e4', 'e3']);
    db.events.push({ id: 'e9', actorId: 'a1', action: 'x', createdAt: new Date(2026, 0, 2) });
    const second = await call(router, 'GET', `/?limit=2&cursor=${first.body.data.nextCursor}`);
    expect(second.body.data.items.map((e: { id: string }) => e.id)).toEqual(['e2', 'e1']);
    const third = await call(router, 'GET', `/?limit=2&cursor=${second.body.data.nextCursor}`);
    expect(third.body.data.items.map((e: { id: string }) => e.id)).toEqual(['e0']);
    expect(third.body.data.nextCursor).toBeNull();
  });

  it('bad limit → 422', async () => {
    expect((await call(router, 'GET', '/?limit=0')).status).toBe(422);
    expect((await call(router, 'GET', '/?limit=1000')).status).toBe(422);
  });
});
