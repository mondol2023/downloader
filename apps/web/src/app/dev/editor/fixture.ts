import type { JSONContent } from "@media/rich-text";

export const ASSET_ORIGIN = "https://cdn.example.com/cms";

const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): JSONContent => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });

/** Uses every block, mark and attribute the toolbar can produce. */
export const FIXTURE: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [t("Editor fixture")] },
    { type: "heading", attrs: { level: 2 }, content: [t("Second level")] },
    p(
      t("Bold ", [{ type: "bold" }]),
      t("italic ", [{ type: "italic" }]),
      t("underline ", [{ type: "underline" }]),
      t("strike ", [{ type: "strike" }]),
      t("code ", [{ type: "code" }]),
      t("sub", [{ type: "subscript" }]),
      t(" "),
      t("sup", [{ type: "superscript" }]),
    ),
    p(
      t("Coloured", [{ type: "textStyle", attrs: { color: "#dc2626" } }]),
      t(" "),
      t("highlighted", [{ type: "highlight", attrs: { color: "#fde68a" } }]),
      t(" "),
      t("big serif", [{ type: "textStyle", attrs: { fontSize: "32px", fontFamily: "Georgia, serif" } }]),
    ),
    { type: "paragraph", attrs: { textAlign: "center", lineHeight: "1.8", indent: 1 }, content: [t("Centered, indented, loose line height.")] },
    { type: "blockquote", content: [p(t("A quotation."))] },
    { type: "codeBlock", attrs: { language: "typescript" }, content: [t("const answer: number = 42;")] },
    { type: "bulletList", content: [{ type: "listItem", content: [p(t("Bullet one"))] }, { type: "listItem", content: [p(t("Bullet two"))] }] },
    { type: "orderedList", content: [{ type: "listItem", content: [p(t("Step one"))] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("Done"))] }, { type: "taskItem", attrs: { checked: false }, content: [p(t("To do"))] }] },
    { type: "paragraph", content: [t("A "), t("link", [{ type: "link", attrs: { href: "https://example.com/", target: "_blank" } }]), t(".")] },
    { type: "image", attrs: { src: `${ASSET_ORIGIN}/hero.webp`, alt: "Hero", title: "A caption", width: 50 } },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Format"))] }, { type: "tableHeader", content: [p(t("Max"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [p(t("MP4"))] }, { type: "tableCell", content: [p(t("4K"))] }] },
      ],
    },
    { type: "horizontalRule" },
    p(t("© ™ — … 🎉")),
  ],
};
