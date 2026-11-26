import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  users: new Map<string, { role: string; disabledAt: Date | null }>(),
}));

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.users.get(where.id) ?? null),
      count: vi.fn(async ({ where }: { where: { role: string; disabledAt: null } }) =>
        [...db.users.values()].filter((u) => u.role === where.role && !u.disabledAt).length,
      ),
    },
  },
}));

import { AppError } from '../../../src/lib/errors.js';
import { assertCanChangeUser, requireRole } from '../../../src/features/admin/require-role.js';

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code } });
    return;
  }
  res.status(500).json({ error: { code: 'INTERNAL' } });
};

/** Tiny app: identity comes from the `x-user` header, mimicking attachIdentity. */
function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    const id = req.header('x-user');
    (req as unknown as { identity: unknown }).identity = { userId: id ?? null };
    next();
  });
  app.get('/admin/policy', requireRole('ADMIN'), (_req, res) => res.json({ ok: true }));
  app.get('/admin/cms/pages', requireRole('ADMIN', 'EDITOR'), (_req, res) => res.json({ ok: true }));
  app.use(onError);
  return app;
}

async function call(path: string, user?: string): Promise<{ status: number; code?: string }> {
  const server = makeApp().listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: user ? { 'x-user': user } : {} });
    const body = (await res.json()) as { error?: { code: string } };
    return { status: res.status, code: body.error?.code };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  db.users.clear();
  db.users.set('user', { role: 'USER', disabledAt: null });
  db.users.set('editor', { role: 'EDITOR', disabledAt: null });
  db.users.set('admin', { role: 'ADMIN', disabledAt: null });
  db.users.set('admin2', { role: 'ADMIN', disabledAt: null });
});

describe('requireRole', () => {
  it('anonymous → 401', async () => {
    expect((await call('/admin/policy')).status).toBe(401);
  });

  it('USER → 403', async () => {
    expect(await call('/admin/policy', 'user')).toEqual({ status: 403, code: 'FORBIDDEN' });
  });

  it('EDITOR on /admin/policy → 403', async () => {
    expect((await call('/admin/policy', 'editor')).status).toBe(403);
  });

  it('EDITOR on /admin/cms/pages → 200', async () => {
    expect((await call('/admin/cms/pages', 'editor')).status).toBe(200);
  });

  it('ADMIN can use everything', async () => {
    expect((await call('/admin/policy', 'admin')).status).toBe(200);
  });

  it('demoted mid-session → next request 403', async () => {
    expect((await call('/admin/policy', 'admin')).status).toBe(200);
    db.users.set('admin', { role: 'USER', disabledAt: null });
    expect((await call('/admin/policy', 'admin')).status).toBe(403);
  });

  it('disabled user → 403 ACCOUNT_DISABLED', async () => {
    db.users.set('admin', { role: 'ADMIN', disabledAt: new Date() });
    expect(await call('/admin/policy', 'admin')).toEqual({ status: 403, code: 'ACCOUNT_DISABLED' });
  });

  it('deleted user → 401', async () => {
    expect((await call('/admin/policy', 'ghost')).status).toBe(401);
  });
});

describe('assertCanChangeUser', () => {
  it('admin cannot demote themselves', async () => {
    await expect(assertCanChangeUser({ actorId: 'admin', targetId: 'admin', role: 'EDITOR' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('admin cannot disable themselves', async () => {
    await expect(assertCanChangeUser({ actorId: 'admin', targetId: 'admin', disable: true })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('last admin cannot be demoted → 409', async () => {
    db.users.delete('admin2');
    await expect(assertCanChangeUser({ actorId: 'editor', targetId: 'admin', role: 'USER' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('last admin cannot be disabled → 409', async () => {
    db.users.delete('admin2');
    await expect(assertCanChangeUser({ actorId: 'editor', targetId: 'admin', disable: true })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('another admin can demote an admin when two exist', async () => {
    await expect(
      assertCanChangeUser({ actorId: 'admin2', targetId: 'admin', role: 'USER' }),
    ).resolves.toBeUndefined();
  });

  it('promoting a user is allowed', async () => {
    await expect(assertCanChangeUser({ actorId: 'admin', targetId: 'user', role: 'EDITOR' })).resolves.toBeUndefined();
  });
});
