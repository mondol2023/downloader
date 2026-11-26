"use client";
import * as P from "@radix-ui/react-progress";
import { motion } from "motion/react";
import { spring } from "@/design/motion";

/** Width is a `scaleX` (compositor-only), eased by a spring so 1 s polling gaps still read as smooth. */
export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <P.Root
      value={value}
      aria-label={label}
      className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <P.Indicator asChild>
        <motion.div
          className="h-full w-full origin-left bg-signal"
          initial={false}
          animate={{ scaleX: pct / 100 }}
          transition={spring.progress}
        />
      </P.Indicator>
    </P.Root>
  );
}
