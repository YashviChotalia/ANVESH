"use client";

import clsx from "clsx";
import { ShieldCheck, ShieldX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { api } from "@/lib/api";
import type { AuditEventT } from "@/lib/types";

export default function Audit() {
  const [events, setEvents] = useState<AuditEventT[]>([]);
  const [v, setV] = useState<{ ok: boolean; events_checked: number; message: string; broken_at?: number } | null>(null);
  const [checking, setChecking] = useState(false);

  const verify = async () => {
    setChecking(true);
    try { setV(await api.get("/api/audit/verify")); } finally { setChecking(false); }
  };
  useEffect(() => { api.get<AuditEventT[]>("/api/audit?limit=300").then(setEvents); verify(); }, []);

  return (
    <div className="pb-16">
      <PageHeader eyebrow="Audit trail" title="Tamper-evident by design."
        sub="Every access, AI output and human correction is written to a SHA-256 hash chain. Editing any past event breaks every hash after it."
        right={<button onClick={verify} className="btn-primary" disabled={checking}><ShieldCheck size={16} /> {checking ? "Verifying…" : "Verify chain"}</button>} />
      <div className="space-y-6 px-8">
        {v && (
          <div className={clsx("flex items-center gap-4 rounded-2xl p-5 text-white shadow-lift", v.ok ? "bg-signal-ok" : "bg-signal-crit")}>
            {v.ok ? <ShieldCheck size={30} /> : <ShieldX size={30} />}
            <div>
              <div className="font-display text-[20px] font-bold">{v.ok ? "Chain intact" : "Chain broken"}</div>
              <div className="text-[13px] text-white/90">{v.message}</div>
            </div>
          </div>
        )}
        <p className="text-[12.5px] text-ink-400">A hash proves the log and files were not altered after they were recorded. It does not by itself prove a recording is authentic, complete or lawfully obtained.</p>
        <section className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[12.5px]">
            <thead><tr className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              <th className="px-5 py-3">#</th><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Case</th><th>Hash</th><th className="pr-5">Model / pipeline</th>
            </tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={clsx("border-t border-line", v?.broken_at === e.id && "bg-signal-critbg")}>
                  <td className="mono px-5 py-2.5 text-ink-400">{e.id}</td>
                  <td className="py-2.5">{e.ts.replace("T", " ").replace("Z", "")}</td>
                  <td className="py-2.5 font-semibold">{e.actor}</td>
                  <td className="py-2.5"><span className="chip bg-canvas text-ink-800">{e.action}</span></td>
                  <td className="py-2.5">{e.case_id ? <Link href={`/cases/${e.case_id}`} className="mono hover:text-brand-700">{e.case_id}</Link> : "—"}</td>
                  <td className="mono py-2.5 text-ink-400" title={e.hash}>{e.hash.slice(0, 14)}…</td>
                  <td className="mono max-w-[260px] truncate py-2.5 pr-5 text-[11px] text-ink-400" title={e.model_version || ""}>{e.model_version || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
