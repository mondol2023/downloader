/* eslint-disable @typescript-eslint/no-explicit-any */
/** In-memory stand-in for the four CMS Prisma models, covering only the calls the CMS code makes. */

type Row = Record<string, any>;

export interface CmsDb {
  pages: Row[];
  revisions: Row[];
  blocks: Row[];
  assets: Row[];
  audit: Row[];
  seq: number;
  clock: number;
}

export function newDb(): CmsDb {
  return { pages: [], revisions: [], blocks: [], assets: [], audit: [], seq: 0, clock: 0 };
}

export function reset(db: CmsDb): void {
  db.pages.length = db.revisions.length = db.blocks.length = db.assets.length = db.audit.length = 0;
  db.seq = db.clock = 0;
}

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) row[k] = row[k] + v.increment;
    else row[k] = v;
  }
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('lte' in v) return row[k] != null && row[k] <= v.lte;
      if ('contains' in v) return String(row[k] ?? '').toLowerCase().includes(String(v.contains).toLowerCase());
      if ('in' in v) return v.in.includes(row[k]);
    }
    return row[k] === v;
  });
}

function page(rows: Row[], args: { where?: Row; take?: number; cursor?: { id: string }; skip?: number }): Row[] {
  const sorted = rows.filter((r) => matches(r, args.where ?? {})).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  const start = args.cursor ? sorted.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
  return sorted.slice(start, args.take ? start + args.take : undefined).map((r) => structuredClone(r));
}

export function makePrisma(db: CmsDb): any {
  const stamp = () => new Date(2026, 0, 1, 0, 0, ++db.clock);
  const prisma: any = {
    auditEvent: { create: async ({ data }: { data: Row }) => void db.audit.push(data) },
    cmsPage: {
      findUnique: async ({ where }: { where: Row }) =>
        structuredClone(db.pages.find((p) => (where.id ? p.id === where.id : p.slug === where.slug)) ?? null),
      findMany: async (args: any) => page(db.pages, args),
      create: async ({ data }: { data: Row }) => {
        if (db.pages.some((p) => p.slug === data.slug)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { id: `p${++db.seq}`, status: 'DRAFT', version: 1, createdAt: stamp(), updatedAt: stamp(), publishAt: null, publishedAt: null, seoTitle: null, seoDescription: null, ogImageId: null, ...data };
        db.pages.push(row);
        return structuredClone(row);
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = db.pages.find((p) => p.id === where.id)!;
        applyData(row, data);
        return structuredClone(row);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = db.pages.filter((p) => matches(p, where));
        rows.forEach((r) => applyData(r, data));
        return { count: rows.length };
      },
      delete: async ({ where }: { where: Row }) => {
        db.pages = db.pages.filter((p) => p.id !== where.id);
      },
    },
    cmsRevision: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `r${++db.seq}`, createdAt: stamp(), ...data };
        db.revisions.push(row);
        return structuredClone(row);
      },
      findMany: async ({ where }: { where: Row }) =>
        db.revisions.filter((r) => matches(r, where)).sort((a, b) => b.version - a.version).map((r) => structuredClone(r)),
      findUnique: async ({ where }: { where: { pageId_version: { pageId: string; version: number } } }) =>
        structuredClone(db.revisions.find((r) => r.pageId === where.pageId_version.pageId && r.version === where.pageId_version.version) ?? null),
    },
    cmsBlock: {
      findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
        db.blocks.filter((b) => where.key.in.includes(b.key)).map((b) => structuredClone(b)),
      upsert: async ({ where, create, update }: { where: { key: string }; create: Row; update: Row }) => {
        let row = db.blocks.find((b) => b.key === where.key);
        if (row) applyData(row, update);
        else db.blocks.push((row = { ...create, updatedAt: stamp() }));
        return structuredClone(row);
      },
    },
    cmsAsset: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `a${++db.seq}`, createdAt: stamp(), ...data };
        db.assets.push(row);
        return structuredClone(row);
      },
      findMany: async (args: any) => page(db.assets, args),
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(prisma),
  };
  return prisma;
}

/** The one database the mocked Prisma client and the tests share. */
export const testDb = newDb();

export const docWith =(text: string, extra: Row = {}) => ({
  type: 'doc',
  content: [{ type: 'paragraph', ...extra, content: [{ type: 'text', text }] }],
});
