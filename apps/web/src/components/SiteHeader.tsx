import Link from "next/link";
import { UserMenu } from "@/features/auth";

const NAV = [
  { href: "/jobs", label: "Downloads" },
  { href: "/pricing", label: "Plans" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-display text-xl">
            Media
          </Link>
          <nav aria-label="Main" className="flex gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="inline-flex min-h-11 items-center rounded-key px-3 text-muted hover:bg-surface-2 hover:text-text">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <UserMenu />
      </div>
    </header>
  );
}
