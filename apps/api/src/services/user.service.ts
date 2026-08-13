import argon2 from 'argon2';
import type { Subscription, User } from '@prisma/client';
import type { AuthUser, Tier } from '@media/shared';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Argon2id with parameters sized for a login endpoint: ~64 MB and 3 passes
 * costs a few hundred ms here but makes offline cracking of a leaked dump
 * expensive. `timeCost`/`memoryCost` are recorded in the hash itself, so raising
 * them later re-hashes on next login rather than invalidating anyone.
 */
const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * A pre-computed hash used to spend the same CPU time when the email does not
 * exist. Without it, login response time tells an attacker which addresses are
 * registered.
 */
let decoyHash: string | null = null;
async function getDecoyHash(): Promise<string> {
  decoyHash ??= await argon2.hash('decoy-password-for-timing-equalisation', ARGON_OPTIONS);
  return decoyHash;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<User> {
  const email = normaliseEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Deliberately the same wording the UI shows for a failed login attempt on
    // an existing address — registration should not be an account oracle.
    throw AppError.conflict('That email address cannot be registered.');
  }

  return prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: input.displayName?.trim().slice(0, 80) || null,
      // Registering upgrades GUEST → FREE: 1080p, 250 MB, 10 downloads a day.
      tier: 'FREE',
    },
  });
}

export async function authenticate(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: normaliseEmail(email) } });

  if (!user?.passwordHash) {
    await argon2.verify(await getDecoyHash(), password).catch(() => false);
    throw AppError.unauthorized('Email or password is incorrect');
  }

  let valid = false;
  try {
    valid = await argon2.verify(user.passwordHash, password);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Password verification failed');
  }

  if (!valid) throw AppError.unauthorized('Email or password is incorrect');
  if (user.disabledAt) throw AppError.forbidden(user.disabledReason ?? 'This account is disabled');

  // Opportunistic rehash when the cost parameters have since been raised.
  if (argon2.needsRehash(user.passwordHash, ARGON_OPTIONS)) {
    const passwordHash = await hashPassword(password);
    await prisma.user
      .update({ where: { id: user.id }, data: { passwordHash } })
      .catch((err: unknown) => logger.warn({ err, userId: user.id }, 'Password rehash failed'));
  }

  return user;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) throw AppError.badRequest('This account has no password set');

  const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
  if (!valid) throw AppError.unauthorized('Current password is incorrect');

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

export function toAuthUser(user: User & { subscription?: Subscription | null }): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    tier: user.tier as Tier,
    emailVerified: user.emailVerified,
    subscriptionStatus: user.subscription?.status ?? null,
    subscriptionEndsAt: user.subscription?.currentPeriodEnd?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function loadAuthUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
  if (!user) throw AppError.unauthorized('Account no longer exists');
  if (user.disabledAt) throw AppError.forbidden(user.disabledReason ?? 'This account is disabled');
  return toAuthUser(user);
}

export async function recordAudit(input: {
  userId?: string | null;
  guestKey?: string | null;
  action: string;
  outcome: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        userId: input.userId ?? null,
        guestKey: input.guestKey ?? null,
        action: input.action,
        outcome: input.outcome,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    // Auditing must never break the request it is auditing.
    logger.error({ err, action: input.action }, 'Audit write failed');
  }
}
