import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { mediaQueue } from '../../queue/queues.js';
import { buildHealthReport } from '../health/health.routes.js';
import { getToolVersions } from '../health/index.js';
import { getDbHealth } from '../persistence/index.js';
import { readStats } from './stats-counters.js';

const router = Router();

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [jobGroups, extractsByPlatform, refusalsByCode, queue, health] = await Promise.all([
      prisma.job.groupBy({ by: ['state'], where: { createdAt: { gte: startOfUtcDay() } }, _count: { _all: true } }),
      readStats('extracts'),
      readStats('refusals'),
      mediaQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      buildHealthReport({
        dbUp: () => getDbHealth().up,
        redisPing: () => redis.ping(),
        tools: getToolVersions,
        region: env.REGION,
      }),
    ]);

    res.json({
      data: {
        jobsToday: Object.fromEntries(jobGroups.map((g) => [g.state, g._count._all])),
        extractsByPlatform,
        refusalsByCode,
        queueDepth: {
          waiting: queue.waiting ?? 0,
          active: queue.active ?? 0,
          delayed: queue.delayed ?? 0,
          failed: queue.failed ?? 0,
        },
        health: { status: health.status, db: health.db, redis: health.redis, tools: health.tools, region: health.region },
        windowHours: 24,
      },
    });
  }),
);

export default router;
