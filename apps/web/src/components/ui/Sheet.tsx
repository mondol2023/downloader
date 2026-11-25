"use client";
import * as D from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { duration, ease, spring } from "@/design/motion";
import { useMotionSafe } from "@/design/use-motion-safe";

export function Sheet({ trigger, title, children, open: controlled, onOpenChange }: {
  trigger: ReactNode; title: string; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = (o: boolean) => {
    setInner(o);
    onOpenChange?.(o);
  };
  // Panel: y 24 -> 0 on `spring.gentle`; exit is a quick fade (`duration.fast`).
  const panel = useMotionSafe(
    { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8 } },
    spring.gentle,
  );
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount key="sheet">
            <D.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 bg-black/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration.fast, ease: ease.out }}
              />
            </D.Overlay>
            <D.Content asChild forceMount>
              <motion.div
                {...panel}
                exit={{ ...panel.exit, transition: { duration: duration.fast, ease: ease.exit } }}
                className="fixed inset-y-0 right-0 z-50 w-96 max-w-full overflow-y-auto border-l border-line bg-surface-1 p-6"
              >
                <D.Title className="font-display text-xl">{title}</D.Title>
                <D.Description className="sr-only">{title}</D.Description>
                <div className="mt-4">{children}</div>
                <D.Close aria-label="Close" className="absolute right-3 top-3 min-h-11 min-w-11 text-muted hover:text-text">×</D.Close>
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}
