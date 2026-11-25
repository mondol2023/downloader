import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakePrisma, FakeRedisBus } from './fakes.js';

vi.mock('../../../src/config/env.js', () => ({ env: { BLOCKED_HOSTS_EXTRA: [] as string[] } }));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const recordAudit = vi.fn(async (_input: unknown) => undefined);
vi.mock('../../../src/services/user.service.js', () => ({ recordAudit }));

const { createPolicyStore } = await import('../../../src/features/restrictions/policy.store.js');
const { DEFAULT_POLICY } = await import('../../../src/features/restrictions/restrictions.config.js');
const { AppError } = await import('../../../src/lib/errors.js');

let dir: string;
let snapshotPath: string;
const stores: Array<{ stop(): Promise<void> }> = [];

function build(prisma: FakePrisma, bus = new FakeRedisBus(), extra: { seedBlockedHosts?: string[] } = {}) {
  const store = createPolicyStore({
    prisma: prisma as never,
    redis: bus.client() as never,
    snapshotPath,
    pollMs: 0,
    ...extra,
  });
  stores.push(store);
  return store;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'policy-'));
  snapshotPath = path.join(dir, 'policy.snapshot.json');
  recordAudit.mockClear();
});

afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.stop()));
  await rm(dir, { recursive: true, force: true });
});

describe('policy store boot', () => {
  it('boot with DB down and snapshot present → snapshot policy', async () => {
    await writeFile(
      snapshotPath,
      JSON.stringify({
        version: 7,
        overrides: { global: { maintenanceMode: true, maintenanceMessage: 'from snapshot' } },
      }),
    );
    const prisma = new FakePrisma();
    prisma.down = true;
    const store = build(prisma);
    await store.start();
    expect(store.getPolicy().version).toBe(7);
    expect(store.getPolicy().global.maintenanceMessage).toBe('from snapshot');
    expect(store.getPolicy().global.maintenanceMode).toBe(true);
  });

  it('boot with DB down and no snapshot → DEFAULT_POLICY, never {}', async () => {
    const prisma = new FakePrisma();
    prisma.down = true;
    const store = build(prisma);
    await store.start();
    const policy = store.getPolicy();
    expect(policy.global).toEqual(DEFAULT_POLICY.global);
    expect(policy.tiers).toEqual(DEFAULT_POLICY.tiers);
    expect(policy.platforms).toEqual(DEFAULT_POLICY.platforms);
    expect(policy.hardFloor.blockedHosts.length).toBeGreaterThan(0);
  });

  it('an unparsable snapshot is ignored in favour of the defaults', async () => {
    await writeFile(snapshotPath, '{not json');
    const prisma = new FakePrisma();
    prisma.down = true;
    const store = build(prisma);
    await store.start();
    expect(store.getPolicy().global).toEqual(DEFAULT_POLICY.global);
  });

  it('boot with an active version in the DB uses it', async () => {
    const prisma = new FakePrisma();
    prisma.seed(3, { tiers: { FREE: { dailyDownloads: 1 } } });
    const store = build(prisma);
    await store.start();
    expect(store.getPolicy().version).toBe(3);
    expect(store.getPolicy().tiers.FREE.dailyDownloads).toBe(1);
    expect(store.getPolicy().tiers.FREE.maxHeight).toBe(DEFAULT_POLICY.tiers.FREE.maxHeight);
  });

  it('an invalid stored version is not used: falls back to the defaults', async () => {
    const prisma = new FakePrisma();
    prisma.seed(2, { platforms: { netflix: { enabled: true } } });
    const store = build(prisma);
    await store.start();
    expect(store.getPolicy().global).toEqual(DEFAULT_POLICY.global);
  });
});

describe('publishPolicy', () => {
  it('publishPolicy invalid → 422, active version unchanged', async () => {
    const prisma = new FakePrisma();
    const store = build(prisma);
    await store.start();
    const first = await store.publish({ global: { maintenanceMode: true } }, 'maintenance', 'admin1');
    expect(first.version).toBe(1);

    await expect(
      store.publish({ global: { extraBlockedHosts: ['not a host'] } }, 'bad', 'admin1'),
    ).rejects.toMatchObject({ status: 422, code: 'POLICY_INVALID' });
    await expect(store.publish({ hardFloor: { refuse: [] } }, 'sneaky', 'admin1')).rejects.toBeInstanceOf(AppError);

    expect(store.getPolicy().version).toBe(1);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows.filter((r) => r.active).map((r) => r.version)).toEqual([1]);
  });

  it('publish deactivates the old version, writes a snapshot and an audit event', async () => {
    const prisma = new FakePrisma();
    const store = build(prisma);
    await store.start();
    await store.publish({ global: { maintenanceMode: true } }, 'one', 'admin1');
    const second = await store.publish({ tiers: { FREE: { dailyDownloads: 1 } } }, 'two', 'admin2');

    expect(second.version).toBe(2);
    expect(prisma.rows.filter((r) => r.active).map((r) => r.version)).toEqual([2]);
    expect(prisma.rows[1]).toMatchObject({ note: 'two', createdById: 'admin2' });
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expect(snapshot.version).toBe(2);
    expect(snapshot.overrides).toEqual({ tiers: { FREE: { dailyDownloads: 1 } } });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin2', action: 'policy.publish' }));
  });

  it('publish → a second store instance on the same Redis sees the new version', async () => {
    const prisma = new FakePrisma();
    const bus = new FakeRedisBus();
    const a = build(prisma, bus);
    const b = build(prisma, bus);
    await a.start();
    await b.start();
    expect(b.getPolicy().version).toBe(0);

    await a.publish({ platforms: { tiktok: { enabled: false } } }, 'disable tiktok', 'admin1');

    await vi.waitFor(() => expect(b.getPolicy().version).toBe(1));
    expect(b.getPolicy().platforms.tiktok.enabled).toBe(false);
  });
});

describe('activatePolicyVersion (rollback)', () => {
  it('re-activates an older version everywhere', async () => {
    const prisma = new FakePrisma();
    const bus = new FakeRedisBus();
    const a = build(prisma, bus);
    const b = build(prisma, bus);
    await a.start();
    await b.start();
    await a.publish({ global: { maintenanceMode: true } }, 'v1', 'admin1');
    await a.publish({}, 'v2', 'admin1');
    expect(a.getPolicy().global.maintenanceMode).toBe(false);

    const rolled = await a.activate(1, 'admin1');
    expect(rolled.version).toBe(1);
    expect(a.getPolicy().global.maintenanceMode).toBe(true);
    await vi.waitFor(() => expect(b.getPolicy().version).toBe(1));
    expect(prisma.rows.filter((r) => r.active).map((r) => r.version)).toEqual([1]);
  });

  it('stop() waits for an in-flight refresh to finish its snapshot write', async () => {
    const prisma = new FakePrisma();
    const bus = new FakeRedisBus();
    const a = build(prisma, bus);
    const bPath = path.join(dir, 'b.snapshot.json');
    const b = createPolicyStore({ prisma: prisma as never, redis: bus.client() as never, snapshotPath: bPath, pollMs: 0 });
    await a.start();
    await b.start();
    await a.publish({ global: { maintenanceMode: true } }, 'v1', 'admin1');

    await b.stop();

    expect(JSON.parse(await readFile(bPath, 'utf8')).version).toBe(1);
  });

  it('unknown version → 404 and nothing changes', async () => {
    const prisma = new FakePrisma();
    const store = build(prisma);
    await store.start();
    await expect(store.activate(99, 'admin1')).rejects.toMatchObject({ status: 404 });
    expect(store.getPolicy().version).toBe(0);
  });
});

describe('first boot seeding', () => {
  it('seeds extraBlockedHosts from BLOCKED_HOSTS_EXTRA when no versions exist', async () => {
    const prisma = new FakePrisma();
    const store = build(prisma, new FakeRedisBus(), { seedBlockedHosts: ['Bad.example.com'] });
    await store.start();
    expect(store.getPolicy().version).toBe(1);
    expect(store.getPolicy().global.extraBlockedHosts).toEqual(['bad.example.com']);
    expect(prisma.rows).toHaveLength(1);
  });

  it('does not seed when versions already exist', async () => {
    const prisma = new FakePrisma();
    prisma.seed(4, {});
    const store = build(prisma, new FakeRedisBus(), { seedBlockedHosts: ['bad.example.com'] });
    await store.start();
    expect(store.getPolicy().version).toBe(4);
    expect(store.getPolicy().global.extraBlockedHosts).toEqual([]);
    expect(prisma.rows).toHaveLength(1);
  });

  it('keeps blocking the configured hosts when the DB is down at boot', async () => {
    const prisma = new FakePrisma();
    prisma.down = true;
    const store = build(prisma, new FakeRedisBus(), { seedBlockedHosts: ['bad.example.com'] });
    await store.start();
    expect(store.getPolicy().global.extraBlockedHosts).toEqual(['bad.example.com']);
  });
});
