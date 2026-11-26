import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { MeResponse } from "@/lib/types";
import { AdminShell } from "@/features/admin";

const API = process.env.API_INTERNAL_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

/** Convenience gate only: the API's requireRole is the real guard. */
async function loadRole(): Promise<string | null> {
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  try {
    const res = await fetch(`${API}/api/v1/auth/me`, { headers: { cookie }, cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { data: MeResponse }).data.user?.role ?? null;
  } catch {
    return null;
  }
}

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const role = await loadRole();
  if (role !== "ADMIN" && role !== "EDITOR") redirect("/login");
  return <AdminShell>{children}</AdminShell>;
}
