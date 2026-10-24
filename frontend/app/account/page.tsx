"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Field, PASSWORD_HINT } from "@/components/AuthCard";
import { TopBar } from "@/components/Shell";
import { ErrorNote, KV } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

function Account() {
  const required = useSearchParams().get("required");
  const router = useRouter();
  const { me, refresh } = useSession();
  const [f, setF] = useState({ current: "", new: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.new !== f.confirm) { setMsg({ ok: false, text: "The new passwords do not match" }); return; }
    try {
      await api.post("/api/auth/password", { current: f.current, new: f.new });
      setF({ current: "", new: "", confirm: "" });
      setMsg({ ok: true, text: "Password changed. Other sessions of this account were signed out." });
      await refresh();
      if (required) router.replace("/");
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };

  return (
    <>
      <TopBar title="Account" />
      <div className="grid max-w-[880px] gap-5 p-6 md:grid-cols-2">
        <section className="panel p-4">
          <h3 className="panel-t mb-3">Signed in as</h3>
          <div className="grid gap-3">
            <KV k="Name" v={me?.display_name} />
            <KV k="Username" v={<span className="mono">{me?.username}</span>} />
            <KV k="Roles" v={me?.roles.join(", ")} />
            <KV k="Permissions" v={<span className="text-xs2 text-fg-2">{me?.permissions.join(" · ")}</span>} />
          </div>
        </section>
        <section className="panel p-4">
          <h3 className="panel-t mb-1">Change password</h3>
          {required && <p className="mb-3 text-[13px] text-warn">Set your own password before you continue.</p>}
          <form onSubmit={submit} className="space-y-3">
            {msg && (msg.ok ? <div className="rounded border border-ok-line bg-ok-soft px-3 py-2 text-[13px] text-ok">{msg.text}</div> : <ErrorNote msg={msg.text} />)}
            <Field label="Current password" type="password" value={f.current} onChange={set("current")} required autoComplete="current-password" />
            <Field label="New password" type="password" value={f.new} onChange={set("new")} required minLength={12} maxLength={128} hint={PASSWORD_HINT} autoComplete="new-password" />
            <Field label="Confirm new password" type="password" value={f.confirm} onChange={set("confirm")} required autoComplete="new-password" />
            <button className="btn-primary">Change password</button>
          </form>
        </section>
      </div>
    </>
  );
}

export default function Page() { return <Suspense><Account /></Suspense>; }
