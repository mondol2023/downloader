"use client";
import type { ReactNode } from "react";
import { Button, Skeleton } from "@/components/ui";
import type { AdminList } from "./useAdminList";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/** Table over a `useAdminList`: loading skeleton, empty/error states, and Previous/Next cursor paging. */
export function DataTable<T extends { id: string }>({
  list,
  columns,
  label,
  empty,
}: {
  list: AdminList<T>;
  columns: Array<Column<T>>;
  label: string;
  empty: string;
}) {
  const { query } = list;
  if (query.isPending) return <Skeleton className="h-64" />;
  if (query.isError) {
    return (
      <p role="alert" className="rounded-deck border border-line bg-surface-1 p-5 text-sm text-danger">
        Could not load {label}.{" "}
        <button className="underline" onClick={() => void query.refetch()}>
          Retry
        </button>
      </p>
    );
  }
  const rows = query.data.items;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-deck border border-line bg-surface-1">
        <table className="w-full text-left text-sm" aria-label={label}>
          <thead className="text-xs text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="p-3 font-normal">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-6 text-center text-muted">
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} data-testid="row" className="border-t border-line">
                {columns.map((c) => (
                  <td key={c.key} className={`p-3 align-top ${c.className ?? ""}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!list.hasPrev} onClick={list.prev}>
          Previous
        </Button>
        <Button type="button" variant="secondary" disabled={!query.data.nextCursor} onClick={list.next}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** A labelled `<select>` filter bound to a URL param. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-key border border-line bg-surface-2 px-3 text-text"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
