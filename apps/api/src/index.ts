import http from 'node:http';
import path from 'node:path';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma, prisma } from './lib/prisma.js';
import { disconnectRedis, redis } from './lib/redis.js';
import {
  startDbHealthProbe,
  startOutboxDrainer,
  startSheetsMirrorFromEnv,
} from './features/persistence/index.js';
import { startPolicyStore, stopPolicyStore } from './features/restrictions/policy.store.js';
import { initToolVersions } from './features/health/index.js';
import { runYtDlpSelfUpdate, startYtDlpUpdateListener } from './features/maintenance/index.js';
import { closeQueue } from './queue/queues.js';
import { app } from './app.js';
import { pruneExpiredRefreshTokens } from './services/token.service.js';

void initToolVersions(
  { ytDlp: env.YTDLP_PATH, ffmpeg: env.FFMPEG_PATH, ffprobe: env.FFPROBE_PATH },
  logger,
);
// The worker's daily tick broadcasts; the API extracts with its own yt-dlp, so it updates itself too.
const stopYtDlpListener = startYtDlpUpdateListener({
  subscriber: redis.duplicate(),
  update: () => runYtDlpSelfUpdate({ enabled: env.YTDLP_AUTO_UPDATE, ytDlpPath: env.YTDLP_PATH, log: logger }),
  log: logger,
});

// Probe Postgres so routes that need it can 503 instantly during an outage.
const stopDbProbe = startDbHealthProbe();
// Replay ledger/audit rows queued during an outage once the DB is back.
const stopOutboxDrainer = startOutboxDrainer();
// Optional Google Sheets copy of the ledger (no-op unless configured).
const stopSheetsMirror = startSheetsMirrorFromEnv();
// Runtime restriction policy: database → snapshot file → code defaults, refreshed on `policy:changed`.
void startPolicyStore({
  prisma,
  redis,
  snapshotPath: path.join(path.resolve(env.STORAGE_DIR), 'policy.snapshot.json'),
}).catch((err: unknown) => logger.error({ err }, 'Policy store failed to start; using code defaults'));

const server = http.createServer(app);
// Slightly above a typical 60s ALB idle timeout so the proxy, not the origin,
// closes idle connections — otherwise clients see sporadic 502s.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
// Streaming an artifact can legitimately take a long time; the per-job timeouts
// live in the worker, not here.
server.requestTimeout = 0;

server.listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT, env: env.NODE_ENV, url: env.API_PUBLIC_URL },
    'Media engine API listening',
  );
});

/**
 * Housekeeping. Expired refresh tokens are harmless (they fail verification)
 * but the table grows without bound, and a fat token table slows every rotation.
 */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const pruneTimer = setInterval(() => {
  pruneExpiredRefreshTokens().catch((err) => {
    logger.error({ err }, 'Refresh token prune failed');
  });
}, PRUNE_INTERVAL_MS);
pruneTimer.unref();

/**
 * Graceful shutdown. In-flight downloads get the grace period to finish; new
 * connections are refused immediately so the load balancer drains us.
 */
const SHUTDOWN_GRACE_MS = 15_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  clearInterval(pruneTimer);
  stopDbProbe();
  stopOutboxDrainer();
  stopSheetsMirror();
  await stopYtDlpListener();
  await stopPolicyStore().catch(() => undefined);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceExit.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Queue first: it holds its own Redis connections, and closing the shared
  // client out from under BullMQ produces a noisy shutdown.
  await closeQueue();
  await disconnectRedis();
  await disconnectPrisma();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * A rejected promise that reaches here means a code path is missing its own
 * handling — log it with full context and keep serving; crashing the API over
 * one bad request would be a self-inflicted outage.
 */
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

// An uncaught exception leaves the process in an unknown state; log, then let
// the orchestrator restart us cleanly.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException');
});

export { app, server };
