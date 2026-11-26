"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ADMIN_NAV } from "./nav";

export function AdminShell({ children, pathname }: { children: ReactNode; pathname?: string }) {
  const live = usePathname();
  const current = pathname ?? live;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row">
      <nav aria-label="Admin" className="flex shrink-0 flex-row flex-wrap gap-1 md:w-48 md:flex-col">
        {ADMIN_NAV.map((n) => {
          const active = n.href === "/admin" ? current === n.href : current.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-key px-3 text-sm hover:bg-surface-2",
                active ? "bg-surface-2 text-text" : "text-muted hover:text-text",
              )}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
      <main className="min-w-0 flex-1 space-y-6">{children}</main>
    </div>
  );
}
