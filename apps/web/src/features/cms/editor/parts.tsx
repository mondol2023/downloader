"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SWATCHES } from "./constants";

/** Toolbar button: always labelled, shortcut in the tooltip, a roving-tabindex stop (`data-tb`). */
export function ToolButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-tb
      tabIndex={-1}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      // Keep the editor selection: a click on a toolbar button must not blur the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-sm text-[color:var(--paper-ink)]",
        "hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-[#b36b00] text-white hover:bg-[#b36b00]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ToolSelect({
  label,
  value,
  onChange,
  children,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <select
      data-tb
      tabIndex={-1}
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-8 rounded-md border border-[color:var(--paper-line)] bg-white px-1 text-sm text-[color:var(--paper-ink)]", className)}
    >
      {children}
    </select>
  );
}

export function Sep() {
  return <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px self-center bg-[color:var(--paper-line)]" />;
}

/** A trigger button that opens a small panel; closes on outside click and Escape. */
export function Popover({
  label,
  trigger,
  active,
  children,
  align = "left",
}: {
  label: string;
  trigger: ReactNode;
  active?: boolean;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        data-tb
        tabIndex={-1}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-sm text-[color:var(--paper-ink)] hover:bg-black/10",
          (active || open) && "bg-black/10",
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={cn(
            "absolute top-9 z-30 min-w-48 rounded-lg border border-[color:var(--paper-line)] bg-white p-2 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

/** 16 swatches + a custom hex picker + reset. */
export function ColorPicker({
  label,
  current,
  onPick,
  onReset,
  trigger,
}: {
  label: string;
  current?: string | null;
  onPick: (hex: string) => void;
  onReset: () => void;
  trigger: ReactNode;
}) {
  return (
    <Popover label={label} trigger={trigger} active={!!current}>
      {(close) => (
        <div className="w-44 space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            {SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`${label} ${hex}`}
                title={hex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(hex);
                  close();
                }}
                className={cn("h-7 rounded border border-black/20", current?.toLowerCase() === hex && "ring-2 ring-[#b36b00]")}
                style={{ background: hex }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[color:var(--paper-muted)]">
            Custom
            <input
              type="color"
              aria-label={`${label}: custom colour`}
              value={/^#[0-9a-f]{6}$/i.test(current ?? "") ? current! : "#000000"}
              onChange={(e) => onPick(e.target.value)}
              className="h-7 w-full cursor-pointer"
            />
          </label>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onReset();
              close();
            }}
            className="w-full rounded-md border border-[color:var(--paper-line)] py-1 text-xs hover:bg-black/5"
          >
            Reset
          </button>
        </div>
      )}
    </Popover>
  );
}

export function CharGrid({ label, items, onPick }: { label: string; items: readonly string[]; onPick: (c: string) => void }) {
  return (
    <div role="group" aria-label={label} className="grid w-56 grid-cols-8 gap-0.5">
      {items.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Insert ${c}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
          className="h-7 rounded text-base hover:bg-black/10"
        >
          {c}
        </button>
      ))}
    </div>
  );
}
