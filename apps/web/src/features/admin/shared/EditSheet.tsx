"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Sheet } from "@/components/ui";

export const inputClass = "min-h-11 w-full rounded-key border border-line bg-surface-2 px-3 text-sm text-text";

/** A side sheet holding one form. `onSubmit` may reject; the message shows above the button and the sheet stays open. */
export function EditSheet({
  trigger,
  title,
  submitLabel = "Save",
  onSubmit,
  children,
}: {
  trigger: ReactNode;
  title: string;
  submitLabel?: string;
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      trigger={trigger}
      title={title}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {children}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Sheet>
  );
}
