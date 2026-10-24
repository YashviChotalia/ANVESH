"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/Shell";
import { Empty, ErrorNote, n, PriorityLabel, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, inr, inrShort, MODE_LABEL } from "@/lib/format";
import type { CaseSummary, OfficialSummary, Ring, Stats } from "@/lib/types";
import { useWorkspace, wsParam } from "@/lib/workspace";

type Filter = "all" | "IMMEDIATE" | "safety" | "linked";
interface RadarGroup { key: string; label: string; last_24h: number; last_period: number; rising: boolean; districts: string[]; reported_loss: number }

export default function Queue() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rings, setRings] = useState<Ring[]>([]);
  const [radar, setRadar] = useState<RadarGroup[]>([]);
  const [official, setOfficial] = useState<OfficialSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [ws, setWs] = useWorkspace();
  const [page, setPage] = useState(0);
  const PER = 20;
  useEffect(() => setPage(0), [filter, ws]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [c, s, g, rd] = await Promise.all([
          api.get<CaseSummary[]>(`/api/cases${wsParam(ws)}`), api.get<Stats>(`/api/stats${wsParam(ws)}`),
          api.get<{ rings: Ring[] }>(`/api/graph${wsParam(ws)}`), api.get<{ groups: RadarGroup[] }>(`/api/radar?days=7${wsParam(ws, "&")}`),
        ]);
        if (!alive) return;
        setCases(c); setStats(s); setRings(g.rings.filter((r) => r.size >= 2)); setRadar(rd.groups); setErr(null);
      } catch (e: any) { if (alive) setErr(e.message || "Could not load cases"); }
    };
    load();
    api.get<OfficialSummary>("/api/official").then((o) => alive && setOfficial(o)).catch(() => {});
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [ws]);

  const ringOf = (id: string) => rings.find((r) => r.cases.includes(id));
  const open = (cases || []).filter((c) => c.status !== "closed");
  const counts: Record<Filter, number> = {
    all: open.length,
    IMMEDIATE: open.filter((c) => c.priority === "IMMEDIATE").length,
    safety: open.filter((c) => c.coercion || c.crisis).length,
    linked: open.filter((c) => ringOf(c.id)).length,
  };
  const shown = open.filter((c) => filter === "all" ? true : filter === "IMMEDIATE" ? c.priority === "IMMEDIATE"
    : filter === "safety" ? c.coercion || c.crisis : !!ringOf(c.id));

  return (
    <>
      <TopBar title="Case queue" right={<Link href="/intake" className="btn-primary"><Plus size={14} /> New intake</Link>} />
      <div className="space-y-5 p-6">
        {err && <ErrorNote msg={err} />}
        {official && <NationalStrip o={official} />}
        {ws === "training" && (
          <div className="rounded border border-warn-line bg-warn-soft px-4 py-2 text-xs2 text-warn">
            <span className="font-semibold">Training workspace.</span> Scripted scenarios for practice and demos, not real complaints.
            They never mix with live cases or their links. Scam types and places come from official Chakshu and NCRB data; numbers and UPI handles are placeholders.
          </div>
        )}

        <div className="panel grid grid-cols-2 divide-x divide-line md:grid-cols-5">
          <Metric label="Open cases" value={stats?.open_cases} />
          <Metric label="Immediate review" value={stats?.immediate} tone={stats?.immediate ? "crit" : undefined} />
          <Metric label="Safety alerts" value={stats?.safety_alerts} tone={stats?.safety_alerts ? "crit" : undefined} />
          <Metric label="Linked groups" value={stats?.rings} sub={stats ? `${stats.linked_cases} cases` : undefined} />
          <Metric label="Reported loss (open)" value={stats ? inrShort(stats.reported_loss) : undefined} sub="As reported by callers" />
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="panel overflow-hidden">
            <div className="flex items-center gap-1 border-b border-line px-3">
              {([["all", "All open"], ["IMMEDIATE", "Immediate"], ["safety", "Safety alerts"], ["linked", "Linked"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={clsx("-mb-px flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium",
                    filter === k ? "border-brand text-fg" : "border-transparent text-fg-3 hover:text-fg")}>
                  {l}<span className="rounded bg-bg px-1.5 text-xs2 text-fg-3">{counts[k]}</span>
                </button>
              ))}
            </div>
            {cases === null ? (
              <div className="space-y-px p-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-bg" />)}</div>
            ) : open.length === 0 && ws === "live" ? (
              <div className="px-6 py-12 text-center">
                <div className="text-[15px] font-semibold text-fg">No live cases yet</div>
                <p className="mx-auto mt-1 max-w-[520px] text-[13px] text-fg-2">
                  This queue only shows real calls taken here. Start an intake to take a call, or open the training workspace to practise on scripted scenarios.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Link href="/intake" className="btn-primary"><Plus size={14} /> New intake</Link>
                  {(stats?.training_available ?? 0) > 0 && <button onClick={() => setWs("training")} className="btn-secondary">Open training workspace</button>}
                </div>
              </div>
            ) : shown.length === 0 ? (
              <Empty title="No cases in this view" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="th w-[104px] pl-4">Priority</th><th className="th">Case</th>
                      <th className="th">Incident type</th><th className="th whitespace-nowrap text-right">Reported loss</th><th className="th pr-4">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(page * PER, page * PER + PER).map((c) => {
                      const ring = ringOf(c.id);
                      return (
                        <tr key={c.id} onClick={() => router.push(`/cases/${c.id}`)} className="cursor-pointer hover:bg-bg">
                          <td className="td pl-4"><PriorityLabel p={c.priority} /></td>
                          <td className="td">
                            <Link href={`/cases/${c.id}`} className="mono text-[12px] font-medium text-fg hover:text-accent">{c.id}</Link>
                            <div className="max-w-[210px] truncate text-xs2 text-fg-3" title={c.caller_label}>{[c.caller_label, c.district, ago(c.created_at)].filter(Boolean).join(" · ")}</div>
                          </td>
                          <td className="td max-w-[170px] truncate whitespace-nowrap text-fg-2" title={c.playbook.label}>{c.playbook.label}</td>
                          <td className="td text-right font-medium tabular-nums">{c.amount ? inr(c.amount) : <span className="text-fg-4">—</span>}</td>
                          <td className="td">
                            <div className="flex max-w-[150px] flex-wrap gap-1">
                              {c.crisis && <Tag tone="crit">Crisis</Tag>}
                              {c.coercion && <Tag tone="crit">Coercion</Tag>}
                              {ring && <Tag tone="accent">Linked · {ring.size}</Tag>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shown.length > PER && (
                  <div className="flex items-center justify-between px-4 py-2.5 text-xs2 text-fg-3">
                    <span>{page * PER + 1}–{Math.min(shown.length, (page + 1) * PER)} of {shown.length}</span>
                    <div className="flex gap-1">
                      <button className="btn-secondary btn-xs" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                      <button className="btn-secondary btn-xs" disabled={(page + 1) * PER >= shown.length} onClick={() => setPage(page + 1)}>Next</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="min-w-0 space-y-5">
          <section className="panel h-fit overflow-hidden">
            <header className="panel-h"><h3 className="panel-t">Scam trends · 7 days</h3><span className="text-xs2 text-fg-3">24 h / 7 d</span></header>
            {radar.length === 0 ? <Empty title="No complaints in the last 7 days" /> : (
              <ul className="divide-y divide-line">
                {radar.map((g) => (
                  <li key={g.key} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[13px] text-fg"><span className="truncate">{g.label}</span>{g.rising && <Tag tone="warn">Rising</Tag>}</div>
                      <div className="truncate text-xs2 text-fg-3" title={g.districts.join(", ")}>
                        {g.districts.slice(0, 3).join(", ") || "—"}{g.districts.length > 3 ? ` +${g.districts.length - 3} more` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums" title="Last 24 hours / last 7 days">
                      <b className="font-semibold">{g.last_24h}</b><span className="text-fg-3"> / {g.last_period}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel h-fit overflow-hidden">
            <header className="panel-h"><h3 className="panel-t">Linked groups</h3><Link href="/rings" className="text-xs2 font-medium text-accent hover:underline">View graph</Link></header>
            {rings.length === 0 ? <Empty title="No linked cases" body="Cases are linked when they share an identifier, scam script or suspect voice." /> : (
              <ul className="max-h-[520px] divide-y divide-line overflow-auto scroll-thin">
                {rings.map((r) => (
                  <li key={r.id}>
                    <Link href={`/rings?ring=${r.id}`} className="block px-4 py-3 hover:bg-bg">
                      <div className="flex items-center justify-between">
                        <span className="mono font-medium">{r.id}</span>
                        <span className="font-medium tabular-nums">{inrShort(r.total_amount)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs2 text-fg-3" title={r.districts.join(", ")}>{r.size} cases · {r.districts.slice(0, 3).join(", ") || "—"}{r.districts.length > 3 ? ` +${r.districts.length - 3}` : ""}</div>
                      {r.shared_identifiers.length > 0 && <div className="mono mt-1.5 truncate text-[11.5px] text-fg-2">{r.shared_identifiers.join(", ")}</div>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </div>
        </div>
      </div>
    </>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value?: number | string; sub?: string; tone?: "crit" }) {
  return (
    <div className="px-4 py-3">
      <div className="label">{label}</div>
      <div className={clsx("mt-1 text-[22px] font-semibold leading-7 tabular-nums", tone === "crit" ? "text-crit" : "text-fg")}>{value ?? "–"}</div>
      {sub && <div className="text-xs2 text-fg-3">{sub}</div>}
    </div>
  );
}

function NationalStrip({ o }: { o: OfficialSummary }) {
  const h = o.headline;
  return (
    <Link href="/insights" className="panel group flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2.5 text-[13px] hover:border-line2">
      <span className="text-xs2 font-medium uppercase tracking-wide text-fg-3">India, official</span>
      <span><b className="font-semibold tabular-nums">{n(h.cyber_crimes_2023)}</b> <span className="text-fg-2">cyber crimes in 2023</span> <span className="text-fg-3">(+{h.growth_2022_2023_pct}%)</span></span>
      <span><b className="font-semibold tabular-nums">{(h.ncrp_complaints_latest / 1e5).toFixed(1)} lakh</b> <span className="text-fg-2">fraud complaints in {h.ncrp_year_latest}</span></span>
      <span><b className="font-semibold tabular-nums">₹{n(h.ncrp_amount_crore_latest)} Cr</b> <span className="text-fg-2">reported lost</span></span>
      <span className="ml-auto text-xs2 text-fg-3 group-hover:text-brand-700">NCRB · I4C · DoT →</span>
    </Link>
  );
}
