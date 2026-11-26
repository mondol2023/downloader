import type { SoftPolicy } from "./types";

/**
 * A draft is a flat map of edits against the active policy, keyed by dotted path
 * (`tiers.FREE.maxHeight`). Flat keys make the diff, the sessionStorage copy and the
 * server's 422 field errors (same dotted paths) line up trivially.
 */
export type Draft = Record<string, unknown>;

export const MB = 1024 * 1024;

export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function getPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  cur[keys[keys.length - 1]!] = value;
}

/** Every editable leaf path (arrays and scalars are leaves). */
export function leafPaths(obj: unknown, prefix = ""): string[] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.entries(obj).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

const editable = (p: SoftPolicy) => ({
  global: p.global,
  tiers: p.tiers,
  platforms: p.platforms,
  rules: p.rules,
  disabledBuiltins: p.disabledBuiltins,
});

/** What the editor shows for `path`: the draft edit if there is one, else the active value. */
export const valueAt = (active: SoftPolicy, draft: Draft, path: string) =>
  path in draft ? draft[path] : getPath(active, path);

/** Edit `path`; an edit equal to the active value is dropped, so "Review changes" counts only real changes. */
export function edit(active: SoftPolicy, draft: Draft, path: string, value: unknown): Draft {
  const next = { ...draft };
  if (same(value, getPath(active, path))) delete next[path];
  else next[path] = value;
  return next;
}

export interface Change {
  path: string;
  from: unknown;
  to: unknown;
}
export const changes = (active: SoftPolicy, draft: Draft): Change[] =>
  Object.entries(draft)
    .map(([path, to]) => ({ path, from: getPath(active, path), to }))
    .sort((a, b) => a.path.localeCompare(b.path));

/** The overrides to send: every leaf where (active + draft) differs from the code defaults. */
export function toOverrides(defaults: SoftPolicy, active: SoftPolicy, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of leafPaths(editable(defaults))) {
    const v = valueAt(active, draft, path);
    if (!same(v, getPath(defaults, path))) setPath(out, path, v);
  }
  return out;
}

export const formatValue = (v: unknown): string =>
  v === null || v === undefined ? "unlimited" : Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v);
