import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  users: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  audit: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  revoked: [] as string[],
}));

vi.mock('../../../src/config/env.js', () => ({ env: { REGION: 'test' }, isProd: false }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    auditEvent: { create: vi.fn(async ({ data }: { data: Record<string, any> }) => void db.audit.push(data)) },
    refreshToken: { updateMany: vi.fn(async ({ where }: { where: { userId: string } }) => void db.revoked.push(where.userId)) },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => structuredClone(db.users.find((u) => u.id === where.id) ?? null)),
      count: vi.fn(async ({ where }: { where: { role: string } }) =>
        db.users.filter((u) => u.role === where.role && !u.disabledAt).length,
      ),
      findMany: vi.fn(async (args: { where: Record<string, any>; take: number; cursor?: { id: string }; skip?: number }) => {
        const { tier, role, OR } = args.where;
        const needle: string | undefined = OR?.[0]?.email?.contains?.toLowerCase();
        const sorted = db.users
          .filter((u) => (!tier || u.tier === tier) && (!role || u.role === role) && (!needle || u.email.includes(needle)))
          .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
        const start = args.cursor ? sorted.findIndex((u) => u.id === args.cursor!.id) + (args.skip ?? 0) : 0;
        return sorted.slice(start, start + args.take);
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const row = db.users.find((u) => u.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import router from '../../../src/features/admin/users.admin.js';
import { call } from './harness.js';

function user(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@example.com`,
    tier: 'FREE',
    role: 'USER',
    disabledAt: null,
    createdAt: new Date(2026, 0, 1, 0, 0, db.users.length),
    ...over,
  };
}

beforeEach(() => {
  db.audit.length = 0;
  db.revoked.length = 0;
  db.users.length = 0;
  db.users.push(user('admin', { role: 'ADMIN' }), user('admin2', { role: 'ADMIN' }), user('ann'), user('bob', { tier: 'PRO' }));
});

describe('GET /users', () => {
  it('searches by email, filters by tier and role', async () => {
    expect((await call(router, 'GET', '/?q=ANN')).body.data.items.map((u: { id: string }) => u.id)).toEqual(['ann']);
    expect((await call(router, 'GET', '/?tier=PRO')).body.data.items.map((u: { id: string }) => u.id)).toEqual(['bob']);
    expect((await call(router, 'GET', '/?role=ADMIN')).body.data.items).toHaveLength(2);
  });

  it('bad filter → 422', async () => {
    expect((await call(router, 'GET', '/?tier=GOLD')).status).toBe(422);
  });

  it('pages with a stable cursor', async () => {
    const first = await call(router, 'GET', '/?limit=3');
    expect(first.body.data.items).toHaveLength(3);
    db.users.push(user('late')); // arrives mid-pagination
    const second = await call(router, 'GET', `/?limit=3&cursor=${first.body.data.nextCursor}`);
    expect(second.body.data.items.map((u: { id: string }) => u.id)).toEqual(['admin']);
    expect(second.body.data.nextCursor).toBeNull();
  });
});

describe('PATCH /users/:id', () => {
  it('sets tier and role, audits before/after', async () => {
    const res = await call(router, 'PATCH', '/ann', { tier: 'PRO', role: 'EDITOR' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tier: 'PRO', role: 'EDITOR' });
    expect(db.audit[0]).toMatchObject({
      action: 'user.update',
      actorId: 'admin',
      target: 'user:ann',
      before: { tier: 'FREE', role: 'USER' },
      after: { tier: 'PRO', role: 'EDITOR' },
    });
  });

  it('disabling stamps disabledAt and revokes the sessions', async () => {
    const res = await call(router, 'PATCH', '/ann', { disabled: true, disabledReason: 'abuse' });
    expect(res.body.data.disabledAt).toBeTruthy();
    expect(res.body.data.disabledReason).toBe('abuse');
    expect(db.revoked).toEqual(['ann']);
    const back = await call(router, 'PATCH', '/ann', { disabled: false });
    expect(back.body.data.disabledAt).toBeNull();
  });

  it('empty body or unknown value → 422, nothing written', async () => {
    expect((await call(router, 'PATCH', '/ann', {})).status).toBe(422);
    expect((await call(router, 'PATCH', '/ann', { role: 'ROOT' })).status).toBe(422);
    expect(db.audit).toHaveLength(0);
  });

  it('unknown user → 404', async () => {
    expect((await call(router, 'PATCH', '/ghost', { tier: 'PRO' })).status).toBe(404);
  });

  it("an admin can't demote or disable themselves → 409", async () => {
    expect((await call(router, 'PATCH', '/admin', { role: 'USER' }, 'admin')).status).toBe(409);
    expect((await call(router, 'PATCH', '/admin', { disabled: true }, 'admin')).status).toBe(409);
    expect(db.audit).toHaveLength(0);
  });

  it('the last admin cannot be demoted → 409', async () => {
    db.users.splice(1, 1); // drop admin2
    const res = await call(router, 'PATCH', '/admin', { role: 'USER' }, 'ann');
    expect(res.status).toBe(409);
  });

  it('never returns the password hash', async () => {
    db.users[2]!.passwordHash = 'secret';
    // The fake ignores `select`, so assert the route asks for the safe projection instead.
    const { prisma } = await import('../../../src/lib/prisma.js');
    await call(router, 'GET', '/');
    const args = (prisma.user.findMany as any).mock.calls.at(-1)[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(args.select.passwordHash).toBeUndefined();
    expect(args.select.stripeCustomerId).toBeUndefined();
    expect(args.select.email).toBe(true);
  });
});
