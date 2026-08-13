import Stripe from 'stripe';
import { env, stripeEnabled } from '../config/env.js';
import { AppError } from './errors.js';

/**
 * Stripe is optional so the platform runs end to end without billing keys — Pro
 * is then only reachable by seeding the tier directly. Every billing route calls
 * `stripe()`, which fails loudly rather than letting a half-configured
 * deployment silently accept checkout attempts it cannot complete.
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!stripeEnabled) {
    throw AppError.unavailable('Billing is not configured on this deployment');
  }
  client ??= new Stripe(env.STRIPE_SECRET_KEY, {
    // Pinning the version means a Stripe-side upgrade cannot change the shape of
    // the webhook payloads this service parses.
    apiVersion: '2024-12-18.acacia',
    typescript: true,
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  return client;
}

export { stripeEnabled };
