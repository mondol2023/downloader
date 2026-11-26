"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { DataTable, FilterSelect, type Column } from "@/features/admin/shared/DataTable";
import { EditSheet, inputClass } from "@/features/admin/shared/EditSheet";
import { TextFilter } from "@/features/admin/shared/TextFilter";
import { fmtDate, useAdminAction } from "@/features/admin/shared/useAdminAction";
import { useAdminList } from "@/features/admin/shared/useAdminList";
import { EMPTY_DOC, slugify, type CmsPageRow } from "../shared";

const STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;
const TONE = { DRAFT: "neutral", SCHEDULED: "signal", PUBLISHED: "success", ARCHIVED: "neutral" } as const;

export function StatusBadge({ status }: { status: CmsPageRow["status"] }) {
  return <Badge tone={TONE[status]}>{status}</Badge>;
}

function NewPage() {
  const act = useAdminAction("cms");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <EditSheet
      title="New page"
      submitLabel="Create draft"
      trigger={<Button type="button">New page</Button>}
      onSubmit={async () => {
        const row = (await act("POST", "/pages", { title, slug, contentJson: EMPTY_DOC })) as { id: string };
        router.push(`/admin/content/pages/${row.id}`);
      }}
    >
      <label className="block space-y-1 text-sm">
        Title
        <input
          className={inputClass}
          value={title}
          required
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!touched) setSlug(slugify(e.target.value));
          }}
        />
      </label>
      <label className="block space-y-1 text-sm">
        Slug
        <input
          className={`${inputClass} num`}
          value={slug}
          required
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          onChange={(e) => {
            setTouched(true);
            setSlug(e.target.value);
          }}
        />
        <span className="block text-xs text-muted">Public address: /p/{slug || "…"}</span>
      </label>
    </EditSheet>
  );
}

const columns: Array<Column<CmsPageRow>> = [
  {
    key: "title",
    header: "Page",
    cell: (r) => (
      <div>
        <Link href={`/admin/content/pages/${r.id}`} className="underline">
          {r.title}
        </Link>
        <p className="num text-xs text-muted">/{r.slug}</p>
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => (
      <div className="space-y-1">
        <StatusBadge status={r.status} />
        {r.status === "SCHEDULED" && <p className="num text-xs text-muted">{fmtDate(r.publishAt)}</p>}
      </div>
    ),
  },
  {
    key: "by",
    header: "Updated by",
    cell: (r) => (
      <span className="num text-muted" title={r.updatedById}>
        {r.updatedById ? `…${r.updatedById.slice(-6)}` : "—"}
      </span>
    ),
  },
  { key: "updated", header: "Updated", cell: (r) => <span className="num text-muted">{fmtDate(r.updatedAt)}</span> },
];

export function PagesList() {
  const list = useAdminList<CmsPageRow>("/admin/cms/pages", ["q", "status"]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl">Pages</h1>
        <NewPage />
      </div>
      <div className="flex flex-wrap gap-4">
        <TextFilter label="Search" value={list.filters.q!} onApply={(v) => list.setFilter("q", v)} placeholder="title or slug" />
        <FilterSelect label="Status" value={list.filters.status!} options={STATUSES} onChange={(v) => list.setFilter("status", v)} />
      </div>
      <DataTable list={list} columns={columns} label="Pages" empty="No pages match." />
    </div>
  );
}
