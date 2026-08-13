import type Stripe from 'stripe';
import type { SubscriptionStatus, Tier } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { stripe } from '../lib/stripe.js';
import { AppError } from '../lib/errors.js';

/**
 * Subscription reconciliation.
 *
 * Stripe is the source of truth for *billing*; `User.tier` is the denormalised
 * answer to "what may this user do", written only from here. Everything the
 * gatekeeper reads (tier on the JWT, tier on the request) ultimately flows from
 * this one function, so there is exactly one place where money turns into
 * entitlement.
 */

const STATUS_MAP: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'INCOMPLETE_EXPIRED',
  unpaid: 'UNPAID',
  paused: 'PAUSED',
};

/**
 * Only a paid-up or trialing subscription grants Pro. `past_due` deliberately
 * does not: Stripe retries for days, and during that window the account falls
 * back to Free rather than serving unlimited 8K to an unpaid card.
 */
const ENTITLING_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'TRIALING'];

export function tierForStatus(status: SubscriptionStatus): Tier {
  return ENTITLING_STATUSES.includes(status) ? 'PRO' : 'FREE';
}

/** Finds or creates the Stripe customer for a user, and remembers the id. */
export async function ensureCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.unauthorized('Account no longer exists');
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe().customers.create({
    email: user.email,
    name: user.displayName ?? undefined,
    // Lets the webhook path recover the account even if subscription metadata
    // is missing (e.g. a subscription created from the Stripe dashboard).
    metadata: { userId: user.id },
  });

  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** Resolves the local user for a Stripe subscription, by metadata then customer. */
async function resolveUserId(subscription: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = subscription.metadata?.userId;
  if (fromMetadata) {
    const exists = await prisma.user.findUnique({
      where: { id: fromMetadata },
      select: { id: true },
    });
    if (exists) return exists.id;
  }

  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const byCustomer = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return byCustomer?.id ?? null;
}

/**
 * Writes the subscription and the resulting tier in one transaction, so a user
 * can never be left holding Pro entitlement with no subscription row (or the
 * reverse) if the process dies mid-update.
 */
export async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserId(subscription);
  if (!userId) {
    logger.warn({ subscriptionId: subscription.id }, 'Subscription has no matching local user');
    return;
  }

  const status = STATUS_MAP[subscription.status] ?? 'INCOMPLETE';
  const priceId = subscription.items.data[0]?.price.id ?? '';
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
  const tier = tierForStatus(status);

  const data = {
    userId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
  };

  await prisma.$transaction([
    prisma.subscription.upsert({ where: { userId }, create: data, update: data }),
    prisma.user.update({ where: { id: userId }, data: { tier } }),
  ]);

  logger.info({ userId, subscriptionId: subscription.id, status, tier }, 'Subscription synced');
}

/**
 * Deletion arrives as its own event rather than a status update, so the tier has
 * to be dropped explicitly here.
 */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserId(subscription);
  if (!userId) return;

  await prisma.$transaction([
    prisma.subscription.updateMany({
      where: { userId },
      data: { status: 'CANCELED', canceledAt: new Date() },
    }),
    prisma.user.update({ where: { id: userId }, data: { tier: 'FREE' } }),
  ]);

  logger.info({ userId, subscriptionId: subscription.id }, 'Subscription cancelled; tier reset');
}

/**
 * Marks an event id as handled. Returns false when Stripe has already delivered
 * it — webhooks are at-least-once, and replaying a `subscription.deleted` after
 * a re-subscribe would otherwise revoke a paying customer's access.
 */
export async function claimWebhookEvent(id: string, type: string): Promise<boolean> {
  try {
    await prisma.processedWebhook.create({ data: { id, type } });
    return true;
  } catch {
    // Unique violation on the primary key — a duplicate delivery.
    return false;
  }
}
