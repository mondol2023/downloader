import type { GatedMediaFormat } from "@media/shared";
import type { ExtractResponse } from "@/lib/types";

export interface FormatGroups {
  video: GatedMediaFormat[];
  audio: GatedMediaFormat[];
}

const byQuality = (a: GatedMediaFormat, b: GatedMediaFormat) =>
  (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0) || (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0);

export function groupFormats(formats: GatedMediaFormat[]): FormatGroups {
  return {
    video: formats.filter((f) => f.hasVideo).sort(byQuality),
    audio: formats.filter((f) => !f.hasVideo).sort(byQuality),
  };
}

/** The recommendation if it's selectable, else the best unlocked rendition. */
export function defaultFormatId(r: Pick<ExtractResponse, "formats" | "recommendedFormatId">): string | null {
  const rec = r.formats.find((f) => f.id === r.recommendedFormatId && f.allowed);
  if (rec) return rec.id;
  const { video, audio } = groupFormats(r.formats.filter((f) => f.allowed));
  return (video[0] ?? audio[0])?.id ?? null;
}

/**
 * The browser can only preview a rendition that carries its own audio. For a video-only pick we
 * preview the best muxed one instead, so the preview never plays silently.
 */
export function playableFormatId(r: Pick<ExtractResponse, "formats" | "recommendedFormatId">, selectedId: string | null): string | null {
  const selected = r.formats.find((f) => f.id === selectedId);
  if (selected && selected.allowed && (selected.hasAudio || !selected.hasVideo)) return selected.id;
  const muxed = r.formats.filter((f) => f.allowed && f.hasVideo && f.hasAudio).sort(byQuality);
  return (muxed.find((f) => f.id === r.recommendedFormatId) ?? muxed[0])?.id ?? null;
}
