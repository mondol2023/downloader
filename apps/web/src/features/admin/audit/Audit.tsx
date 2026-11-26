"use client";
import { DataTable, type Column } from "../shared/DataTable";
import { TextFilter } from "../shared/TextFilter";
import { fmtDate } from "../shared/useAdminAction";
import { useAdminList } from "../shared/useAdminList";

export interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  outcome: string;
  target: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

const columns: Array<Column<AuditRow>> = [
  { key: "when", header: "When", cell: (r) => <span className="num text-muted">{fmtDate(r.createdAt)}</span> },
  { key: "actor", header: "Actor", cell: (r) => <span className="num">{r.actorId ?? "—"}</span> },
  { key: "action", header: "Action", cell: (r) => <span className="num">{r.action}</span> },
  { key: "target", header: "Target", cell: (r) => <span className="num text-muted">{r.target ?? "—"}</span> },
  {
    key: "change",
    header: "Change",
    cell: (r) =>
      r.before == null && r.after == null ? (
        <span className="text-muted">—</span>
      ) : (
        <details>
          <summary className="cursor-pointer text-muted">Before / after</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <pre className="num overflow-x-auto rounded-key bg-surface-2 p-2 text-xs">{r.before == null ? "—" : json(r.before)}</pre>
            <pre className="num overflow-x-auto rounded-key bg-surface-2 p-2 text-xs">{r.after == null ? "—" : json(r.after)}</pre>
          </div>
        </details>
      ),
  },
];

/** Read-only, so no actions: filter by actor id and by action (a trailing dot matches the whole family, e.g. `policy.`). */
export function Audit() {
  const list = useAdminList<AuditRow>("/admin/audit", ["actor", "action"]);
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Audit log</h1>
      <div className="flex flex-wrap gap-4">
        <TextFilter label="Actor" value={list.filters.actor!} onApply={(v) => list.setFilter("actor", v)} placeholder="user id" />
        <TextFilter label="Action" value={list.filters.action!} onApply={(v) => list.setFilter("action", v)} placeholder="policy." />
      </div>
      <DataTable list={list} columns={columns} label="Audit events" empty="No events match." />
    </div>
  );
}
