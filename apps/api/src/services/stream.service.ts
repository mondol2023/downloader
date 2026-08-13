import { createStreamGrant, isPrivateHostname, type MediaFormat, type Tier } from '@media/shared';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { upstreamUrlFor, type ExtractionRecord } from './extraction.service.js';

/**
 * Mints the opaque tokens the browser uses to play media.
 *
 * The browser is never told where the bytes really come from. It receives a
 * grant — an HMAC envelope over the upstream URL plus the entitlement checked
 * at mint time — and hands it back to the Next.js range proxy, which verifies
 * the signature before opening any socket. That inversion is what keeps the
 * proxy from being an open SSRF relay.
 */

export interface PlaybackGrant {
  formatId: string;
  /** Relative URL on the Next.js origin. Range requests go here. */
  playbackUrl: string;
  protocol: MediaFormat['protocol'];
  mimeType: string;
  expiresAt: string;
}

const MIME_BY_CONTAINER: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ts: 'video/mp2t',
};

export function mimeTypeFor(format: MediaFormat): string {
  if (format.protocol === 'hls') return 'application/vnd.apple.mpegurl';
  if (format.protocol === 'dash') return 'application/dash+xml';
  const base = MIME_BY_CONTAINER[format.container];
  if (base) return format.track === 'audio' && base.startsWith('video/') ? 'audio/mp4' : base;
  return format.track === 'audio' ? 'audio/mpeg' : 'video/mp4';
}

export function mintPlaybackGrant(
  record: ExtractionRecord,
  format: MediaFormat,
  subject: { sub: string; tier: Tier },
): PlaybackGrant {
  const url = upstreamUrlFor(record, format.id);

  // The URL came from yt-dlp, not the client — but an extractor could still
  // hand back something internal, so it is re-checked before being signed.
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw AppError.upstream('The source returned an unusable media URL');
  }
  if (isPrivateHostname(host)) {
    throw AppError.upstream('The source returned a non-public media URL');
  }

  const manifest = format.protocol === 'hls' || format.protocol === 'dash';
  // Live manifests rotate quickly; a long grant would outlive its own playlist.
  const ttl = record.media.isLive
    ? Math.min(env.STREAM_GRANT_TTL, 300)
    : env.STREAM_GRANT_TTL;

  const token = createStreamGrant(
    {
      url,
      sub: subject.sub,
      tier: subject.tier,
      mediaId: record.media.id,
      formatId: format.id,
      mime: mimeTypeFor(format),
      manifest,
    },
    env.STREAM_SIGNING_SECRET,
    ttl,
  );

  return {
    formatId: format.id,
    playbackUrl: `/api/stream/${token}`,
    protocol: format.protocol,
    mimeType: mimeTypeFor(format),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

/**
 * Grants for subtitle fetches. Subtitles are small and need conversion, so they
 * are served by this API directly rather than proxied by Next.js — but the same
 * private-host rule applies before we fetch anything.
 */
export function assertFetchableUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw AppError.upstream('Malformed upstream URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw AppError.upstream('Refusing to fetch a non-http(s) URL');
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw AppError.upstream('Refusing to fetch a private host');
  }
  return parsed;
}
