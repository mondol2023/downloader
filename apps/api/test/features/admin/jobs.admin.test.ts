import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  audit: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  queued: new Set<string>(),
  cancelFlags: [] as string[],
  released: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
}));

vi.mock('../../../src/config/env.js', () => ({ env: { REGION: 'test' }, isProd: false }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));
vi.mock('../../../src/queue/queues.js', () => ({
  removeQueuedJob: vi.fn(async (id: string) => db.queued.delete(id)),
}));
vi.mock('../../../src/services/job.service.js', () => ({
  TERMINAL_STATES: ['COMPLETED', 'FAILED', 'CANCELLED'],
  requestCancellation: vi.fn(async (id: string) => void db.cancelFlags.push(id)),
}));
vi.mock('../../../src/services/quota.service.js', () => ({
  release: vi.fn(async (r: Record<string, any>) => void db.released.push(r)),
}));
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    auditEvent: { create: vi.fn(async ({ data }: { data: Record<string, any> }) => void db.audit.push(data)) },
    job: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => structuredClone(db.jobs.find((j) => j.id === where.id) ?? null)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => db.jobs.find((j) => j.id === where.id)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const row = db.jobs.find((j) => j.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      findMany: vi.fn(async (args: { where: { state?: string }; take: number; cursor?: { id: string }; skip?: number }) => {
        const sorted = db.jobs
          .filter((j) => !args.where.state || j.state === args.where.state)
          .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
        const start = args.cursor ? sorted.findIndex((j) => j.id === args.cursor!.id) + (args.skip ?? 0) : 0;
        return sorted.slice(start, start + args.take);
      }),
    },
  },
}));

import router from '../../../src/features/admin/jobs.admin.js';
import { call } from './harness.js';

function job(id: string, state: string, over: Record<string, unknown> = {}) {
  return { id, state, userId: 'u1', guestKey: null, region: null, createdAt: new Date(2026, 0, 1, 0, 0, db.jobs.length), ...over };
}

beforeEach(() => {
  db.jobs.length = 0;
  db.audit.length = 0;
  db.queued.clear();
  db.cancelFlags.length = 0;
  db.released.length = 0;
  db.jobs.push(job('j1', 'QUEUED'), job('j2', 'DOWNLOADING'), job('j3', 'COMPLETED'), job('j4', 'QUEUED', { userId: null, guestKey: 'g9' }));
});

describe('GET /jobs', () => {
  it('lists newest first and filters by state', async () => {
    expect((await call(router, 'GET', '/')).body.data.items.map((j: { id: string }) => j.id)).toEqual(['j4', 'j3', 'j2', 'j1']);
    expect((await call(router, 'GET', '/?state=QUEUED')).body.data.items.map((j: { id: string }) => j.id)).toEqual(['j4', 'j1']);
  });

  it('unknown state → 422', async () => {
    expect((await call(router, 'GET', '/?state=BOGUS')).status).toBe(422);
  });

  it('cursor pages stay stable when a job is enqueued mid-read', async () => {
    const first = await call(router, 'GET', '/?limit=2');
    db.jobs.push(job('j9', 'QUEUED'));
    const second = await call(router, 'GET', `/?limit=2&cursor=${first.body.data.nextCursor}`);
    expect(second.body.data.items.map((j: { id: string }) => j.id)).toEqual(['j2', 'j1']);
    expect(second.body.data.nextCursor).toBeNull();
  });

  it('selects no BigInt or artifact columns', async () => {
    const { prisma } = await import('../../../src/lib/prisma.js');
    await call(router, 'GET', '/');
    const args = (prisma.job.findMany as any).mock.calls.at(-1)[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const col of ['totalBytes', 'downloadedBytes', 'artifactBytes', 'artifactPath', 'guestKey']) {
      expect(args.select[col]).toBeUndefined();
    }
  });
});

describe('POST /jobs/:id/cancel', () => {
  it('a queued job is removed, marked CANCELLED, its allowance given back, and the action audited', async () => {
    db.queued.add('j1');
    const res = await call(router, 'POST', '/j1/cancel', undefined, 'boss');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('CANCELLED');
    expect(db.cancelFlags).toEqual(['j1']);
    expect(db.released).toEqual([{ id: 'j1', subject: 'user:u1', ipSubject: null }]);
    expect(db.audit[0]).toMatchObject({
      action: 'job.cancel',
      actorId: 'boss',
      target: 'job:j1',
      before: { state: 'QUEUED' },
    });
  });

  it('a running job only gets the cancel flag; the worker finishes the cancel', async () => {
    const res = await call(router, 'POST', '/j2/cancel');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('DOWNLOADING');
    expect(db.cancelFlags).toEqual(['j2']);
    expect(db.released).toHaveLength(0);
  });

  it('a guest job releases the guest subject', async () => {
    db.queued.add('j4');
    await call(router, 'POST', '/j4/cancel');
    expect(db.released[0]?.subject).toBe('guest:g9');
  });

  it('finished job → 409, unknown job → 404, neither audited', async () => {
    expect((await call(router, 'POST', '/j3/cancel')).status).toBe(409);
    expect((await call(router, 'POST', '/nope/cancel')).status).toBe(404);
    expect(db.audit).toHaveLength(0);
  });
});
