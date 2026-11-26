import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Tier } from './tiers.js';

/**
 * Stream grants: the contract that lets Next.js proxy bytes without ever
 * trusting the browser.
 *
 * Upstream CDN URLs are signed, IP-locked and expiring; handing them to the
 * client would leak them and also break playback (many CDNs reject cross-origin
 * range requests). So instead:
 *
 *   1. Express extracts the rendition and mints a grant — an HMAC-signed
 *      envelope containing the upstream URL plus the entitlement that was
 *      checked at mint time.
 *   2. The browser only ever sees the opaque grant.
 *   3. The Next.js range proxy verifies the HMAC, re-checks expiry, and streams
 *      the upstream response through.
 *
 * The upstream URL therefore originates from the backend and is tamper-evident,
 * which is what closes the SSRF hole a naive `?url=` proxy would open. The proxy
 * additionally enforces `ALLOWED_STREAM_HOSTS` as defence in depth.
 */

export const STREAM_GRANT_VERSION = 1;

export interface StreamGrantPayload {
  v: number;
  /** Upstream media URL. Signed, so the proxy can trust it. */
  url: string;
  /** Hostname of `url`, denormalised so the proxy can allowlist without parsing first. */
  host: string;
  /** Subject: user id, or `guest:<fingerprint>` for anonymous sessions. */
  sub: string;
  tier: Tier;
  /** Deterministic media id, for logging and per-media rate limiting. */
  mediaId: string;
  formatId: string;
  /** Content-Type to advertise when upstream is vague. */
  mime: string | null;
  /** Manifest grants let the proxy rewrite child URIs; progressive ones do not. */
  manifest: boolean;
  /** Issued-at / expiry, epoch seconds. */
  iat: number;
  exp: number;
}

export class StreamGrantError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'MALFORMED'
      | 'BAD_SIGNATURE'
      | 'EXPIRED'
      | 'VERSION_MISMATCH'
      | 'HOST_NOT_ALLOWED',
  ) {
    super(message);
    this.name = 'StreamGrantError';
  }
}

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createStreamGrant(
  payload: Omit<StreamGrantPayload, 'v' | 'iat' | 'exp' | 'host'>,
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  let host: string;
  try {
    host = new URL(payload.url).hostname.toLowerCase();
  } catch {
    throw new StreamGrantError('Cannot sign a grant for a non-absolute URL', 'MALFORMED');
  }

  const full: StreamGrantPayload = {
    ...payload,
    v: STREAM_GRANT_VERSION,
    host,
    iat: now,
    exp: now + ttlSeconds,
  };

  const body = b64urlEncode(JSON.stringify(full));
  return `${body}.${sign(body, secret)}`;
}

export function verifyStreamGrant(token: string, secret: string): StreamGrantPayload {
  const separator = token.lastIndexOf('.');
  if (separator <= 0 || separator === token.length - 1) {
    throw new StreamGrantError('Grant is not in <body>.<signature> form', 'MALFORMED');
  }

  const body = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = sign(body, secret);

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on mismatched lengths.
  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    throw new StreamGrantError('Grant signature does not verify', 'BAD_SIGNATURE');
  }

  let payload: StreamGrantPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StreamGrantPayload;
  } catch {
    throw new StreamGrantError('Grant body is not valid JSON', 'MALFORMED');
  }

  if (payload.v !== STREAM_GRANT_VERSION) {
    throw new StreamGrantError(`Unsupported grant version ${payload.v}`, 'VERSION_MISMATCH');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new StreamGrantError('Grant has expired', 'EXPIRED');
  }
  if (typeof payload.url !== 'string' || !/^https?:\/\//i.test(payload.url)) {
    throw new StreamGrantError('Grant carries a non-http(s) URL', 'MALFORMED');
  }

  return payload;
}

/**
 * Defence in depth for the proxy. Even a validly signed grant is refused when
 * its host is not one we expect to fetch from, so a compromised signing path
 * cannot be escalated into a request against internal infrastructure.
 */
export function assertHostAllowed(host: string, allowlist: readonly string[]): void {
  const normalised = host.toLowerCase();

  if (isPrivateHostname(normalised)) {
    throw new StreamGrantError(`Refusing to proxy private host ${host}`, 'HOST_NOT_ALLOWED');
  }
  // An empty allowlist means "any public host" — appropriate when yt-dlp may
  // return CDNs from 1000+ extractors that cannot be enumerated ahead of time.
  if (allowlist.length === 0) return;

  const ok = allowlist.some((entry) => {
    const pattern = entry.toLowerCase().trim();
    if (!pattern) return false;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".example.com"
      return normalised.endsWith(suffix);
    }
    return normalised === pattern;
  });

  if (!ok) throw new StreamGrantError(`Host ${host} is not allowlisted`, 'HOST_NOT_ALLOWED');
}

/** Blocks loopback, link-local, RFC1918, unique-local, multicast and reserved literals, incl. IPv4-in-IPv6 forms. */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }

  const v4 = parseIpv4(host);
  if (v4) return isPrivateIpv4(v4);

  if (host.includes(':')) {
    const bytes = parseIpv6(host);
    // Unparseable "IPv6" is refused rather than guessed at.
    if (!bytes) return true;
    return isPrivateIpv6(bytes);
  }

  return false;
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
  return parts.every((n) => n <= 255) ? parts : null;
}

function isPrivateIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Expands any textual IPv6 (including `::` and a trailing dotted quad) to 16 bytes. */
function parseIpv6(host: string): number[] | null {
  const zone = host.indexOf('%');
  let text = zone === -1 ? host : host.slice(0, zone);
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (tail) {
    const q = parseIpv4(tail[1]!);
    if (!q) return null;
    text = text.slice(0, -tail[1]!.length) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function isPrivateIpv6(b: number[]): boolean {
  const allZeroUntil = (n: number) => b.slice(0, n).every((x) => x === 0);
  if (allZeroUntil(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (allZeroUntil(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIpv4([b[12]!, b[13]!, b[14]!, b[15]!]); // ::ffff:a.b.c.d
  if (allZeroUntil(12)) return isPrivateIpv4([b[12]!, b[13]!, b[14]!, b[15]!]); // deprecated IPv4-compatible
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return isPrivateIpv4([b[12]!, b[13]!, b[14]!, b[15]!]);
  }
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (b[0] === 0xff) return true; // multicast
  return false;
}
