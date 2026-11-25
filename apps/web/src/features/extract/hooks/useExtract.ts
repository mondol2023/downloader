"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ExtractResponse } from "@/lib/types";

export function useExtract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api<ExtractResponse>("/media/extract", { method: "POST", body: { url } }),
    onSuccess: (result) => {
      // The media page opens instantly from this seed instead of re-extracting.
      qc.setQueryData(queryKeys.media(result.media.id), result);
    },
  });
}
