"use client";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { DataTable, FilterSelect, type Column } from "../shared/DataTable";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { EditSheet, inputClass } from "../shared/EditSheet";
import { fmtDate, useAdminAction } from "../shared/useAdminAction";
import { useAdminList } from "../shared/useAdminList";

export interface TakedownRow {
  id: string;
  mediaId: string;
  sourceUrl: string;
  reason: string;
  status: "PENDING" | "ACTIVE" | "REJECTED";
  requesterEmail: string | null;
  createdAt: string;
}
const STATUSES = ["PENDING", "ACTIVE", "REJECTED"] as const;
const TONE = { PENDING: "neutral", ACTIVE: "danger", REJECTED: "success" } as const;

function Decide({ row, to }: { row: TakedownRow; to: "ACTIVE" | "REJECTED" }) {
  const act = useAdminAction("takedowns");
  const approve = to === "ACTIVE";
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="secondary" className="min-h-9">
          {approve ? "Approve" : "Reject"}
        </Button>
      }
      title={approve ? "Approve takedown?" : "Reject takedown?"}
      target={row.sourceUrl}
      confirmLabel={approve ? "Approve and block" : "Reject request"}
      onConfirm={() => act("PATCH", `/${row.id}`, { status: to })}
    >
      <p className="text-sm text-muted">
        {approve
          ? "The source is refused for everyone straight away and its cached record is dropped."
          : "The source stays available."}
      </p>
    </ConfirmDialog>
  );
}

function NewTakedown() {
  const act = useAdminAction("takedowns");
  const [f, setF] = useState({ sourceUrl: "", reason: "", requesterEmail: "", status: "PENDING" });
  return (
    <EditSheet
      title="New takedown"
      submitLabel="File takedown"
      trigger={<Button type="button">New takedown</Button>}
      onSubmit={async () => {
        await act("POST", "", {
          sourceUrl: f.sourceUrl,
          reason: f.reason,
          status: f.status,
          ...(f.requesterEmail ? { requesterEmail: f.requesterEmail } : {}),
        });
        setF({ sourceUrl: "", reason: "", requesterEmail: "", status: "PENDING" });
      }}
    >
      <label className="block space-y-1 text-sm">
        Source URL
        <input required className={inputClass} value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />
      </label>
      <label className="block space-y-1 text-sm">
        Reason
        <textarea required rows={3} className={`${inputClass} py-2`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </label>
      <label className="block space-y-1 text-sm">
        Requester email (optional)
        <input type="email" className={inputClass} value={f.requesterEmail} onChange={(e) => setF({ ...f, requesterEmail: e.target.value })} />
      </label>
      <label className="block space-y-1 text-sm">
        Starts as
        <select className={inputClass} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="PENDING">Pending review</option>
          <option value="ACTIVE">Active (block now)</option>
        </select>
      </label>
    </EditSheet>
  );
}

const columns: Array<Column<TakedownRow>> = [
  { key: "source", header: "Source", cell: (r) => <span className="num break-all" title={r.mediaId}>{r.sourceUrl}</span> },
  { key: "reason", header: "Reason", cell: (r) => <span className="text-muted">{r.reason}</span> },
  { key: "status", header: "Status", cell: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> },
  { key: "filed", header: "Filed", cell: (r) => <span className="num text-muted">{fmtDate(r.createdAt)}</span> },
  {
    key: "actions",
    header: "Actions",
    cell: (r) => (
      <div className="flex gap-2">
        {r.status !== "ACTIVE" && <Decide row={r} to="ACTIVE" />}
        {r.status === "PENDING" && <Decide row={r} to="REJECTED" />}
      </div>
    ),
  },
];

export function Takedowns() {
  const list = useAdminList<TakedownRow>("/admin/takedowns", ["status"]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Takedowns</h1>
        <NewTakedown />
      </div>
      <FilterSelect label="Status" value={list.filters.status!} options={STATUSES} onChange={(v) => list.setFilter("status", v)} />
      <DataTable list={list} columns={columns} label="Takedowns" empty="No takedowns match." />
    </div>
  );
}
