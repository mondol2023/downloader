"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ExtractResponse } from "@/lib/types";

/** Seeded by `useExtract`; falls back to the cached-lookup route on reload or deep link. */
export function useMedia(mediaId: string) {
  return useQuery({ queryKey: queryKeys.media(mediaId), queryFn: () => api<ExtractResponse>(`/media/${encodeURIComponent(mediaId)}`) });
}
