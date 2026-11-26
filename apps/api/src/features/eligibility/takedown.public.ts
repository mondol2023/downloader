import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { normaliseSourceUrl } from '../../lib/source-url.js';
import { asyncHandler } from '../../middleware/error-handler.js';

/**
 * Public DMCA intake. Anyone may file a request; it can only ever create a PENDING row, which has
 * no effect on serving until an admin approves it (admin/takedowns). The reply is identical whether
 * or not a row already exists, so the endpoint cannot be used to probe what has been reported.
 */
const body = z.object({
  sourceUrl: z.string().trim().min(1).max(2048),
  requesterName: z.string().trim().min(1).max(120),
  requesterEmail: z.string().trim().email().max(254),
  reason: z.string().trim().min(20, 'Please describe the work and why you are entitled to act').max(1000),
  /** The statement of good faith / accuracy required of a DMCA notice. */
  goodFaith: z.literal(true, { errorMap: () => ({ message: 'You must confirm the statement' }) }),
});

const router = Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = body.parse(req.body);
    // skipPolicy: a source our own policy already blocks can still be the subject of a notice.
    const source = normaliseSourceUrl(input.sourceUrl, { skipPolicy: true });

    const existing = await prisma.takedown.findUnique({ where: { mediaId: source.mediaId }, select: { id: true } });
    if (!existing) {
      await prisma.takedown.create({
        data: {
          mediaId: source.mediaId,
          sourceUrl: source.canonical,
          reason: `From ${input.requesterName}: ${input.reason}`,
          status: 'PENDING',
          requesterEmail: input.requesterEmail,
        },
      });
      logger.info({ mediaId: source.mediaId }, 'Public takedown request received');
    }
    res.status(202).json({ data: { received: true } });
  }),
);

export default router;
