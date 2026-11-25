import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { setAudit } from '../admin/audit.js';
import { actorId, pageArgs, pageQuery, toPage } from '../admin/http.js';
import { assetOrigin, docSchema, renderDoc } from './cms.render.js';
import { parseUpload, storeImage } from './cms.upload.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[A-Za-z0-9._-]{1,80}$/;
const STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] as const;

const slug = z.string().trim().min(1).max(80).regex(SLUG, 'lowercase letters, digits and hyphens');
const seo = {
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
  ogImageId: z.string().trim().max(64).nullable().optional(),
};
const createBody = z.object({ slug, title: z.string().trim().min(1).max(200), contentJson: docSchema, ...seo });
const patchBody = z.object({
  /** The version the editor loaded; a mismatch means someone else saved first. */
  version: z.number().int().min(1),
  slug: slug.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  contentJson: docSchema.optional(),
  ...seo,
});
const listQuery = pageQuery.extend({ status: z.enum(STATUSES).optional() });
const scheduleBody = z.object({ publishAt: z.coerce.date() });
const blockBody = z.object({ contentJson: docSchema });
const altBody = z.object({ alt: z.string().trim().min(1).max(300) });

const conflict = () => new AppError(409, 'CMS_CONFLICT', 'This page was changed by someone else; reload and re-apply your edit');
const taken = () => AppError.conflict('That slug is already in use');
const isUnique = (err: unknown) => (err as { code?: string } | null)?.code === 'P2002';
const idOf = (p: { id?: string }) => String(p.id);

const router = Router();

router.get(
  '/pages',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await prisma.cmsPage.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, slug: true, title: true, status: true, version: true, publishAt: true,
        publishedAt: true, updatedAt: true, createdAt: true,
      },
      ...pageArgs(q),
    });
    res.json({ data: toPage(rows, q.limit) });
  }),
);

router.get(
  '/pages/:id',
  asyncHandler(async (req, res) => {
    const row = await prisma.cmsPage.findUnique({ where: { id: idOf(req.params) } });
    if (!row) throw AppError.notFound('Page not found');
    res.json({ data: row });
  }),
);

router.post(
  '/pages',
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
    const by = actorId(req);
    const contentHtml = renderDoc(body.contentJson);
    const row = await prisma
      .$transaction(async (tx) => {
        const page = await tx.cmsPage.create({
          data: {
            slug: body.slug, title: body.title, contentJson: body.contentJson as never, contentHtml,
            seoTitle: body.seoTitle ?? null, seoDescription: body.seoDescription ?? null,
            ogImageId: body.ogImageId ?? null, updatedById: by,
          },
        });
        await tx.cmsRevision.create({
          data: { pageId: page.id, version: page.version, title: page.title, contentJson: body.contentJson as never, authorId: by },
        });
        return page;
      })
      .catch((err: unknown) => {
        throw isUnique(err) ? taken() : err;
      });
    setAudit(res, { action: 'cms.page.create', target: `cms-page:${row.id}`, after: { slug: row.slug, title: row.title } });
    res.status(201).json({ data: row });
  }),
);

router.patch(
  '/pages/:id',
  asyncHandler(async (req, res) => {
    const { version, ...fields } = patchBody.parse(req.body);
    const id = idOf(req.params);
    const by = actorId(req);
    const html = fields.contentJson ? renderDoc(fields.contentJson) : undefined;

    const out = await prisma
      .$transaction(async (tx) => {
        const before = await tx.cmsPage.findUnique({ where: { id } });
        if (!before) throw AppError.notFound('Page not found');
        const { count } = await tx.cmsPage.updateMany({
          where: { id, version },
          data: {
            ...(fields.slug !== undefined ? { slug: fields.slug } : {}),
            ...(fields.title !== undefined ? { title: fields.title } : {}),
            ...(fields.contentJson ? { contentJson: fields.contentJson as never, contentHtml: html } : {}),
            ...(fields.seoTitle !== undefined ? { seoTitle: fields.seoTitle } : {}),
            ...(fields.seoDescription !== undefined ? { seoDescription: fields.seoDescription } : {}),
            ...(fields.ogImageId !== undefined ? { ogImageId: fields.ogImageId } : {}),
            updatedById: by,
            version: { increment: 1 },
          },
        });
        if (count === 0) throw conflict();
        const page = (await tx.cmsPage.findUnique({ where: { id } }))!;
        await tx.cmsRevision.create({
          data: { pageId: id, version: page.version, title: page.title, contentJson: page.contentJson as never, authorId: by },
        });
        return { before, page };
      })
      .catch((err: unknown) => {
        throw isUnique(err) ? taken() : err;
      });
    setAudit(res, {
      action: 'cms.page.update',
      target: `cms-page:${id}`,
      before: { slug: out.before.slug, title: out.before.title, version: out.before.version },
      after: { slug: out.page.slug, title: out.page.title, version: out.page.version },
    });
    res.json({ data: out.page });
  }),
);

/** Deleting a page archives it: the public site stops serving it, the revision history survives. */
router.delete(
  '/pages/:id',
  asyncHandler(async (req, res) => {
    const id = idOf(req.params);
    const before = await prisma.cmsPage.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('Page not found');
    const page = await prisma.cmsPage.update({ where: { id }, data: { status: 'ARCHIVED', publishAt: null } });
    setAudit(res, { action: 'cms.page.archive', target: `cms-page:${id}`, before: { status: before.status }, after: { status: 'ARCHIVED' } });
    res.json({ data: page });
  }),
);

async function transition(id: string, data: Record<string, unknown>) {
  const before = await prisma.cmsPage.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Page not found');
  const page = await prisma.cmsPage.update({ where: { id }, data });
  return { before, page };
}

router.post(
  '/pages/:id/publish',
  asyncHandler(async (req, res) => {
    const id = idOf(req.params);
    const { before, page } = await transition(id, { status: 'PUBLISHED', publishedAt: new Date(), publishAt: null });
    setAudit(res, { action: 'cms.page.publish', target: `cms-page:${id}`, before: { status: before.status }, after: { status: page.status } });
    res.json({ data: page });
  }),
);

router.post(
  '/pages/:id/unpublish',
  asyncHandler(async (req, res) => {
    const id = idOf(req.params);
    const { before, page } = await transition(id, { status: 'DRAFT', publishAt: null });
    setAudit(res, { action: 'cms.page.unpublish', target: `cms-page:${id}`, before: { status: before.status }, after: { status: page.status } });
    res.json({ data: page });
  }),
);

router.post(
  '/pages/:id/schedule',
  asyncHandler(async (req, res) => {
    const id = idOf(req.params);
    const { publishAt } = scheduleBody.parse(req.body);
    if (publishAt.getTime() <= Date.now()) throw AppError.unprocessable('publishAt must be in the future');
    const { before, page } = await transition(id, { status: 'SCHEDULED', publishAt });
    setAudit(res, {
      action: 'cms.page.schedule',
      target: `cms-page:${id}`,
      before: { status: before.status },
      after: { status: page.status, publishAt: publishAt.toISOString() },
    });
    res.json({ data: page });
  }),
);

router.get(
  '/pages/:id/revisions',
  asyncHandler(async (req, res) => {
    const id = idOf(req.params);
    if (!(await prisma.cmsPage.findUnique({ where: { id } }))) throw AppError.notFound('Page not found');
    const items = await prisma.cmsRevision.findMany({ where: { pageId: id }, orderBy: { version: 'desc' } });
    res.json({ data: { items } });
  }),
);

/** Restoring writes a NEW revision (version + 1) with the old content, so history is never rewritten. */
router.post(
  '/pages/:id/revisions/:version/restore',
  asyncHandler(async (req, res) => {
    const id = idOf(req.params);
    const version = z.coerce.number().int().min(1).parse(req.params.version);
    const by = actorId(req);
    const page = await prisma.$transaction(async (tx) => {
      const rev = await tx.cmsRevision.findUnique({ where: { pageId_version: { pageId: id, version } } });
      if (!rev) throw AppError.notFound('Revision not found');
      const updated = await tx.cmsPage.update({
        where: { id },
        data: {
          title: rev.title,
          contentJson: rev.contentJson as never,
          contentHtml: renderDoc(rev.contentJson),
          updatedById: by,
          version: { increment: 1 },
        },
      });
      await tx.cmsRevision.create({
        data: { pageId: id, version: updated.version, title: rev.title, contentJson: rev.contentJson as never, authorId: by },
      });
      return updated;
    });
    setAudit(res, { action: 'cms.page.restore', target: `cms-page:${id}`, after: { restoredFrom: version, version: page.version } });
    res.json({ data: page });
  }),
);

router.put(
  '/blocks/:key',
  asyncHandler(async (req, res) => {
    const key = z.string().regex(KEY).parse(req.params.key);
    const { contentJson } = blockBody.parse(req.body);
    const contentHtml = renderDoc(contentJson);
    const by = actorId(req);
    const row = await prisma.cmsBlock.upsert({
      where: { key },
      create: { key, contentJson: contentJson as never, contentHtml, updatedById: by },
      update: { contentJson: contentJson as never, contentHtml, updatedById: by },
    });
    setAudit(res, { action: 'cms.block.put', target: `cms-block:${key}` });
    res.json({ data: row });
  }),
);

router.post(
  '/assets',
  parseUpload,
  asyncHandler(async (req, res) => {
    const { alt } = altBody.parse(req.body ?? {});
    if (!req.file) throw AppError.badRequest('Send the image in a "file" field');
    const stored = await storeImage(req.file.buffer);
    const row = await prisma.cmsAsset.create({ data: { ...stored, alt } });
    setAudit(res, { action: 'cms.asset.upload', target: `cms-asset:${row.id}`, after: { key: row.key, bytes: row.bytes } });
    res.status(201).json({ data: { ...row, url: `${assetOrigin()}/${row.key}` } });
  }),
);

router.get(
  '/assets',
  asyncHandler(async (req, res) => {
    const q = pageQuery.parse(req.query);
    const rows = await prisma.cmsAsset.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const page = toPage(rows, q.limit);
    res.json({ data: { ...page, items: page.items.map((a) => ({ ...a, url: `${assetOrigin()}/${a.key}` })) } });
  }),
);

export default router;
