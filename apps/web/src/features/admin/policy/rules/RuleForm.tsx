"use client";
import { useId, useState, type ReactNode } from "react";
import { RULE_CATALOGUE, type Rule, type RuleField } from "@media/shared";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HOST, cleanHost } from "../fields";
import { PLATFORM_IDS, TIERS } from "../types";

const input =
  "min-h-11 w-full rounded-key border border-line bg-surface-2 px-3 text-sm text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-signal";
const ACTIONS = ["extract", "download", "playback"] as const;
const KEYWORD_FIELDS = ["title", "channel"] as const;

type Errors = Record<string, string>;
/** The error for `path`, or for anything nested under it (`params.hosts.0`). */
const errorFor = (errors: Errors, path: string) =>
  errors[path] ?? Object.entries(errors).find(([k]) => k.startsWith(`${path}.`))?.[1];

function Frame({ label, hint, error, children, group }: {
  label: string; hint?: string; error?: string; group?: boolean; children: (id: string, described?: string) => ReactNode;
}) {
  const id = useId();
  const described = error ? `${id}-err` : undefined;
  return (
    <div className="space-y-1">
      {group ? <p id={id} className="text-sm">{label}</p> : <label htmlFor={id} className="block text-sm">{label}</label>}
      {children(id, described)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p id={described} className="text-xs text-danger" data-testid="field-error">{error}</p>}
    </div>
  );
}

function Checks<T extends string>({ id, options, value, onChange }: {
  id: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void;
}) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-wrap gap-x-4">
      {options.map((o) => (
        <label key={o} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(o)}
            onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))}
            className="size-5 accent-[var(--color-signal)]"
          />
          {o}
        </label>
      ))}
    </div>
  );
}

function Hosts({ id, value, onChange, described }: { id: string; value: string[]; onChange: (v: string[]) => void; described?: string }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState<string | null>(null);
  const add = () => {
    const parts = text.split(/[\s,]+/).filter(Boolean).map(cleanHost);
    if (!parts.length) return;
    const invalid = parts.find((h) => !HOST.test(h));
    if (invalid) return setBad(`"${invalid}" is not a bare hostname such as example.com`);
    setBad(null);
    onChange([...new Set([...value, ...parts])]);
    setText("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          id={id}
          className={input}
          value={text}
          aria-describedby={described}
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
      <ul className="flex flex-wrap gap-2">
        {value.map((h) => (
          <li key={h} className="num inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pl-2 text-xs">
            {h}
            <button type="button" aria-label={`Remove ${h}`} className="min-h-11 min-w-11 text-muted hover:text-text" onClick={() => onChange(value.filter((x) => x !== h))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IntInput({ id, value, onChange, described }: { id: string; value: number; onChange: (n: number) => void; described?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      step={1}
      aria-describedby={described}
      aria-invalid={described ? true : undefined}
      className={cn(input, "num")}
      value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setText(null)}
    />
  );
}

type TierId = (typeof TIERS)[number];

/** One catalogue field, rendered by its `kind`. Optional arrays that end up empty are removed (the API wants at least one entry). */
function ParamField({ f, params, set, errors }: { f: RuleField; params: Record<string, unknown>; set: (key: string, v: unknown) => void; errors: Errors }) {
  const v = params[f.key];
  const put = (next: unknown) => set(f.key, f.optional && Array.isArray(next) && next.length === 0 ? undefined : next);
  const error = errorFor(errors, `params.${f.key}`);
  const group = ["tiers", "platforms", "actions", "keywordFields"].includes(f.kind);
  return (
    <Frame label={f.label} hint={f.hint} error={error} group={group}>
      {(id, described) => {
        switch (f.kind) {
          case "hosts":
            return <Hosts id={id} described={described} value={(v as string[] | undefined) ?? []} onChange={put} />;
          case "platform":
            return (
              <select id={id} className={input} value={(v as string) ?? ""} aria-describedby={described} onChange={(e) => put(e.target.value)}>
                {PLATFORM_IDS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            );
          case "platforms":
            return <Checks id={id} options={PLATFORM_IDS} value={(v as string[] | undefined) ?? []} onChange={put} />;
          case "tiers":
            return <Checks id={id} options={TIERS} value={(v as TierId[] | undefined) ?? []} onChange={put} />;
          case "actions":
            return <Checks id={id} options={ACTIONS} value={(v as (typeof ACTIONS)[number][] | undefined) ?? []} onChange={put} />;
          case "keywordFields":
            return <Checks id={id} options={KEYWORD_FIELDS} value={(v as (typeof KEYWORD_FIELDS)[number][] | undefined) ?? []} onChange={put} />;
          case "tier":
            return (
              <select id={id} className={input} value={(v as string) ?? "PRO"} aria-describedby={described} onChange={(e) => put(e.target.value)}>
                {TIERS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            );
          case "int":
            return <IntInput id={id} described={described} value={(v as number | undefined) ?? 0} onChange={put} />;
          case "pattern":
          case "text":
            return (
              <input
                id={id}
                className={cn(input, f.kind === "pattern" && "num")}
                aria-describedby={described}
                aria-invalid={described ? true : undefined}
                value={(v as string | undefined) ?? ""}
                onChange={(e) => put(e.target.value)}
              />
            );
        }
      }}
    </Frame>
  );
}

/** Generated from RULE_CATALOGUE. Edits a local copy; nothing reaches the draft until Save rule. */
export function RuleForm({ initial, errors, onSave, onCancel }: { initial: Rule; errors: Errors; onSave: (r: Rule) => void; onCancel: () => void }) {
  const [rule, setRule] = useState<Rule>(initial);
  const cat = RULE_CATALOGUE[rule.type];
  const top = (key: "name" | "message" | "note", value: string) =>
    setRule((r) => {
      const next = { ...r, [key]: value } as Rule;
      if (key !== "name" && value === "") delete next[key];
      return next;
    });
  const setParam = (key: string, v: unknown) =>
    setRule((r) => {
      const params = { ...r.params } as Record<string, unknown>;
      if (v === undefined) delete params[key];
      else params[key] = v;
      return { ...r, params } as Rule;
    });
  const general = [errors.id, errors.type, errors.params, errors.enabled].filter(Boolean);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(rule);
      }}
    >
      <p className="text-sm text-muted">{cat.description}</p>
      {general.map((m) => (
        <p key={m} role="alert" className="text-sm text-danger">{m}</p>
      ))}
      <Frame label="Name" error={errors.name}>
        {(id, d) => (
          <input id={id} className={input} aria-describedby={d} aria-invalid={d ? true : undefined} value={rule.name} maxLength={80} onChange={(e) => top("name", e.target.value)} />
        )}
      </Frame>
      {cat.fields.map((f) => (
        <ParamField key={f.key} f={f} params={rule.params as Record<string, unknown>} set={setParam} errors={errors} />
      ))}
      <Frame label="Message shown to users" hint="Optional. Leave empty for the standard wording." error={errors.message}>
        {(id, d) => (
          <textarea id={id} rows={2} maxLength={300} className={cn(input, "py-2")} aria-describedby={d} value={rule.message ?? ""} onChange={(e) => top("message", e.target.value)} />
        )}
      </Frame>
      <Frame label="Admin note" hint="Only admins see this." error={errors.note}>
        {(id, d) => (
          <textarea id={id} rows={2} maxLength={500} className={cn(input, "py-2")} aria-describedby={d} value={rule.note ?? ""} onChange={(e) => top("note", e.target.value)} />
        )}
      </Frame>
      <div className="flex gap-2">
        <Button type="submit">Save rule</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
