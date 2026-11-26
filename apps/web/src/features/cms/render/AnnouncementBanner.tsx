"use client";
import { motion, useReducedMotion } from "motion/react";
import { duration, ease } from "@/design/motion";

/** `html` is sanitised server-side (see `getCmsBlocks`). Reveals with the same clip-path wipe as the degraded banner. */
export function AnnouncementBanner({ html }: { html: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="status"
      data-testid="announcement-banner"
      className="cms-content border-b border-signal/40 bg-signal/10 px-4 py-2 text-center text-sm [&>*+*]:mt-0"
      initial={reduce ? { opacity: 0 } : { clipPath: "inset(0 0 100% 0)", opacity: 0 }}
      animate={reduce ? { opacity: 1 } : { clipPath: "inset(0 0 0% 0)", opacity: 1 }}
      transition={{ duration: duration.base, ease: ease.out }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
