"use client";
import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

interface Item {
  title: string;
  hint: string;
  run: (editor: Editor) => void;
}

const ITEMS: Item[] = [
  { title: "Paragraph", hint: "Plain text", run: (e) => e.chain().focus().setParagraph().run() },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    title: `Heading ${level}`,
    hint: `h${level}`,
    run: (e: Editor) => e.chain().focus().setHeading({ level }).run(),
  })),
  { title: "Bullet list", hint: "Unordered list", run: (e) => e.chain().focus().toggleBulletList().run() },
  { title: "Numbered list", hint: "Ordered list", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: "Task list", hint: "Checkboxes", run: (e) => e.chain().focus().toggleTaskList().run() },
  { title: "Quote", hint: "Blockquote", run: (e) => e.chain().focus().setBlockquote().run() },
  { title: "Code block", hint: "Monospace, highlighted", run: (e) => e.chain().focus().setCodeBlock().run() },
  { title: "Divider", hint: "Horizontal rule", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { title: "Table", hint: "3 × 3 with header", run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

const TRIGGER = /(?:^|\s)\/([\w ]{0,20})$/;

/** `/` at the start of a word opens a block picker; type to filter, ↑ ↓ Enter / Esc to drive it. */
export function SlashMenu({ editor }: { editor: Editor }) {
  const [query, setQuery] = useState<string | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [index, setIndex] = useState(0);

  const items = useMemo(() => ITEMS.filter((i) => i.title.toLowerCase().includes((query ?? "").trim().toLowerCase())), [query]);

  useEffect(() => {
    const update = () => {
      const { selection } = editor.state;
      if (!selection.empty || !editor.isEditable) return setQuery(null);
      const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, "￼");
      const m = TRIGGER.exec(before);
      if (!m) return setQuery(null);
      const c = editor.view.coordsAtPos(selection.from);
      const host = editor.view.dom.closest("[data-editor-root]")?.getBoundingClientRect();
      setPos({ left: c.left - (host?.left ?? 0), top: c.bottom - (host?.top ?? 0) + 6 });
      setQuery((q): string | null => {
        if (q !== m[1]) setIndex(0);
        return m[1] ?? "";
      });
    };
    editor.on("transaction", update);
    editor.on("blur", () => setQuery(null));
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const choose = (item: Item) => {
    const { from } = editor.state.selection;
    const before = editor.state.selection.$from.parent.textBetween(0, editor.state.selection.$from.parentOffset, undefined, "￼");
    const m = TRIGGER.exec(before);
    if (m) editor.chain().focus().deleteRange({ from: from - m[0].trimStart().length, to: from }).run();
    item.run(editor);
    setQuery(null);
  };

  useEffect(() => {
    if (query === null) return;
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setQuery(null);
      if (!items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const picked = items[index] ?? items[0];
        if (picked) choose(picked);
      }
    };
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, items, index, editor]);

  if (query === null || items.length === 0) return null;
  return (
    <div role="listbox" aria-label="Insert block" style={{ left: pos.left, top: pos.top }} className="cms-paper absolute z-30 max-h-64 w-60 overflow-y-auto rounded-lg border border-[color:var(--paper-line)] p-1 shadow-lg">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose(item)}
          className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm", i === index ? "bg-[#b36b00] text-white" : "hover:bg-black/5")}
        >
          <span>{item.title}</span>
          <span className={cn("text-xs", i === index ? "text-white/80" : "text-[color:var(--paper-muted)]")}>{item.hint}</span>
        </button>
      ))}
    </div>
  );
}
