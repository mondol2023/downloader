import { randomUUID } from 'node:crypto';
import type {
  DeliveryProtocol,
  ExtractionResult,
  GatedMediaFormat,
  IneligibleCode,
  MediaFormat,
  MediaKind,
  MediaMetadata,
  StreamContainer,
  SubtitleTrack,
  Thumbnail,
  Tier,
} from '@media/shared';
import { INELIGIBLE_CODES, evaluateFormatAccess, minimumTierFor, policyFor } from '@media/shared';
import { env } from '../config/env.js';
import { keys, redis } from '../lib/redis.js';
import { getDbHealth } from '../features/persistence/index.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { CommandError, assertNotFlag, runCommand } from '../lib/exec.js';
import { evaluateEligibility, refusalError } from '../features/eligibility/index.js';
import { normaliseSourceUrl, platformFromHost, type NormalisedSource } from '../lib/source-url.js';

/**
 * Extraction: turns an arbitrary media URL into a normalised, cacheable record.
 *
 * Two invariants drive the design:
 *
 *  1. **Upstream URLs never leave the backend.** They are signed, IP-bound and
 *     expiring; leaking them breaks playback and hands out our extraction work
 *     for free. They live in `ExtractionRecord.urls`, which is stripped before
 *     the record is serialised to a client. Playback goes through a minted
 *     stream grant instead (see stream.service.ts).
 *
 *  2. **Extraction is expensive and identical for every caller**, so the result
 *     is cached per media, tier-agnostic. Entitlement is applied afterwards by
 *     `gate()`, which means a Pro user and a guest share one yt-dlp run.
 */

/** yt-dlp's JSON is loosely typed by nature — 1000+ extractors, varying fields. */
interface YtDlpFormat {
  format_id?: string;
  format_note?: string;
  ext?: string;
  protocol?: string;
  url?: string;
  manifest_url?: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  tbr?: number | null;
  vbr?: number | null;
  abr?: number | null;
  asr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  language?: string | null;
  has_drm?: boolean | string | null;
}

interface YtDlpSubtitle {
  ext?: string;
  url?: string;
  name?: string;
}

interface YtDlpPayload {
  id?: string;
  _type?: string;
  availability?: string | null;
  title?: string;
  description?: string | null;
  webpage_url?: string;
  original_url?: string;
  extractor?: string;
  extractor_key?: string;
  duration?: number | null;
  uploader?: string | null;
  uploader_url?: string | null;
  channel?: string | null;
  channel_url?: string | null;
  upload_date?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  is_live?: boolean;
  live_status?: string | null;
  age_limit?: number;
  thumbnail?: string | null;
  thumbnails?: Array<{ url?: string; width?: number | null; height?: number | null }>;
  formats?: YtDlpFormat[];
  url?: string;
  ext?: string;
  subtitles?: Record<string, YtDlpSubtitle[]>;
  automatic_captions?: Record<string, YtDlpSubtitle[]>;
  chapters?: Array<{ title?: string; start_time?: number; end_time?: number }> | null;
  entries?: YtDlpPayload[];
  playlist_count?: number;
}

export interface SubtitleSource {
  url: string;
  ext: string;
  auto: boolean;
  label: string;
}

/** The cached, tier-agnostic extraction. Backend-only: contains upstream URLs. */
export interface ExtractionRecord {
  media: MediaMetadata;
  formats: MediaFormat[];
  /** formatId → upstream URL. Stripped from every client-facing response. */
  urls: Record<string, string>;
  subtitleSources: Record<string, SubtitleSource>;
  fetchedAt: string;
  expiresAt: string;
}

const LIVE_TTL_SECONDS = 30;
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const LOCK_TTL_MS = 90_000;

export async function extractMedia(
  rawUrl: string,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<ExtractionRecord> {
  const source = normaliseSourceUrl(rawUrl);

  if (!options.force) {
    const refused = await readRefusal(source.mediaId);
    if (refused) throw refused;
    const cached = await readCache(source.mediaId);
    if (cached) return cached;
  }

  // Stampede guard: ten users pasting the same viral link should cost one
  // yt-dlp run, not ten. Losers of the lock wait for the winner's result.
  const lockKey = keys.extractionLock(source.mediaId);
  const lockToken = randomUUID();
  const acquired = await redis.set(lockKey, lockToken, 'PX', LOCK_TTL_MS, 'NX');

  if (!acquired) {
    const waited = await waitForCache(source.mediaId);
    if (waited) return waited;
    // Winner died without writing a result; fall through and run it ourselves.
  }

  try {
    const record = await runExtraction(source, options.signal);
    await writeCache(record);
    return record;
  } catch (err) {
    if (err instanceof AppError && isIneligibleCode(err.code)) await writeRefusal(source.mediaId, err.code);
    throw err;
  } finally {
    // Only release a lock we still own.
    const current = await redis.get(lockKey).catch(() => null);
    if (current === lockToken) await redis.del(lockKey).catch(() => undefined);
  }
}

/** How long a refusal is remembered, so repeat pastes of the same link don't re-run yt-dlp. */
const REFUSAL_TTL_SECONDS = 600;

export function isIneligibleCode(code: string): code is IneligibleCode {
  return (INELIGIBLE_CODES as readonly string[]).includes(code);
}

async function readRefusal(mediaId: string): Promise<AppError | null> {
  try {
    const hit = await redis.get(keys.eligibilityRefusal(mediaId));
    if (!hit) return null;
    const { code } = JSON.parse(hit) as { code?: string };
    return code && isIneligibleCode(code) ? refusalError(code) : null;
  } catch (err) {
    logger.warn({ err, mediaId }, 'Refusal cache read failed');
    return null;
  }
}

async function writeRefusal(mediaId: string, code: IneligibleCode): Promise<void> {
  await redis
    .set(keys.eligibilityRefusal(mediaId), JSON.stringify({ code }), 'EX', REFUSAL_TTL_SECONDS)
    .catch((err: unknown) => logger.warn({ err, mediaId }, 'Refusal cache write failed'));
}

async function waitForCache(mediaId: string): Promise<ExtractionRecord | null> {
  const deadline = Date.now() + Math.min(env.EXTRACTION_TIMEOUT_MS, 30_000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const cached = await readCache(mediaId);
    if (cached) return cached;
  }
  return null;
}

async function readCache(mediaId: string): Promise<ExtractionRecord | null> {
  try {
    const hit = await redis.get(keys.extraction(mediaId));
    if (hit) {
      const record = JSON.parse(hit) as ExtractionRecord;
      if (Date.parse(record.expiresAt) > Date.now()) return record;
    }
  } catch (err) {
    logger.warn({ err, mediaId }, 'Extraction cache read failed');
  }

  // Cold Redis: fall back to the Postgres mirror, which is what keeps SSR
  // metadata pages working after a cache flush. Skipped while Postgres is down
  // (degraded mode) so a miss doesn't wait on a dead connection.
  if (!getDbHealth().up) return null;
  try {
    const row = await prisma.mediaCache.findUnique({ where: { id: mediaId } });
    if (row && row.expiresAt.getTime() > Date.now()) {
      const record = row.payload as unknown as ExtractionRecord;
      await prisma.mediaCache
        .update({ where: { id: mediaId }, data: { hitCount: { increment: 1 } } })
        .catch(() => undefined);
      return record;
    }
  } catch (err) {
    logger.warn({ err, mediaId }, 'Extraction mirror read failed');
  }

  return null;
}

async function writeCache(record: ExtractionRecord): Promise<void> {
  const ttlSeconds = Math.max(
    5,
    Math.floor((Date.parse(record.expiresAt) - Date.now()) / 1000),
  );

  await redis
    .set(keys.extraction(record.media.id), JSON.stringify(record), 'EX', ttlSeconds)
    .catch((err: unknown) => logger.warn({ err }, 'Extraction cache write failed'));

  // Live streams churn every 30s; mirroring them would just thrash Postgres.
  if (record.media.isLive) return;
  // Degraded mode: Redis already holds the record; don't queue on a dead DB.
  if (!getDbHealth().up) return;

  const mirror = {
    canonicalUrl: record.media.canonicalUrl,
    platform: record.media.platform,
    extractor: record.media.extractor,
    title: record.media.title,
    durationSeconds: record.media.durationSeconds,
    thumbnail: record.media.bestThumbnail,
    payload: record as unknown as object,
    expiresAt: new Date(record.expiresAt),
  };

  await prisma.mediaCache
    .upsert({
      where: { id: record.media.id },
      create: { id: record.media.id, ...mirror },
      update: mirror,
    })
    .catch((err: unknown) => logger.warn({ err }, 'Extraction mirror write failed'));
}

async function runExtraction(
  source: NormalisedSource,
  signal?: AbortSignal,
): Promise<ExtractionRecord> {
  // Defence in depth: normaliseSourceUrl already rejected anything odd, but the
  // value is about to become argv, so re-assert it cannot be read as a flag.
  assertNotFlag(source.canonical, 'URL');

  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-progress',
    '--no-playlist',
    '--no-call-home',
    // Never fake X-Forwarded-For: geo-bypass would let a region-locked source through.
    '--xff',
    'never',
    '--ignore-config',
    '--skip-download',
    '--no-check-formats',
    '--retries',
    '2',
    '--socket-timeout',
    '15',
    '--extractor-retries',
    '1',
  ];

  if (env.YTDLP_COOKIES_FILE) args.push('--cookies', env.YTDLP_COOKIES_FILE);
  args.push('--', source.canonical);

  let stdout: string;
  try {
    const result = await runCommand(env.YTDLP_PATH, {
      args,
      timeoutMs: env.EXTRACTION_TIMEOUT_MS,
      maxOutputBytes: 48 * 1024 * 1024,
      ...(signal ? { signal } : {}),
    });
    stdout = result.stdout;
  } catch (err) {
    throw translateExtractionError(err, source);
  }

  let payload: YtDlpPayload;
  try {
    payload = JSON.parse(stdout) as YtDlpPayload;
  } catch {
    throw AppError.upstream('The extractor returned an unreadable response');
  }

  // `--no-playlist` still yields a playlist envelope for some extractors.
  if (payload._type === 'playlist' && Array.isArray(payload.entries)) {
    const first = payload.entries.find((entry) => entry && (entry.formats || entry.url));
    if (!first) throw AppError.notFound('No playable media was found at that URL');
    payload = { ...first, webpage_url: first.webpage_url ?? payload.webpage_url };
  }

  return buildRecord(source, payload);
}

export function translateExtractionError(
  err: unknown,
  source: Pick<NormalisedSource, 'platform'>,
): AppError {
  if (!(err instanceof CommandError)) {
    return AppError.upstream('Extraction failed unexpectedly');
  }
  if (err.timedOut) {
    return AppError.timeout('The source took too long to respond. Try again in a moment.');
  }

  const stderr = err.stderr.toLowerCase();
  logger.warn({ platform: source.platform, stderr: err.stderr.slice(-800) }, 'yt-dlp extraction failed');

  if (stderr.includes('is not a valid url') || stderr.includes('unsupported url')) {
    return AppError.badRequest('That site is not supported yet.');
  }
  if (stderr.includes('members-only') || stderr.includes('join this channel') || stderr.includes('premium')) {
    return refusalError('SOURCE_MEMBERS_ONLY');
  }
  if (stderr.includes('private video') || stderr.includes('login required') || stderr.includes('sign in')) {
    return new AppError(403, 'SOURCE_PRIVATE', 'That media is private or requires a sign-in on the source site.');
  }
  if (stderr.includes('age') && stderr.includes('confirm')) {
    return new AppError(403, 'SOURCE_AGE_RESTRICTED', 'That media is age-restricted at the source.');
  }
  if (stderr.includes('video unavailable') || stderr.includes('404') || stderr.includes('not found')) {
    return AppError.notFound('That media no longer exists at the source.');
  }
  if (stderr.includes('geo') || stderr.includes('not available in your country')) {
    return new AppError(451, 'SOURCE_GEOBLOCKED', 'That media is blocked in this service\'s region.');
  }
  if (stderr.includes('copyright') || stderr.includes('drm')) {
    return new AppError(403, 'SOURCE_PROTECTED', 'That media is DRM-protected and cannot be processed.');
  }
  if (stderr.includes('could not be executed')) {
    return AppError.unavailable('The extraction engine is not available right now.');
  }
  return AppError.upstream('The source could not be read. It may be temporarily unavailable.');
}

export function buildRecord(source: NormalisedSource, payload: YtDlpPayload): ExtractionRecord {
  const verdict = evaluateEligibility({
    availability: payload.availability ?? null,
    liveStatus: payload.live_status ?? (payload.is_live ? 'is_live' : null),
    ageLimit: payload.age_limit ?? 0,
    formatDrm: (payload.formats ?? []).map((format) => format.has_drm === true),
    host: source.host,
  });
  if (!verdict.eligible) throw refusalError(verdict.code);
  if (verdict.dropFormatIndexes.length > 0) {
    const drop = new Set(verdict.dropFormatIndexes);
    payload = { ...payload, formats: (payload.formats ?? []).filter((_, i) => !drop.has(i)) };
  }

  const isLive = Boolean(payload.is_live) || payload.live_status === 'is_live';
  const ttlSeconds = isLive ? LIVE_TTL_SECONDS : DEFAULT_TTL_SECONDS;
  const now = new Date();

  const { formats, urls } = normaliseFormats(payload);
  if (formats.length === 0) {
    throw AppError.unprocessable('No downloadable renditions were found for that URL.');
  }

  const { tracks, sources } = normaliseSubtitles(payload, source.mediaId);
  const thumbnails = normaliseThumbnails(payload);

  const canonicalUrl = payload.webpage_url ?? source.canonical;
  const extractor = payload.extractor_key ?? payload.extractor ?? 'generic';

  const media: MediaMetadata = {
    id: source.mediaId,
    sourceUrl: source.original,
    canonicalUrl,
    extractor,
    platform: normalisePlatform(extractor, source),
    kind: inferKind(formats, isLive),
    title: (payload.title ?? 'Untitled').slice(0, 500),
    description: payload.description ? payload.description.slice(0, 5000) : null,
    durationSeconds: numberOrNull(payload.duration),
    uploader: payload.uploader ?? payload.channel ?? null,
    uploaderUrl: payload.uploader_url ?? payload.channel_url ?? null,
    uploadDate: formatUploadDate(payload.upload_date),
    viewCount: numberOrNull(payload.view_count),
    likeCount: numberOrNull(payload.like_count),
    isLive,
    ageLimit: payload.age_limit ?? 0,
    availability: payload.availability ?? null,
    thumbnails,
    bestThumbnail: payload.thumbnail ?? thumbnails[thumbnails.length - 1]?.url ?? null,
    subtitles: tracks,
    chapters: (payload.chapters ?? [])
      .filter((chapter) => chapter && typeof chapter.start_time === 'number')
      .map((chapter) => ({
        title: chapter.title ?? 'Chapter',
        startSeconds: chapter.start_time ?? 0,
        endSeconds: chapter.end_time ?? 0,
      })),
  };

  return {
    media,
    formats,
    urls,
    subtitleSources: sources,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

function normalisePlatform(extractor: string, source: NormalisedSource): string {
  const key = extractor.toLowerCase();
  if (!key || key === 'generic') return source.platform;
  // `Youtube:tab` / `TikTok` / `Facebook` → a stable, lowercase family name.
  const family = key.split(':')[0] ?? key;
  return family === 'twitter' ? 'x' : family || platformFromHost(source.host);
}

function normaliseFormats(payload: YtDlpPayload): {
  formats: MediaFormat[];
  urls: Record<string, string>;
} {
  const urls: Record<string, string> = {};
  const raw = payload.formats ?? [];

  // Some extractors (direct media links, many image posts) return a single URL
  // with no `formats` array at all.
  if (raw.length === 0 && payload.url) {
    const id = 'source';
    urls[id] = payload.url;
    return {
      formats: [
        {
          id,
          track: 'muxed',
          container: toContainer(payload.ext),
          protocol: 'https',
          width: null,
          height: null,
          fps: null,
          label: 'Original',
          videoCodec: null,
          audioCodec: null,
          bitrateKbps: null,
          sizeBytes: null,
          sizeIsEstimate: false,
          hasAudio: true,
          hasVideo: true,
          requiresMux: false,
        },
      ],
      urls,
    };
  }

  const candidates: MediaFormat[] = [];

  for (const format of raw) {
    const url = format.url ?? format.manifest_url;
    const id = format.format_id;
    if (!url || !id) continue;
    // Storyboards and images-as-video are not playable renditions.
    if (format.ext === 'mhtml' || format.format_note?.toLowerCase().includes('storyboard')) continue;

    const hasVideo = Boolean(format.vcodec && format.vcodec !== 'none');
    const hasAudio = Boolean(format.acodec && format.acodec !== 'none');
    if (!hasVideo && !hasAudio) continue;

    const track: MediaFormat['track'] = hasVideo && hasAudio ? 'muxed' : hasVideo ? 'video' : 'audio';
    const size = numberOrNull(format.filesize);
    const approx = numberOrNull(format.filesize_approx);

    urls[id] = url;

    candidates.push({
      id,
      track,
      container: toContainer(format.ext),
      protocol: toProtocol(format.protocol),
      width: numberOrNull(format.width),
      height: numberOrNull(format.height),
      fps: format.fps ? Math.round(format.fps) : null,
      label: buildLabel(format, track),
      videoCodec: cleanCodec(format.vcodec),
      audioCodec: cleanCodec(format.acodec),
      bitrateKbps: format.tbr ? Math.round(format.tbr) : format.abr ? Math.round(format.abr) : null,
      sizeBytes: size ?? approx,
      sizeIsEstimate: size == null && approx != null,
      hasAudio,
      hasVideo,
      // Video-only renditions must be merged with an audio stream by ffmpeg.
      requiresMux: track === 'video',
    });
  }

  return { formats: dedupeAndSort(candidates), urls };
}

/**
 * Platforms routinely publish the same rendition several times (different CDN
 * containers, DASH vs progressive). Showing all of them makes the quality
 * selector unusable, so we keep the best entry per (track, height, fps,
 * container) bucket, preferring higher bitrate and a known file size.
 */
function dedupeAndSort(formats: MediaFormat[]): MediaFormat[] {
  const best = new Map<string, MediaFormat>();

  for (const format of formats) {
    const key = [
      format.track,
      format.height ?? 0,
      format.fps ?? 0,
      format.container,
      format.track === 'audio' ? format.bitrateKbps ?? 0 : '',
    ].join('|');

    const existing = best.get(key);
    if (!existing) {
      best.set(key, format);
      continue;
    }
    const score = (f: MediaFormat) =>
      (f.bitrateKbps ?? 0) + (f.sizeBytes != null && !f.sizeIsEstimate ? 1 : 0) +
      (f.protocol === 'https' ? 2 : 0);
    if (score(format) > score(existing)) best.set(key, format);
  }

  const rank = { muxed: 0, video: 1, audio: 2 } as const;

  return [...best.values()].sort((a, b) => {
    if (a.track !== b.track) return rank[a.track] - rank[b.track];
    if ((b.height ?? 0) !== (a.height ?? 0)) return (b.height ?? 0) - (a.height ?? 0);
    if ((b.fps ?? 0) !== (a.fps ?? 0)) return (b.fps ?? 0) - (a.fps ?? 0);
    return (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0);
  });
}

function buildLabel(format: YtDlpFormat, track: MediaFormat['track']): string {
  if (track === 'audio') {
    const rate = format.abr ?? format.tbr;
    const codec = cleanCodec(format.acodec);
    return rate ? `Audio ${Math.round(rate)} kbps${codec ? ` · ${codec}` : ''}` : 'Audio';
  }

  const height = format.height;
  if (!height) return format.format_note?.trim() || 'Video';

  const fps = format.fps && format.fps >= 50 ? Math.round(format.fps) : null;
  const resolutionName =
    height >= 4320 ? '8K' : height >= 2160 ? '4K' : height >= 1440 ? '2K' : null;

  const base = `${height}p${fps ?? ''}`;
  return resolutionName ? `${base} · ${resolutionName}` : base;
}

function cleanCodec(codec: string | null | undefined): string | null {
  if (!codec || codec === 'none') return null;
  // "avc1.640028" → "avc1"
  return codec.split('.')[0] ?? codec;
}

function toContainer(ext: string | null | undefined): StreamContainer {
  switch ((ext ?? '').toLowerCase()) {
    case 'mp4':
      return 'mp4';
    case 'webm':
      return 'webm';
    case 'mkv':
      return 'mkv';
    case 'm4a':
      return 'm4a';
    case 'mp3':
      return 'mp3';
    case 'ts':
      return 'ts';
    default:
      return 'unknown';
  }
}

function toProtocol(protocol: string | null | undefined): DeliveryProtocol {
  const value = (protocol ?? '').toLowerCase();
  if (value.includes('m3u8')) return 'hls';
  if (value.includes('dash')) return 'dash';
  return 'https';
}

function inferKind(formats: MediaFormat[], isLive: boolean): MediaKind {
  if (isLive) return 'live';
  return formats.some((format) => format.hasVideo) ? 'video' : 'audio';
}

function normaliseThumbnails(payload: YtDlpPayload): Thumbnail[] {
  return (payload.thumbnails ?? [])
    .filter((thumbnail): thumbnail is { url: string; width?: number | null; height?: number | null } =>
      typeof thumbnail?.url === 'string',
    )
    .map((thumbnail) => ({
      url: thumbnail.url,
      width: numberOrNull(thumbnail.width),
      height: numberOrNull(thumbnail.height),
    }))
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
    .slice(-6);
}

/**
 * Subtitle URLs are upstream URLs too, so the client is handed a route on this
 * API rather than the real one. The route fetches and converts to WebVTT, which
 * is the only format an HTML5 `<track>` accepts.
 */
function normaliseSubtitles(
  payload: YtDlpPayload,
  mediaId: string,
): { tracks: SubtitleTrack[]; sources: Record<string, SubtitleSource> } {
  const tracks: SubtitleTrack[] = [];
  const sources: Record<string, SubtitleSource> = {};

  const collect = (map: Record<string, YtDlpSubtitle[]> | undefined, auto: boolean) => {
    for (const [lang, variants] of Object.entries(map ?? {})) {
      if (!Array.isArray(variants) || variants.length === 0) continue;
      // Only accept a language tag we would be willing to put in a URL path.
      if (!/^[a-zA-Z0-9_-]{1,24}$/.test(lang)) continue;

      const key = auto ? `${lang}-auto` : lang;
      if (sources[key]) continue;

      const preferred =
        variants.find((variant) => variant.ext === 'vtt') ??
        variants.find((variant) => variant.ext === 'srt') ??
        variants[0];
      if (!preferred?.url) continue;

      sources[key] = {
        url: preferred.url,
        ext: (preferred.ext ?? 'vtt').toLowerCase(),
        auto,
        label: preferred.name ?? lang,
      };

      tracks.push({
        lang: key,
        label: `${preferred.name ?? lang}${auto ? ' (auto)' : ''}`,
        ext: 'vtt',
        autoGenerated: auto,
        url: `/api/v1/media/${mediaId}/subtitles/${encodeURIComponent(key)}`,
      });
    }
  };

  collect(payload.subtitles, false);
  collect(payload.automatic_captions, true);

  // Manual tracks first, then auto; cap the list so the menu stays usable.
  return { tracks: tracks.slice(0, 40), sources };
}

function formatUploadDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Applies the caller's tier to a cached record.
 *
 * Locked formats are returned rather than hidden — the whole point of the
 * upgrade path is that a guest can *see* the 4K rendition they cannot have.
 * The upstream URL is never included either way, so "visible" is not "usable".
 */
export function gateRecord(record: ExtractionRecord, tier: Tier): ExtractionResult {
  const policy = policyFor(tier);

  const formats: GatedMediaFormat[] = record.formats.map((format) => {
    const constraint = {
      height: format.height,
      fps: format.fps,
      sizeBytes: format.sizeBytes,
    };
    const { allowed, reason } = evaluateFormatAccess(tier, constraint);
    return {
      ...format,
      allowed,
      lockReason: reason,
      requiredTier: allowed ? tier : minimumTierFor(constraint),
    };
  });

  // Open on the best rendition the caller may actually play: prefer a muxed
  // stream (no ffmpeg needed), fall back to any allowed video, then audio.
  const playable = formats.filter((format) => format.allowed);
  const recommended =
    playable.find((format) => format.track === 'muxed' && format.hasVideo) ??
    playable.find((format) => format.hasVideo) ??
    playable[0] ??
    null;

  return {
    media: record.media,
    formats,
    recommendedFormatId: recommended?.id ?? null,
    lockedFormatCount: formats.filter((format) => !format.allowed).length,
    tier,
    cachedAt: record.fetchedAt,
    expiresAt: record.expiresAt,
  };
}

/** Looks up the upstream URL for a rendition. Backend-only. */
export function upstreamUrlFor(record: ExtractionRecord, formatId: string): string {
  const url = record.urls[formatId];
  if (!url) throw AppError.notFound('That rendition is no longer available; re-run the extraction.');
  return url;
}

export function findFormat(record: ExtractionRecord, formatId: string): MediaFormat {
  const format = record.formats.find((candidate) => candidate.id === formatId);
  if (!format) throw AppError.notFound('Unknown format for this media');
  return format;
}

/**
 * Entitlement check for a specific rendition, run again at request time rather
 * than trusting the `allowed` flag the client was shown — that flag was
 * computed for whatever tier the caller had when the page rendered.
 */
export function assertFormatAllowed(format: MediaFormat, tier: Tier): void {
  const { allowed, reason } = evaluateFormatAccess(tier, {
    height: format.height,
    fps: format.fps,
    sizeBytes: format.sizeBytes,
  });
  if (allowed) return;

  const required = minimumTierFor({
    height: format.height,
    fps: format.fps,
    sizeBytes: format.sizeBytes,
  });
  const policy = policyFor(tier);

  const message =
    reason === 'FILE_SIZE'
      ? `That file is larger than the ${policy.label} plan's per-file limit.`
      : reason === 'FPS'
        ? `High frame rate output is above the ${policy.label} plan limit.`
        : `${format.label} is above the ${policy.label} plan's quality limit.`;

  throw AppError.forbidden(message, required);
}

/** Reads a cached record without triggering extraction. Used by playback routes. */
export async function getCachedRecord(mediaId: string): Promise<ExtractionRecord | null> {
  if (!/^[0-9a-f]{24}$/.test(mediaId)) throw AppError.badRequest('Invalid media id');
  return readCache(mediaId);
}

export { normaliseSourceUrl };
