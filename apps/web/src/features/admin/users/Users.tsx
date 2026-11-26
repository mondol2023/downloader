"use client";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { DataTable, FilterSelect, type Column } from "../shared/DataTable";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { EditSheet, inputClass } from "../shared/EditSheet";
import { TextFilter } from "../shared/TextFilter";
import { fmtDate, useAdminAction } from "../shared/useAdminAction";
import { useAdminList } from "../shared/useAdminList";

export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  tier: string;
  role: string;
  emailVerified: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}
const TIER_OPTIONS = ["GUEST", "FREE", "PRO"] as const;
const ROLES = ["USER", "EDITOR", "ADMIN"] as const;

function EditUser({ row }: { row: UserRow }) {
  const act = useAdminAction("users");
  const [tier, setTier] = useState(row.tier);
  const [role, setRole] = useState(row.role);
  return (
    <EditSheet
      title={`Edit ${row.email}`}
      trigger={
        <Button type="button" variant="secondary" className="min-h-9" aria-label={`Edit ${row.email}`}>
          Edit
        </Button>
      }
      onSubmit={() => act("PATCH", `/${row.id}`, { tier, role })}
    >
      <label className="block space-y-1 text-sm">
        Tier
        <select className={inputClass} value={tier} onChange={(e) => setTier(e.target.value)}>
          {TIER_OPTIONS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        Role
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
    </EditSheet>
  );
}

function Disable({ row }: { row: UserRow }) {
  const act = useAdminAction("users");
  const [reason, setReason] = useState("");
  const off = row.disabledAt !== null;
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="secondary" className="min-h-9" aria-label={`${off ? "Enable" : "Disable"} ${row.email}`}>
          {off ? "Enable" : "Disable"}
        </Button>
      }
      title={off ? "Enable account?" : "Disable account?"}
      target={row.email}
      confirmLabel={off ? "Enable account" : "Disable account"}
      onConfirm={() =>
        act("PATCH", `/${row.id}`, off ? { disabled: false } : { disabled: true, ...(reason.trim() ? { disabledReason: reason.trim() } : {}) })
      }
    >
      {off ? (
        <p className="text-sm text-muted">They can sign in again.</p>
      ) : (
        <label className="block space-y-1 text-sm">
          Reason (optional)
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          <span className="block text-xs text-muted">Signs them out everywhere immediately.</span>
        </label>
      )}
    </ConfirmDialog>
  );
}

const columns: Array<Column<UserRow>> = [
  {
    key: "user",
    header: "User",
    cell: (r) => (
      <div>
        <p className="num">{r.email}</p>
        {r.displayName && <p className="text-xs text-muted">{r.displayName}</p>}
      </div>
    ),
  },
  { key: "tier", header: "Tier", cell: (r) => <Badge>{r.tier}</Badge> },
  { key: "role", header: "Role", cell: (r) => <Badge tone={r.role === "USER" ? "neutral" : "signal"}>{r.role}</Badge> },
  {
    key: "status",
    header: "Status",
    cell: (r) =>
      r.disabledAt ? (
        <span title={r.disabledReason ?? undefined}>
          <Badge tone="danger">Disabled</Badge>
        </span>
      ) : (
        <Badge tone="success">Active</Badge>
      ),
  },
  { key: "login", header: "Last sign-in", cell: (r) => <span className="num text-muted">{fmtDate(r.lastLoginAt)}</span> },
  {
    key: "actions",
    header: "Actions",
    cell: (r) => (
      <div className="flex gap-2">
        <EditUser row={r} />
        <Disable row={r} />
      </div>
    ),
  },
];

export function Users() {
  const list = useAdminList<UserRow>("/admin/users", ["q", "tier", "role"]);
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Users</h1>
      <div className="flex flex-wrap gap-4">
        <TextFilter label="Search" value={list.filters.q!} onApply={(v) => list.setFilter("q", v)} placeholder="email or name" />
        <FilterSelect label="Tier" value={list.filters.tier!} options={TIER_OPTIONS} onChange={(v) => list.setFilter("tier", v)} />
        <FilterSelect label="Role" value={list.filters.role!} options={ROLES} onChange={(v) => list.setFilter("role", v)} />
      </div>
      <DataTable list={list} columns={columns} label="Users" empty="No users match." />
    </div>
  );
}
