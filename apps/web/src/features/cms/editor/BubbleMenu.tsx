"use client";
import { BubbleMenu as TiptapBubbleMenu, type Editor } from "@tiptap/react";
import { ColorPicker, ToolButton } from "./parts";
import { LinkPopover } from "./Toolbar";

/** Floating menu on text selection: marks, link, colour. */
export function BubbleMenu({ editor, mod }: { editor: Editor; mod: string }) {
  const color = (editor.getAttributes("textStyle") as { color?: string }).color;
  return (
    <TiptapBubbleMenu
      editor={editor}
      tippyOptions={{ duration: 100, placement: "top" }}
      shouldShow={({ state, editor: e, view, element }) =>
        // Stay hidden while the author works in a toolbar popover, or it would sit on top of it.
        (view.hasFocus() || element.contains(document.activeElement)) && !state.selection.empty && e.isEditable && !e.isActive("image") && !e.isActive("codeBlock")
      }
    >
      <div role="toolbar" aria-label="Selection formatting" className="cms-paper flex items-center gap-0.5 rounded-lg border border-[color:var(--paper-line)] p-1 shadow-lg">
        <ToolButton label="Bold" shortcut={mod === "⌘" ? "⌘B" : "Ctrl+B"} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <b>B</b>
        </ToolButton>
        <ToolButton label="Italic" shortcut={mod === "⌘" ? "⌘I" : "Ctrl+I"} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <i>I</i>
        </ToolButton>
        <ToolButton label="Underline" shortcut={mod === "⌘" ? "⌘U" : "Ctrl+U"} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <u>U</u>
        </ToolButton>
        <LinkPopover editor={editor} mod={mod} />
        <ColorPicker
          label="Selection text colour"
          current={color}
          trigger={<span style={{ borderBottom: `3px solid ${color ?? "#1b1916"}` }}>A</span>}
          onPick={(h) => editor.chain().focus().setColor(h).run()}
          onReset={() => editor.chain().focus().unsetColor().run()}
        />
      </div>
    </TiptapBubbleMenu>
  );
}
