import { Extension, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import Youtube from '@tiptap/extension-youtube';
import StarterKit from '@tiptap/starter-kit';

/**
 * Custom attributes that change the stored JSON live here, not in the web app, so the API's
 * renderer reads exactly the document the editor wrote.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    lineHeight: {
      setLineHeight: (value: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

export const MAX_INDENT = 8;
const BLOCKS = ['paragraph', 'heading'];

export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize || null,
            renderHTML: (attrs) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

export const LineHeight = Extension.create({
  name: 'lineHeight',
  addGlobalAttributes() {
    return [
      {
        types: BLOCKS,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (attrs) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineHeight: (value) => ({ commands }) => BLOCKS.every((t) => commands.updateAttributes(t, { lineHeight: value })),
      unsetLineHeight: () => ({ commands }) => BLOCKS.every((t) => commands.resetAttributes(t, 'lineHeight')),
    };
  },
});

export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: BLOCKS,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              const m = /(?:^|\s)cms-indent-(\d)(?:\s|$)/.exec(el.getAttribute('class') ?? '');
              return m ? Number(m[1]) : 0;
            },
            renderHTML: (attrs) => (attrs.indent > 0 ? { class: `cms-indent-${attrs.indent}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    const shift = (delta: number) => () => ({ state, tr, dispatch }: { state: any; tr: any; dispatch?: any }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node: any, pos: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!BLOCKS.includes(node.type.name)) return true;
        const next = Math.min(MAX_INDENT, Math.max(0, (node.attrs.indent ?? 0) + delta));
        if (next !== node.attrs.indent) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
          changed = true;
        }
        return false;
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return { indent: shift(1), outdent: shift(-1) };
  },
});

export const IMAGE_WIDTHS = [25, 50, 75, 100] as const;

/** Image with a display width (25/50/75/100 %) stored as a `cms-img-N` class; the caption is the `title`. */
export const CmsImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 100,
        parseHTML: (el) => {
          const m = /(?:^|\s)cms-img-(25|50|75|100)(?:\s|$)/.exec(el.getAttribute('class') ?? '');
          return m ? Number(m[1]) : 100;
        },
        renderHTML: (attrs) => ({ class: `cms-img-${IMAGE_WIDTHS.includes(attrs.width) ? attrs.width : 100}` }),
      },
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    vimeo: { setVimeo: (options: { id: string }) => ReturnType };
  }
}

/** Vimeo embed. Only a numeric id is stored; the iframe URL is rebuilt on render. */
export const Vimeo = Node.create({
  name: 'vimeo',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => /\/video\/(\d{1,20})(?:[/?#]|$)/.exec(el.querySelector('iframe')?.getAttribute('src') ?? '')?.[1] ?? null,
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-vimeo-video]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const id = String(node.attrs.id ?? '').replace(/\D/g, '');
    return [
      'div',
      mergeAttributes({ 'data-vimeo-video': '' }, { class: HTMLAttributes.class }),
      ['iframe', { src: `https://player.vimeo.com/video/${id}`, width: '640', height: '360', allowfullscreen: 'true', frameborder: '0' }],
    ];
  },
  addCommands() {
    return { setVimeo: (options) => ({ commands }) => commands.insertContent({ type: this.name, attrs: options }) };
  },
});

/** The ONE extension list: the editor (web) adds editor-only extras on top; the renderer (api) uses it as is. */
export const extensions: AnyExtension[] = [
  StarterKit,
  Underline,
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  LineHeight,
  Indent,
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Link.configure({ openOnClick: false, autolink: false }),
  CmsImage,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem,
  Youtube.configure({ nocookie: true }),
  Vimeo,
];
