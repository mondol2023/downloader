import type { Tier } from './tiers.js';

/** Admin-managed restriction rules. Deny-only; the hard floor is never affected by them. */
export const RULE_TYPES = [
  'block_host',
  'block_platform',
  'block_url_pattern',
  'block_keyword',
  'max_duration',
  'max_height',
  'age_limit',
  'tier_only',
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/** Built-in limits an admin can switch off without losing their configured value. */
export const BUILTIN_TOGGLES = ['maxDuration', 'ageLimit', 'blockedHosts'] as const;
export type BuiltinToggleId = (typeof BUILTIN_TOGGLES)[number];

export type RuleAction = 'extract' | 'download' | 'playback';
export type KeywordField = 'title' | 'channel';

interface RuleBase<T extends RuleType, P> {
  id: string;
  name: string;
  type: T;
  enabled: boolean;
  params: P;
  /** User-facing refusal text. Defaults to stock copy for the type. */
  message?: string;
  /** Admin-only note. */
  note?: string;
}

export type Rule =
  | RuleBase<'block_host', { hosts: string[] }>
  | RuleBase<'block_platform', { platform: string; actions: RuleAction[] }>
  | RuleBase<'block_url_pattern', { pattern: string }>
  | RuleBase<'block_keyword', { text: string; fields: KeywordField[] }>
  | RuleBase<'max_duration', { seconds: number; tiers?: Tier[]; platforms?: string[] }>
  | RuleBase<'max_height', { height: number; tiers?: Tier[]; platforms?: string[] }>
  | RuleBase<'age_limit', { max: number }>
  | RuleBase<'tier_only', { minTier: Tier; platforms?: string[]; hosts?: string[] }>;

export interface RuleField {
  key: string;
  label: string;
  kind:
    | 'hosts'
    | 'platform'
    | 'platforms'
    | 'tiers'
    | 'actions'
    | 'keywordFields'
    | 'pattern'
    | 'text'
    | 'int'
    | 'tier';
  hint?: string;
  optional?: boolean;
}

export const RULE_CATALOGUE: Record<RuleType, { label: string; description: string; fields: RuleField[] }> = {
  block_host: {
    label: 'Block hosts',
    description: 'Refuse links from these hostnames and their subdomains.',
    fields: [{ key: 'hosts', label: 'Hosts', kind: 'hosts', hint: 'e.g. example.com' }],
  },
  block_platform: {
    label: 'Block platform',
    description: 'Refuse a supported site for lookup, download or playback.',
    fields: [
      { key: 'platform', label: 'Platform', kind: 'platform' },
      { key: 'actions', label: 'Blocked actions', kind: 'actions' },
    ],
  },
  block_url_pattern: {
    label: 'Block URL pattern',
    description: 'Refuse links matching a wildcard pattern on host, path and query.',
    fields: [
      { key: 'pattern', label: 'Pattern', kind: 'pattern', hint: 'Use * as a wildcard, e.g. */shorts/*' },
    ],
  },
  block_keyword: {
    label: 'Block keyword',
    description: 'Refuse media whose title or channel contains some text.',
    fields: [
      { key: 'text', label: 'Text', kind: 'text', hint: 'Case-insensitive' },
      { key: 'fields', label: 'Look in', kind: 'keywordFields' },
    ],
  },
  max_duration: {
    label: 'Maximum duration',
    description: 'Refuse media longer than a limit.',
    fields: [
      { key: 'seconds', label: 'Seconds', kind: 'int' },
      { key: 'tiers', label: 'Plans', kind: 'tiers', optional: true, hint: 'Empty = all plans' },
      { key: 'platforms', label: 'Platforms', kind: 'platforms', optional: true, hint: 'Empty = all sites' },
    ],
  },
  max_height: {
    label: 'Maximum resolution',
    description: 'Lock renditions taller than a limit.',
    fields: [
      { key: 'height', label: 'Height (px)', kind: 'int' },
      { key: 'tiers', label: 'Plans', kind: 'tiers', optional: true, hint: 'Empty = all plans' },
      { key: 'platforms', label: 'Platforms', kind: 'platforms', optional: true, hint: 'Empty = all sites' },
    ],
  },
  age_limit: {
    label: 'Age limit',
    description: 'Refuse media rated above an age.',
    fields: [{ key: 'max', label: 'Highest allowed age (0-17)', kind: 'int' }],
  },
  tier_only: {
    label: 'Plan-only access',
    description: 'Restrict sites or hosts to a minimum plan.',
    fields: [
      { key: 'minTier', label: 'Minimum plan', kind: 'tier' },
      { key: 'platforms', label: 'Platforms', kind: 'platforms', optional: true },
      { key: 'hosts', label: 'Hosts', kind: 'hosts', optional: true },
    ],
  },
};
