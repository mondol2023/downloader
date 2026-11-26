"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { Button, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import type { Page } from "@/features/admin/shared/useAdminList";
import { inputClass } from "@/features/admin/shared/EditSheet";
import type { CmsAssetRow } from "../shared";

export const ASSETS_KEY = ["admin", "/admin/cms/assets"] as const;

/** Drag-and-drop upload. Alt text is required, so a dropped file waits for it before it is sent. */
function Uploader() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };
  const upload = async () => {
    if (!file || !alt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("alt", alt.trim());
      form.set("file", file);
      await api("/admin/cms/assets", { method: "POST", body: form });
      await qc.invalidateQueries({ queryKey: ASSETS_KEY });
      setFile(null);
      setAlt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid="dropzone"
      className={`space-y-3 rounded-deck border border-dashed p-5 ${over ? "border-signal bg-surface-2" : "border-line bg-surface-1"}`}
    >
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="sr-only"
        aria-label="Choose image"
        onChange={(e) => take(e.target.files?.[0])}
      />
      {file ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void upload();
          }}
        >
          <p className="num text-sm">{file.name}</p>
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
            Alt text (required)
            <input className={inputClass} value={alt} onChange={(e) => setAlt(e.target.value)} required maxLength={300} />
          </label>
          <Button type="submit" disabled={busy || !alt.trim()}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setFile(null)}>
            Cancel
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted">
          Drop an image here, or{" "}
          <button type="button" className="underline" onClick={() => input.current?.click()}>
            choose a file
          </button>
          . PNG, JPEG, WebP, GIF or AVIF.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The library grid. With `onPick`, each tile selects the image instead of copying its URL. */
export function MediaGrid({ onPick, selectedId }: { onPick?: (a: CmsAssetRow) => void; selectedId?: string | null }) {
  const q = useInfiniteQuery({
    queryKey: ASSETS_KEY,
    initialPageParam: "",
    queryFn: ({ pageParam }) => api<Page<CmsAssetRow>>(`/admin/cms/assets${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (a: CmsAssetRow) => {
    await navigator.clipboard?.writeText(a.url);
    setCopied(a.id);
    setTimeout(() => setCopied((c) => (c === a.id ? null : c)), 1500);
  };

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-4">
      <Uploader />
      {q.isPending && <Skeleton className="h-48" />}
      {q.isError && (
        <p role="alert" className="text-sm text-danger">
          Could not load the library.{" "}
          <button className="underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      )}
      {q.isSuccess && items.length === 0 && <p className="text-sm text-muted">No images yet.</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Images">
        {items.map((a) => (
          <li key={a.id} className={`overflow-hidden rounded-deck border bg-surface-1 ${selectedId === a.id ? "border-signal" : "border-line"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.alt} loading="lazy" className="aspect-video w-full bg-surface-2 object-cover" />
            <div className="space-y-2 p-3">
              <p className="line-clamp-2 text-xs text-muted">{a.alt}</p>
              {onPick ? (
                <Button type="button" className="min-h-9 w-full" onClick={() => onPick(a)}>
                  Use image
                </Button>
              ) : (
                <Button type="button" variant="secondary" className="min-h-9 w-full" onClick={() => void copy(a)} aria-label={`Copy URL of ${a.alt}`}>
                  {copied === a.id ? "Copied" : "Copy URL"}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <Button type="button" variant="secondary" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {q.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
