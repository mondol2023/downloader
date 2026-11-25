"use client";
import Link from "next/link";
import { Badge, Button, buttonStyles } from "@/components/ui";
import { tierLabel } from "@/lib/format";
import { useLogout, useMe } from "../hooks/useAuth";

/** Header slot: sign-in links for guests, account links for signed-in users. */
export function UserMenu() {
  const { data } = useMe();
  const logout = useLogout();
  if (!data) return <div className="h-11 w-24" aria-hidden />;
  if (!data.user) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/login" className={buttonStyles("ghost")}>
          Sign in
        </Link>
        <Link href="/register" className={buttonStyles("secondary")}>
          Sign up
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Badge tone={data.tier === "PRO" ? "signal" : "neutral"}>{tierLabel(data.tier)}</Badge>
      <Link href="/account/history" className={buttonStyles("ghost")}>
        {data.user.displayName ?? data.user.email}
      </Link>
      <Button variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
        Sign out
      </Button>
    </div>
  );
}
