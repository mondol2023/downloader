"use client";
import * as D from "@radix-ui/react-dialog";
import type { CmsAssetRow } from "../shared";
import { MediaGrid } from "./MediaGrid";

/** A dialog over the library; `onPick` receives the chosen image and the dialog closes. */
export function MediaPicker({
  open,
  onOpenChange,
  onPick,
  selectedId,
  title = "Choose an image",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (a: CmsAssetRow) => void;
  selectedId?: string | null;
  title?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <D.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[56rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-deck border border-line bg-surface-1 p-6">
          <D.Title className="font-display text-xl">{title}</D.Title>
          <D.Description className="sr-only">Pick an image from the media library</D.Description>
          <MediaGrid
            selectedId={selectedId}
            onPick={(a) => {
              onPick(a);
              onOpenChange(false);
            }}
          />
          <D.Close aria-label="Close" className="absolute right-3 top-3 min-h-11 min-w-11 text-muted hover:text-text">
            ×
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
