"use client";

import clsx from "clsx";
import { ArrowUpRight, HeartPulse, Network, Plus, ShieldAlert, Siren, Timer, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Empty, ErrorNote, PriorityPill, SyntheticBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, inr, inrShort, MODE_LABEL } from "@/lib/format";
import type { CaseSummary, Ring, Stats } from "@/lib/types";

export default function Command() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rings, setRings] = useState<Ring[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "IMMEDIATE" | "safety">("all");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [c, s, g] = await Promise.all([
          api.get<CaseSummary[]>("/api/cases"), api.get<Stats>("/api/stats"), api.get<{ rings: Ring[] }>("/api/graph"),
        ]);
        if (!alive) return;
        setCases(c); setStats(s); setRings(g.rings.filter((r) => r.size >= 2)); setErr(null);
      } catch (e: any) { if (alive) setErr(e.message || "Could not load cases"); }
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const shown = (cases || []).filter((c) => c.status !== "closed").filter((c) =>
    filter === "all" ? true : filter === "IMMEDIATE" ? c.priority === "IMMEDIATE" : c.coercion || c.crisis);
  const ringOf = (id: string) => rings.find((r) => r.cases.includes(id));

  return (
    <div className="pb-16">
      <div className="grain border-b border-line bg-white">
        <PageHeader eyebrow="Command centre" title="Every call solves more than one case."
          sub="Victim calls become evidence-linked case files, triaged by reported facts and linked to earlier complaints."
          right={<Link href="/intake" className="btn-brand"><Plus size={16} /> New intake</Link>} />
        <div className="grid grid-cols-2 gap-4 px-8 pb-8 xl:grid-cols-5">
          <Kpi icon={<Siren size={18} />} tone="crit" label="Immediate review" value={stats?.immediate} sub={`${stats?.open_cases ?? "–"} open cases`} />
          <Kpi icon={<HeartPulse size={18} />} tone="high" label="Human-safety alerts" value={stats?.safety_alerts} sub="Crisis or coercion" />
          <Kpi icon={<Network size={18} />} tone="info" label="Fraud rings" value={stats?.rings} sub={`${stats?.linked_cases ?? "–"} cases linked`} />
          <Kpi icon={<Wallet size={18} />} tone="dark" label="Reported loss, open" value={stats ? inrShort(stats.reported_loss) : undefined} sub="Caller-reported, unverified" />
          <Kpi icon={<Timer size={18} />} tone="ok" label="Median intake time" value={stats?.median_intake_seconds ? `${Math.round(stats.median_intake_seconds)}s` : "—"} sub="Call start → case file" />
        </div>
      </div>

      {err && <div className="px-8 pt-6"><ErrorNote msg={err} /></div>}

      <div className="grid gap-6 px-8 pt-8 2xl:grid-cols-[1fr_380px]">
        <section className="card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-display text-[17px] font-semibold">Triage queue</h2>
              <p className="text-[12.5px] text-ink-400">Ordered by reported facts and human-safety flags, never by emotion scores.</p>
            </div>
            <div className="flex rounded-xl bg-canvas p-1 text-[12px] font-semibold">
              {([["all", "All open"], ["IMMEDIATE", "Immediate"], ["safety", "Safety alerts"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={clsx("rounded-lg px-3 py-1.5 transition", filter === k ? "bg-white text-ink-900 shadow-card" : "text-ink-400 hover:text-ink-800")}>{l}</button>
              ))}
            </div>
          </header>
          {cases === null ? (
            <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-canvas" />)}</div>
          ) : shown.length === 0 ? (
            <div className="p-6"><Empty title="Queue is clear" body="New intakes appear here as soon as the first details are captured." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="px-5 py-3">Priority</th><th className="py-3">Case</th><th className="py-3">Incident type</th>
                    <th className="py-3 text-right">Reported loss</th><th className="py-3 pl-6">Signals</th><th className="py-3 pr-5 text-right">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const ring = ringOf(c.id);
                    return (
                      <tr key={c.id} className="group border-t border-line transition hover:bg-canvas/70">
                        <td className="px-5 py-3.5"><PriorityPill p={c.priority} /></td>
                        <td className="py-3.5">
                          <Link href={`/cases/${c.id}`} className="block">
                            <div className="flex items-center gap-2">
                              <span className="mono font-semibold text-ink-900 group-hover:text-brand-700">{c.id}</span>
                              {c.synthetic && <span className="rounded bg-ink-900/5 px-1.5 text-[10px] font-semibold text-ink-400">DEMO</span>}
                            </div>
                            <div className="text-[12.5px] text-ink-400">{c.caller_label} · {c.district || "District n/a"} · {MODE_LABEL[c.mode]}</div>
                          </Link>
                        </td>
                        <td className="py-3.5 text-[13px] text-ink-800">{c.playbook.label}</td>
                        <td className="py-3.5 text-right font-display text-[15px] font-semibold tabular-nums">{inr(c.amount)}</td>
                        <td className="py-3.5 pl-6">
                          <div className="flex flex-wrap gap-1.5">
                            {c.crisis && <span className="chip bg-signal-critbg text-signal-crit"><HeartPulse size={11} /> Crisis</span>}
                            {c.coercion && <span className="chip bg-signal-critbg text-signal-crit"><ShieldAlert size={11} /> Coercion</span>}
                            {ring && <span className="chip bg-signal-infobg text-signal-info"><Network size={11} /> Ring of {ring.size}</span>}
                          </div>
                        </td>
                        <td className="py-3.5 pr-5 text-right text-[12.5px] text-ink-400">{ago(c.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[17px] font-semibold">Active fraud rings</h2>
            <Link href="/rings" className="flex items-center gap-1 text-[12.5px] font-semibold text-signal-info hover:underline">Open graph <ArrowUpRight size={14} /></Link>
          </div>
          {rings.length === 0 && <Empty title="No linked cases yet" body="Rings appear when complaints share a UPI ID, phone, account, script or caller voice." />}
          {rings.slice(0, 4).map((r) => (
            <Link key={r.id} href={`/rings?ring=${r.id}`} className="card block p-4 transition hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex items-center justify-between">
                <span className="mono font-semibold">{r.id}</span>
                {r.synthetic && <SyntheticBadge />}
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="font-display text-[26px] font-bold leading-none">{r.size}<span className="ml-1 text-[13px] font-medium text-ink-400">cases</span></div>
                  <div className="mt-1 text-[12px] text-ink-400">{r.districts.join(" · ") || "—"}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-[18px] font-semibold">{inrShort(r.total_amount)}</div>
                  <div className="text-[11px] text-ink-400">reported</div>
                </div>
              </div>
              {r.shared_identifiers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.shared_identifiers.slice(0, 3).map((x) => <span key={x} className="mono rounded-md bg-canvas px-2 py-0.5 text-[11px]">{x}</span>)}
                </div>
              )}
            </Link>
          ))}
        </aside>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value?: number | string; sub: string; tone: "crit" | "high" | "info" | "ok" | "dark" }) {
  const t = { crit: "text-signal-crit bg-signal-critbg", high: "text-signal-high bg-signal-highbg", info: "text-signal-info bg-signal-infobg", ok: "text-signal-ok bg-signal-okbg", dark: "text-ink-900 bg-canvas" }[tone];
  return (
    <div className="rounded-2xl border border-line bg-white/90 p-4 shadow-card backdrop-blur">
      <div className="flex items-center gap-2">
        <span className={clsx("grid h-8 w-8 place-items-center rounded-lg", t)}>{icon}</span>
        <span className="text-[12px] font-semibold text-ink-400">{label}</span>
      </div>
      <div className="mt-3 font-display text-[30px] font-bold leading-none tabular-nums">{value ?? "–"}</div>
      <div className="mt-1.5 text-[11.5px] text-ink-400">{sub}</div>
    </div>
  );
}
