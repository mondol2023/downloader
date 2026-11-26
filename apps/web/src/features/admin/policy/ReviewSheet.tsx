"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Sheet } from "@/components/ui";
import { ApiError, api, fieldErrors } from "@/lib/api";
import type { BuiltinToggleId, Rule } from "@media/shared";
import { formatValue } from "./draft";
import { diffRules } from "./rules/ruleModel";
import type { PreviewResponse, Tier, Verdict } from "./types";
import { TIERS } from "./types";
import { usePolicyDraft } from "./usePolicyDraft";

const field =
  "min-h-11 w-full rounded-key border border-line bg-surface-2 px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-signal";

function VerdictCard({ title, v }: { title: string; v: Verdict }) {
  return (
    <div className="space-y-1 rounded-key border border-line p-3 text-sm" data-testid={`verdict-${title.toLowerCase()}`}>
      <p className="text-xs text-muted">{title}</p>
      <Badge tone={v.allowed ? "success" : "danger"}>{v.allowed ? "allowed" : "refused"}</Badge>
      {v.refusal && (
        <p>
          <span className="num text-xs">{v.refusal.code}</span>
          <span className="block text-muted">{v.refusal.message}</span>
        </p>
      )}
      {v.rule && <p className="text-muted">Rule: {v.rule.name}</p>}
      {v.blockedActions.length > 0 && <p className="text-muted">Blocked: {v.blockedActions.join(", ")}</p>}
      {v.formats && (
        <p className="text-muted">
          {v.formats.allowed}/{v.formats.total} formats open
        </p>
      )}
    </div>
  );
}

function TestUrl() {
  const { overrides } = usePolicyDraft();
  const [url, setUrl] = useState("");
  const [tier, setTier] = useState<Tier>("FREE");
  const test = useMutation({
    mutationFn: () => api<PreviewResponse>("/admin/policy/preview", { method: "POST", body: { overrides: overrides(), url, tier } }),
  });
  return (
    <section className="space-y-3" aria-label="Test a URL">
      <h3 className="text-sm font-medium">Test a URL</h3>
      <div className="flex gap-2">
        <input
          aria-label="URL to test"
          className={field}
          placeholder="https://www.tiktok.com/@a/video/1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select aria-label="Tier" className={`${field} w-28`} value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          {TIERS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <Button type="button" variant="secondary" disabled={!url.trim() || test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? "Testing…" : "Test"}
      </Button>
      {test.error && (
        <p role="alert" className="text-sm text-danger">
          {test.error instanceof ApiError ? test.error.message : "Couldn't run the test."}
        </p>
      )}
      {test.data && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <VerdictCard title="Active" v={test.data.active} />
            <VerdictCard title="Draft" v={test.data.draft} />
          </div>
          {!test.data.cached && <p className="text-xs text-muted">Not extracted recently, so per-format limits weren&apos;t judged.</p>}
        </div>
      )}
    </section>
  );
}

const RULE_PATHS = ["rules", "disabledBuiltins"];

/** Rule-list changes read as lines ("Added: No shorts"), not as a JSON dump. */
function ruleLines(changes: ReturnType<typeof usePolicyDraft>["changes"]): string[] {
  const get = <T,>(path: string, side: "from" | "to") => (changes.find((c) => c.path === path)?.[side] ?? []) as T[];
  return diffRules(
    get<Rule>("rules", "from"),
    get<Rule>("rules", "to"),
    get<BuiltinToggleId>("disabledBuiltins", "from"),
    get<BuiltinToggleId>("disabledBuiltins", "to"),
  );
}

export function ReviewSheet() {
  const { changes, overrides, discard, errors, setErrors } = usePolicyDraft();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const publish = useMutation({
    mutationFn: () => api("/admin/policy", { method: "POST", body: { overrides: overrides(), note: note.trim() } }),
    onSuccess: async () => {
      discard();
      setNote("");
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ["admin", "policy"] });
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  const failed = publish.error instanceof ApiError ? publish.error : null;
  const errorCount = Object.keys(errors).length;

  return (
    <Sheet
      title="Review changes"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button type="button" disabled={changes.length === 0}>
          Review changes{changes.length ? ` (${changes.length})` : ""}
        </Button>
      }
    >
      <div className="space-y-6">
        <section aria-label="Changes">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-2 font-normal">Field</th>
                <th className="py-1 pr-2 font-normal">Active</th>
                <th className="py-1 font-normal">Draft</th>
              </tr>
            </thead>
            <tbody>
              {changes.filter((c) => !RULE_PATHS.includes(c.path)).map((c) => (
                <tr key={c.path} className="border-t border-line align-top" data-testid="diff-row">
                  <td className="num break-all py-2 pr-2 text-xs">
                    {c.path}
                    {errors[c.path] && <span className="block text-danger">{errors[c.path]}</span>}
                  </td>
                  <td className="num py-2 pr-2 text-muted">{formatValue(c.from)}</td>
                  <td className="num py-2">{formatValue(c.to)}</td>
                </tr>
              ))}
              {changes.some((c) => RULE_PATHS.includes(c.path)) && (
                <tr className="border-t border-line align-top" data-testid="diff-row">
                  <td className="num py-2 pr-2 text-xs">
                    rules
                    {(errors.rules || errors.disabledBuiltins) && (
                      <span className="block text-danger">{errors.rules ?? errors.disabledBuiltins}</span>
                    )}
                  </td>
                  <td className="py-2 text-sm" colSpan={2}>
                    <ul className="space-y-0.5">
                      {ruleLines(changes).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <TestUrl />

        <section className="space-y-2">
          <label htmlFor="policy-note" className="text-sm font-medium">
            Note <span className="font-normal text-muted">(required, saved with the version)</span>
          </label>
          <textarea id="policy-note" rows={2} maxLength={500} className={`${field} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
          {failed && (
            <p role="alert" className="text-sm text-danger">
              {failed.code === "POLICY_INVALID"
                ? `${errorCount || "Some"} field${errorCount === 1 ? "" : "s"} failed validation. Fix them in the form or the list above.`
                : failed.message}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" disabled={!note.trim() || publish.isPending} onClick={() => publish.mutate()}>
              {publish.isPending ? "Publishing…" : "Publish"}
            </Button>
            <Button type="button" variant="ghost" onClick={discard}>
              Discard draft
            </Button>
          </div>
        </section>
      </div>
    </Sheet>
  );
}
