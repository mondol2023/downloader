"use client";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PlaybackGrantResponse } from "@/lib/types";

export function usePlayback() {
  return useMutation({
    mutationFn: (input: { url: string; formatId: string }) =>
      api<PlaybackGrantResponse>("/media/playback", { method: "POST", body: input }),
  });
}
