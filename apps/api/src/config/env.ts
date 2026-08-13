import { z } from 'zod';

/**
 * Fail fast on misconfiguration. A missing signing secret must stop the process
 * at boot, not surface as an auth bypass under load.
 */

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = z
  .string()
  .default('')
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: csv,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  STREAM_SIGNING_SECRET: z.string().min(32, 'STREAM_SIGNING_SECRET must be at least 32 chars'),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: bool.default(false),

  YTDLP_PATH: z.string().default('yt-dlp'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  EXTRACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  YTDLP_COOKIES_FILE: z.string().optional(),

  STORAGE_DIR: z.string().default('./storage'),
  ARTIFACT_TTL: z.coerce.number().int().positive().default(86_400),
  /** How long a minted stream grant stays valid. Short: playback re-mints. */
  STREAM_GRANT_TTL: z.coerce.number().int().positive().default(21_600),
  /** Empty = allow any public host (needed for 1000+ extractors). */
  ALLOWED_STREAM_HOSTS: csv,

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY_PRO: z.coerce.number().int().positive().default(4),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_PRO_MONTHLY: z.string().default(''),
  STRIPE_PRICE_PRO_YEARLY: z.string().default(''),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

/** Stripe is optional in development; billing routes 503 when unconfigured. */
export const stripeEnabled = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

if (isProd) {
  const weak = ['change-me', 'secret', 'password'];
  for (const [key, value] of Object.entries({
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    STREAM_SIGNING_SECRET: env.STREAM_SIGNING_SECRET,
  })) {
    if (weak.some((w) => value.toLowerCase().includes(w))) {
      // eslint-disable-next-line no-console
      console.error(`${key} still holds a placeholder value; refusing to boot in production.`);
      process.exit(1);
    }
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    // eslint-disable-next-line no-console
    console.error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.');
    process.exit(1);
  }
}
