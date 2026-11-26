import { AppError } from '../../lib/errors.js';
import { HARD_FLOOR } from './restrictions.config.js';
import {
  PolicyOverridesSchema,
  type EffectivePolicy,
  type PublicPolicy,
  type SoftPolicy,
} from './policy.schema.js';

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merges plain objects; arrays and scalars in `over` replace. Never mutates inputs. */
function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return structuredClone(base);
  if (!isPlain(base) || !isPlain(over)) return structuredClone(over);
  const out: Plain = {};
  for (const key of Object.keys(base)) out[key] = structuredClone(base[key]);
  for (const key of Object.keys(over)) out[key] = deepMerge(base[key], over[key]);
  return out;
}

/**
 * Validates `overrides` against the schema and layers them over `defaults`.
 * Invalid overrides never produce a partial result: they throw 422 POLICY_INVALID.
 */
export function mergePolicy(defaults: SoftPolicy, overrides: unknown, version: number): EffectivePolicy {
  const parsed = PolicyOverridesSchema.safeParse(overrides ?? {});
  if (!parsed.success) {
    // Unknown-key issues are reported on the parent path; append the offending keys.
    const flat = parsed.error.issues.flatMap((i) => {
      const base = i.path.join('.');
      if (i.code === 'unrecognized_keys') {
        return i.keys.map((k) => ({ path: base ? `${base}.${k}` : k, message: 'unknown key' }));
      }
      return [{ path: base || '(root)', message: i.message }];
    });
    const paths = [...new Set(flat.map((f) => f.path))];
    throw new AppError(422, 'POLICY_INVALID', `Invalid policy: ${paths.join(', ')}`, { details: flat });
  }
  const merged = deepMerge(defaults, parsed.data) as SoftPolicy;
  return { ...merged, hardFloor: HARD_FLOOR, version };
}

/** What anonymous clients may see: tier limits and per-platform enabled/download. */
export function toPublicPolicy(p: EffectivePolicy): PublicPolicy {
  const platforms = {} as PublicPolicy['platforms'];
  for (const [id, cfg] of Object.entries(p.platforms) as Array<[keyof PublicPolicy['platforms'], SoftPolicy['platforms'][keyof SoftPolicy['platforms']]]>) {
    platforms[id] = { enabled: cfg.enabled, download: cfg.download };
  }
  return { version: p.version, tiers: structuredClone(p.tiers), platforms };
}
