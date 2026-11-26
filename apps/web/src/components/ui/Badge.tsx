import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

const tones = {
  neutral: "bg-surface-2 text-muted",
  signal: "bg-signal/15 text-signal",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
};
/** Numeric badge (resolution, size): uses tabular mono so digits don't jitter. */
export function Badge({ tone = "neutral", className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span {...p} className={cn("num inline-flex items-center rounded-md px-2 py-0.5 text-xs", tones[tone], className)} />
  );
}
