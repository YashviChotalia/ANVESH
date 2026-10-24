"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard, Field, PASSWORD_HINT } from "@/components/AuthCard";
import { ErrorNote } from "@/components/ui";
import { authApi } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function Setup() {
  const router = useRouter();
  const { refresh } = useSession();
  const [f, setF] = useState({ display_name: "", username: "", password: "", confirm: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setErr("The passwords do not match"); return; }
    setBusy(true); setErr(null);
    try {
      await authApi.setup({ display_name: f.display_name, username: f.username.toLowerCase(), password: f.password });
      await refresh();
      router.replace("/");
    } catch (e: any) { setErr(e.message || "Setup failed"); } finally { setBusy(false); }
  };

  return (
    <AuthCard title="Set up Anvesh" sub="Create the first administrator. This is possible only once, and only on the server computer.">
      <form onSubmit={submit} className="space-y-4">
        {err && <ErrorNote msg={err} />}
        <Field label="Full name" value={f.display_name} onChange={set("display_name")} required maxLength={120} autoFocus />
        <Field label="Username" value={f.username} onChange={set("username")} required minLength={3} maxLength={32}
          pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}" hint="Lowercase letters, digits, dot, dash or underscore." autoComplete="username" />
        <Field label="Password" type="password" value={f.password} onChange={set("password")} required minLength={12} maxLength={128}
          hint={PASSWORD_HINT} autoComplete="new-password" />
        <Field label="Confirm password" type="password" value={f.confirm} onChange={set("confirm")} required autoComplete="new-password" />
        <p className="text-xs2 text-fg-3">This account gets the Administrator and Supervisor roles. Create operator accounts from Users afterwards.</p>
        <button className="btn-primary h-9 w-full" disabled={busy}>{busy ? "Creating…" : "Create administrator"}</button>
      </form>
    </AuthCard>
  );
}
