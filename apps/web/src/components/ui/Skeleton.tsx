import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("rounded-key bg-surface-2 animate-[shimmer_1.2s_ease-in-out_infinite_alternate]", className)}
    />
  );
}
