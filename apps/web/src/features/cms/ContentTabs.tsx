"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/admin/content/pages", label: "Pages" },
  { href: "/admin/content/blocks", label: "Blocks" },
  { href: "/admin/content/media", label: "Media" },
] as const;

export function ContentTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Content" className="flex gap-1 border-b border-line">
      {TABS.map((t) => {
        const active = path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center px-3 text-sm", active ? "border-b-2 border-signal text-text" : "text-muted hover:text-text")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
