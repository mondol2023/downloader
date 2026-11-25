"use client";
import { useState, type ReactNode } from "react";
import { Badge, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HardFloor } from "./HardFloor";
import { HistoryTab } from "./HistoryTab";
import { ReviewSheet } from "./ReviewSheet";
import type { PolicyAdminResponse } from "./types";
import { PolicyDraftProvider, usePolicyAdmin, usePolicyDraft } from "./usePolicyDraft";

function Bar() {
  const { changes, discard, data } = usePolicyDraft();
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 border-t border-line bg-surface-1/95 p-3 backdrop-blur">
      <p className="text-sm text-muted" aria-live="polite">
        {changes.length ? `${changes.length} unpublished change${changes.length === 1 ? "" : "s"}` : `No changes · v${data.active.version} active`}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" disabled={changes.length === 0} onClick={discard}>
          Discard
        </Button>
        <ReviewSheet />
      </div>
    </div>
  );
}

function Body({ title, children }: { title: string; children: ReactNode }) {
  const { data } = usePolicyDraft();
  const [tab, setTab] = useState<"edit" | "history">("edit");
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">{title}</h1>
        <Badge tone="neutral">policy v{data.active.version}</Badge>
      </div>
      <HardFloor floor={data.hardFloor} />
      <div role="tablist" aria-label="Policy" className="flex gap-1 border-b border-line">
        {(["edit", "history"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={cn(
              "min-h-11 px-4 text-sm capitalize",
              tab === t ? "border-b-2 border-signal text-text" : "text-muted hover:text-text",
            )}
          >
            {t === "edit" ? "Settings" : "History"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "edit" ? children : <HistoryTab />}
      </div>
      {tab === "edit" && <Bar />}
    </div>
  );
}

/** Loads the policy, owns the shared draft, and frames one editor with the hard floor, History and the review bar. */
export function PolicyScreen({ title, children }: { title: string; children: ReactNode }) {
  const q = usePolicyAdmin();
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <p role="alert" className="text-sm text-danger">Couldn&apos;t load the policy.</p>;
  return <PolicyView data={q.data} title={title}>{children}</PolicyView>;
}

export function PolicyView({ data, title, children }: { data: PolicyAdminResponse; title: string; children: ReactNode }) {
  return (
    <PolicyDraftProvider data={data}>
      <Body title={title}>{children}</Body>
    </PolicyDraftProvider>
  );
}
