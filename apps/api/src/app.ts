import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env, isProd } from './config/env.js';
import { logger } from './lib/logger.js';
import { redis } from './lib/redis.js';
import { getDbHealth } from './features/persistence/index.js';
import { createHealthRouter, getToolVersions } from './features/health/index.js';
import { attachIdentity, csrfGuard } from './middleware/identity.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalRateLimit } from './middleware/rate-limit.js';
import apiRouter from './routes/index.js';
import { webhookHandler } from './routes/billing.routes.js';

/**
 * The Express app, with no listener and no background timers. `index.ts` listens on it (long-running
 * container); `serverless.ts` hands it to a Next.js route handler (Vercel).
 */

const app = express();

/**
 * Behind exactly one reverse proxy (Next.js in dev, an ingress in production).
 * A numeric hop count rather than `true`: trusting the whole chain would let a
 * client forge `X-Forwarded-For` and defeat every IP-keyed rate limit and the
 * guest quota's IP fallback.
 */
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.set('etag', false);

/**
 * Stripe first — before cookies, before identity, before the JSON parser.
 *
 * Signature verification needs the exact bytes Stripe signed, so this handler
 * must see a raw Buffer. Mounting it here also means Stripe never receives a
 * guest cookie and never passes through the CSRF guard, which it would fail:
 * the signature *is* the authentication.
 */
app.post('/api/v1/billing/webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.use(
  helmet({
    // The API serves JSON and file downloads, never HTML, so a CSP here would
    // only ever apply to error pages. Next.js sets the real one.
    contentSecurityPolicy: false,
    // Artifacts are streamed to the browser from a different origin than the UI.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: isProd ? { maxAge: 15_552_000, includeSubDomains: true } : false,
  }),
);

/**
 * Browsers only ever talk to Next.js, so CORS exists for local tooling and any
 * first-party client we ship later. `credentials: true` requires an explicit
 * origin list — a wildcard would silently drop the auth cookies.
 */
const allowedOrigins = new Set(
  env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : [env.WEB_PUBLIC_URL],
);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: same-origin, curl, or a server-side fetch from Next.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      logger.warn({ origin }, 'Blocked cross-origin request');
      return callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['x-request-id', 'retry-after', 'content-disposition'],
    maxAge: 600,
  }),
);

app.use(
  compression({
    filter(req, res) {
      // Re-compressing an MP4 burns CPU for nothing and breaks range replies.
      const type = String(res.getHeader('content-type') ?? '');
      if (/^(video|audio|image)\//.test(type) || type === 'application/octet-stream') return false;
      return compression.filter(req, res);
    },
  }),
);

// 256kb is far more than any request here needs; the largest body is a URL plus
// a format id. Uploads do not exist on this API.
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(cookieParser());

app.use(
  pinoHttp({
    logger,
    // `attachIdentity` has not run yet, so derive the id the same way it does
    // and let it reuse ours — one id spans the log line and the response header.
    genReqId(req, res) {
      const existing = req.headers['x-request-id'];
      const id =
        (Array.isArray(existing) ? existing[0] : existing)?.slice(0, 64) ||
        crypto.randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customProps(req) {
      // Present for every request that got past `attachIdentity`; absent on the
      // webhook and on health probes.
      const identity = (req as express.Request).identity;
      return identity ? { tier: identity.tier, userId: identity.userId } : {};
    },
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/health/ready',
    },
  }),
);

/**
 * Every request gets an identity from here on — a user, or a cookie-backed
 * guest. Downstream code can rely on `req.identity` existing.
 */
app.use(attachIdentity);

/**
 * Health probes sit above the rate limiter on purpose: an orchestrator polling
 * every few seconds must not consume the same window a real client uses, and a
 * throttled health check would take a healthy instance out of rotation.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

app.use(
  createHealthRouter({
    dbUp: () => getDbHealth().up,
    redisPing: () => redis.ping(),
    tools: getToolVersions,
    region: env.REGION,
  }),
);

app.get('/health/ready', async (_req, res) => {
  const [db, cache] = await Promise.all([
    Promise.resolve(getDbHealth().up),
    redis.ping().then(
      () => true,
      () => false,
    ),
  ]);

  const ready = db && cache;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', db, cache });
});

/**
 * CSRF before the rate limiter: a forged cross-site request should be rejected
 * outright rather than eating the victim's allowance on the way to being
 * rejected. Safe methods and bearer-token callers are skipped inside the guard.
 */
app.use(csrfGuard);
app.use(globalRateLimit);

app.use('/api/v1', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
