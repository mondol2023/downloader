"use client";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { usePolicyDraft } from "./usePolicyDraft";

const input =
  "min-h-11 w-full rounded-key border border-line bg-surface-2 px-3 text-sm text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-signal";

/** Marks a field that differs from the active policy, and shows the server's 422 message for it. */
function Frame({ path, label, children, hint, srLabel }: { path: string; label: string; srLabel?: boolean; children: (id: string, describedBy?: string) => ReactNode; hint?: string }) {
  const { draft, errors } = usePolicyDraft();
  const id = useId();
  const err = errors[path];
  const dirty = path in draft;
  return (
    <div className="space-y-1" data-dirty={dirty || undefined}>
      <label htmlFor={id} className={cn("flex items-center gap-2 text-sm", srLabel && "sr-only")}>
        {label}
        {dirty && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label="changed" />}
      </label>
      {children(id, err ? `${id}-err` : undefined)}
      {hint && !err && <p className="text-xs text-muted">{hint}</p>}
      {err && (
        <p id={`${id}-err`} className="text-xs text-danger" data-testid="field-error">
          {err}
        </p>
      )}
    </div>
  );
}

export function SwitchField({ path, label, hint }: { path: string; label: string; hint?: string }) {
  const { get, set, draft, errors } = usePolicyDraft();
  const on = get<boolean>(path);
  const dirty = path in draft;
  return (
    <div className="space-y-1">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => set(path, e.target.checked)}
          className="size-5 accent-[var(--color-signal)]"
        />
        <span>{label}</span>
        {dirty && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label="changed" />}
      </label>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {errors[path] && <p className="text-xs text-danger" data-testid="field-error">{errors[path]}</p>}
    </div>
  );
}

/**
 * Numeric input. `scale` converts display to stored units (MB ↔ bytes). A stored `null`
 * means unlimited and shows as an empty box; clearing the box leaves the value unchanged.
 */
export function NumberField({
  path, label, hint, scale = 1, allowNull = false, compact = false,
}: { path: string; label: string; hint?: string; scale?: number; allowNull?: boolean; compact?: boolean }) {
  const { get, set } = usePolicyDraft();
  const stored = get<number | null>(path);
  const shown = stored === null || stored === undefined ? "" : String(stored / scale);
  const [text, setText] = useState<string | null>(null);
  return (
    <Frame path={path} label={label} hint={hint} srLabel={compact}>
      {(id, described) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          aria-describedby={described}
          aria-invalid={described ? true : undefined}
          placeholder={stored === null ? "unlimited" : undefined}
          className={cn(input, "num", compact && "min-w-20")}
          value={text ?? shown}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value === "") return allowNull ? set(path, null) : undefined;
            const n = Number(e.target.value);
            if (Number.isFinite(n)) set(path, n * scale);
          }}
          onBlur={() => setText(null)}
        />
      )}
    </Frame>
  );
}

export function TextField({ path, label, hint, multiline }: { path: string; label: string; hint?: string; multiline?: boolean }) {
  const { get, set } = usePolicyDraft();
  const value = get<string>(path) ?? "";
  return (
    <Frame path={path} label={label} hint={hint}>
      {(id, described) =>
        multiline ? (
          <textarea id={id} rows={2} aria-describedby={described} className={cn(input, "py-2")} value={value} onChange={(e) => set(path, e.target.value)} />
        ) : (
          <input id={id} type="text" aria-describedby={described} className={input} value={value} onChange={(e) => set(path, e.target.value)} />
        )
      }
    </Frame>
  );
}

export const HOST = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z0-9-]+$/;
/** Pull a bare hostname out of whatever was pasted: URL, `www.` prefix, trailing slash. */
export function cleanHost(raw: string): string {
  let h = raw.trim().toLowerCase();
  try {
    if (h.includes("://")) h = new URL(h).hostname;
  } catch {
    /* fall through to the regex */
  }
  return h.replace(/^www\./, "").replace(/\/.*$/, "");
}

export function HostChips({ path, label }: { path: string; label: string }) {
  const { get, set } = usePolicyDraft();
  const hosts = get<string[]>(path) ?? [];
  const [text, setText] = useState("");
  const [bad, setBad] = useState<string | null>(null);

  const add = () => {
    const parts = text.split(/[\s,]+/).filter(Boolean).map(cleanHost);
    if (!parts.length) return;
    const invalid = parts.find((h) => !HOST.test(h));
    if (invalid) return setBad(`"${invalid}" is not a bare hostname such as example.com`);
    setBad(null);
    set(path, [...new Set([...hosts, ...parts])]);
    setText("");
  };
  return (
    <Frame path={path} label={label} hint="Subdomains are blocked too. Press Enter or comma to add.">
      {(id, described) => (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              id={id}
              className={input}
              value={text}
              aria-describedby={described}
              aria-invalid={bad ? true : undefined}
              placeholder="example.com"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" onClick={add} className="min-h-11 rounded-key border border-line px-4 text-sm hover:border-muted">
              Add
            </button>
          </div>
          {bad && <p className="text-xs text-danger" role="alert">{bad}</p>}
          <ul className="flex flex-wrap gap-2" aria-label="Blocked hosts">
            {hosts.map((h) => (
              <li key={h} className="num inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pl-2 text-xs">
                {h}
                <button
                  type="button"
                  aria-label={`Remove ${h}`}
                  className="min-h-11 min-w-11 text-muted hover:text-text"
                  onClick={() => set(path, hosts.filter((x) => x !== h))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Frame>
  );
}
