"use client";

import clsx from "clsx";
import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/Shell";
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
    <>
      <TopBar title="Audit log" right={<button onClick={verify} className="btn-secondary" disabled={checking}>{checking ? "Verifying…" : "Verify integrity"}</button>} />
      <div className="space-y-4 p-6">
        {v && (
          <div className={clsx("flex items-center gap-2.5 rounded border px-4 py-2.5 text-[13px]", v.ok ? "border-ok-line bg-ok-soft" : "border-crit-line bg-crit-soft")}>
            {v.ok ? <CheckCircle2 size={16} className="text-ok" /> : <XCircle size={16} className="text-crit" />}
            <span className={clsx("font-medium", v.ok ? "text-ok" : "text-crit")}>{v.ok ? "Chain intact." : "Chain broken."}</span>
            <span className="text-fg-2">{v.message}</span>
          </div>
        )}
        <section className="panel overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-[13px]">
            <thead><tr>
              <th className="th pl-4">#</th><th className="th">Time (UTC)</th><th className="th">Actor</th><th className="th">Action</th>
              <th className="th">Case</th><th className="th">Hash</th><th className="th pr-4">Pipeline</th>
            </tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={clsx(v?.broken_at === e.id && "bg-crit-soft")}>
                  <td className="td mono pl-4 text-fg-3">{e.id}</td>
                  <td className="td mono text-fg-2">{e.ts.replace("T", " ").replace("Z", "")}</td>
                  <td className="td">{e.actor}</td>
                  <td className="td mono text-fg">{e.action}</td>
                  <td className="td">{e.case_id ? <Link href={`/cases/${e.case_id}`} className="mono text-accent hover:underline">{e.case_id}</Link> : <span className="text-fg-4">—</span>}</td>
                  <td className="td mono text-fg-3" title={e.hash}>{e.hash.slice(0, 12)}</td>
                  <td className="td mono max-w-[240px] truncate pr-4 text-[11px] text-fg-3" title={e.model_version || ""}>{e.model_version || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="text-xs2 text-fg-3">Each entry is chained to the previous one with SHA-256, so any later edit is detectable. This shows the log was not altered; it does not by itself establish that a recording is authentic or lawfully obtained.</p>
      </div>
    </>
  );
}
