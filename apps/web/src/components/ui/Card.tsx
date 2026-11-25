import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cn("rounded-deck border border-line bg-surface-1 p-5", className)} />;
}
