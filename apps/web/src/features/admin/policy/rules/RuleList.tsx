"use client";
import { useState } from "react";
import { RULE_CATALOGUE, RULE_TYPES, type Rule } from "@media/shared";
import { Badge, Button, Card, Sheet } from "@/components/ui";
import { usePolicyDraft } from "../usePolicyDraft";
import { RuleForm } from "./RuleForm";
import { describeRule, newRule, ruleErrors } from "./ruleModel";

function AddRule({ onAdd }: { onAdd: (r: Rule) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Rule | null>(null);
  const close = (o: boolean) => {
    setOpen(o);
    if (!o) setDraft(null);
  };
  return (
    <Sheet open={open} onOpenChange={close} title="Add rule" trigger={<Button type="button">Add rule</Button>}>
      {draft ? (
        <RuleForm
          initial={draft}
          errors={{}}
          onCancel={() => setDraft(null)}
          onSave={(r) => {
            onAdd(r);
            close(false);
          }}
        />
      ) : (
        <ul className="space-y-2">
          {RULE_TYPES.map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => setDraft(newRule(t))}
                className="min-h-11 w-full rounded-key border border-line p-3 text-left hover:border-muted"
              >
                <span className="block text-sm">{RULE_CATALOGUE[t].label}</span>
                <span className="block text-xs text-muted">{RULE_CATALOGUE[t].description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function Row({ rule, index, onChange, onDelete }: { rule: Rule; index: number; onChange: (r: Rule) => void; onDelete: () => void }) {
  const { errors } = usePolicyDraft();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const own = ruleErrors(errors, index);
  return (
    <li data-testid={`rule-row-${rule.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm">
          {rule.name || "Untitled rule"}
          {Object.keys(own).length > 0 && <Badge tone="danger">Has errors</Badge>}
        </p>
        <p className="text-xs text-muted">{describeRule(rule)}</p>
      </div>
      <div className="flex items-center gap-2">
        <Sheet open={open} onOpenChange={setOpen} title="Edit rule" trigger={<Button type="button" variant="secondary">Edit</Button>}>
          <RuleForm
            initial={rule}
            errors={own}
            onCancel={() => setOpen(false)}
            onSave={(r) => {
              onChange(r);
              setOpen(false);
            }}
          />
        </Sheet>
        {confirming ? (
          <>
            <Button type="button" variant="secondary" onClick={onDelete}>Confirm delete</Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>Delete</Button>
        )}
        <input
          type="checkbox"
          role="switch"
          aria-label="Enabled"
          checked={rule.enabled}
          onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
          className="size-6 shrink-0 accent-[var(--color-signal)]"
        />
      </div>
    </li>
  );
}

/** Custom rules, edited as one `rules` array in the shared draft. */
export function RuleList() {
  const { get, set, errors } = usePolicyDraft();
  const rules = get<Rule[]>("rules") ?? [];
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">Custom rules</h2>
        <AddRule onAdd={(r) => set("rules", [...rules, r])} />
      </div>
      {errors.rules && <p role="alert" className="text-sm text-danger">{errors.rules}</p>}
      {rules.length === 0 ? (
        <p className="py-2 text-sm text-muted">No custom rules yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r, i) => (
            <Row
              key={r.id}
              rule={r}
              index={i}
              onChange={(next) => set("rules", rules.map((x) => (x.id === r.id ? next : x)))}
              onDelete={() => set("rules", rules.filter((x) => x.id !== r.id))}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
