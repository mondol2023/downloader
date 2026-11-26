"use client";
import * as D from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * Confirm a destructive action. `target` is named in the prompt so the admin sees exactly what they are changing.
 * `onConfirm` may reject; the message shows inside the dialog and it stays open.
 */
export function ConfirmDialog({
  trigger,
  title,
  target,
  confirmLabel,
  onConfirm,
  children,
}: {
  trigger: ReactNode;
  title: string;
  target: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return (
    <D.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <D.Content
          role="alertdialog"
          className="fixed left-1/2 top-1/2 z-50 w-[28rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-deck border border-line bg-surface-1 p-6"
        >
          <D.Title className="font-display text-xl">{title}</D.Title>
          <D.Description className="text-sm text-muted">
            This affects <strong className="num text-text">{target}</strong>.
          </D.Description>
          {children}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button type="button" disabled={busy} onClick={() => void run()} className="bg-danger text-white">
              {busy ? "Working…" : confirmLabel}
            </Button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
