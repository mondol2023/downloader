import { createHash, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Tier } from '@media/shared';
import { env, isProd } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { ACCESS_COOKIE, CSRF_COOKIE, GUEST_COOKIE, verifyAccessToken } from '../services/token.service.js';

/**
 * Resolves who is calling before any route runs. Anonymous callers are not
 * rejected — they become GUEST identities with their own quota subject, which
 * is what lets the platform offer 3 downloads without registration.
 */
export function attachIdentity(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.header('x-request-id') || randomUUID()).slice(0, 64);
  res.setHeader('x-request-id', req.requestId);

  const ipHash = hashIp(clientIp(req));

  // A guest cookie is the primary anonymous key. It is trivially clearable, so
  // the IP hash below is enforced as a second, coarser ceiling.
  let guestKey = readGuestCookie(req);
  if (!guestKey) {
    guestKey = randomUUID();
    res.cookie(GUEST_COOKIE, guestKey, {
      httpOnly: true,
      secure: env.COOKIE_SECURE || isProd,
      sameSite: 'lax',
      domain: env.COOKIE_DOMAIN === 'localhost' ? undefined : env.COOKIE_DOMAIN,
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
  }

  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;

  if (!token) {
    req.identity = {
      userId: null,
      guestKey,
      subject: `guest:${guestKey}`,
      tier: 'GUEST',
      email: null,
      ipHash,
    };
    next();
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.identity = {
      userId: claims.sub,
      guestKey,
      subject: `user:${claims.sub}`,
      // The JWT carries the tier so the hot path needs no DB round trip. It is
      // re-read from the database on the routes that spend entitlement.
      tier: claims.tier,
      email: claims.email,
      ipHash,
    };
  } catch {
    // An expired or tampered cookie degrades to guest rather than 401ing, so
    // public pages keep working while the client silently refreshes.
    req.identity = {
      userId: null,
      guestKey,
      subject: `guest:${guestKey}`,
      tier: 'GUEST',
      email: null,
      ipHash,
    };
  }

  next();
}

/** Rejects anonymous callers. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.identity?.userId) {
    next(AppError.unauthorized('You must be signed in to do this'));
    return;
  }
  next();
}

/**
 * Re-reads the tier from Postgres. Used before anything that spends money or
 * entitlement, because a downgrade (failed payment, cancellation) must take
 * effect before the access token naturally expires.
 */
export async function refreshTierFromDb(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.identity?.userId) {
    next();
    return;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.identity.userId },
      select: { tier: true, disabledAt: true, disabledReason: true },
    });
    if (!user) {
      next(AppError.unauthorized('Account no longer exists'));
      return;
    }
    if (user.disabledAt) {
      next(AppError.forbidden(user.disabledReason ?? 'Account disabled'));
      return;
    }
    req.identity.tier = user.tier as Tier;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Double-submit CSRF check. Cookie auth means a cross-site form post would
 * otherwise carry the session; requiring a header that only same-origin JS can
 * read blocks that.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  // Bearer callers (server-to-server, mobile) are not cookie-driven.
  if (req.header('authorization')?.startsWith('Bearer ')) {
    next();
    return;
  }
  // No session cookie means nothing to forge.
  if (!req.cookies?.[ACCESS_COOKIE]) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const headerToken = req.header('x-csrf-token');

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    next(new AppError(403, 'CSRF_FAILED', 'CSRF token missing or invalid'));
    return;
  }
  next();
}

export function clientIp(req: Request): string {
  // `trust proxy` is configured in index.ts, so req.ip already honours
  // X-Forwarded-For from the trusted hop only.
  return req.ip ?? req.socket.remoteAddress ?? '0.0.0.0';
}

/** Never store raw IPs on quota keys — hashing keeps the counters non-identifying. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${ip}:${env.JWT_ACCESS_SECRET}`).digest('hex').slice(0, 32);
}

function readGuestCookie(req: Request): string | null {
  const raw = req.cookies?.[GUEST_COOKIE];
  if (typeof raw !== 'string') return null;
  // Only accept a well-formed UUID; anything else is attacker-controlled input
  // that would end up inside a Redis key.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}
