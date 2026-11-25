"use client";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Sends a write to `/admin/<resource>…` then refreshes every cached page of that list. Rejects with the API's `ApiError`. */
export function useAdminAction(resource: string) {
  const qc = useQueryClient();
  return async (method: "POST" | "PATCH", sub: string, body?: unknown) => {
    const out = await api<unknown>(`/admin/${resource}${sub}`, { method, body: body ?? {} });
    await qc.invalidateQueries({ queryKey: ["admin", `/admin/${resource}`] });
    return out;
  };
}

/** Locale date-time, or an em dash when unset. */
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
