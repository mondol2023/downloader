"use client";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { Button, Card } from "@/components/ui";
import { ApiError, fieldErrors, isDegraded } from "@/lib/api";

export type AuthMode = "login" | "register";

const COPY = {
  login: {
    title: "Welcome back",
    cta: "Sign in",
    busy: "Signing in…",
    alt: { text: "New here?", href: "/register", label: "Create an account" },
  },
  register: {
    title: "Create your account",
    cta: "Create account",
    busy: "Creating account…",
    alt: { text: "Already have an account?", href: "/login", label: "Sign in" },
  },
} as const;

/** Presentational form. `error` is whatever the mutation threw; field messages come from a 422. */
export function AuthForm({
  mode,
  pending,
  error,
  onSubmit,
}: {
  mode: AuthMode;
  pending?: boolean;
  error?: unknown;
  onSubmit: (v: { email: string; password: string; displayName?: string }) => void;
}) {
  const c = COPY[mode];
  const id = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const fields = fieldErrors(error);
  const degraded = isDegraded(error);
  const general =
    error instanceof ApiError && !degraded && Object.keys(fields).length === 0 ? error.message : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ email: email.trim(), password, ...(mode === "register" && displayName.trim() ? { displayName: displayName.trim() } : {}) });
  }

  const field = (name: "email" | "password" | "displayName", label: string, props: React.InputHTMLAttributes<HTMLInputElement>, hint?: string) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        name={name}
        {...props}
        aria-invalid={fields[name] ? true : undefined}
        aria-describedby={fields[name] ? `${id}-${name}-err` : hint ? `${id}-${name}-hint` : undefined}
        className="min-h-11 w-full rounded-key border border-line bg-surface-0 px-3 text-text placeholder:text-muted aria-[invalid=true]:border-danger"
      />
      {fields[name] ? (
        <p id={`${id}-${name}-err`} className="text-sm text-danger">
          {fields[name]}
        </p>
      ) : hint ? (
        <p id={`${id}-${name}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );

  return (
    <Card className="mx-auto w-full max-w-md space-y-5 p-6">
      <h1 className="font-display text-3xl">{c.title}</h1>
      {degraded && (
        <div role="alert" className="rounded-key bg-signal/10 p-3 text-sm">
          <p className="font-medium">Sign-in is paused for a moment</p>
          <p className="mt-1 text-muted">
            We&apos;re restoring our database. You can still paste a link and preview media as a guest, then try again here shortly.
          </p>
        </div>
      )}
      {general && (
        <p role="alert" className="rounded-key bg-danger/10 p-3 text-sm text-danger">
          {general}
        </p>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        {mode === "register" && field("displayName", "Name (optional)", { type: "text", autoComplete: "name", value: displayName, onChange: (e) => setDisplayName(e.target.value), maxLength: 80 })}
        {field("email", "Email", { type: "email", autoComplete: "email", required: true, value: email, onChange: (e) => setEmail(e.target.value) })}
        {field(
          "password",
          "Password",
          { type: "password", autoComplete: mode === "login" ? "current-password" : "new-password", required: true, value: password, onChange: (e) => setPassword(e.target.value) },
          mode === "register" ? "At least 10 characters. A few random words works well." : undefined,
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? c.busy : c.cta}
        </Button>
      </form>
      <p className="text-sm text-muted">
        {c.alt.text}{" "}
        <Link href={c.alt.href} className="text-signal underline">
          {c.alt.label}
        </Link>
      </p>
    </Card>
  );
}
