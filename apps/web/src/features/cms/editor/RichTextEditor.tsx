"use client";
import { extensions as sharedExtensions, renderHtml, sanitize, type JSONContent } from "@media/rich-text";
import CharacterCount from "@tiptap/extension-character-count";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension, type AnyExtension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { BubbleMenu } from "./BubbleMenu";
import { SlashMenu } from "./SlashMenu";
import { Toolbar, type PickImage, type ViewMode } from "./Toolbar";
import "./editor.css";
import "./tiptap-types";

const lowlight = createLowlight(common);

/** Throw from `onSave` when the API answers 409 CMS_CONFLICT. */
export class EditorConflictError extends Error {
  constructor() {
    super("Someone else edited this page");
    this.name = "EditorConflictError";
  }
}

export type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

export interface RichTextEditorProps {
  initialContent: JSONContent;
  /** Called 5 s after the last change (and on Ctrl/⌘+S). `overwrite` is set after the author picks *Overwrite*. */
  onSave?: (doc: JSONContent, opts: { overwrite: boolean }) => Promise<void>;
  /** *Reload* after a conflict: the host refetches the page and passes new `initialContent` + `resetKey`. */
  onReload?: () => void;
  onChange?: (doc: JSONContent) => void;
  /** Opens the media library; resolves with the chosen image (alt text required there) or null. */
  pickImage?: PickImage;
  /** Images in Preview / HTML must come from this origin (the sanitiser drops anything else). */
  assetOrigin: string;
  /** Changing this replaces the document with `initialContent`. */
  resetKey?: string | number;
  autosaveMs?: number;
  /** Smaller editing surface (CMS blocks). */
  compact?: boolean;
  placeholder?: string;
}

/** Editor-only shortcuts that have no stock Tiptap binding. */
const EditorShortcuts = Extension.create({
  name: "cmsShortcuts",
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        // Open the link popover by clicking its toolbar trigger: one source of truth for the UI.
        document.querySelector<HTMLButtonElement>('[role="toolbar"][aria-label="Formatting"] [aria-label="Link"]')?.click();
        return true;
      },
      "Mod-]": () => this.editor.commands.indent(),
      "Mod-[": () => this.editor.commands.outdent(),
    };
  },
});

function editorExtensions(placeholder: string): AnyExtension[] {
  const list = sharedExtensions.map((ext) =>
    // Same schema as the renderer's StarterKit; only the code block gains syntax highlighting.
    ext.name === "starterKit" ? StarterKit.configure({ codeBlock: false }) : ext,
  );
  return [
    ...list,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
    Placeholder.configure({ placeholder }),
    CharacterCount,
    EditorShortcuts,
  ];
}

const STATUS_TEXT: Record<SaveState, string> = {
  saved: "All changes saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Not saved: edit conflict",
  error: "Couldn’t save — will retry on your next change",
};

export function RichTextEditor({
  initialContent,
  onSave,
  onReload,
  onChange,
  pickImage,
  assetOrigin,
  resetKey,
  autosaveMs = 5000,
  compact = false,
  placeholder = "Write something, or type / for blocks…",
}: RichTextEditorProps) {
  const [view, setView] = useState<ViewMode>("edit");
  const [fullscreen, setFullscreen] = useState(false);
  const [mod] = useState(() => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"));
  const [state, setState] = useState<SaveState>("saved");
  const [snapshot, setSnapshot] = useState<JSONContent>(initialContent);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<JSONContent>(initialContent);
  const stateRef = useRef<SaveState>("saved");
  const saving = useRef(false);
  const onSaveRef = useRef(onSave);
  const onChangeRef = useRef(onChange);
  const flushRef = useRef<(overwrite?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    onSaveRef.current = onSave;
    onChangeRef.current = onChange;
  });

  const setSave = useCallback((s: SaveState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const exts = useMemo(() => editorExtensions(placeholder), [placeholder]);

  const flush = useCallback(
    async (overwrite = false) => {
      clearTimeout(timer.current);
      const save = onSaveRef.current;
      if (!save || saving.current) return;
      const doc = latest.current;
      saving.current = true;
      setSave("saving");
      try {
        await save(doc, { overwrite });
        // Edits made while the request was in flight stay dirty and get their own save.
        if (latest.current === doc) setSave("saved");
        else {
          setSave("dirty");
          timer.current = setTimeout(() => void flushRef.current(), autosaveMs);
        }
      } catch (e) {
        setSave(e instanceof EditorConflictError ? "conflict" : "error");
      } finally {
        saving.current = false;
      }
    },
    [autosaveMs, setSave],
  );
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const editor = useEditor({
    extensions: exts,
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: { "aria-label": "Page content", "aria-multiline": "true", role: "textbox" },
      // Word / Google Docs paste: run it through the same allow-list the server applies.
      transformPastedHTML: (html) => sanitize(html, { assetOrigin }),
      handleKeyDown: (_v, e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void flush();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const doc = ed.getJSON();
      latest.current = doc;
      onChangeRef.current?.(doc);
      if (stateRef.current === "conflict") return; // wait for the author's choice
      setSave("dirty");
      clearTimeout(timer.current);
      if (onSaveRef.current) timer.current = setTimeout(() => void flush(), autosaveMs);
    },
  });

  // New document from the host (page switch, Reload after a conflict).
  const firstKey = useRef(resetKey);
  useEffect(() => {
    if (!editor || firstKey.current === resetKey) return;
    firstKey.current = resetKey;
    clearTimeout(timer.current);
    editor.commands.setContent(initialContent, false);
    latest.current = editor.getJSON();
    setSave("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, editor]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Unsaved changes: warn before the tab closes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (stateRef.current === "saved") return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [fullscreen]);

  useEffect(() => {
    editor?.setEditable(view === "edit");
  }, [editor, view]);

  // Back to editing: restore focus (and the selection) so the next toolbar action has a target.
  const prevView = useRef<ViewMode>("edit");
  useEffect(() => {
    if (view === "edit" && prevView.current !== "edit") editor?.commands.focus();
    prevView.current = view;
  }, [editor, view]);

  const onView = (v: ViewMode) => {
    if (v !== "edit" && editor) setSnapshot(editor.getJSON());
    setView(v);
  };

  const rendered = useMemo(() => (view === "edit" ? "" : renderHtml(snapshot, { assetOrigin })), [view, snapshot, assetOrigin]);

  if (!editor) return <div className="cms-paper min-h-72 rounded-xl border border-line" aria-busy="true" />;
  const count = editor.storage.characterCount as { words(): number; characters(): number };

  return (
    <div
      data-editor-root
      data-save-state={state}
      className={cn(
        "cms-paper relative flex flex-col overflow-visible rounded-xl border border-[color:var(--paper-line)]",
        fullscreen && "fixed inset-0 z-50 rounded-none",
      )}
      style={{ "--cms-editor-min": compact ? "8rem" : "18rem" } as React.CSSProperties}
    >
      <Toolbar editor={editor} mod={mod} pickImage={pickImage} view={view} onView={onView} fullscreen={fullscreen} onFullscreen={() => setFullscreen((f) => !f)} words={count.words()} chars={count.characters()} />

      {state === "conflict" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-[#c2382c]/40 bg-[#fdecea] px-3 py-2 text-sm text-[#7a1f16]">
          <strong>Someone else edited this page.</strong>
          <span>Reload to get their version (your unsaved edits here are lost), or overwrite it with yours.</span>
          <button type="button" onClick={onReload} className="rounded-md border border-[#c2382c] px-3 py-1 text-xs font-medium">
            Reload
          </button>
          <button type="button" onClick={() => void flush(true)} className="rounded-md bg-[#c2382c] px-3 py-1 text-xs font-medium text-white">
            Overwrite
          </button>
        </div>
      )}

      <div className={cn("relative min-h-0 flex-1 overflow-y-auto px-5 py-4", fullscreen && "mx-auto w-full max-w-4xl")}>
        {/* Stay mounted while previewing: unmounting Tiptap's content node races React 19's DOM cleanup. */}
        <div hidden={view !== "edit"}>
          <EditorContent editor={editor} className="cms-prose" />
          <BubbleMenu editor={editor} mod={mod} />
          <SlashMenu editor={editor} />
        </div>
        {view === "preview" && <div data-testid="editor-preview" className="cms-prose" dangerouslySetInnerHTML={{ __html: rendered }} />}
        {view === "html" && (
          <pre data-testid="editor-html" className="whitespace-pre-wrap break-all text-xs text-[color:var(--paper-ink)]">
            {rendered}
          </pre>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[color:var(--paper-line)] px-3 py-1.5 text-xs text-[color:var(--paper-muted)]">
        <span role="status" data-testid="save-status">
          {STATUS_TEXT[state]}
        </span>
        {onSave && state !== "saving" && state !== "saved" && state !== "conflict" && (
          <button type="button" onClick={() => void flush()} className="underline">
            Save now
          </button>
        )}
      </div>
    </div>
  );
}
