import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Download jobs run in the user's region: per-region media queue, and cancellation finds both. */

const stores = new Map<string, Map<string, { state: string; remove: () => Promise<void> }>>();
const added: Array<{ queue: string; id: string }> = [];

function store(name: string) {
  let s = stores.get(name);
  if (!s) stores.set(name, (s = new Map()));
  return s;
}

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(private name: string) {
      if (name.includes(':')) throw new Error('Queue name cannot contain :');
      store(name);
    }
    on() {
      return this;
    }
    async add(_n: string, data: { jobId: string }, opts: { jobId: string }) {
      added.push({ queue: this.name, id: opts.jobId });
      const s = store(this.name);
      s.set(opts.jobId, { state: 'waiting', remove: async () => void s.delete(opts.jobId) });
      void data;
    }
    async getJob(id: string) {
      const j = store(this.name).get(id);
      return j ? { getState: async () => j.state, remove: j.remove } : undefined;
    }
    async close() {}
  },
}));
vi.mock('../../../src/lib/redis.js', () => ({
  createQueueConnection: () => ({ quit: async () => undefined }),
}));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { enqueueMediaJob, removeQueuedJob } = await import('../../../src/queue/queues.js');

const payload = (jobId: string) =>
  ({ jobId, tier: 'FREE', subject: 's', userId: null, guestKey: 'g', mediaId: 'm', sourceUrl: 'u',
    formatId: 'f', embedSubtitles: false, ipHash: 'h', userAgent: null }) as never;

beforeEach(() => {
  stores.clear();
  added.length = 0;
});

describe('regional media queue', () => {
  it('no region or the default region keeps media-jobs', async () => {
    await enqueueMediaJob(payload('a'));
    await enqueueMediaJob(payload('b'), 'default');
    await enqueueMediaJob(payload('c'), null);
    expect(added.map((a) => a.queue)).toEqual(['media-jobs', 'media-jobs', 'media-jobs']);
  });

  it('a regional job goes to its own per-region queue', async () => {
    await enqueueMediaJob(payload('d'), 'bd');
    expect(added).toEqual([{ queue: 'media-jobs-bd', id: 'd' }]);
  });

  it('cancellation removes a queued job from either queue', async () => {
    await enqueueMediaJob(payload('r'), 'bd');
    await enqueueMediaJob(payload('m'));
    expect(await removeQueuedJob('r', 'bd')).toBe(true);
    expect(await removeQueuedJob('m', null)).toBe(true);
    // A row that names a region but whose job sits on the main queue is still found.
    await enqueueMediaJob(payload('x'));
    expect(await removeQueuedJob('x', 'bd')).toBe(true);
    expect(await removeQueuedJob('nope', 'bd')).toBe(false);
  });

  it('an active job is not removed', async () => {
    await enqueueMediaJob(payload('act'), 'bd');
    store('media-jobs-bd').get('act')!.state = 'active';
    expect(await removeQueuedJob('act', 'bd')).toBe(false);
  });
});
