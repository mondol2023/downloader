"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { changes, edit, toOverrides, valueAt, type Draft } from "./draft";
import type { PolicyAdminResponse } from "./types";

const KEY = "mg_policy_draft";

export const usePolicyAdmin = () =>
  useQuery({ queryKey: ["admin", "policy"], queryFn: () => api<PolicyAdminResponse>("/admin/policy") });

interface Ctx {
  data: PolicyAdminResponse;
  draft: Draft;
  errors: Record<string, string>;
  setErrors: (e: Record<string, string>) => void;
  get: <T>(path: string) => T;
  set: (path: string, value: unknown) => void;
  discard: () => void;
  changes: ReturnType<typeof changes>;
  overrides: () => Record<string, unknown>;
}
const PolicyCtx = createContext<Ctx | null>(null);
export const usePolicyDraft = () => {
  const c = useContext(PolicyCtx);
  if (!c) throw new Error("usePolicyDraft outside <PolicyDraftProvider>");
  return c;
};

/** Holds the draft shared by Restrictions, Sites and Tiers; a reload keeps it (sessionStorage). */
export function PolicyDraftProvider({ data, children }: { data: PolicyAdminResponse; children: ReactNode }) {
  // Mounted only after the client-side fetch, so sessionStorage is always available here.
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Draft;
    } catch {
      return {}; // a corrupt draft is just no draft
    }
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  }, [draft]);

  const set = useCallback(
    (path: string, value: unknown) => {
      setErrors((e) => {
        // Editing the rule list clears every per-rule error (their indexes may have shifted).
        const stale = Object.keys(e).filter((k) => k === path || (path === "rules" && k.startsWith("rules.")));
        if (!stale.length) return e;
        const rest = { ...e };
        for (const k of stale) delete rest[k];
        return rest;
      });
      setDraft((d) => edit(data.active, d, path, value));
    },
    [data.active],
  );

  const value = useMemo<Ctx>(
    () => ({
      data,
      draft,
      errors,
      setErrors,
      get: <T,>(path: string) => valueAt(data.active, draft, path) as T,
      set,
      discard: () => {
        setDraft({});
        setErrors({});
      },
      changes: changes(data.active, draft),
      overrides: () => toOverrides(data.defaults, data.active, draft),
    }),
    [data, draft, errors, set],
  );
  return <PolicyCtx.Provider value={value}>{children}</PolicyCtx.Provider>;
}
