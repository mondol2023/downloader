"use client";
import { useState } from "react";

/** A text filter that applies on Enter or blur, so typing doesn't fire a request per keystroke. */
export function TextFilter({ label, value, onApply, placeholder }: {
  label: string;
  value: string;
  onApply: (v: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <input
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onApply(text.trim())}
        onKeyDown={(e) => e.key === "Enter" && onApply(text.trim())}
        className="min-h-11 rounded-key border border-line bg-surface-2 px-3 text-text"
      />
    </label>
  );
}
