import { createHash } from 'node:crypto';
import { isPrivateHostname } from '@media/shared';
import { AppError } from './errors.js';
import { isBlockedHost } from '../features/eligibility/blocked-hosts.js';
import { refusalError } from '../features/eligibility/refusal.js';
import { assertPlatformAllowed } from '../features/restrictions/enforce.js';
import { getPolicy } from '../features/restrictions/policy.current.js';

/**
 * Normalises and vets a user-supplied media URL before it is ever handed to
 * yt-dlp.
 *
 * yt-dlp will happily fetch `http://169.254.169.254/latest/meta-data/` or a
 * `file://` path, which would turn the extraction endpoint into an SSRF/LFI
 * primitive. Scheme and host are therefore checked here, at the boundary, and
 * the result is canonicalised so the same video always maps to one cache key.
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'igshid',
  'si',
  'feature',
  'ref',
  'ref_src',
  'ref_url',
  's',
  'spm',
  'app',
  '_r',
  '_t',
]);

/** Params that identify *which* media, so they must survive canonicalisation. */
const SIGNIFICANT_PARAMS = new Set(['v', 'list', 'index', 't', 'start', 'id', 'story_fbid', 'video_id', 'clip']);

export interface NormalisedSource {
  /** Exactly what the user typed, trimmed. Kept for display and audit. */
  original: string;
  /** Deterministic form used for cache keys and dedupe. */
  canonical: string;
  host: string;
  platform: string;
  /** sha256(canonical) truncated — stable, opaque, safe in a URL path. */
  mediaId: string;
}

export function normaliseSourceUrl(
  input: string,
  options: { skipPolicy?: boolean } = {},
): NormalisedSource {
  const trimmed = input.trim();
  if (!trimmed) throw AppError.badRequest('A media URL is required');
  if (trimmed.length > 2048) throw AppError.badRequest('That URL is too long');

  let parsed: URL;
  try {
    // Accept bare `youtube.com/...` by assuming https.
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw AppError.badRequest('That does not look like a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw AppError.badRequest('Only http:// and https:// URLs are supported');
  }
  if (parsed.username || parsed.password) {
    throw AppError.badRequest('URLs with embedded credentials are not accepted');
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || !host.includes('.')) {
    throw AppError.badRequest('That URL has no public hostname');
  }
  if (isPrivateHostname(host)) {
    throw AppError.badRequest('That host is not reachable from this service');
  }
  const platform = platformFromHost(host);
  // Admin tooling (takedowns, policy preview) needs the media id of a URL the live policy refuses.
  if (!options.skipPolicy) {
    if (isBlockedHost(host, getPolicy())) throw refusalError('SOURCE_BLOCKED_DOMAIN');
    assertPlatformAllowed(platform, 'extract');
  }

  // Rebuild rather than mutate, so nothing exotic survives.
  const canonicalUrl = new URL(`${parsed.protocol}//${host}${parsed.pathname}`);
  canonicalUrl.port = parsed.port && parsed.port !== '443' && parsed.port !== '80' ? parsed.port : '';

  // Drop the trailing slash except at the root, so /watch/ === /watch.
  if (canonicalUrl.pathname.length > 1 && canonicalUrl.pathname.endsWith('/')) {
    canonicalUrl.pathname = canonicalUrl.pathname.replace(/\/+$/, '');
  }

  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => SIGNIFICANT_PARAMS.has(key) || !TRACKING_PARAMS.has(key))
    .filter(([key]) => !key.startsWith('utm_'))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [key, value] of params) canonicalUrl.searchParams.append(key, value);

  const canonical = canonicalUrl.toString();

  return {
    original: trimmed,
    canonical,
    host,
    platform,
    mediaId: createHash('sha256').update(canonical).digest('hex').slice(0, 24),
  };
}

const PLATFORM_BY_SUFFIX: Array<[string, string]> = [
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['facebook.com', 'facebook'],
  ['fb.watch', 'facebook'],
  ['instagram.com', 'instagram'],
  ['twitter.com', 'x'],
  ['x.com', 'x'],
  ['tiktok.com', 'tiktok'],
  ['reddit.com', 'reddit'],
  ['redd.it', 'reddit'],
  ['vimeo.com', 'vimeo'],
  ['twitch.tv', 'twitch'],
  ['dailymotion.com', 'dailymotion'],
  ['soundcloud.com', 'soundcloud'],
  ['bilibili.com', 'bilibili'],
  ['pinterest.com', 'pinterest'],
  ['linkedin.com', 'linkedin'],
  ['tumblr.com', 'tumblr'],
];

/** Best-effort label. The extractor name from yt-dlp overrides this once known. */
export function platformFromHost(host: string): string {
  const bare = host.replace(/^www\./, '').replace(/^m\./, '');
  for (const [suffix, platform] of PLATFORM_BY_SUFFIX) {
    if (bare === suffix || bare.endsWith(`.${suffix}`)) return platform;
  }
  const parts = bare.split('.');
  return parts.length >= 2 ? (parts[parts.length - 2] ?? bare) : bare;
}
