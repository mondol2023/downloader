import { Router } from 'express';
import type { ToolVersions } from './tool-versions.js';

export type HealthStatus = 'ok' | 'degraded' | 'down';
export type Up = 'up' | 'down';

export interface HealthReport {
  status: HealthStatus;
  db: Up;
  redis: Up;
  tools: ToolVersions;
  region: string;
}

export interface HealthDeps {
  /** Cached result of the DB health probe — never a live query, so /healthz can't hang on Prisma. */
  dbUp: () => boolean;
  redisPing: () => Promise<unknown>;
  tools: () => ToolVersions;
  region: string;
  pingTimeoutMs?: number;
}

/**
 * `down` when neither datastore answers (nothing useful can be served); `degraded` when one of them,
 * or any engine binary, is missing; otherwise `ok`.
 */
export function computeHealthStatus(db: boolean, redis: boolean, tools: ToolVersions): HealthStatus {
  if (!db && !redis) return 'down';
  if (!db || !redis) return 'degraded';
  if (Object.values(tools).some((v) => v == null)) return 'degraded';
  return 'ok';
}

async function pingWithTimeout(ping: () => Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      ping().then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function buildHealthReport(deps: HealthDeps): Promise<HealthReport> {
  const db = deps.dbUp();
  const redis = await pingWithTimeout(deps.redisPing, deps.pingTimeoutMs ?? 1_000);
  const tools = { ...deps.tools() };
  return {
    status: computeHealthStatus(db, redis, tools),
    db: db ? 'up' : 'down',
    redis: redis ? 'up' : 'down',
    tools,
    region: deps.region,
  };
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();
  router.get('/healthz', async (_req, res) => {
    const report = await buildHealthReport(deps);
    res
      .status(report.status === 'down' ? 503 : 200)
      .set('Cache-Control', 'no-store')
      .json(report);
  });
  return router;
}
