"use client";
import { INELIGIBLE_CODES } from "@media/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Skeleton } from "@/components/ui";
import { fmtDate } from "@/features/admin/shared/useAdminAction";
import { api } from "@/lib/api";
import { RichTextEditor } from "../editor";
import { EMPTY_DOC, assetOrigin, type CmsBlockRow } from "../shared";

const BLOCKS_KEY = ["admin", "/admin/cms/blocks"] as const;

/** The keys the public site reads. A key with no stored row is simply "not overridden". */
export const KNOWN_BLOCKS: Array<{ key: string; label: string; hint: string }> = [
  { key: "home.hero.subtitle", label: "Home hero subtitle", hint: "The line under the headline on the home page." },
  { key: "announcement.banner", label: "Announcement banner", hint: "Shown across the top of every public page. Leave empty for none." },
  ...INELIGIBLE_CODES.map((code) => ({
    key: `refusal.${code}`,
    label: `Refusal message · ${code}`,
    hint: "Replaces the built-in explanation when a link is refused with this code.",
  })),
];

function BlockEditor({ blockKey, initial }: { blockKey: string; initial: CmsBlockRow | undefined }) {
  const qc = useQueryClient();
  return (
    <RichTextEditor
      compact
      initialContent={initial?.contentJson ?? EMPTY_DOC}
      assetOrigin={assetOrigin()}
      placeholder="Write the replacement text…"
      onSave={async (doc) => {
        await api(`/admin/cms/blocks/${encodeURIComponent(blockKey)}`, { method: "PUT", body: { contentJson: doc } });
        await qc.invalidateQueries({ queryKey: BLOCKS_KEY });
      }}
    />
  );
}

export function Blocks() {
  const q = useQuery({ queryKey: BLOCKS_KEY, queryFn: () => api<{ items: CmsBlockRow[] }>("/admin/cms/blocks") });
  const [open, setOpen] = useState<string | null>(null);

  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        Could not load blocks.{" "}
        <button className="underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  }
  const stored = new Map(q.data.items.map((b) => [b.key, b]));
  // Stored keys that are not in the known list (older or custom) stay editable.
  const known = new Set(KNOWN_BLOCKS.map((b) => b.key));
  const rows = [
    ...KNOWN_BLOCKS,
    ...q.data.items.filter((b) => !known.has(b.key)).map((b) => ({ key: b.key, label: b.key, hint: "Custom block." })),
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl">Blocks</h1>
        <p className="text-sm text-muted">Small pieces of copy used around the site. Changes save automatically and go live on the next page refresh.</p>
      </div>
      <ul className="space-y-3" aria-label="Content blocks">
        {rows.map((b) => {
          const row = stored.get(b.key);
          const isOpen = open === b.key;
          return (
            <li key={b.key} className="rounded-deck border border-line bg-surface-1">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="space-y-1">
                  <p className="text-sm">{b.label}</p>
                  <p className="num text-xs text-muted">{b.key}</p>
                  <p className="text-xs text-muted">{b.hint}</p>
                </div>
                <div className="flex items-center gap-3">
                  {row ? (
                    <span className="text-xs text-muted">
                      <Badge tone="success">Set</Badge> {fmtDate(row.updatedAt)}
                    </span>
                  ) : (
                    <Badge>Default</Badge>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-9"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Close" : "Edit"} ${b.label}`}
                    onClick={() => setOpen(isOpen ? null : b.key)}
                  >
                    {isOpen ? "Close" : "Edit"}
                  </Button>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-line p-4">
                  <BlockEditor blockKey={b.key} initial={row} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
