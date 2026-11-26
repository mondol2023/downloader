import { z } from 'zod';
import { BUILTIN_TOGGLES, TIERS, type BuiltinToggleId, type Rule } from '@media/shared';

/** Mirrors the values of PLATFORM_BY_SUFFIX in lib/source-url.ts. */
export const PLATFORM_IDS = [
  'youtube', 'facebook', 'instagram', 'x', 'tiktok', 'reddit', 'vimeo', 'twitch',
  'dailymotion', 'soundcloud', 'bilibili', 'pinterest', 'linkedin', 'tumblr',
] as const;

export const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z0-9-]+$/, 'must be a bare hostname such as example.com');

export const RULES_MAX = 200;

const platform = z.enum(PLATFORM_IDS);
const tier = z.enum(TIERS);
const scope = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(1);

const common = {
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  message: z.string().max(300).optional(),
  note: z.string().max(500).optional(),
};

const maxStars = (s: string) => (s.match(/\*/g)?.length ?? 0) <= 5;

const ruleUnion = z.discriminatedUnion('type', [
  z
    .object({
      ...common,
      type: z.literal('block_host'),
      params: z.object({ hosts: z.array(hostname).min(1).max(500) }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('block_platform'),
      params: z.object({ platform, actions: scope(z.enum(['extract', 'download', 'playback'])) }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('block_url_pattern'),
      params: z
        .object({
          pattern: z
            .string()
            .regex(/^[^\s]{1,200}$/, 'must be 1-200 characters without spaces')
            .refine(maxStars, 'at most 5 wildcards'),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('block_keyword'),
      params: z
        .object({ text: z.string().trim().min(1).max(100), fields: scope(z.enum(['title', 'channel'])) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('max_duration'),
      params: z
        .object({
          seconds: z.number().int().positive(),
          tiers: scope(tier).optional(),
          platforms: scope(platform).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('max_height'),
      params: z
        .object({
          height: z.number().int().positive(),
          tiers: scope(tier).optional(),
          platforms: scope(platform).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('age_limit'),
      params: z.object({ max: z.number().int().min(0).max(17) }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('tier_only'),
      params: z
        .object({
          minTier: tier,
          platforms: scope(platform).optional(),
          hosts: scope(hostname).max(500).optional(),
        })
        .strict()
        .refine((p) => p.platforms !== undefined || p.hosts !== undefined, 'needs platforms or hosts'),
    })
    .strict(),
]);

export const rulesSchema = z
  .array(ruleUnion)
  .max(RULES_MAX)
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    rules.forEach((r, index) => {
      if (seen.has(r.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'duplicate rule id' });
      seen.add(r.id);
    });
  });

export const disabledBuiltinsSchema = z.array(z.enum(BUILTIN_TOGGLES)).max(BUILTIN_TOGGLES.length);

// The overrides schema is cast through `unknown`, which would hide drift from @media/shared.
type _RulesFit = z.infer<typeof rulesSchema> extends Rule[] ? true : never;
type _RulesFitBack = Rule[] extends z.infer<typeof rulesSchema> ? true : never;
type _BuiltinsFit = z.infer<typeof disabledBuiltinsSchema> extends BuiltinToggleId[] ? true : never;
export type _SchemaChecks = [_RulesFit, _RulesFitBack, _BuiltinsFit];
