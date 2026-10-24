"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/Shell";
import { Empty, ErrorNote, PriorityLabel, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, inr, inrShort, MODE_LABEL } from "@/lib/format";
import type { CaseSummary, Ring, Stats } from "@/lib/types";

type Filter = "all" | "IMMEDIATE" | "safety" | "linked";
interface RadarGroup { key: string; label: string; last_24h: number; last_period: number; rising: boolean; districts: string[]; reported_loss: number }

export default function Queue() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rings, setRings] = useState<Ring[]>([]);
  const [radar, setRadar] = useState<RadarGroup[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [c, s, g, rd] = await Promise.all([
          api.get<CaseSummary[]>("/api/cases"), api.get<Stats>("/api/stats"), api.get<{ rings: Ring[] }>("/api/graph"),
          api.get<{ groups: RadarGroup[] }>("/api/radar?days=7"),
        ]);
        if (!alive) return;
        setCases(c); setStats(s); setRings(g.rings.filter((r) => r.size >= 2)); setRadar(rd.groups); setErr(null);
      } catch (e: any) { if (alive) setErr(e.message || "Could not load cases"); }
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

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
        {open.some((c) => c.synthetic) && (
          <div className="rounded border border-line bg-surface px-4 py-2 text-xs2 text-fg-2">
            This queue includes <span className="font-medium text-fg">synthetic demo cases</span> (marked “synthetic” in the caller name). Names, numbers and UPI IDs are invented.
          </div>
        )}

        <div className="panel grid grid-cols-2 divide-x divide-line md:grid-cols-5">
          <Metric label="Open cases" value={stats?.open_cases} />
          <Metric label="Immediate review" value={stats?.immediate} tone="crit" />
          <Metric label="Safety alerts" value={stats?.safety_alerts} tone={stats?.safety_alerts ? "crit" : undefined} />
          <Metric label="Linked groups" value={stats?.rings} sub={stats ? `${stats.linked_cases} cases` : undefined} />
          <Metric label="Reported loss (open)" value={stats ? inrShort(stats.reported_loss) : undefined} sub="As reported by callers" />
        </div>

        <div className="grid gap-5 2xl:grid-cols-[1fr_320px]">
          <section className="panel overflow-hidden">
            <div className="flex items-center gap-1 border-b border-line px-3">
              {([["all", "All open"], ["IMMEDIATE", "Immediate"], ["safety", "Safety alerts"], ["linked", "Linked"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={clsx("-mb-px flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium",
                    filter === k ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg")}>
                  {l}<span className="rounded bg-bg px-1.5 text-xs2 text-fg-3">{counts[k]}</span>
                </button>
              ))}
            </div>
            {cases === null ? (
              <div className="space-y-px p-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-bg" />)}</div>
            ) : shown.length === 0 ? (
              <Empty title="No cases in this view" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="th w-[112px] pl-4">Priority</th><th className="th">Case</th><th className="th">Caller</th>
                      <th className="th">Incident type</th><th className="th whitespace-nowrap text-right">Reported loss</th><th className="th">Flags</th>
                      <th className="th pr-4 text-right">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => {
                      const ring = ringOf(c.id);
                      return (
                        <tr key={c.id} onClick={() => router.push(`/cases/${c.id}`)} className="cursor-pointer hover:bg-bg">
                          <td className="td pl-4"><PriorityLabel p={c.priority} /></td>
                          <td className="td whitespace-nowrap"><Link href={`/cases/${c.id}`} className="mono font-medium text-fg hover:text-accent">{c.id}</Link></td>
                          <td className="td">
                            <div className="text-fg">{c.caller_label}</div>
                            <div className="text-xs2 text-fg-3">{[c.district, MODE_LABEL[c.mode]].filter(Boolean).join(" · ")}</div>
                          </td>
                          <td className="td text-fg-2">{c.playbook.label}</td>
                          <td className="td text-right font-medium tabular-nums">{c.amount ? inr(c.amount) : <span className="text-fg-4">—</span>}</td>
                          <td className="td">
                            <div className="flex flex-wrap gap-1">
                              {c.crisis && <Tag tone="crit">Crisis</Tag>}
                              {c.coercion && <Tag tone="crit">Coercion</Tag>}
                              {ring && <Tag tone="accent">Linked · {ring.size}</Tag>}
                            </div>
                          </td>
                          <td className="td whitespace-nowrap pr-4 text-right text-fg-3">{ago(c.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="space-y-5">
          <section className="panel h-fit">
            <header className="panel-h"><h3 className="panel-t">Scam trends · 7 days</h3><span className="text-xs2 text-fg-3">24 h / 7 d</span></header>
            {radar.length === 0 ? <Empty title="No complaints in the last 7 days" /> : (
              <table className="w-full text-[13px]">
                <tbody>
                  {radar.map((g) => (
                    <tr key={g.key}>
                      <td className="td pl-4">
                        <div className="flex items-center gap-1.5 text-fg">{g.label}{g.rising && <Tag tone="warn">Rising</Tag>}</div>
                        <div className="truncate text-xs2 text-fg-3">{g.districts.join(", ") || "—"}</div>
                      </td>
                      <td className="td whitespace-nowrap pr-4 text-right tabular-nums"><b className="font-semibold">{g.last_24h}</b><span className="text-fg-3"> / {g.last_period}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel h-fit">
            <header className="panel-h"><h3 className="panel-t">Linked groups</h3><Link href="/rings" className="text-xs2 font-medium text-accent hover:underline">View graph</Link></header>
            {rings.length === 0 ? <Empty title="No linked cases" body="Cases are linked when they share an identifier, scam script or suspect voice." /> : (
              <ul className="divide-y divide-line">
                {rings.map((r) => (
                  <li key={r.id}>
                    <Link href={`/rings?ring=${r.id}`} className="block px-4 py-3 hover:bg-bg">
                      <div className="flex items-center justify-between">
                        <span className="mono font-medium">{r.id}</span>
                        <span className="font-medium tabular-nums">{inrShort(r.total_amount)}</span>
                      </div>
                      <div className="mt-0.5 text-xs2 text-fg-3">{r.size} cases · {r.districts.join(", ") || "—"}</div>
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
