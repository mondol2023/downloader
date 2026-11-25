"use client";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * A server-paginated list whose filters and current cursor live in the URL (shareable, survives reload).
 * "Previous" pops a stack of the cursors already visited, since the API only pages forward.
 */
export function useAdminList<T extends { id: string }>(path: string, filterKeys: readonly string[]) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [stack, setStack] = useState<Array<string | null>>([]);

  const filters = Object.fromEntries(filterKeys.map((k) => [k, params.get(k) ?? ""]));
  const cursor = params.get("cursor");

  const push = useCallback(
    (next: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  if (cursor) qs.set("cursor", cursor);
  const query = useQuery({
    queryKey: ["admin", path, qs.toString()],
    queryFn: () => api<Page<T>>(`${path}${qs.size ? `?${qs}` : ""}`),
  });

  return {
    query,
    filters,
    setFilter: (key: string, value: string) => {
      setStack([]);
      push({ [key]: value || null, cursor: null });
    },
    hasPrev: stack.length > 0,
    next: () => {
      const n = query.data?.nextCursor;
      if (!n) return;
      setStack((s) => [...s, cursor]);
      push({ cursor: n });
    },
    prev: () => {
      const back = stack[stack.length - 1] ?? null;
      setStack((s) => s.slice(0, -1));
      push({ cursor: back });
    },
  };
}

export type AdminList<T extends { id: string }> = ReturnType<typeof useAdminList<T>>;
