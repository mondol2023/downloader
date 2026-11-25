"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { usePolicyDraft } from "./usePolicyDraft";

export function HistoryTab() {
  const { data, discard } = usePolicyDraft();
  const qc = useQueryClient();
  const rollback = useMutation({
    mutationFn: (version: number) => api(`/admin/policy/${version}/activate`, { method: "POST" }),
    onSuccess: async () => {
      discard(); // a draft built on the old active policy no longer applies
      await qc.invalidateQueries({ queryKey: ["admin", "policy"] });
    },
  });
  return (
    <Card className="space-y-3">
      {rollback.error && (
        <p role="alert" className="text-sm text-danger">
          {rollback.error instanceof ApiError ? rollback.error.message : "Couldn't roll back."}
        </p>
      )}
      <ul className="divide-y divide-line">
        {data.versions.map((v) => (
          <li key={v.version} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid="policy-version">
            <div className="min-w-0">
              <p className="flex items-center gap-2">
                <span className="num">v{v.version}</span>
                {v.active && <Badge tone="success">active</Badge>}
              </p>
              <p className="truncate text-muted" title={v.note}>{v.note || "No note"}</p>
              <p className="text-xs text-muted">
                {v.createdBy ?? "system"} · {new Date(v.createdAt).toLocaleString()}
              </p>
            </div>
            {!v.active && (
              <Button
                type="button"
                variant="secondary"
                disabled={rollback.isPending}
                aria-label={`Roll back to version ${v.version}`}
                onClick={() => rollback.mutate(v.version)}
              >
                Roll back to this
              </Button>
            )}
          </li>
        ))}
        {data.versions.length === 0 && <li className="py-2 text-sm text-muted">No versions yet. The code defaults are active.</li>}
      </ul>
    </Card>
  );
}
