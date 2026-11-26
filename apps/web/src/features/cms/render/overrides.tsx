"use client";
import { INELIGIBLE_COPY, type IneligibleCode } from "@media/shared";
import { createContext, useContext, type ReactNode } from "react";
import type { RefusalOverrides } from "./refusal";

const Ctx = createContext<RefusalOverrides>({});

export function CmsOverridesProvider({ refusals, children }: { refusals: RefusalOverrides; children: ReactNode }) {
  return <Ctx value={refusals}>{children}</Ctx>;
}

/** Copy for a refusal code: the CMS `refusal.<CODE>` block when one is published, else the built-in default. */
export function useRefusalCopy(): (code: IneligibleCode) => { title: string; body: string } {
  const overrides = useContext(Ctx);
  return (code) => {
    const base = INELIGIBLE_COPY[code];
    const o = overrides[code];
    return o ? { title: o.title ?? base.title, body: o.body } : base;
  };
}
