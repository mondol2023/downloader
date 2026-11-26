"use client";
import type { Editor } from "@tiptap/react";
import { IMAGE_WIDTHS } from "@media/rich-text";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CODE_LANGUAGES, EMOJI, FONT_SIZES, FONT_STACKS, LINE_HEIGHTS, SPECIAL_CHARS, withMod } from "./constants";
import { CharGrid, ColorPicker, Popover, Sep, ToolButton, ToolSelect } from "./parts";

export type PickImage = () => Promise<{ src: string; alt: string } | null>;
export type ViewMode = "edit" | "preview" | "html";

interface Props {
  editor: Editor;
  mod: string;
  pickImage?: PickImage;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  words: number;
  chars: number;
}

/** Parses a YouTube/Vimeo URL; anything else is rejected (the sanitiser would drop it anyway). */
export function parseEmbed(raw: string): { kind: "youtube"; src: string } | { kind: "vimeo"; id: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = host === "youtu.be" ? url.pathname.slice(1) : (url.searchParams.get("v") ?? /\/embed\/([\w-]+)/.exec(url.pathname)?.[1]);
    return id && /^[\w-]{1,64}$/.test(id) ? { kind: "youtube", src: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = /\/(?:video\/)?(\d{1,20})(?:\/|$)/.exec(url.pathname)?.[1];
    return id ? { kind: "vimeo", id } : null;
  }
  return null;
}

function blockValue(editor: Editor): string {
  for (let l = 1; l <= 6; l++) if (editor.isActive("heading", { level: l })) return `h${l}`;
  if (editor.isActive("blockquote")) return "blockquote";
  if (editor.isActive("codeBlock")) return "codeBlock";
  return "p";
}

function setBlock(editor: Editor, v: string) {
  const c = editor.chain().focus();
  // Switching away from a quote must lift the block out of it first.
  if (v !== "blockquote" && editor.isActive("blockquote")) c.command(({ state, tr }) => {
      // Unwrap the quote(s) under the selection (also works for a select-all, where `lift` cannot).
      const quotes: { pos: number; size: number; content: import("@tiptap/pm/model").Fragment }[] = [];
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.type.name === "blockquote") quotes.push({ pos, size: node.nodeSize, content: node.content });
      });
      for (const q of quotes.reverse()) tr.replaceWith(q.pos, q.pos + q.size, q.content);
      return true;
    });
  if (v === "p") c.setParagraph().run();
  else if (v === "blockquote") c.setParagraph().setBlockquote().run();
  else if (v === "codeBlock") c.setCodeBlock().run();
  else c.setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
}

const field = "mt-1 h-8 w-full rounded-md border border-[color:var(--paper-line)] bg-white px-2 text-sm text-[color:var(--paper-ink)]";

export function LinkPopover({ editor, mod }: { editor: Editor; mod: string }) {
  const href = editor.getAttributes("link").href as string | undefined;
  const [url, setUrl] = useState<string | null>(null);
  return (
    <Popover label="Link" active={editor.isActive("link")} trigger={<span aria-hidden>🔗</span>}>
      {(close) => (
        <form
          className="w-64 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = (url ?? href ?? "").trim();
            if (v) editor.chain().focus().extendMarkRange("link").setLink({ href: v, target: "_blank" }).run();
            setUrl(null);
            close();
          }}
        >
          <label className="block text-xs text-[color:var(--paper-muted)]">
            URL ({withMod("Mod+K", mod)})
            <input autoFocus type="url" placeholder="https://" defaultValue={href ?? ""} onChange={(e) => setUrl(e.target.value)} className={field} />
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" className="rounded-md bg-[#b36b00] px-3 py-1 text-xs text-white">
              Apply
            </button>
            <button
              type="button"
              disabled={!href}
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                close();
              }}
              className="rounded-md border border-[color:var(--paper-line)] px-3 py-1 text-xs disabled:opacity-40"
            >
              Remove
            </button>
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" className="px-1 py-1 text-xs underline">
                Open in new tab
              </a>
            )}
          </div>
        </form>
      )}
    </Popover>
  );
}

function EmbedPopover({ editor }: { editor: Editor }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  return (
    <Popover label="Embed video" trigger={<span aria-hidden>▶</span>}>
      {(close) => (
        <form
          className="w-64 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const embed = parseEmbed(url);
            if (!embed) return setError("Only YouTube and Vimeo links can be embedded.");
            if (embed.kind === "youtube") editor.chain().focus().setYoutubeVideo({ src: embed.src }).run();
            else editor.chain().focus().setVimeo({ id: embed.id }).run();
            setUrl("");
            setError("");
            close();
          }}
        >
          <label className="block text-xs text-[color:var(--paper-muted)]">
            YouTube or Vimeo URL
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" className={field} />
          </label>
          {error && (
            <p role="alert" className="text-xs text-[#c2382c]">
              {error}
            </p>
          )}
          <button type="submit" className="rounded-md bg-[#b36b00] px-3 py-1 text-xs text-white">
            Embed
          </button>
        </form>
      )}
    </Popover>
  );
}

const small = "h-7 w-40 rounded-md border border-[color:var(--paper-line)] bg-white px-2 text-sm text-[color:var(--paper-ink)]";

function ContextBar({ editor }: { editor: Editor }) {
  const inTable = editor.isActive("table");
  const isImage = editor.isActive("image");
  const isCode = editor.isActive("codeBlock");
  if (!inTable && !isImage && !isCode) return null;
  const img = editor.getAttributes("image") as { width?: number; alt?: string; title?: string };
  const run = (f: (c: ReturnType<Editor["chain"]>) => { run: () => boolean }) => () => f(editor.chain().focus()).run();
  return (
    <div role="group" aria-label="Selection options" className="flex flex-wrap items-center gap-1 border-t border-[color:var(--paper-line)] px-2 py-1">
      {isCode && (
        <ToolSelect
          label="Code language"
          value={(editor.getAttributes("codeBlock").language as string) || "plaintext"}
          onChange={(v) => editor.chain().focus().updateAttributes("codeBlock", { language: v }).run()}
        >
          {CODE_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </ToolSelect>
      )}
      {isImage && (
        <>
          <span className="text-xs text-[color:var(--paper-muted)]">Image width</span>
          {IMAGE_WIDTHS.map((w) => (
            <ToolButton key={w} label={`Image width ${w}%`} active={(img.width ?? 100) === w} onClick={() => editor.chain().focus().updateAttributes("image", { width: w }).run()}>
              {w}%
            </ToolButton>
          ))}
          <label className="flex items-center gap-1 text-xs text-[color:var(--paper-muted)]">
            Alt
            <input data-tb tabIndex={-1} aria-label="Image alt text" value={img.alt ?? ""} onChange={(e) => editor.chain().updateAttributes("image", { alt: e.target.value }).run()} className={small} />
          </label>
          <label className="flex items-center gap-1 text-xs text-[color:var(--paper-muted)]">
            Caption
            <input data-tb tabIndex={-1} aria-label="Image caption" value={img.title ?? ""} onChange={(e) => editor.chain().updateAttributes("image", { title: e.target.value }).run()} className={small} />
          </label>
        </>
      )}
      {inTable && (
        <>
          <span className="text-xs text-[color:var(--paper-muted)]">Table</span>
          <ToolButton label="Add row above" onClick={run((c) => c.addRowBefore())}>Row ↑+</ToolButton>
          <ToolButton label="Add row below" onClick={run((c) => c.addRowAfter())}>Row ↓+</ToolButton>
          <ToolButton label="Delete row" onClick={run((c) => c.deleteRow())}>Row −</ToolButton>
          <ToolButton label="Add column before" onClick={run((c) => c.addColumnBefore())}>Col ←+</ToolButton>
          <ToolButton label="Add column after" onClick={run((c) => c.addColumnAfter())}>Col →+</ToolButton>
          <ToolButton label="Delete column" onClick={run((c) => c.deleteColumn())}>Col −</ToolButton>
          <ToolButton label="Merge cells" disabled={!editor.can().mergeCells()} onClick={run((c) => c.mergeCells())}>Merge</ToolButton>
          <ToolButton label="Split cell" disabled={!editor.can().splitCell()} onClick={run((c) => c.splitCell())}>Split</ToolButton>
          <ToolButton label="Toggle header row" onClick={run((c) => c.toggleHeaderRow())}>Header row</ToolButton>
          <ToolButton label="Delete table" onClick={run((c) => c.deleteTable())}>Delete table</ToolButton>
        </>
      )}
    </div>
  );
}

export function Toolbar({ editor, mod, pickImage, view, onView, fullscreen, onFullscreen, words, chars }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState(0);
  const s = (keys: string) => withMod(keys, mod);
  const ts = editor.getAttributes("textStyle") as { color?: string; fontFamily?: string; fontSize?: string };
  const hl = editor.getAttributes("highlight") as { color?: string };
  const editing = view === "edit";

  // Roving tabindex: exactly one toolbar stop is in the tab order; arrows move it.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>("[data-tb]").forEach((el, i) => el.setAttribute("tabindex", i === stop ? "0" : "-1"));
  });
  const all = () => [...(ref.current?.querySelectorAll<HTMLElement>("[data-tb]") ?? [])];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const items = all().filter((el) => !(el as HTMLButtonElement).disabled);
    const at = items.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const i = all().indexOf(e.target as HTMLElement);
    if (i >= 0 && i !== stop) setStop(i);
  };

  const chain = () => editor.chain().focus();
  const T = (label: string, keys: string | undefined, active: boolean | undefined, run: () => void, glyph: ReactNode, disabled?: boolean) => (
    <ToolButton label={label} shortcut={keys ? s(keys) : undefined} active={active} disabled={!editing || disabled} onClick={run}>
      {glyph}
    </ToolButton>
  );
  const lineHeight = (editor.getAttributes("paragraph").lineHeight ?? editor.getAttributes("heading").lineHeight ?? "") as string;

  return (
    <div className="border-b border-[color:var(--paper-line)] bg-[#f1ede4]">
      <div ref={ref} role="toolbar" aria-label="Formatting" aria-orientation="horizontal" onKeyDown={onKeyDown} onFocus={onFocus} className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
        {T("Undo", "Mod+Z", undefined, () => chain().undo().run(), "↶", !editor.can().undo())}
        {T("Redo", "Mod+Shift+Z", undefined, () => chain().redo().run(), "↷", !editor.can().redo())}
        <Sep />
        <ToolSelect label="Block type" value={blockValue(editor)} onChange={(v) => setBlock(editor, v)}>
          <option value="p">Paragraph</option>
          {[1, 2, 3, 4, 5, 6].map((l) => (
            <option key={l} value={`h${l}`}>
              Heading {l}
            </option>
          ))}
          <option value="blockquote">Blockquote</option>
          <option value="codeBlock">Code block</option>
        </ToolSelect>
        {T("Horizontal rule", undefined, undefined, () => chain().setHorizontalRule().run(), "―")}
        <Sep />
        {T("Bold", "Mod+B", editor.isActive("bold"), () => chain().toggleBold().run(), <b>B</b>)}
        {T("Italic", "Mod+I", editor.isActive("italic"), () => chain().toggleItalic().run(), <i>I</i>)}
        {T("Underline", "Mod+U", editor.isActive("underline"), () => chain().toggleUnderline().run(), <u>U</u>)}
        {T("Strikethrough", "Mod+Shift+S", editor.isActive("strike"), () => chain().toggleStrike().run(), <s>S</s>)}
        {T("Inline code", "Mod+E", editor.isActive("code"), () => chain().toggleCode().run(), <code>{"<>"}</code>)}
        {T("Subscript", "Mod+,", editor.isActive("subscript"), () => chain().toggleSubscript().run(), <span>x<sub>2</sub></span>)}
        {T("Superscript", "Mod+.", editor.isActive("superscript"), () => chain().toggleSuperscript().run(), <span>x<sup>2</sup></span>)}
        {T("Clear formatting", undefined, undefined, () => chain().unsetAllMarks().clearNodes().run(), "Tx")}
        <Sep />
        <ToolSelect label="Font family" value={FONT_STACKS.find((f) => f.value === ts.fontFamily)?.value ?? ""} onChange={(v) => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run())} className="w-28">
          <option value="">Default font</option>
          {FONT_STACKS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </ToolSelect>
        <ToolSelect label="Font size" value={ts.fontSize ?? ""} onChange={(v) => (v ? chain().setFontSize(v).run() : chain().unsetFontSize().run())} className="w-20">
          <option value="">Size</option>
          {FONT_SIZES.map((n) => (
            <option key={n} value={`${n}px`}>
              {n}
            </option>
          ))}
        </ToolSelect>
        <ToolSelect label="Line height" value={lineHeight} onChange={(v) => (v ? chain().setLineHeight(v).run() : chain().unsetLineHeight().run())} className="w-20">
          <option value="">Spacing</option>
          {LINE_HEIGHTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </ToolSelect>
        <Sep />
        <ColorPicker label="Text colour" current={ts.color} trigger={<span style={{ borderBottom: `3px solid ${ts.color ?? "#1b1916"}` }}>A</span>} onPick={(h) => chain().setColor(h).run()} onReset={() => chain().unsetColor().run()} />
        <ColorPicker label="Highlight colour" current={hl.color} trigger={<span style={{ background: hl.color ?? "#fde68a", padding: "0 3px" }}>H</span>} onPick={(h) => chain().setHighlight({ color: h }).run()} onReset={() => chain().unsetHighlight().run()} />
        <Sep />
        {T("Align left", "Mod+Shift+L", editor.isActive({ textAlign: "left" }), () => chain().setTextAlign("left").run(), "⬅")}
        {T("Align center", "Mod+Shift+E", editor.isActive({ textAlign: "center" }), () => chain().setTextAlign("center").run(), "↔")}
        {T("Align right", "Mod+Shift+R", editor.isActive({ textAlign: "right" }), () => chain().setTextAlign("right").run(), "➡")}
        {T("Justify", "Mod+Shift+J", editor.isActive({ textAlign: "justify" }), () => chain().setTextAlign("justify").run(), "☰")}
        {T("Indent", "Mod+]", undefined, () => chain().indent().run(), "⇥")}
        {T("Outdent", "Mod+[", undefined, () => chain().outdent().run(), "⇤")}
        <Sep />
        {T("Bullet list", "Mod+Shift+8", editor.isActive("bulletList"), () => chain().toggleBulletList().run(), "•≡")}
        {T("Numbered list", "Mod+Shift+7", editor.isActive("orderedList"), () => chain().toggleOrderedList().run(), "1.")}
        {T("Task list", "Mod+Shift+9", editor.isActive("taskList"), () => chain().toggleTaskList().run(), "☑")}
        <Sep />
        <LinkPopover editor={editor} mod={mod} />
        {T(
          "Image from media library",
          undefined,
          undefined,
          async () => {
            const picked = await pickImage?.();
            if (picked) chain().setImage({ src: picked.src, alt: picked.alt }).run();
          },
          "🖼",
          !pickImage,
        )}
        {T("Insert table", undefined, editor.isActive("table"), () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "▦")}
        <EmbedPopover editor={editor} />
        <Popover label="Emoji" trigger={<span aria-hidden>🙂</span>}>
          {(close) => (
            <CharGrid
              label="Emoji"
              items={EMOJI}
              onPick={(c) => {
                chain().insertContent(c).run();
                close();
              }}
            />
          )}
        </Popover>
        <Popover label="Special characters" trigger={<span aria-hidden>Ω</span>}>
          {(close) => (
            <CharGrid
              label="Special characters"
              items={SPECIAL_CHARS}
              onPick={(c) => {
                chain().insertContent(c).run();
                close();
              }}
            />
          )}
        </Popover>
        <span className="ml-auto" />
        <div role="group" aria-label="View" className="flex items-center gap-0.5">
          <ToolButton label="Edit" active={view === "edit"} onClick={() => onView("edit")}>Edit</ToolButton>
          <ToolButton label="Preview" active={view === "preview"} onClick={() => onView("preview")}>Preview</ToolButton>
          <ToolButton label="HTML view" active={view === "html"} onClick={() => onView("html")}>HTML</ToolButton>
          <ToolButton label={fullscreen ? "Exit full-screen" : "Full-screen"} active={fullscreen} onClick={onFullscreen}>⛶</ToolButton>
        </div>
        <span data-testid="editor-count" className="num ml-2 text-xs text-[color:var(--paper-muted)]" aria-live="polite">
          {words} words · {chars} chars
        </span>
      </div>
      {editing && <ContextBar editor={editor} />}
    </div>
  );
}
