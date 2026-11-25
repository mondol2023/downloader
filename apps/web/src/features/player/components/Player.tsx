"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SubtitleTrack } from "@media/shared";
import { Button, Skeleton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { PlaybackGrantResponse } from "@/lib/types";
import { usePlayback } from "../hooks/usePlayback";

export type PlayerPhase = "poster" | "loading" | "playing" | "error";

/** Attaches hls.js for HLS grants (loaded lazily), native `src` otherwise. */
function useAttach(video: HTMLVideoElement | null, grant: PlaybackGrantResponse | null, onFatal: () => void) {
  // Callers pass inline closures; keep the latest in a ref so the attach effect doesn't re-run.
  const fatal = useRef(onFatal);
  useEffect(() => {
    fatal.current = onFatal;
  });
  useEffect(() => {
    if (!video || !grant) return;
    const onFatal = () => fatal.current();
    let destroy = () => {};
    let cancelled = false;
    const isHls = grant.protocol === "hls" || grant.protocol === "m3u8_native";
    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (isHls && !nativeHls) {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) return onFatal();
        const hls = new Hls();
        hls.on(Hls.Events.ERROR, (_e, data) => data.fatal && onFatal());
        hls.loadSource(grant.playbackUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => {}));
        destroy = () => hls.destroy();
      });
    } else {
      video.setAttribute("src", grant.playbackUrl);
      void video.play().catch(() => {});
    }
    return () => {
      cancelled = true;
      destroy();
    };
  }, [video, grant]);
}

function errorCopy(error: unknown): { title: string; body: string; upsell?: boolean } {
  if (error instanceof ApiError && error.status === 403) {
    return { title: "In-app playback isn't on your plan", body: "You can still download this file.", upsell: true };
  }
  return { title: "Playback didn't start", body: "You can download this one instead, or try another quality." };
}

/** Poster → loading → playing. Subtitle selector appears once there are tracks. */
export function PlayerView({
  phase,
  poster,
  title,
  subtitles,
  grant,
  error,
  onPlay,
  onFatal,
}: {
  phase: PlayerPhase;
  poster: string | null;
  title: string;
  subtitles: SubtitleTrack[];
  grant: PlaybackGrantResponse | null;
  error?: unknown;
  onPlay: () => void;
  onFatal: () => void;
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [lang, setLang] = useState("");
  useAttach(video, phase === "playing" ? grant : null, onFatal);

  // Exactly one text track is visible: the selected language, or none.
  useEffect(() => {
    if (!video) return;
    for (const t of Array.from(video.textTracks)) t.mode = t.language === lang ? "showing" : "disabled";
  }, [video, lang, subtitles]);

  const err = phase === "error" ? errorCopy(error) : null;
  const isAudio = grant?.mimeType.startsWith("audio/");

  return (
    <div data-testid="player" data-phase={phase} className="space-y-3">
      <div className={cn("relative aspect-video overflow-hidden rounded-deck border border-line bg-black", isAudio && "aspect-auto")}>
        {phase === "playing" && grant ? (
          <video
            ref={setVideo}
            controls
            playsInline
            poster={poster ?? undefined}
            aria-label={title}
            crossOrigin="anonymous"
            className={cn("h-full w-full", isAudio && "h-14")}
          >
            {subtitles.map((s) => (
              <track key={s.lang} kind="subtitles" srcLang={s.lang} label={s.label} src={s.url} />
            ))}
          </video>
        ) : (
          <>
            {poster ? (
              // Remote thumbnails come from any CDN, so next/image's allow-list doesn't fit.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt="" className="h-full w-full object-cover" />
            ) : (
              <Skeleton className="h-full w-full rounded-none" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              {phase === "loading" ? (
                <p role="status" className="rounded-key bg-black/70 px-4 py-2 text-sm">Getting it ready…</p>
              ) : (
                <Button onClick={onPlay} aria-label={`Play ${title}`} className="min-h-16 min-w-16 rounded-full text-lg">
                  ▶
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {err && (
        <div role="alert" className="rounded-key bg-danger/10 p-3 text-sm">
          <p className="font-medium">{err.title}</p>
          <p className="mt-1 text-muted">
            {err.body}{" "}
            {err.upsell && (
              <Link href="/pricing" className="text-signal underline">
                See plans
              </Link>
            )}
          </p>
        </div>
      )}

      {phase === "playing" && subtitles.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted">
          Subtitles
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="min-h-11 rounded-key border border-line bg-surface-1 px-2 text-text"
          >
            <option value="">Off</option>
            {subtitles.map((s) => (
              <option key={s.lang} value={s.lang}>
                {s.label}
                {s.autoGenerated ? " (auto)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Wired player: asks the API for a playback grant on first play. */
export function Player({
  url,
  formatId,
  poster,
  title,
  subtitles,
}: {
  url: string;
  formatId: string;
  poster: string | null;
  title: string;
  subtitles: SubtitleTrack[];
}) {
  const playback = usePlayback();
  const [failed, setFailed] = useState(false);

  const phase: PlayerPhase =
    failed || playback.isError ? "error" : playback.isPending ? "loading" : playback.data ? "playing" : "poster";

  return (
    <PlayerView
      phase={phase}
      poster={poster}
      title={title}
      subtitles={subtitles}
      grant={playback.data ?? null}
      error={playback.error}
      onPlay={() => {
        setFailed(false);
        playback.mutate({ url, formatId });
      }}
      onFatal={() => setFailed(true)}
    />
  );
}
