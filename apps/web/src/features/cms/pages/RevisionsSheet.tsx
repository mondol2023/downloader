"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Sheet, Skeleton } from "@/components/ui";
import { ConfirmDialog } from "@/features/admin/shared/ConfirmDialog";
import { fmtDate } from "@/features/admin/shared/useAdminAction";
import { api } from "@/lib/api";
import type { CmsPage, CmsRevision } from "../shared";
import { diffLines, docLines } from "./diff";

const MARK = { same: "  ", add: "+ ", del: "− " } as const;
const STYLE = { same: "text-muted", add: "text-success", del: "text-danger line-through" } as const;

/** Revision history. Each entry diffs against the live page; restoring writes a new revision. */
export function RevisionsSheet({ page, onRestored }: { page: CmsPage; onRestored: (p: CmsPage) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["admin", "/admin/cms/pages", page.id, "revisions", page.version],
    queryFn: () => api<{ items: CmsRevision[] }>(`/admin/cms/pages/${page.id}/revisions`),
    enabled: open,
  });
  const rev = q.data?.items.find((r) => r.version === picked);
  const diff = rev ? diffLines(docLines(rev.contentJson), docLines(page.contentJson)) : [];

  return (
    <Sheet
      title="Revisions"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button type="button" variant="secondary">
          Revisions
        </Button>
      }
    >
      {q.isPending && <Skeleton className="h-32" />}
      {q.isError && (
        <p role="alert" className="text-sm text-danger">
          Could not load revisions.
        </p>
      )}
      <ul className="space-y-2" aria-label="Revisions">
        {q.data?.items.map((r) => (
          <li key={r.id} className="rounded-key border border-line p-3 text-sm">
            <button type="button" className="w-full text-left" aria-pressed={picked === r.version} onClick={() => setPicked(picked === r.version ? null : r.version)}>
              <span className="num">v{r.version}</span>
              {r.version === page.version && <span className="ml-2 text-xs text-muted">current</span>}
              <span className="block text-xs text-muted">{fmtDate(r.createdAt)}</span>
            </button>
            {picked === r.version && (
              <div className="mt-3 space-y-3">
                {r.title !== page.title && (
                  <p className="text-xs">
                    <span className="text-danger line-through">{r.title}</span> → <span className="text-success">{page.title}</span>
                  </p>
                )}
                <pre data-testid="diff" className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                  {diff.length === 0 ? "No content." : diff.map((d, i) => (
                    <span key={i} className={`block ${STYLE[d.kind]}`}>
                      {MARK[d.kind]}
                      {d.text}
                    </span>
                  ))}
                </pre>
                <p className="text-xs text-muted">Diff reads: this revision → the live page.</p>
                {r.version !== page.version && (
                  <ConfirmDialog
                    title="Restore this revision?"
                    target={`${page.title} · v${r.version}`}
                    confirmLabel="Restore"
                    trigger={
                      <Button type="button" variant="secondary" className="min-h-9">
                        Restore v{r.version}
                      </Button>
                    }
                    onConfirm={async () => {
                      const next = await api<CmsPage>(`/admin/cms/pages/${page.id}/revisions/${r.version}/restore`, { method: "POST", body: {} });
                      onRestored(next);
                      setPicked(null);
                      setOpen(false);
                    }}
                  >
                    <p className="text-sm text-muted">Saves a new version with this content. Nothing in the history is lost.</p>
                  </ConfirmDialog>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
