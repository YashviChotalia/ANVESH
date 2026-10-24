"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, Field } from "@/components/AuthCard";
import { ErrorNote } from "@/components/ui";
import { authApi } from "@/lib/api";
import { useSession } from "@/lib/session";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const { refresh } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await authApi.login(username, password);
      setPassword("");
      await refresh();
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(r.user.must_change_password ? "/account?required=1"
        : r.user.permissions.includes("case:read") ? (safeNext || "/") : "/admin/users");
    } catch (e: any) {
      setErr(e.message || "Sign-in failed");
    } finally { setBusy(false); }
  };

  return (
    <AuthCard title="Sign in" sub="Use the account your administrator created for you.">
      <form onSubmit={submit} className="space-y-4" autoComplete="on">
        {err && <ErrorNote msg={err} />}
        <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required maxLength={64} />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={128} />
        <button className="btn-primary h-9 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </AuthCard>
  );
}

export default function Login() {
  return <Suspense><LoginForm /></Suspense>;
}
