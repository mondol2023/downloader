/** In-memory stand-ins for Prisma's PolicyVersion table and Redis pub/sub, shared by the policy tests. */

export interface FakeRow {
  id: string;
  version: number;
  overrides: unknown;
  note: string;
  active: boolean;
  createdById: string | null;
  createdAt: Date;
}

export class FakePrisma {
  rows: FakeRow[] = [];
  down = false;

  private guard(): void {
    if (this.down) throw new Error('database is down');
  }

  seed(version: number, overrides: unknown, active = true): void {
    this.rows.push({
      id: `row${version}`,
      version,
      overrides,
      note: 'seed',
      active,
      createdById: null,
      createdAt: new Date(),
    });
  }

  policyVersion = {
    findFirst: async (args?: { where?: { active?: boolean } }) => {
      this.guard();
      const matches = this.rows.filter((r) => args?.where?.active === undefined || r.active === args.where.active);
      return [...matches].sort((a, b) => b.version - a.version)[0] ?? null;
    },
    findUnique: async (args: { where: { version: number } }) => {
      this.guard();
      return this.rows.find((r) => r.version === args.where.version) ?? null;
    },
    count: async () => {
      this.guard();
      return this.rows.length;
    },
    aggregate: async () => {
      this.guard();
      return {
        _max: { version: this.rows.reduce<number | null>((m, r) => (m == null || r.version > m ? r.version : m), null) },
      };
    },
    create: async (args: { data: Partial<FakeRow> & { version: number } }) => {
      this.guard();
      if (this.rows.some((r) => r.version === args.data.version)) throw new Error('unique violation');
      const row: FakeRow = {
        id: `row${args.data.version}`,
        overrides: args.data.overrides ?? {},
        note: args.data.note ?? '',
        active: args.data.active ?? false,
        createdById: args.data.createdById ?? null,
        createdAt: new Date(),
        version: args.data.version,
      };
      this.rows.push(row);
      return row;
    },
    updateMany: async (args: { where: { active?: boolean }; data: { active: boolean } }) => {
      this.guard();
      let count = 0;
      for (const r of this.rows) {
        if (args.where.active === undefined || r.active === args.where.active) {
          r.active = args.data.active;
          count += 1;
        }
      }
      return { count };
    },
    update: async (args: { where: { version: number }; data: { active: boolean } }) => {
      this.guard();
      const row = this.rows.find((r) => r.version === args.where.version);
      if (!row) throw new Error('not found');
      row.active = args.data.active;
      return row;
    },
  };

  async $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> {
    this.guard();
    const snapshot = this.rows.map((r) => ({ ...r }));
    try {
      return await fn(this);
    } catch (err) {
      this.rows = snapshot;
      throw err;
    }
  }
}

type Handler = (channel: string, message: string) => void;

/** One bus = one Redis server. Every client created from it sees the same channels. */
export class FakeRedisBus {
  readonly subscribers = new Set<Handler>();

  client() {
    const subscribers = this.subscribers;
    return {
      async publish(channel: string, message: string) {
        for (const handler of [...subscribers]) handler(channel, message);
        return subscribers.size;
      },
      duplicate() {
        let handler: Handler | null = null;
        return {
          async subscribe() {
            return 1;
          },
          on(event: string, fn: Handler) {
            if (event === 'message') {
              handler = fn;
              subscribers.add(fn);
            }
          },
          async quit() {
            if (handler) subscribers.delete(handler);
            return 'OK';
          },
          disconnect() {
            if (handler) subscribers.delete(handler);
          },
        };
      },
    };
  }
}
