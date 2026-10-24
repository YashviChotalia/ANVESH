"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Field, PASSWORD_HINT } from "@/components/AuthCard";
import { TopBar } from "@/components/Shell";
import { ErrorNote, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { useSession } from "@/lib/session";

interface U { id: number; username: string; display_name: string; roles: string[]; disabled: boolean; must_change_password: boolean; locked: boolean; last_login: string | null }

const ROLES: { key: string; label: string; desc: string }[] = [
  { key: "operator", label: "Operator", desc: "Takes calls and works cases" },
  { key: "supervisor", label: "Supervisor", desc: "Reviews case links, sees protected informants, reads audit, erases cases" },
  { key: "admin", label: "Administrator", desc: "Manages accounts and audit. Cannot read cases unless also given another role" },
];

export default function Users() {
  const { me } = useSession();
  const [users, setUsers] = useState<U[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ display_name: "", username: "", password: "", roles: ["operator"] as string[] });
  const [reset, setReset] = useState<{ id: number; pw: string } | null>(null);

  const load = useCallback(() => api.get<U[]>("/api/users").then(setUsers).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const act = async (p: Promise<unknown>) => { try { setErr(null); await p; await load(); } catch (e: any) { setErr(e.message); } };
  const toggleRole = (roles: string[], r: string) => roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await act(api.post("/api/users", { ...f, username: f.username.toLowerCase() }));
    setF({ display_name: "", username: "", password: "", roles: ["operator"] });
    setOpen(false);
  };

  return (
    <>
      <TopBar title="Users" right={<button onClick={() => setOpen((v) => !v)} className="btn-primary"><Plus size={14} /> Add user</button>} />
      <div className="space-y-5 p-6">
        {err && <ErrorNote msg={err} />}
        {open && (
          <form onSubmit={create} className="panel grid gap-4 p-4 md:grid-cols-2">
            <Field label="Full name" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} required maxLength={120} />
            <Field label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required minLength={3} maxLength={32} />
            <Field label="Temporary password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })}
              required minLength={12} hint={`${PASSWORD_HINT} They must change it at first sign-in.`} autoComplete="new-password" />
            <div>
              <span className="label">Roles</span>
              <div className="mt-1 space-y-1.5">
                {ROLES.map((r) => (
                  <label key={r.key} className="flex items-start gap-2 text-[13px]">
                    <input type="checkbox" className="mt-0.5 accent-[#F97A0F]" checked={f.roles.includes(r.key)} onChange={() => setF({ ...f, roles: toggleRole(f.roles, r.key) })} />
                    <span><span className="font-medium text-fg">{r.label}</span> <span className="text-fg-3">· {r.desc}</span></span>
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 flex gap-2"><button className="btn-primary">Create user</button><button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button></div>
          </form>
        )}

        <section className="panel overflow-hidden">
          <table className="w-full border-collapse text-[13px]">
            <thead><tr><th className="th pl-4">User</th><th className="th">Roles</th><th className="th">Status</th><th className="th">Last sign-in</th><th className="th pr-4 text-right">Actions</th></tr></thead>
            <tbody>
              {(users || []).map((u) => (
                <tr key={u.id} className={clsx(u.disabled && "opacity-60")}>
                  <td className="td pl-4"><div className="font-medium text-fg">{u.display_name}</div><div className="mono text-fg-3">{u.username}</div></td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {ROLES.map((r) => (
                        <button key={r.key} disabled={u.id === undefined}
                          onClick={() => act(api.patch(`/api/users/${u.id}`, { roles: toggleRole(u.roles, r.key) }))}
                          className={clsx("tag", u.roles.includes(r.key) ? "border-brand-line bg-brand-soft text-brand-700" : "border-line text-fg-4 hover:text-fg-2")}
                          title={u.roles.includes(r.key) ? `Remove ${r.label}` : `Add ${r.label}`}>{r.label}</button>
                      ))}
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {u.disabled ? <Tag tone="crit">Disabled</Tag> : <Tag tone="ok">Active</Tag>}
                      {u.locked && <Tag tone="warn">Locked</Tag>}
                      {u.must_change_password && <Tag>Must change password</Tag>}
                    </div>
                  </td>
                  <td className="td text-fg-3">{u.last_login ? ago(u.last_login) : "Never"}</td>
                  <td className="td pr-4 text-right">
                    {u.username !== me?.username && (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setReset({ id: u.id, pw: "" })} className="btn-quiet btn-xs">Reset password</button>
                        <button onClick={() => act(api.patch(`/api/users/${u.id}`, { disabled: !u.disabled }))} className="btn-secondary btn-xs">{u.disabled ? "Enable" : "Disable"}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {reset && (
          <form className="panel flex flex-wrap items-end gap-3 p-4" onSubmit={async (e) => { e.preventDefault(); await act(api.patch(`/api/users/${reset.id}`, { password: reset.pw })); setReset(null); }}>
            <div className="min-w-[280px] flex-1"><Field label="New temporary password" type="password" value={reset.pw} onChange={(e) => setReset({ ...reset, pw: e.target.value })} required minLength={12} hint={PASSWORD_HINT} autoComplete="new-password" /></div>
            <button className="btn-primary">Set password and sign the user out</button>
            <button type="button" onClick={() => setReset(null)} className="btn-secondary">Cancel</button>
          </form>
        )}
        <p className="text-xs2 text-fg-3">Changing roles, disabling an account or resetting a password signs that user out everywhere. Every change is written to the audit log.</p>
      </div>
    </>
  );
}
