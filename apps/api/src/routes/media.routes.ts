import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { toWebVtt } from '../lib/subtitles.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { extractionRateLimit, rateLimit } from '../middleware/rate-limit.js';
import { refreshTierFromDb } from '../middleware/identity.js';
import {
  assertFormatAllowed,
  extractMedia,
  findFormat,
  gateRecord,
  getCachedRecord,
} from '../services/extraction.service.js';
import { assertFetchableUrl, mintPlaybackGrant } from '../services/stream.service.js';
import { getQuotaSnapshot, quotaIdentity } from '../services/quota.service.js';
import { env } from '../config/env.js';
import { resolveUserRegion } from '../features/regions/region.js';
import { assertPlatformAllowed, tierPolicyFor } from '../features/restrictions/enforce.js';

const router = Router();

const urlInput = z.object({
  url: z.string().min(1, 'Paste a media URL').max(2048),
  /** Bypasses the cache. Rate limited like any other extraction. */
  refresh: z.boolean().optional(),
});

/**
 * Extraction. Runs yt-dlp (or serves the shared cache) and returns the format
 * list decorated with this caller's entitlement — locked renditions included,
 * so the UI can show a 4K row with an upgrade prompt instead of pretending the
 * quality does not exist.
 */
router.post(
  '/extract',
  refreshTierFromDb,
  extractionRateLimit,
  asyncHandler(async (req, res) => {
    const input = urlInput.parse(req.body);

    // Client disconnects should stop the yt-dlp process, not orphan it.
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const record = await extractMedia(input.url, {
      signal: controller.signal,
      force: input.refresh === true,
      userRegion: resolveUserRegion(req, env),
    });

    const result = gateRecord(record, req.identity.tier);

    logger.info(
      {
        mediaId: record.media.id,
        platform: record.media.platform,
        tier: req.identity.tier,
        formats: result.formats.length,
        locked: result.lockedFormatCount,
      },
      'Extraction served',
    );

    res.json({
      data: {
        ...result,
        policy: tierPolicyFor(req.identity.tier, record.media.platform),
        quota: await getQuotaSnapshot(quotaIdentity(req.identity)),
      },
    });
  }),
);

/** Cached lookup by id — used by SSR metadata pages and by the player on reload. */
router.get(
  '/:mediaId',
  asyncHandler(async (req, res) => {
    const record = await getCachedRecord(req.params.mediaId as string);
    if (!record) throw AppError.notFound('That media is not cached; submit the URL again.');
    res.json({ data: gateRecord(record, req.identity.tier) });
  }),
);

/**
 * Mints a playback grant.
 *
 * This is the only place an upstream URL is converted into something the
 * browser may use, and the entitlement is re-evaluated here rather than trusted
 * from whatever the client was shown earlier.
 */
router.post(
  '/playback',
  refreshTierFromDb,
  rateLimit({ bucket: 'playback', windowSeconds: 60, max: 60 }),
  asyncHandler(async (req, res) => {
    const input = z
      .object({ url: z.string().min(1).max(2048), formatId: z.string().min(1).max(128) })
      .parse(req.body);

    const policy = tierPolicyFor(req.identity.tier);
    if (!policy.allowStreaming) {
      throw AppError.forbidden('In-app playback is not available on your plan', 'FREE');
    }

    const record = await extractMedia(input.url);
    const format = findFormat(record, input.formatId);
    assertPlatformAllowed(record.media.platform, 'playback');
    assertFormatAllowed(format, req.identity.tier, record.media.platform);

    const grant = mintPlaybackGrant(record, format, {
      sub: req.identity.subject,
      tier: req.identity.tier,
    });

    res.json({
      data: {
        ...grant,
        mediaId: record.media.id,
        title: record.media.title,
        durationSeconds: record.media.durationSeconds,
        poster: record.media.bestThumbnail,
        subtitles: record.media.subtitles,
        chapters: record.media.chapters,
        isLive: record.media.isLive,
      },
    });
  }),
);

/**
 * Subtitle proxy + converter.
 *
 * Served from this API rather than the Next.js byte proxy because the payload
 * needs rewriting (SRT/TTML/JSON3 → WebVTT), it is small, and `<track>` will
 * only load a same-origin or CORS-enabled URL. The upstream URL comes from our
 * own cache and is re-checked against the private-host rule before any fetch.
 */
router.get(
  '/:mediaId/subtitles/:lang',
  rateLimit({ bucket: 'subs', windowSeconds: 60, max: 120 }),
  asyncHandler(async (req, res) => {
    const lang = String(req.params.lang ?? '');
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(lang)) throw AppError.badRequest('Invalid subtitle language');

    const record = await getCachedRecord(req.params.mediaId as string);
    if (!record) throw AppError.notFound('That media is not cached; submit the URL again.');

    const source = record.subtitleSources[lang];
    if (!source) throw AppError.notFound('No subtitles for that language');

    const target = assertFetchableUrl(source.url);

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; MediaEngine/1.0)' },
      });
    } catch (err) {
      logger.warn({ err, lang }, 'Subtitle fetch failed');
      throw AppError.upstream('Could not load that subtitle track');
    }

    if (!upstream.ok) throw AppError.upstream('The subtitle track is no longer available');

    // Subtitles are text; a multi-megabyte body means something is wrong.
    const declared = Number(upstream.headers.get('content-length') ?? 0);
    if (declared > 5 * 1024 * 1024) throw AppError.payloadTooLarge('Subtitle track is too large');

    const body = await upstream.text();
    if (body.length > 5 * 1024 * 1024) throw AppError.payloadTooLarge('Subtitle track is too large');

    res.setHeader('content-type', 'text/vtt; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.send(toWebVtt(body, source.ext));
  }),
);

export default router;
