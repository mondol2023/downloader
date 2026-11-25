"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Badge, Skeleton, buttonStyles } from "@/components/ui";
import { duration, ease } from "@/design/motion";
import { useMotionSafe } from "@/design/use-motion-safe";
import { ApiError } from "@/lib/api";
import { formatBytes, formatDuration, tierLabel } from "@/lib/format";
import type { ExtractResponse } from "@/lib/types";
import { Player } from "@/features/player";
import { useStartJob } from "@/features/jobs";
import { defaultFormatId, playableFormatId } from "../group";
import { useMedia } from "../hooks/useMedia";
import { DownloadBar } from "./DownloadBar";
import { FormatPicker, type PickerState } from "./FormatPicker";

/** Everything below the header: preview, picker, download. Presentational over a loaded result. */
export function MediaView({ result, pending, error, queued, onDownload }: {
  result: ExtractResponse;
  pending?: boolean;
  error?: unknown;
  queued?: boolean;
  onDownload: (p: PickerState) => void;
}) {
  const { media } = result;
  const [value, setValue] = useState<PickerState>(() => ({ formatId: defaultFormatId(result), audioFormat: null, subtitleLang: null }));
  const selected = result.formats.find((f) => f.id === value.formatId);
  const reveal = useMotionSafe({ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } }, { duration: duration.base, ease: ease.out });
  const playId = useMemo(() => playableFormatId(result, value.formatId), [result, value.formatId]);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="space-y-4">
        <motion.header {...reveal} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{media.platform}</Badge>
            <Badge>{formatDuration(media.durationSeconds)}</Badge>
            {media.availability === "unlisted" && <Badge>Unlisted</Badge>}
          </div>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">{media.title}</h1>
          {media.uploader && <p className="text-muted">{media.uploader}</p>}
        </motion.header>
        {playId ? (
          <Player key={playId} url={media.canonicalUrl} formatId={playId} poster={media.bestThumbnail} title={media.title} subtitles={media.subtitles} />
        ) : (
          <p className="rounded-key border border-line p-4 text-sm text-muted">A preview isn&apos;t available for these formats, but you can still download them.</p>
        )}
      </div>

      <aside className="space-y-5">
        {result.lockedFormatCount > 0 && (
          <div data-testid="locked-banner" className="rounded-key border border-signal/40 bg-signal/10 p-3 text-sm">
            <p>
              {result.lockedFormatCount} higher-quality {result.lockedFormatCount === 1 ? "format is" : "formats are"} available on a bigger plan.
            </p>
            <Link href={result.tier === "GUEST" ? "/register" : "/pricing"} className="mt-1 inline-block font-medium text-signal underline">
              {result.tier === "GUEST" ? "Create a free account" : "Upgrade to Pro for 4K"}
            </Link>
          </div>
        )}
        <FormatPicker formats={result.formats} tier={result.tier} recommendedFormatId={result.recommendedFormatId} subtitles={media.subtitles} value={value} onChange={setValue} />
        <DownloadBar
          label={selected?.label ?? null}
          sizeText={selected?.sizeBytes != null ? `${selected.sizeIsEstimate ? "~" : ""}${formatBytes(selected.sizeBytes)}` : undefined}
          pending={pending}
          error={error}
          queued={queued}
          resetsAt={result.quota?.windowResetsAt}
          onDownload={() => onDownload(value)}
        />
        <p className="text-xs text-muted">Your plan: {tierLabel(result.tier)}</p>
      </aside>
    </main>
  );
}

export function MediaSkeleton() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_26rem]" aria-busy="true" data-testid="media-skeleton">
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="aspect-video w-full" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11" />
        ))}
      </div>
    </main>
  );
}

export function MediaNotFound() {
  return (
    <main className="mx-auto max-w-lg space-y-3 px-4 py-24 text-center">
      <h1 className="font-display text-3xl">That link has expired</h1>
      <p className="text-muted">We keep results for a few hours. Paste the link again and it&apos;ll be right back.</p>
      <Link href="/" className={buttonStyles("primary")}>
        Paste a link
      </Link>
    </main>
  );
}

export function MediaScreen({ mediaId }: { mediaId: string }) {
  const media = useMedia(mediaId);
  const start = useStartJob();
  if (media.isPending) return <MediaSkeleton />;
  if (media.error instanceof ApiError && media.error.status === 404) return <MediaNotFound />;
  if (media.error || !media.data) {
    return (
      <main className="mx-auto max-w-lg space-y-3 px-4 py-24 text-center">
        <h1 className="font-display text-3xl">We couldn&apos;t load this one</h1>
        <p className="text-muted">Give it a moment, then refresh. Or paste the link again.</p>
      </main>
    );
  }
  const result = media.data;
  return (
    <MediaView
      // A new identity (sign-in) changes entitlements, so rebuild the picker state.
      key={`${result.tier}:${result.cachedAt}`}
      result={result}
      pending={start.isPending}
      error={start.error}
      queued={start.isSuccess}
      onDownload={(p) => {
        if (!p.formatId) return;
        start.mutate({
          url: result.media.canonicalUrl,
          formatId: p.formatId,
          ...(p.audioFormat ? { audioFormat: p.audioFormat } : {}),
          ...(p.subtitleLang ? { embedSubtitles: true, subtitleLang: p.subtitleLang } : {}),
        });
      }}
    />
  );
}
