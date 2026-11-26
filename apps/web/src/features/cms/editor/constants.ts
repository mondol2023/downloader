/** Font stacks: the first family is one of the 8 the sanitiser allows; fallbacks are plain names. */
export const FONT_STACKS = [
  { label: "Geist Sans", value: "Geist Sans, sans-serif" },
  { label: "Fraunces", value: "Fraunces, serif" },
  { label: "Geist Mono", value: "Geist Mono, monospace" },
  { label: "System sans", value: "system-ui, sans-serif" },
  { label: "System serif", value: "ui-serif, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
] as const;

export const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72] as const;
export const LINE_HEIGHTS = ["1.0", "1.2", "1.4", "1.5", "1.6", "1.8", "2.0", "2.2", "2.4"] as const;

export const SWATCHES = [
  "#000000", "#4b5563", "#9ca3af", "#ffffff",
  "#dc2626", "#ea580c", "#d97706", "#ca8a04",
  "#16a34a", "#0d9488", "#2563eb", "#4f46e5",
  "#9333ea", "#db2777", "#fde68a", "#bbf7d0",
] as const;

export const CODE_LANGUAGES = ["plaintext", "typescript", "javascript", "json", "bash", "html", "css", "python", "sql"] as const;

export const EMOJI = [
  "😀", "😂", "😊", "😍", "😎", "🤔", "😢", "😡", "👍", "👎", "👏", "🙏", "💪", "🎉", "🔥", "✨",
  "❤️", "💡", "✅", "❌", "⚠️", "📌", "📎", "🔒", "🔗", "📅", "⭐", "🚀", "📣", "📝", "🔍", "⏱️",
] as const;

export const SPECIAL_CHARS = [
  "©", "®", "™", "§", "¶", "•", "·", "…", "–", "—", "‘", "’", "“", "”", "«", "»",
  "°", "±", "×", "÷", "≠", "≤", "≥", "≈", "∞", "€", "£", "¥", "¢", "←", "→", "↑", "↓",
] as const;

export interface ShortcutKeys {
  mod: string;
}

/** Tooltip text for a shortcut written with `Mod` (Ctrl on Windows/Linux, ⌘ on macOS). */
export const withMod = (keys: string, mod: string) => keys.replace(/Mod/g, mod).replace(/Shift/g, mod === "⌘" ? "⇧" : "Shift");
