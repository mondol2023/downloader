"use client";
import type { JSONContent } from "@media/rich-text";
import { useRef, useState } from "react";
import { EditorConflictError, RichTextEditor } from "@/features/cms/editor";
import { ASSET_ORIGIN, FIXTURE } from "./fixture";

declare global {
  interface Window {
    __saves?: { version: number; overwrite: boolean }[];
  }
}

/** Mock page store: a stale `?conflict=1` makes the first save answer 409, like the API's CMS_CONFLICT. */
export function EditorShowcase() {
  const version = useRef(1);
  const conflictOnce = useRef(typeof window !== "undefined" && new URLSearchParams(window.location.search).has("conflict"));
  const [resetKey, setResetKey] = useState(0);
  const [doc, setDoc] = useState<JSONContent>(FIXTURE);

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <h1 className="font-display text-2xl">Rich-text editor</h1>
      <p className="text-sm text-muted">Fixture document on mock data. Autosaves 5 s after the last change.</p>
      <RichTextEditor
        initialContent={doc}
        resetKey={resetKey}
        assetOrigin={ASSET_ORIGIN}
        autosaveMs={Number(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("autosave") ?? 5000 : 5000)}
        pickImage={async () => ({ src: `${ASSET_ORIGIN}/picked.webp`, alt: "Picked from library" })}
        onReload={() => {
          conflictOnce.current = false;
          setDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Their version" }] }] });
          setResetKey((k) => k + 1);
        }}
        onSave={async (_doc, { overwrite }) => {
          if (conflictOnce.current && !overwrite) throw new EditorConflictError();
          conflictOnce.current = false;
          version.current += 1;
          (window.__saves ??= []).push({ version: version.current, overwrite });
        }}
      />
    </main>
  );
}
