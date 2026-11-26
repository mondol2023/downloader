"use client";
import type { JSONContent } from "@media/rich-text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { EditSheet, inputClass } from "@/features/admin/shared/EditSheet";
import { ConfirmDialog } from "@/features/admin/shared/ConfirmDialog";
import { fmtDate } from "@/features/admin/shared/useAdminAction";
import { ApiError, api, fieldErrors } from "@/lib/api";
import { EditorConflictError, RichTextEditor, type PickImage } from "../editor";
import { MediaPicker } from "../media-library";
import { assetOrigin, type CmsAssetRow, type CmsPage } from "../shared";
import { RevisionsSheet } from "./RevisionsSheet";
import { StatusBadge } from "./PagesList";

const PAGES = "/admin/cms/pages";
const SEO_TITLE_MAX = 120;
const SEO_DESC_MAX = 300;

const isConflict = (e: unknown) => e instanceof ApiError && e.code === "CMS_CONFLICT";

function Counter({ value, max, soft }: { value: string; max: number; soft: number }) {
  const n = value.length;
  return (
    <span className={`num block text-xs ${n > max ? "text-danger" : n > soft ? "text-warning" : "text-muted"}`} aria-live="polite">
      {n} / {max} (search engines show about {soft})
    </span>
  );
}

/** Debounced slug check against the list endpoint: any other page with exactly this slug means it's taken. */
function useSlugTaken(slug: string, id: string) {
  const [debounced, setDebounced] = useState(slug);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(slug), 300);
    return () => clearTimeout(t);
  }, [slug]);
  const q = useQuery({
    queryKey: ["admin", PAGES, "slug-check", debounced],
    queryFn: () => api<{ items: Array<{ id: string; slug: string }> }>(`${PAGES}?q=${encodeURIComponent(debounced)}&limit=20`),
    enabled: debounced.length > 0,
  });
  return slug === debounced && !!q.data?.items.some((p) => p.slug === debounced && p.id !== id);
}

function Details({
  page,
  onSaved,
  saveMeta,
}: {
  page: CmsPage;
  onSaved: (p: CmsPage) => void;
  saveMeta: (fields: Record<string, unknown>) => Promise<CmsPage>;
}) {
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [slugTouched, setSlugTouched] = useState(true);
  const [seoTitle, setSeoTitle] = useState(page.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(page.seoDescription ?? "");
  const [ogImageId, setOgImageId] = useState(page.ogImageId);
  const [ogUrl, setOgUrl] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const taken = useSlugTaken(slug, page.id);

  const dirty =
    title !== page.title ||
    slug !== page.slug ||
    seoTitle !== (page.seoTitle ?? "") ||
    seoDescription !== (page.seoDescription ?? "") ||
    ogImageId !== page.ogImageId;

  const save = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      onSaved(
        await saveMeta({
          title,
          slug,
          seoTitle: seoTitle.trim() || null,
          seoDescription: seoDescription.trim() || null,
          ogImageId,
        }),
      );
    } catch (e) {
      setFields(fieldErrors(e));
      setError(isConflict(e) ? "Someone else edited this page. Reload to see their changes." : e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="Page details"
      className="space-y-4 rounded-deck border border-line bg-surface-1 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
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
            if (!slugTouched) setSlug(
              e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 80),
            );
          }}
        />
        {fields.title && <span className="block text-xs text-danger">{fields.title}</span>}
      </label>
      <label className="block space-y-1 text-sm">
        Slug
        <input
          className={`${inputClass} num`}
          value={slug}
          required
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          aria-invalid={taken || !!fields.slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
        <span className="block text-xs text-muted">Public address: /p/{slug || "…"}</span>
        {taken && (
          <span role="alert" className="block text-xs text-danger">
            That slug is already used by another page.
          </span>
        )}
        {fields.slug && <span className="block text-xs text-danger">{fields.slug}</span>}
      </label>
      <fieldset className="space-y-4 border-t border-line pt-4">
        <legend className="text-sm text-muted">Search and sharing</legend>
        <label className="block space-y-1 text-sm">
          SEO title
          <input className={inputClass} value={seoTitle} maxLength={SEO_TITLE_MAX} onChange={(e) => setSeoTitle(e.target.value)} />
          <Counter value={seoTitle} max={SEO_TITLE_MAX} soft={60} />
        </label>
        <label className="block space-y-1 text-sm">
          SEO description
          <textarea
            className={`${inputClass} py-2`}
            rows={3}
            value={seoDescription}
            maxLength={SEO_DESC_MAX}
            onChange={(e) => setSeoDescription(e.target.value)}
          />
          <Counter value={seoDescription} max={SEO_DESC_MAX} soft={160} />
        </label>
        <div className="space-y-2 text-sm">
          <p>Share image (OG)</p>
          {ogImageId ? (
            <div className="flex items-center gap-3">
              {ogUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ogUrl} alt="Selected share image" className="h-16 w-28 rounded-key object-cover" />
              )}
              <span className="num text-xs text-muted">…{ogImageId.slice(-8)}</span>
              <Button type="button" variant="secondary" className="min-h-9" onClick={() => setOgImageId(null)}>
                Remove
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">None. Search and social cards will use the site default.</p>
          )}
          <Button type="button" variant="secondary" className="min-h-9" onClick={() => setPicking(true)}>
            {ogImageId ? "Change image" : "Choose image"}
          </Button>
          <MediaPicker
            open={picking}
            onOpenChange={setPicking}
            selectedId={ogImageId}
            title="Choose a share image"
            onPick={(a) => {
              setOgImageId(a.id);
              setOgUrl(a.url);
            }}
          />
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !dirty || taken}>
        {busy ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}

function StatusActions({ page, onChange }: { page: CmsPage; onChange: (p: CmsPage) => void }) {
  const [when, setWhen] = useState("");
  const post = async (sub: string, body: unknown = {}) => onChange(await api<CmsPage>(`${PAGES}/${page.id}/${sub}`, { method: "POST", body }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {page.status !== "PUBLISHED" && (
        <ConfirmDialog
          title="Publish this page?"
          target={`/p/${page.slug}`}
          confirmLabel="Publish"
          trigger={<Button type="button">Publish</Button>}
          onConfirm={() => post("publish")}
        >
          <p className="text-sm text-muted">It goes live on the public site straight away.</p>
        </ConfirmDialog>
      )}
      {(page.status === "PUBLISHED" || page.status === "SCHEDULED") && (
        <ConfirmDialog
          title={page.status === "PUBLISHED" ? "Unpublish this page?" : "Cancel the schedule?"}
          target={`/p/${page.slug}`}
          confirmLabel={page.status === "PUBLISHED" ? "Unpublish" : "Cancel schedule"}
          trigger={
            <Button type="button" variant="secondary">
              {page.status === "PUBLISHED" ? "Unpublish" : "Cancel schedule"}
            </Button>
          }
          onConfirm={() => post("unpublish")}
        >
          <p className="text-sm text-muted">The page goes back to a draft and stops being served.</p>
        </ConfirmDialog>
      )}
      {page.status !== "PUBLISHED" && (
        <EditSheet
          title="Schedule publishing"
          submitLabel="Schedule"
          trigger={
            <Button type="button" variant="secondary">
              Schedule
            </Button>
          }
          onSubmit={() => {
            const at = new Date(when);
            if (!when || Number.isNaN(at.getTime())) return Promise.reject(new Error("Pick a date and time"));
            return post("schedule", { publishAt: at.toISOString() });
          }}
        >
          <label className="block space-y-1 text-sm">
            Publish at (your local time)
            <input type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} required />
          </label>
        </EditSheet>
      )}
    </div>
  );
}

function Loaded({ initial }: { initial: CmsPage }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(initial);
  const [resetKey, setResetKey] = useState(0);
  const [initialDoc, setInitialDoc] = useState<JSONContent>(initial.contentJson);
  const version = useRef(initial.version);
  const picker = useRef<((a: CmsAssetRow | null) => void) | null>(null);
  const [picking, setPicking] = useState(false);

  const adopt = useCallback(
    (p: CmsPage) => {
      version.current = p.version;
      setPage((cur) => ({ ...cur, ...p }));
      void qc.invalidateQueries({ queryKey: ["admin", PAGES] });
    },
    [qc],
  );
  // After a restore or reload the editor must show the server's document, not the local one.
  const replace = useCallback(
    (p: CmsPage) => {
      adopt(p);
      setInitialDoc(p.contentJson);
      setResetKey((k) => k + 1);
    },
    [adopt],
  );

  const patch = useCallback(
    async (fields: Record<string, unknown>, ver = version.current) => {
      const next = await api<CmsPage>(`${PAGES}/${page.id}`, { method: "PATCH", body: { version: ver, ...fields } });
      adopt(next);
      return next;
    },
    [adopt, page.id],
  );

  const pickImage: PickImage = useCallback(
    () =>
      new Promise((resolve) => {
        picker.current = (a) => resolve(a ? { src: a.url, alt: a.alt } : null);
        setPicking(true);
      }),
    [],
  );

  const reload = useCallback(async () => replace(await api<CmsPage>(`${PAGES}/${page.id}`)), [page.id, replace]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Link href="/admin/content/pages" className="text-sm text-muted underline">
            ← All pages
          </Link>
          <h1 className="font-display text-3xl">{page.title}</h1>
          <p className="text-sm text-muted">
            <StatusBadge status={page.status} /> <span className="num">v{page.version}</span> · updated {fmtDate(page.updatedAt)}
            {page.status === "SCHEDULED" && <> · goes live {fmtDate(page.publishAt)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RevisionsSheet page={page} onRestored={replace} />
          <StatusActions page={page} onChange={adopt} />
        </div>
      </div>

      <Details page={page} onSaved={adopt} saveMeta={(fields) => patch(fields)} />

      <RichTextEditor
        initialContent={initialDoc}
        resetKey={resetKey}
        assetOrigin={assetOrigin()}
        pickImage={pickImage}
        onReload={() => void reload()}
        onSave={async (doc, { overwrite }) => {
          try {
            // *Overwrite* re-reads the live version first, so the write wins instead of conflicting again.
            const ver = overwrite ? (await api<CmsPage>(`${PAGES}/${page.id}`)).version : version.current;
            await patch({ contentJson: doc }, ver);
          } catch (e) {
            if (isConflict(e)) throw new EditorConflictError();
            throw e;
          }
        }}
      />

      <MediaPicker
        open={picking}
        onOpenChange={(o) => {
          setPicking(o);
          if (!o && picker.current) {
            picker.current(null);
            picker.current = null;
          }
        }}
        onPick={(a) => {
          picker.current?.(a);
          picker.current = null;
        }}
      />
    </div>
  );
}

export function PageEditor({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["admin", PAGES, id], queryFn: () => api<CmsPage>(`${PAGES}/${id}`), staleTime: Infinity, refetchOnWindowFocus: false });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {q.error instanceof ApiError && q.error.status === 404 ? "That page does not exist." : "Could not load the page."}{" "}
        <Link href="/admin/content/pages" className="underline">
          Back to pages
        </Link>
      </p>
    );
  }
  return <Loaded initial={q.data} />;
}
