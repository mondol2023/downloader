import type { Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type Stripe from 'stripe';
import { TIER_POLICIES } from '@media/shared';
import { env, stripeEnabled } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { stripe } from '../lib/stripe.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { clientIp, requireAuth } from '../middleware/identity.js';
import {
  claimWebhookEvent,
  ensureCustomer,
  handleSubscriptionDeleted,
  syncSubscription,
} from '../services/billing.service.js';
import { recordAudit } from '../services/user.service.js';

/**
 * Payment surface. Express owns this outright — Next.js never holds a Stripe
 * key and never sees a webhook, it only renders the URLs this router returns.
 */

const router = Router();

const PLANS = [
  {
    id: 'pro-monthly',
    priceId: () => env.STRIPE_PRICE_PRO_MONTHLY,
    interval: 'month' as const,
    label: 'Pro Monthly',
  },
  {
    id: 'pro-yearly',
    priceId: () => env.STRIPE_PRICE_PRO_YEARLY,
    interval: 'year' as const,
    label: 'Pro Yearly',
  },
];

/**
 * Public plan listing. Prices come from Stripe so the marketing page cannot
 * drift from what the customer is actually charged.
 */
router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const tiers = Object.values(TIER_POLICIES).map((policy) => ({
      tier: policy.id,
      label: policy.label,
      maxHeight: policy.maxHeight,
      maxFileSizeBytes: policy.maxFileSizeBytes,
      dailyDownloads: policy.dailyDownloads,
      maxConcurrentJobs: policy.maxConcurrentJobs,
      audioFormats: policy.audioFormats,
    }));

    if (!stripeEnabled) {
      res.json({ data: { tiers, plans: [], billingEnabled: false } });
      return;
    }

    const plans = await Promise.all(
      PLANS.filter((plan) => plan.priceId()).map(async (plan) => {
        try {
          const price = await stripe().prices.retrieve(plan.priceId());
          return {
            id: plan.id,
            label: plan.label,
            interval: plan.interval,
            amount: price.unit_amount,
            currency: price.currency,
          };
        } catch (err) {
          logger.error({ err, plan: plan.id }, 'Failed to load Stripe price');
          return null;
        }
      }),
    );

    res.json({
      data: { tiers, plans: plans.filter(Boolean), billingEnabled: true },
    });
  }),
);

/**
 * Starts a Checkout session. The price is chosen from a server-side allowlist —
 * accepting a raw `priceId` from the client would let anyone subscribe at a
 * price of their choosing.
 */
router.post(
  '/checkout',
  requireAuth,
  rateLimit({ bucket: 'checkout', windowSeconds: 300, max: 10 }),
  asyncHandler(async (req, res) => {
    const input = z.object({ plan: z.enum(['pro-monthly', 'pro-yearly']) }).parse(req.body);

    const plan = PLANS.find((p) => p.id === input.plan);
    const priceId = plan?.priceId();
    if (!priceId) throw AppError.unavailable('That plan is not available right now');

    const userId = req.identity.userId as string;
    const customer = await ensureCustomer(userId);

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      // Carried onto the subscription so the webhook can attribute it even if
      // the customer record is later re-linked.
      subscription_data: { metadata: { userId } },
      success_url: `${env.WEB_PUBLIC_URL}/account?checkout=success`,
      cancel_url: `${env.WEB_PUBLIC_URL}/pricing?checkout=cancelled`,
    });

    await recordAudit({
      userId,
      action: 'billing.checkout_started',
      outcome: 'success',
      ip: clientIp(req),
      metadata: { plan: input.plan, sessionId: session.id },
    });

    res.json({ data: { url: session.url } });
  }),
);

/** Stripe-hosted portal: card updates, invoices and cancellation all live there. */
router.post(
  '/portal',
  requireAuth,
  rateLimit({ bucket: 'portal', windowSeconds: 300, max: 10 }),
  asyncHandler(async (req, res) => {
    const customer = await ensureCustomer(req.identity.userId as string);
    const session = await stripe().billingPortal.sessions.create({
      customer,
      return_url: `${env.WEB_PUBLIC_URL}/account`,
    });
    res.json({ data: { url: session.url } });
  }),
);

router.get(
  '/subscription',
  requireAuth,
  asyncHandler(async (req, res) => {
    const subscription = await prisma.subscription.findUnique({
      where: { userId: req.identity.userId as string },
    });

    res.json({
      data: subscription
        ? {
            status: subscription.status,
            priceId: subscription.stripePriceId,
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
    });
  }),
);

/**
 * Webhook receiver.
 *
 * Mounted before the JSON body parser with `express.raw`, because signature
 * verification needs the exact bytes Stripe signed. It is deliberately *not*
 * behind the CSRF guard or the auth middleware — the signature is the
 * authentication.
 */
export const webhookHandler: RequestHandler = async (req: Request, res: Response) => {
  if (!stripeEnabled) {
    res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Billing disabled' } });
    return;
  }

  const signature = req.header('stripe-signature');
  if (!signature) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing signature' } });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      req.body as Buffer,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    logger.warn({ err }, 'Rejected Stripe webhook with invalid signature');
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid signature' } });
    return;
  }

  const claimed = await claimWebhookEvent(event.id, event.type);
  if (!claimed) {
    // Already handled. Acknowledge so Stripe stops retrying.
    logger.debug({ eventId: event.id, type: event.type }, 'Duplicate webhook ignored');
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    await processEvent(event);
    res.json({ received: true });
  } catch (err) {
    // Release the claim so Stripe's retry can actually re-run the handler.
    await prisma.processedWebhook.delete({ where: { id: event.id } }).catch(() => undefined);
    logger.error({ err, eventId: event.id, type: event.type }, 'Webhook processing failed');
    res.status(500).json({ error: { code: 'WEBHOOK_FAILED', message: 'Processing failed' } });
  }
};

async function processEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (!session.subscription) break;
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      // Re-fetch rather than trusting the embedded object: the session snapshot
      // predates any immediate proration or trial adjustment.
      const subscription = await stripe().subscriptions.retrieve(subscriptionId);
      await syncSubscription(subscription);
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await syncSubscription(event.data.object);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;

    case 'invoice.payment_failed':
    case 'invoice.payment_succeeded': {
      // The authoritative state change arrives as `subscription.updated`; this
      // is only here so a failed payment is visible in the audit trail.
      const invoice = event.data.object;
      const subscriptionId =
        typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (subscriptionId) {
        const subscription = await stripe().subscriptions.retrieve(subscriptionId);
        await syncSubscription(subscription);
      }
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Unhandled Stripe event');
  }
}

export default router;
