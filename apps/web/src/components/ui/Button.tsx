import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };
const variants: Record<Variant, string> = {
  primary: "bg-signal text-signal-ink hover:brightness-110",
  secondary: "bg-surface-2 text-text border border-line hover:border-muted",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
};

/** Class string so links (`<a>`, `next/link`) can look exactly like buttons. */
export const buttonStyles = (variant: Variant = "primary", className?: string) =>
  cn(
    "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-key px-5 text-sm font-medium",
    "transition-[filter,background-color,transform] duration-150 active:translate-y-px active:scale-[0.98]",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    variants[variant],
    className,
  );

export function Button({ variant = "primary", className, ...p }: Props) {
  return <button {...p} className={buttonStyles(variant, className)} />;
}
