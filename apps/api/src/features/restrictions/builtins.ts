import type { BuiltinToggleId } from '@media/shared';
import { HARD_FLOOR } from './restrictions.config.js';
import type { EffectivePolicy } from './policy.schema.js';

/**
 * Effective values of the built-in limits an admin can switch off. Switching one off never deletes
 * its configured value (re-enabling restores it) and never reaches the hard floor.
 * `disabledBuiltins` is optional so callers holding a partial policy keep working.
 */
export type BuiltinView = Pick<EffectivePolicy, 'global'> & { disabledBuiltins?: BuiltinToggleId[] };

const isOff = (p: BuiltinView | undefined, id: BuiltinToggleId): boolean => p?.disabledBuiltins?.includes(id) ?? false;

/** Longest allowed media in seconds, or null when the built-in is disabled. */
export function maxDurationOf(p: BuiltinView): number | null {
  return isOff(p, 'maxDuration') ? null : p.global.maxDurationSec;
}

/** Highest allowed age rating. Disabling the built-in falls back to the floor, never to no cap. */
export function ageCapOf(p?: BuiltinView): number {
  if (!p || isOff(p, 'ageLimit')) return HARD_FLOOR.maxAgeLimit;
  return Math.min(p.global.ageLimitMax, HARD_FLOOR.maxAgeLimit);
}

/** Admin-added blocked hosts; the code-only DRM floor list is separate and always applies. */
export function extraBlockedHostsOf(p?: BuiltinView): string[] {
  return !p || isOff(p, 'blockedHosts') ? [] : p.global.extraBlockedHosts;
}
