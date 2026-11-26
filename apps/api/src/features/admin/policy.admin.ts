import { Router } from 'express';
import { TIERS } from '@media/shared';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { normaliseSourceUrl } from '../../lib/source-url.js';
import { getCachedRecordUnchecked } from '../../services/extraction.service.js';
import { DEFAULT_POLICY, HARD_FLOOR } from '../restrictions/restrictions.config.js';
import { mergePolicy } from '../restrictions/merge.js';
import { getPolicy } from '../restrictions/policy.current.js';
import { activatePolicyVersion, publishPolicy } from '../restrictions/policy.store.js';
import { isTakenDown } from '../eligibility/takedown.js';
import { setAudit, skipAudit } from './audit.js';
import { actorId } from './http.js';
import { verdictFor } from './policy.preview.js';

const overridesBody = z.record(z.unknown());
const publishBody = z.object({ overrides: overridesBody, note: z.string().trim().min(1).max(500) });
const previewBody = z.object({
  overrides: overridesBody,
  url: z.string().trim().min(1).max(2048),
  tier: z.enum(TIERS),
});

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.policyVersion.findMany({ orderBy: { version: 'desc' }, take: 100 });
    const authorIds = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id))];
    const authors = authorIds.length
      ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, email: true } })
      : [];
    const emailById = new Map(authors.map((a) => [a.id, a.email]));

    res.json({
      data: {
        active: getPolicy(),
        defaults: mergePolicy(DEFAULT_POLICY, {}, 0),
        hardFloor: HARD_FLOOR,
        versions: rows.map((r) => ({
          version: r.version,
          note: r.note,
          createdBy: r.createdById ? (emailById.get(r.createdById) ?? null) : null,
          createdAt: r.createdAt,
          active: r.active,
        })),
      },
    });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { overrides, note } = publishBody.parse(req.body);
    const before = getPolicy().version;
    const effective = await publishPolicy(overrides, note, actorId(req)); // 422 POLICY_INVALID when invalid
    setAudit(res, {
      action: 'policy.publish',
      target: `policy:${effective.version}`,
      before: { version: before },
      after: { version: effective.version, overrides, note },
    });
    res.status(201).json({ data: effective });
  }),
);

router.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const { overrides, url, tier } = previewBody.parse(req.body);
    const draft = mergePolicy(DEFAULT_POLICY, overrides, 0); // 422 when the draft is invalid
    const active = getPolicy();

    // The live policy may refuse this very URL, so normalise without it and judge both ourselves.
    const source = normaliseSourceUrl(url, { skipPolicy: true });
    const record = await getCachedRecordUnchecked(source.mediaId);
    const takenDown = await isTakenDown(source.mediaId);
    const info = { host: source.host, platform: source.platform, url: source.canonical, takenDown };
    const media = record
      ? {
          platform: record.media.platform,
          durationSeconds: record.media.durationSeconds,
          availability: record.media.availability,
          isLive: record.media.isLive,
          ageLimit: record.media.ageLimit,
          title: record.media.title,
          uploader: record.media.uploader,
          formats: record.formats,
        }
      : null;

    skipAudit(res); // a dry run: nothing changed
    res.json({
      data: {
        mediaId: source.mediaId,
        cached: record !== null,
        active: verdictFor(active, tier, info, media),
        draft: verdictFor(draft, tier, info, media),
      },
    });
  }),
);

router.post(
  '/:version/activate',
  asyncHandler(async (req, res) => {
    const version = z.coerce.number().int().positive().safeParse(req.params.version);
    if (!version.success) throw AppError.unprocessable('Version must be a positive integer');
    const before = getPolicy().version;
    const effective = await activatePolicyVersion(version.data, actorId(req));
    setAudit(res, {
      action: 'policy.activate',
      target: `policy:${version.data}`,
      before: { version: before },
      after: { version: effective.version },
    });
    res.json({ data: effective });
  }),
);

export default router;
