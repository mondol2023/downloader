"use client";
import { useRouter } from "next/navigation";
import { AuthForm, type AuthMode } from "./AuthForm";
import { useLogin, useRegister } from "../hooks/useAuth";

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const login = useLogin();
  const register = useRegister();
  const m = mode === "login" ? login : register;
  return (
    <main className="flex flex-1 items-center px-4 py-10">
      <AuthForm
        mode={mode}
        pending={m.isPending}
        error={m.error}
        onSubmit={(v) => m.mutate(v, { onSuccess: () => router.push("/") })}
      />
    </main>
  );
}
