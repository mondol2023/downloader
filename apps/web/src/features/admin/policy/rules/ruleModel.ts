import type { BuiltinToggleId, Rule, RuleType } from "@media/shared";

const list = (xs: readonly string[] | undefined, all: string) => (xs && xs.length ? xs.join(", ") : all);
const label = (r: Rule) => r.name.trim() || r.id;

/** A new rule with the smallest params that satisfy the type; the admin fills in the rest. */
export function newRule(type: RuleType): Rule {
  const base = { id: crypto.randomUUID(), name: "", enabled: true };
  switch (type) {
    case "block_host":
      return { ...base, type, params: { hosts: [] } };
    case "block_platform":
      return { ...base, type, params: { platform: "youtube", actions: ["extract"] } };
    case "block_url_pattern":
      return { ...base, type, params: { pattern: "" } };
    case "block_keyword":
      return { ...base, type, params: { text: "", fields: ["title"] } };
    case "max_duration":
      return { ...base, type, params: { seconds: 3600 } };
    case "max_height":
      return { ...base, type, params: { height: 720 } };
    case "age_limit":
      return { ...base, type, params: { max: 12 } };
    case "tier_only":
      return { ...base, type, params: { minTier: "PRO" } };
  }
}

// One-line summary of what a rule does (for example: Blocks a URL pattern for all plans).
export function describeRule(rule: Rule): string {
  switch (rule.type) {
    case "block_host":
      return `Blocks ${list(rule.params.hosts, "no hosts yet")}`;
    case "block_platform":
      return `Blocks ${rule.params.platform}: ${list(rule.params.actions, "nothing")}`;
    case "block_url_pattern":
      return `Blocks ${rule.params.pattern || "(empty pattern)"} for all plans`;
    case "block_keyword":
      return `Blocks "${rule.params.text}" in ${list(rule.params.fields, "nothing")}`;
    case "max_duration":
      return `Refuses media over ${rule.params.seconds}s on ${list(rule.params.tiers, "all plans")}, ${list(rule.params.platforms, "all sites")}`;
    case "max_height":
      return `Locks renditions over ${rule.params.height}px on ${list(rule.params.tiers, "all plans")}, ${list(rule.params.platforms, "all sites")}`;
    case "age_limit":
      return `Refuses media rated above ${rule.params.max}`;
    case "tier_only": {
      const { minTier, platforms, hosts } = rule.params;
      return `Needs ${minTier}+ for ${list([...(platforms ?? []), ...(hosts ?? [])], "nothing yet")}`;
    }
  }
}

const withoutEnabled = (r: Rule) => JSON.stringify({ ...r, enabled: undefined });

/** Human-readable change lines between two rule lists and two disabled-built-in lists. */
export function diffRules(from: Rule[], to: Rule[], fromOff: string[], toOff: string[]): string[] {
  const out: string[] = [];
  const before = new Map(from.map((r) => [r.id, r]));
  const after = new Map(to.map((r) => [r.id, r]));
  for (const r of to) {
    const old = before.get(r.id);
    if (!old) out.push(`Added: ${label(r)}`);
    else {
      if (withoutEnabled(old) !== withoutEnabled(r)) out.push(`Edited: ${label(r)}`);
      if (old.enabled !== r.enabled) out.push(`${r.enabled ? "Enabled" : "Disabled"}: ${label(r)}`);
    }
  }
  for (const r of from) if (!after.has(r.id)) out.push(`Removed: ${label(r)}`);
  for (const id of toOff) if (!fromOff.includes(id)) out.push(`Built-in disabled: ${id}`);
  for (const id of fromOff) if (!toOff.includes(id)) out.push(`Built-in enabled: ${id}`);
  return out;
}

/** Field errors for one rule: `rules.<index>.params.seconds` → `params.seconds`. */
export function ruleErrors(errors: Record<string, string>, index: number): Record<string, string> {
  const prefix = `rules.${index}.`;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

export type { BuiltinToggleId };
