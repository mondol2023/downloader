/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Router } from 'express';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ dir: '' }));

vi.mock('../../../src/config/env.js', () => ({
  env: {
    REGION: 'test',
    NODE_ENV: 'test',
    API_PUBLIC_URL: 'http://api.test',
    CMS_ASSET_ORIGIN: 'http://api.test/api/v1/cms/assets',
    CMS_MAX_UPLOAD_MB: 1,
    get STORAGE_DIR() {
      return store.dir;
    },
  },
  isProd: false,
}));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));
vi.mock('../../../src/features/persistence/index.js', () => ({
  requireDatabase: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../../src/lib/prisma.js', async () => {
  const f = await import('./fakes.js');
  return { prisma: f.makePrisma(f.testDb) };
});

import cmsAdmin from '../../../src/features/cms/cms.admin.js';
import cmsPublic from '../../../src/features/cms/cms.public.js';
import { publishDuePages } from '../../../src/features/cms/cms.publisher.js';
import { call, makeApp } from '../admin/harness.js';
import { docWith, reset, testDb } from './fakes.js';

const router = Router();
router.use('/admin', cmsAdmin);
router.use('/public', cmsPublic);

const create = (slug: string, text = 'hello') =>
  call(router, 'POST', '/admin/pages', { slug, title: slug.toUpperCase(), contentJson: docWith(text) });

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = makeApp(router).listen(0);
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

function upload(bytes: Buffer, filename: string, alt?: string) {
  return withServer(async (base) => {
    const form = new FormData();
    if (alt !== undefined) form.set('alt', alt);
    form.set('file', new Blob([new Uint8Array(bytes)]), filename);
    const res = await fetch(`${base}/admin/assets`, { method: 'POST', body: form });
    return { status: res.status, body: (await res.json()) as any };
  });
}

beforeEach(() => {
  reset(testDb);
  store.dir = mkdtempSync(path.join(tmpdir(), 'cms-'));
});

describe('pages', () => {
  it('creates a page with a first revision and sanitised html', async () => {
    const r = await create('about', 'hi');
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ slug: 'about', version: 1, status: 'DRAFT', contentHtml: '<p>hi</p>' });
    expect(testDb.revisions).toHaveLength(1);
  });

  it('rejects a duplicate slug and a bad slug', async () => {
    await create('about');
    expect((await create('about')).status).toBe(409);
    expect((await create('Bad Slug')).status).toBe(422);
  });

  it('neutralises hostile content in a stored document', async () => {
    const r = await call(router, 'POST', '/admin/pages', {
      slug: 'x',
      title: 'x',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
          { type: 'image', attrs: { src: 'https://evil.test/x.png', alt: 'x' } },
        ],
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.data.contentHtml).not.toMatch(/javascript:|evil\.test|onerror/i);
    expect(r.body.data.contentHtml).toContain('click');
  });

  it('PATCH with a stale version returns 409 CMS_CONFLICT and changes nothing', async () => {
    const id = (await create('about', 'one')).body.data.id;
    const ok = await call(router, 'PATCH', `/admin/pages/${id}`, { version: 1, contentJson: docWith('two') });
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(2);
    const stale = await call(router, 'PATCH', `/admin/pages/${id}`, { version: 1, contentJson: docWith('three') });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CMS_CONFLICT');
    expect(testDb.pages[0]!.contentHtml).toBe('<p>two</p>');
    expect(testDb.revisions).toHaveLength(2);
  });

  it('PATCH on a missing page is 404', async () => {
    expect((await call(router, 'PATCH', '/admin/pages/nope', { version: 1, title: 'x' })).status).toBe(404);
  });

  it('publish makes the page public; draft and unpublished pages are 404', async () => {
    const id = (await create('about', 'live')).body.data.id;
    expect((await call(router, 'GET', '/public/pages/about')).status).toBe(404);
    expect((await call(router, 'POST', `/admin/pages/${id}/publish`)).status).toBe(200);
    const pub = await call(router, 'GET', '/public/pages/about');
    expect(pub.status).toBe(200);
    expect(pub.body.data).toMatchObject({ title: 'ABOUT', html: '<p>live</p>' });
    await call(router, 'POST', `/admin/pages/${id}/unpublish`);
    expect((await call(router, 'GET', '/public/pages/about')).status).toBe(404);
  });

  it('schedule needs a future time; the publisher flips due pages only', async () => {
    const id = (await create('later')).body.data.id;
    expect((await call(router, 'POST', `/admin/pages/${id}/schedule`, { publishAt: '2000-01-01T00:00:00Z' })).status).toBe(422);
    const at = new Date(Date.now() + 3_600_000);
    const sched = await call(router, 'POST', `/admin/pages/${id}/schedule`, { publishAt: at.toISOString() });
    expect(sched.body.data.status).toBe('SCHEDULED');
    expect((await call(router, 'GET', '/public/pages/later')).status).toBe(404);
    expect(await publishDuePages(new Date())).toBe(0);
    expect(await publishDuePages(new Date(at.getTime() + 1))).toBe(1);
    expect((await call(router, 'GET', '/public/pages/later')).status).toBe(200);
  });

  it('restoring revision 2 restores its content and bumps the version', async () => {
    const id = (await create('about', 'v1')).body.data.id;
    await call(router, 'PATCH', `/admin/pages/${id}`, { version: 1, contentJson: docWith('v2') });
    await call(router, 'PATCH', `/admin/pages/${id}`, { version: 2, contentJson: docWith('v3') });
    const rev2 = testDb.revisions.find((r) => r.version === 2)!;
    const r = await call(router, 'POST', `/admin/pages/${id}/revisions/2/restore`);
    expect(r.status).toBe(200);
    expect(r.body.data.version).toBe(4);
    expect(r.body.data.contentJson).toEqual(rev2.contentJson);
    expect(r.body.data.contentHtml).toBe('<p>v2</p>');
    const list = await call(router, 'GET', `/admin/pages/${id}/revisions`);
    expect(list.body.data.items.map((x: any) => x.version)).toEqual([4, 3, 2, 1]);
    expect((await call(router, 'POST', `/admin/pages/${id}/revisions/99/restore`)).status).toBe(404);
  });

  it('DELETE archives, hiding the page publicly but keeping history', async () => {
    const id = (await create('about')).body.data.id;
    await call(router, 'POST', `/admin/pages/${id}/publish`);
    expect((await call(router, 'DELETE', `/admin/pages/${id}`)).body.data.status).toBe('ARCHIVED');
    expect((await call(router, 'GET', '/public/pages/about')).status).toBe(404);
    expect(testDb.revisions).toHaveLength(1);
  });

  it('lists with a keyset cursor and writes audit rows', async () => {
    for (const s of ['a', 'b', 'c']) await create(s);
    const first = await call(router, 'GET', '/admin/pages?limit=2');
    expect(first.body.data.items).toHaveLength(2);
    const next = await call(router, 'GET', `/admin/pages?limit=2&cursor=${first.body.data.nextCursor}`);
    expect(next.body.data.items).toHaveLength(1);
    expect(testDb.audit.map((a) => a.action)).toContain('cms.page.create');
  });
});

describe('blocks', () => {
  it('PUT stores a block; the public list returns requested keys only', async () => {
    expect((await call(router, 'PUT', '/admin/blocks/footer.text', { contentJson: docWith('bye') })).status).toBe(200);
    await call(router, 'PUT', '/admin/blocks/other', { contentJson: docWith('no') });
    const r = await call(router, 'GET', '/public/blocks?keys=footer.text,missing');
    expect(r.body.data.map((b: any) => [b.key, b.html])).toEqual([['footer.text', '<p>bye</p>']]);
    expect((await call(router, 'GET', '/public/blocks?keys=bad/key')).status).toBe(400);
    expect((await call(router, 'PUT', '/admin/blocks/bad%20key', { contentJson: docWith('x') })).status).toBe(422);
  });
});

describe('assets', () => {
  const png = () => sharp({ create: { width: 8, height: 6, channels: 3, background: '#f00' } }).png().toBuffer();

  it('re-encodes an image to webp and stores it under STORAGE_DIR/cms', async () => {
    const r = await upload(await png(), 'a.png', 'a red box');
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ mime: 'image/webp', width: 8, height: 6, alt: 'a red box' });
    expect(r.body.data.url).toBe(`http://api.test/api/v1/cms/assets/${r.body.data.key}`);
    expect(readdirSync(path.join(store.dir, 'cms'))).toEqual([r.body.data.key]);
    expect(readFileSync(path.join(store.dir, 'cms', r.body.data.key)).subarray(8, 12).toString()).toBe('WEBP');
  });

  it('strips EXIF', async () => {
    const withExif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0f0' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-owner' } })
      .toBuffer();
    expect(withExif.includes('secret-owner')).toBe(true);
    const r = await upload(withExif, 'a.jpg', 'x');
    expect(r.status).toBe(201);
    expect(readFileSync(path.join(store.dir, 'cms', r.body.data.key)).includes('secret-owner')).toBe(false);
  });

  it('an .exe renamed to .png is 415 and nothing is stored', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
    const r = await upload(exe, 'totally-a-photo.png', 'x');
    expect(r.status).toBe(415);
    expect(testDb.assets).toHaveLength(0);
  });

  it('image magic bytes with a corrupt body is 415', async () => {
    const bad = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    expect((await upload(bad, 'x.png', 'x')).status).toBe(415);
  });

  it('too large is 413; missing alt is 422', async () => {
    expect((await upload(Buffer.alloc(1024 * 1024 + 10, 1), 'big.png', 'x')).status).toBe(413);
    expect((await upload(await png(), 'a.png')).status).toBe(422);
  });

  it('lists assets with urls', async () => {
    await upload(await png(), 'a.png', 'one');
    const r = await call(router, 'GET', '/admin/assets');
    expect(r.body.data.items).toHaveLength(1);
    expect(r.body.data.items[0].url).toMatch(/\/api\/v1\/cms\/assets\/.+\.webp$/);
  });

  it('serves stored files with nosniff and refuses anything but a generated name', async () => {
    const r = await upload(await png(), 'a.png', 'x');
    await withServer(async (base) => {
      const ok = await fetch(`${base}/public/assets/${r.body.data.key}`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
      expect(ok.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect((await fetch(`${base}/public/assets/..%2F..%2Fsecret.txt`)).status).toBe(404);
      expect((await fetch(`${base}/public/assets/${'0'.repeat(36)}.webp`)).status).toBe(404);
    });
  });
});
