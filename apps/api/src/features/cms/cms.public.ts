import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { requireDatabase } from '../persistence/index.js';
import { assetDir } from './cms.upload.js';

const router = Router();
const KEY = /^[A-Za-z0-9._-]{1,80}$/;
const FILE = /^[0-9a-f-]{36}\.(?:webp|gif)$/;

router.get(
  '/pages/:slug',
  requireDatabase,
  asyncHandler(async (req, res) => {
    const slug = z.string().min(1).max(80).parse(req.params.slug);
    const row = await prisma.cmsPage.findUnique({ where: { slug } });
    // Drafts, scheduled and archived pages are indistinguishable from pages that never existed.
    if (!row || row.status !== 'PUBLISHED') throw AppError.notFound('Page not found');
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({
      data: {
        title: row.title,
        html: row.contentHtml,
        seo: { title: row.seoTitle, description: row.seoDescription, ogImageId: row.ogImageId },
        updatedAt: row.updatedAt,
      },
    });
  }),
);

router.get(
  '/blocks',
  requireDatabase,
  asyncHandler(async (req, res) => {
    const keys = z
      .string()
      .min(1)
      .parse(req.query.keys)
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    if (keys.length === 0 || keys.length > 20 || !keys.every((k) => KEY.test(k))) {
      throw AppError.badRequest('keys must be 1-20 comma-separated block keys');
    }
    const rows = await prisma.cmsBlock.findMany({ where: { key: { in: keys } } });
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ data: rows.map((b) => ({ key: b.key, html: b.contentHtml, updatedAt: b.updatedAt })) });
  }),
);

/** Served from disk; the strict name pattern means no path can leave the cms directory. */
router.get('/assets/:file', (req, res, next) => {
  const file = String(req.params.file);
  if (!FILE.test(file)) return next(AppError.notFound());
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  res.sendFile(path.join(assetDir(), file), (err) => {
    if (err) next(AppError.notFound());
  });
});

export default router;
