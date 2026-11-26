"use client";
import { Badge, Button } from "@/components/ui";
import { DataTable, FilterSelect, type Column } from "../shared/DataTable";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { fmtDate, useAdminAction } from "../shared/useAdminAction";
import { useAdminList } from "../shared/useAdminList";

export interface JobRow {
  id: string;
  userId: string | null;
  type: string;
  state: string;
  platform: string | null;
  mediaTitle: string | null;
  sourceUrl: string | null;
  formatLabel: string | null;
  tierAtRequest: string | null;
  percent: number | null;
  stage: string | null;
  error: string | null;
  createdAt: string;
}
const STATES = ["QUEUED", "EXTRACTING", "DOWNLOADING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"] as const;
const DONE = ["COMPLETED", "FAILED", "CANCELLED"];
const tone = (s: string) => (s === "COMPLETED" ? "success" : s === "FAILED" ? "danger" : s === "CANCELLED" ? "neutral" : "signal");

function Cancel({ row }: { row: JobRow }) {
  const act = useAdminAction("jobs");
  const name = row.mediaTitle ?? row.sourceUrl ?? row.id;
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="secondary" className="min-h-9" aria-label={`Cancel job ${name}`}>
          Cancel
        </Button>
      }
      title="Cancel this job?"
      target={name}
      confirmLabel="Cancel job"
      onConfirm={() => act("POST", `/${row.id}/cancel`)}
    >
      <p className="text-sm text-muted">A queued job is removed at once; a running one stops at its next stage.</p>
    </ConfirmDialog>
  );
}

const columns: Array<Column<JobRow>> = [
  {
    key: "media",
    header: "Media",
    cell: (r) => (
      <div className="max-w-xs">
        <p className="truncate">{r.mediaTitle ?? r.sourceUrl ?? "—"}</p>
        <p className="num text-xs text-muted">
          {r.platform ?? "?"} · {r.formatLabel ?? r.type}
        </p>
      </div>
    ),
  },
  { key: "state", header: "State", cell: (r) => <Badge tone={tone(r.state)}>{r.state}</Badge> },
  { key: "progress", header: "Progress", cell: (r) => <span className="num">{r.percent == null ? "—" : `${Math.round(r.percent)}%`}</span> },
  { key: "tier", header: "Tier", cell: (r) => <span className="num text-muted">{r.tierAtRequest ?? "—"}</span> },
  { key: "error", header: "Error", cell: (r) => <span className="text-danger">{r.error ?? ""}</span> },
  { key: "created", header: "Created", cell: (r) => <span className="num text-muted">{fmtDate(r.createdAt)}</span> },
  { key: "actions", header: "Actions", cell: (r) => (DONE.includes(r.state) ? null : <Cancel row={r} />) },
];

export function Jobs() {
  const list = useAdminList<JobRow>("/admin/jobs", ["state"]);
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Jobs</h1>
      <FilterSelect label="State" value={list.filters.state!} options={STATES} onChange={(v) => list.setFilter("state", v)} />
      <DataTable list={list} columns={columns} label="Jobs" empty="No jobs match." />
    </div>
  );
}
