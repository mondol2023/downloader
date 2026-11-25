"use client";
import * as T from "@radix-ui/react-toast";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { duration, ease, spring } from "@/design/motion";
import { useMotionSafe } from "@/design/use-motion-safe";

export const ToastProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider swipeDirection="right">
    {children}
    <T.Viewport className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
  </T.Provider>
);

export function Toast({ title, description, open, onOpenChange }: {
  title: string; description?: string; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  // In: y 16 -> 0 on `spring.gentle`. Out: fade + y 8 over `duration.fast`.
  const motionProps = useMotionSafe(
    { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8 } },
    spring.gentle,
  );
  return (
    <AnimatePresence>
      {open && (
        <T.Root key="toast" forceMount open onOpenChange={onOpenChange} asChild>
          <motion.li
            {...motionProps}
            exit={{ ...motionProps.exit, transition: { duration: duration.fast, ease: ease.exit } }}
            className="relative list-none rounded-key border border-line bg-surface-2 p-4 shadow-lg"
          >
            <T.Title className="text-sm font-medium">{title}</T.Title>
            {description && <T.Description className="mt-1 text-sm text-muted">{description}</T.Description>}
            <T.Close aria-label="Dismiss" className="absolute right-2 top-2 min-h-11 min-w-11 text-muted hover:text-text">×</T.Close>
          </motion.li>
        </T.Root>
      )}
    </AnimatePresence>
  );
}
