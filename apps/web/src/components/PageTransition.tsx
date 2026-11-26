"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { duration, ease } from "@/design/motion";
import { useMotionSafe } from "@/design/use-motion-safe";

/**
 * Route enter: fade + 8px rise. Rendered from `app/template.tsx`, which remounts per navigation.
 * App Router unmounts the old page before the new one mounts, so there is no exit pass to animate.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const props = useMotionSafe(
    { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } },
    { duration: duration.base, ease: ease.out },
  );
  return (
    <motion.div {...props} className="flex flex-1 flex-col">
      {children}
    </motion.div>
  );
}
