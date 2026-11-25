import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { AUDIO_FORMATS, type AudioFormat } from '@media/shared';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { clientIp, refreshTierFromDb } from '../middleware/identity.js';
import {
  assertFormatAllowed,
  extractMedia,
  findFormat,
} from '../services/extraction.service.js';
import {
  assertSizeAllowed,
  getQuotaSnapshot,
  quotaIdentity,
  release,
  reserveDownload,
} from '../services/quota.service.js';
import {
  findOwnedJob,
  listJobs,
  requestCancellation,
  toJobSummary,
} from '../services/job.service.js';
import { enqueueMediaJob, removeQueuedJob } from '../queue/queues.js';
import { recordAudit } from '../services/user.service.js';
import {
  assertDownloadsOpen,
  assertPlatformAllowed,
  tierPolicyFor,
} from '../features/restrictions/enforce.js';

const router = Router();

const downloadRequest = z.object({
  url: z.string().min(1).max(2048),
  formatId: z.string().min(1).max(128),
  audioFormat: z.enum(AUDIO_FORMATS).optional(),
  embedSubtitles: z.boolean().optional(),
  subtitleLang: z.string().max(32).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});

/**
 * Enqueue a download.
 *
 * Order matters here. Entitlement is checked before quota is spent, and quota
 * is reserved before the job row exists, so a rejected request never consumes
 * one of a guest's three daily downloads and an accepted one cannot be
 * double-spent by a parallel request.
 */
router.post(
  '/',
  refreshTierFromDb,
  rateLimit({ bucket: 'enqueue', windowSeconds: 60, max: 20 }),
  asyncHandler(async (req, res) => {
    const input = downloadRequest.parse(req.body);
    const tier = req.identity.tier;

    // Maintenance and the downloads switch come first: nothing below may spend quota.
    assertDownloadsOpen();

    const record = await extractMedia(input.url);
    const format = findFormat(record, input.formatId);
    const platform = record.media.platform;
    const policy = tierPolicyFor(tier, platform);

    assertPlatformAllowed(platform, 'download');
    assertFormatAllowed(format, tier, platform);
    assertSizeAllowed(tier, format.sizeBytes);

    if (input.audioFormat) {
      if (!policy.audioFormats.includes(input.audioFormat)) {
        throw AppError.forbidden(
          `${input.audioFormat.toUpperCase()} audio is not available on the ${policy.label} plan.`,
          'PRO',
        );
      }
      if (!policy.allowTranscode) {
        throw AppError.forbidden(
          'Server-side audio conversion requires a free account.',
          'FREE',
        );
      }
    }

    // Muxing a video-only rendition with a separate audio track is an ffmpeg
    // stream copy, not a re-encode, so it is allowed on every tier.
    const type = input.audioFormat ? 'TRANSCODE_AUDIO' : format.requiresMux ? 'MUX' : 'DOWNLOAD';

    const reservation = await reserveDownload(quotaIdentity(req.identity));

    try {
      const job = await prisma.job.create({
        data: {
          id: reservation.id,
          userId: req.identity.userId,
          guestKey: req.identity.userId ? null : req.identity.guestKey,
          type,
          state: 'QUEUED',
          sourceUrl: record.media.canonicalUrl,
          mediaId: record.media.id,
          platform: record.media.platform,
          mediaTitle: record.media.title,
          region: record.region ?? null,
          formatId: format.id,
          formatLabel: input.audioFormat
            ? `${format.label} → ${input.audioFormat.toUpperCase()}`
            : format.label,
          audioFormat: input.audioFormat ?? null,
          embedSubtitles: input.embedSubtitles ?? false,
          subtitleLang: input.subtitleLang ?? null,
          tierAtRequest: tier,
          totalBytes: format.sizeBytes != null ? BigInt(Math.round(format.sizeBytes)) : null,
          expiresAt: new Date(Date.now() + env.ARTIFACT_TTL * 1000),
        },
      });

      await enqueueMediaJob({
        jobId: job.id,
        subject: req.identity.subject,
        userId: req.identity.userId,
        guestKey: req.identity.userId ? null : req.identity.guestKey,
        tier,
        mediaId: record.media.id,
        sourceUrl: record.media.canonicalUrl,
        formatId: format.id,
        ...(input.audioFormat ? { audioFormat: input.audioFormat as AudioFormat } : {}),
        embedSubtitles: input.embedSubtitles ?? false,
        ...(input.subtitleLang ? { subtitleLang: input.subtitleLang } : {}),
        ipHash: req.identity.ipHash,
        userAgent: req.header('user-agent') ?? null,
      });

      await recordAudit({
        userId: req.identity.userId,
        guestKey: req.identity.guestKey,
        action: 'job.enqueue',
        outcome: 'success',
        ip: clientIp(req),
        metadata: { jobId: job.id, platform: record.media.platform, formatId: format.id, tier },
      });

      res.status(202).json({
        data: await toJobSummary(job),
        quota: await getQuotaSnapshot(quotaIdentity(req.identity)),
      });
    } catch (err) {
      // The reservation is only "spent" if a job actually exists to spend it.
      await release(reservation);
      throw err;
    }
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit ?? 25);
    res.json({ data: await listJobs(req.identity, Number.isFinite(limit) ? limit : 25) });
  }),
);

router.get(
  '/quota',
  refreshTierFromDb,
  asyncHandler(async (req, res) => {
    res.json({ data: await getQuotaSnapshot(quotaIdentity(req.identity)) });
  }),
);

router.get(
  '/:jobId',
  asyncHandler(async (req, res) => {
    const row = await findOwnedJob(req.params.jobId as string, req.identity);
    res.json({ data: await toJobSummary(row) });
  }),
);

router.post(
  '/:jobId/cancel',
  asyncHandler(async (req, res) => {
    const row = await findOwnedJob(req.params.jobId as string, req.identity);

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.state)) {
      throw AppError.conflict('That job has already finished');
    }

    // Remove it if it has not started; otherwise set the flag the worker polls.
    const removed = await removeQueuedJob(row.id);
    await requestCancellation(row.id);

    if (removed) {
      await prisma.job.update({
        where: { id: row.id },
        data: { state: 'CANCELLED', completedAt: new Date() },
      });
      // A cancelled-before-start job costs nothing, so give the allowance back.
      await release({
        id: row.id,
        subject: req.identity.subject,
        ipSubject: req.identity.userId ? null : `ip:${req.identity.ipHash}`,
      });
    }

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: row.id } });
    res.json({ data: await toJobSummary(updated) });
  }),
);

/**
 * Artifact delivery. Ownership is re-checked on every request — a job id is not
 * a capability — and the path is confined to STORAGE_DIR so a corrupted row
 * cannot be turned into arbitrary file reads.
 */
router.get(
  '/:jobId/artifact',
  asyncHandler(async (req, res) => {
    const row = await findOwnedJob(req.params.jobId as string, req.identity);

    if (row.state !== 'COMPLETED' || !row.artifactPath) {
      throw AppError.conflict('That job has no downloadable file yet');
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw AppError.notFound('That file has expired and been removed');
    }

    const storageRoot = path.resolve(env.STORAGE_DIR);
    const resolved = path.resolve(row.artifactPath);
    if (resolved !== storageRoot && !resolved.startsWith(storageRoot + path.sep)) {
      logger.error({ jobId: row.id, resolved }, 'Artifact path escaped storage root');
      throw AppError.notFound('That file is no longer available');
    }

    let size: number;
    try {
      const stats = await stat(resolved);
      if (!stats.isFile()) throw new Error('not a file');
      size = stats.size;
    } catch {
      throw AppError.notFound('That file is no longer available');
    }

    const fileName = sanitiseFileName(row.fileName ?? `${row.mediaTitle}.bin`);

    res.setHeader('content-type', row.artifactMime ?? 'application/octet-stream');
    res.setHeader('content-length', String(size));
    res.setHeader(
      'content-disposition',
      `attachment; filename="${fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-content-type-options', 'nosniff');

    const stream = createReadStream(resolved);
    stream.on('error', (err) => {
      logger.error({ err, jobId: row.id }, 'Artifact stream failed');
      res.destroy();
    });
    stream.pipe(res);
  }),
);

/** Keeps the filename safe for a Content-Disposition header and for any OS. */
function sanitiseFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'download').slice(0, 180);
}

export default router;
