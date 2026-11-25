import { DEFAULT_POLICY } from './restrictions.config.js';
import { mergePolicy } from './merge.js';
import type { EffectivePolicy } from './policy.schema.js';

/**
 * The policy this process enforces right now.
 *
 * Kept in its own tiny module so request-path code (URL normalising, rate limits) can read it
 * without importing the store's database and Redis dependencies. It starts as the code defaults,
 * so `getPolicy()` is defined from the first line of the process, never an empty object.
 */
let current: EffectivePolicy = mergePolicy(DEFAULT_POLICY, {}, 0);

/** Sync and in-memory. Always a complete, validated policy. */
export function getPolicy(): EffectivePolicy {
  return current;
}

/** Only the store (and tests) call this. Callers must pass a policy that came from `mergePolicy`. */
export function setCurrentPolicy(next: EffectivePolicy): void {
  current = next;
}
