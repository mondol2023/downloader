import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import { clientIp, requireAuth } from '../middleware/identity.js';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  issueRefreshToken,
  revokeAllSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  setAuthCookies,
  signAccessToken,
} from '../services/token.service.js';
import {
  authenticate,
  changePassword,
  loadAuthUser,
  recordAudit,
  registerUser,
  toAuthUser,
} from '../services/user.service.js';
import { getQuotaSnapshot, quotaIdentity } from '../services/quota.service.js';
import type { Tier } from '@media/shared';

/**
 * Authentication lives here and nowhere else. Next.js never mints or verifies a
 * session token — it forwards cookies to this service and renders whatever it
 * gets back, which keeps exactly one implementation of the auth rules.
 */

const router = Router();

// Long enough to resist offline attack, no composition rules: length is what
// actually helps, and arbitrary symbol requirements push users to `Password1!`.
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password is too long');

const credentials = z.object({
  email: z.string().email('Enter a valid email address').max(320),
  password,
});

const registration = credentials.extend({
  displayName: z.string().trim().min(1).max(80).optional(),
});

router.post(
  '/register',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = registration.parse(req.body);
    const user = await registerUser(input);

    const refreshToken = await issueRefreshToken(user.id, {
      userAgent: req.header('user-agent') ?? undefined,
      ip: clientIp(req),
    });
    const accessToken = signAccessToken({ id: user.id, email: user.email, tier: user.tier as Tier });
    setAuthCookies(res, accessToken, refreshToken);

    await recordAudit({
      userId: user.id,
      action: 'auth.register',
      outcome: 'success',
      ip: clientIp(req),
      userAgent: req.header('user-agent'),
    });

    res.status(201).json({ data: toAuthUser(user) });
  }),
);

router.post(
  '/login',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = credentials.parse(req.body);

    let user;
    try {
      user = await authenticate(input.email, input.password);
    } catch (err) {
      await recordAudit({
        action: 'auth.login',
        outcome: 'failure',
        ip: clientIp(req),
        userAgent: req.header('user-agent'),
        metadata: { email: input.email.toLowerCase() },
      });
      throw err;
    }

    const refreshToken = await issueRefreshToken(user.id, {
      userAgent: req.header('user-agent') ?? undefined,
      ip: clientIp(req),
    });
    const accessToken = signAccessToken({ id: user.id, email: user.email, tier: user.tier as Tier });
    setAuthCookies(res, accessToken, refreshToken);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit({
      userId: user.id,
      action: 'auth.login',
      outcome: 'success',
      ip: clientIp(req),
      userAgent: req.header('user-agent'),
    });

    res.json({ data: await loadAuthUser(user.id) });
  }),
);

/**
 * Rotation endpoint. Every call invalidates the presented token and issues a
 * new one in the same family; presenting a spent token revokes the family (see
 * token.service). The refresh cookie is path-scoped to this router so it is not
 * attached to ordinary API traffic.
 */
router.post(
  '/refresh',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!presented) throw AppError.unauthorized('No session to refresh');

    let rotated;
    try {
      rotated = await rotateRefreshToken(presented, {
        userAgent: req.header('user-agent') ?? undefined,
        ip: clientIp(req),
      });
    } catch (err) {
      // A failed rotation means the session is unusable; clear it so the client
      // stops retrying with a dead cookie.
      clearAuthCookies(res);
      throw err;
    }

    const user = await prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user) throw AppError.unauthorized('Account no longer exists');
    if (user.disabledAt) throw AppError.forbidden(user.disabledReason ?? 'This account is disabled');

    // The new access token carries the tier as it is *now*, which is how a
    // Stripe upgrade or cancellation reaches the client within one refresh.
    const accessToken = signAccessToken({ id: user.id, email: user.email, tier: user.tier as Tier });
    setAuthCookies(res, accessToken, rotated.token);

    res.json({ data: await loadAuthUser(user.id) });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (presented) await revokeRefreshToken(presented);
    clearAuthCookies(res);

    await recordAudit({
      userId: req.identity.userId,
      action: 'auth.logout',
      outcome: 'success',
      ip: clientIp(req),
    });

    res.status(204).end();
  }),
);

/** Signs the user out everywhere — the correct response to a suspected leak. */
router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(req.identity.userId as string);
    clearAuthCookies(res);
    await recordAudit({
      userId: req.identity.userId,
      action: 'auth.logout_all',
      outcome: 'success',
      ip: clientIp(req),
    });
    res.status(204).end();
  }),
);

/**
 * Session bootstrap for the frontend. Guests get a valid response too — with
 * their guest quota — because the landing page needs to render limits before
 * anyone signs in.
 */
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const quota = await getQuotaSnapshot(quotaIdentity(req.identity));

    if (!req.identity.userId) {
      res.json({ data: { user: null, tier: 'GUEST' as Tier, quota } });
      return;
    }

    const user = await loadAuthUser(req.identity.userId);
    res.json({ data: { user, tier: user.tier, quota: { ...quota, tier: user.tier } } });
  }),
);

router.post(
  '/password',
  requireAuth,
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = z
      .object({ currentPassword: z.string().min(1), newPassword: password })
      .parse(req.body);

    const userId = req.identity.userId as string;
    await changePassword(userId, input.currentPassword, input.newPassword);
    // Changing a password must not leave old sessions alive.
    await revokeAllSessions(userId);
    clearAuthCookies(res);

    await recordAudit({ userId, action: 'auth.password_change', outcome: 'success', ip: clientIp(req) });
    res.status(204).end();
  }),
);

export default router;
