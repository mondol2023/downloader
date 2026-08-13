import { createHash, randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Response } from 'express';
import type { Tier } from '@media/shared';
import { env, isProd } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const ACCESS_COOKIE = 'mg_at';
export const REFRESH_COOKIE = 'mg_rt';
export const GUEST_COOKIE = 'mg_gid';
export const CSRF_COOKIE = 'mg_csrf';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  email: string;
  tier: Tier;
  typ: 'access';
}

/**
 * Tokens live in HttpOnly cookies so no XSS payload can exfiltrate them.
 * That choice makes the API CSRF-eligible, which is why `sameSite: 'lax'` is
 * paired with a double-submit CSRF token on every state-changing route.
 */
function cookieBase(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE || isProd,
    sameSite: 'lax' as const,
    domain: env.COOKIE_DOMAIN === 'localhost' ? undefined : env.COOKIE_DOMAIN,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}

export function signAccessToken(user: { id: string; email: string; tier: Tier }): string {
  return jwt.sign(
    { email: user.email, tier: user.tier, typ: 'access' } satisfies Omit<AccessTokenClaims, 'sub'>,
    env.JWT_ACCESS_SECRET,
    {
      subject: user.id,
      expiresIn: env.ACCESS_TOKEN_TTL,
      issuer: 'media-engine',
      audience: 'media-engine-web',
      jwtid: randomUUID(),
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'media-engine',
      audience: 'media-engine-web',
    }) as AccessTokenClaims;
    if (claims.typ !== 'access') throw new Error('wrong token type');
    return claims;
  } catch (err) {
    throw AppError.unauthorized(
      err instanceof jwt.TokenExpiredError ? 'Session expired' : 'Invalid session',
    );
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Refresh tokens rotate on every use and are tracked as a family. Presenting an
 * already-rotated token means the cookie leaked, so the whole family is revoked
 * rather than just that one token.
 */
export async function issueRefreshToken(
  userId: string,
  context: { familyId?: string; userAgent?: string; ip?: string },
): Promise<string> {
  const token = `${randomUUID()}.${randomUUID()}`;
  const familyId = context.familyId ?? randomUUID();

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      familyId,
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      ip: context.ip ?? null,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
    },
  });

  return token;
}

export async function rotateRefreshToken(
  presented: string,
  context: { userAgent?: string; ip?: string },
): Promise<{ userId: string; token: string }> {
  const tokenHash = hashToken(presented);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record) throw AppError.unauthorized('Invalid refresh token');

  if (record.revokedAt) {
    // Reuse detection: this token was already exchanged. Assume theft.
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn({ userId: record.userId, familyId: record.familyId }, 'Refresh token reuse detected — family revoked');
    throw AppError.unauthorized('Session revoked, please sign in again');
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized('Session expired');
  }
  if (record.user.disabledAt) {
    throw AppError.forbidden('Account disabled');
  }

  const next = await issueRefreshToken(record.userId, {
    familyId: record.familyId,
    userAgent: context.userAgent,
    ip: context.ip,
  });

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date(), replacedBy: hashToken(next) },
  });

  return { userId: record.userId, token: next };
}

export async function revokeRefreshToken(presented: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(presented), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, cookieBase(env.ACCESS_TOKEN_TTL));
  // Scoped to the refresh endpoint so it is not sent on every API call.
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieBase(env.REFRESH_TOKEN_TTL),
    path: '/api/v1/auth',
  });
  // Readable by JS on purpose: the browser echoes it back in X-CSRF-Token.
  res.cookie(CSRF_COOKIE, randomUUID(), {
    ...cookieBase(env.REFRESH_TOKEN_TTL),
    httpOnly: false,
  });
}

export function clearAuthCookies(res: Response): void {
  const base = { ...cookieBase(0), maxAge: undefined };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/v1/auth' });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}

/** Housekeeping: called from a periodic job to keep the table small. */
export async function pruneExpiredRefreshTokens(): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
