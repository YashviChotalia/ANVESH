"use client";

import clsx from "clsx";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/Shell";
import { Empty, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { useWorkspace, wsParam } from "@/lib/workspace";
import { inr, inrShort, MODE_LABEL } from "@/lib/format";
import type { CaseSummary, Ring } from "@/lib/types";

interface Edge { id: number; source: string; target: string; kind: "identifier" | "script" | "voice"; score: number; status: string; reason?: string }
type N = CaseSummary & SimulationNodeDatum;

const KIND = {
  identifier: { label: "Shared identifier", color: "#344054", dash: "" },
  script: { label: "Similar script", color: "#1849A9", dash: "5 4" },
  voice: { label: "Possible same voice", color: "#B54708", dash: "2 3" },
};
const NODE = { IMMEDIATE: "#B42318", HIGH: "#B54708", STANDARD: "#667085" };

export default function RingsPage() {
  return <Suspense><Rings /></Suspense>;
}

function Rings() {
  const params = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<{ nodes: CaseSummary[]; edges: Edge[]; rings: Ring[] } | null>(null);
  const [sel, setSel] = useState<string | null>(params.get("ring"));
  const [hover, setHover] = useState<string | null>(null);
  const [nodes, setNodes] = useState<N[]>([]);
  const [pairs, setPairs] = useState<Map<string, Edge[]>>(new Map());
  const W = 880, H = 540;

  const [ws] = useWorkspace();
  useEffect(() => { api.get<{ nodes: CaseSummary[]; edges: Edge[]; rings: Ring[] }>(`/api/graph${wsParam(ws)}`).then(setData); }, [ws]);

  useEffect(() => {
    if (!data) return;
    const comps = data.rings;
    const cols = Math.max(1, Math.ceil(Math.sqrt(comps.length)));
    const rows = Math.max(1, Math.ceil(comps.length / cols));
    const cw = W / cols, ch = H / rows;
    const all: N[] = [];
    comps.forEach((ring, i) => {
      const x0 = cw * (i % cols), y0 = ch * Math.floor(i / cols);
      const cx = x0 + cw / 2, cy = y0 + ch / 2;
      const ns: N[] = data.nodes.filter((n) => ring.cases.includes(n.id)).map((n) => ({ ...n }));
      const ls = data.edges.filter((e) => ring.cases.includes(e.source) && ring.cases.includes(e.target)).map((e) => ({ ...e }));
      const sim = forceSimulation(ns)
        .force("link", forceLink<N, any>(ls).id((d) => d.id).distance(110).strength(0.5))
        .force("charge", forceManyBody().strength(-650))
        .force("x", forceX(cx).strength(0.08)).force("y", forceY(cy).strength(0.12))
        .force("collide", forceCollide(58)).stop();
      for (let k = 0; k < 400; k++) sim.tick();
      ns.forEach((n) => {
        n.x = Math.max(x0 + 60, Math.min(x0 + cw - 60, n.x || cx));
        n.y = Math.max(y0 + 36, Math.min(y0 + ch - 48, n.y || cy));
      });
      all.push(...ns);
    });
    const p = new Map<string, Edge[]>();
    data.edges.forEach((e) => { const k = [e.source, e.target].sort().join("|"); p.set(k, [...(p.get(k) || []), e]); });
    setNodes(all); setPairs(p);
  }, [data]);

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const ring = data?.rings.find((r) => r.id === sel) || null;
  const inRing = (id: string) => !ring || ring.cases.includes(id);
  const groups = (data?.rings || []).filter((r) => r.size >= 2);

  return (
    <>
      <TopBar title="Linked cases" />
      <div className="grid gap-4 p-6 2xl:grid-cols-[1fr_340px]">
        <section className="panel overflow-hidden">
          <header className="panel-h">
            <h3 className="panel-t">Case graph</h3>
            <div className="flex flex-wrap items-center gap-4 text-xs2 text-fg-2">
              {Object.values(KIND).map((v) => (
                <span key={v.label} className="flex items-center gap-1.5">
                  <svg width="22" height="6"><line x1="0" x2="22" y1="3" y2="3" stroke={v.color} strokeWidth="2" strokeDasharray={v.dash} /></svg>{v.label}
                </span>
              ))}
              <span className="text-fg-3">Node size = reported loss</span>
            </div>
          </header>
          {!data ? <div className="h-[540px] animate-pulse bg-bg" /> : nodes.length === 0 ? <Empty title="No linked cases yet" /> : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-surface" role="img" aria-label="Graph of linked cases">
              {[...pairs.entries()].map(([key, es]) => {
                const [ia, ib] = key.split("|");
                const a = byId[ia], b = byId[ib];
                if (!a || !b) return null;
                const dx = (b.x || 0) - (a.x || 0), dy = (b.y || 0) - (a.y || 0), len = Math.hypot(dx, dy) || 1;
                const ox = -dy / len, oy = dx / len;
                const kinds = [...new Set(es.map((e) => e.kind))];
                const hi = hover === a.id || hover === b.id;
                return (
                  <g key={key} opacity={inRing(a.id) && inRing(b.id) ? 1 : 0.15}>
                    {kinds.map((k, j) => {
                      const off = (j - (kinds.length - 1) / 2) * 4;
                      return <line key={k} x1={(a.x || 0) + ox * off} y1={(a.y || 0) + oy * off} x2={(b.x || 0) + ox * off} y2={(b.y || 0) + oy * off}
                        stroke={KIND[k].color} strokeWidth={hi ? 2.4 : 1.5} strokeDasharray={KIND[k].dash}><title>{es.map((x) => x.reason).join(" · ")}</title></line>;
                    })}
                  </g>
                );
              })}
              {nodes.map((n) => {
                const maxAmt = Math.max(...nodes.map((x) => x.amount || 0), 1);
                const r = 7 + 11 * Math.sqrt((n.amount || 0) / maxAmt);
                return (
                  <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={inRing(n.id) ? 1 : 0.2} className="cursor-pointer"
                    onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => router.push(`/cases/${n.id}`)}>
                    {n.mode === "victim"
                      ? <circle r={r} fill={NODE[n.priority]} stroke="#fff" strokeWidth="2" />
                      : <rect x={-r} y={-r} width={r * 2} height={r * 2} rx="3" fill="#fff" stroke={NODE[n.priority]} strokeWidth="2" />}
                    <text textAnchor="middle" y={r + 14} fontSize="11" fontWeight="600" fill="#101828" fontFamily="JetBrains Mono" stroke="#fff" strokeWidth="3" paintOrder="stroke">{n.id.split("-").at(-1)}</text>
                    <text textAnchor="middle" y={r + 27} fontSize="10.5" fill="#667085" stroke="#fff" strokeWidth="3" paintOrder="stroke">
                      {[n.district, n.mode !== "victim" ? (n.mode === "suspect_recording" ? "recording" : "tip") : n.amount ? inrShort(n.amount) : null].filter(Boolean).join(" · ")}
                    </text>
                    <title>{`${n.id} · ${MODE_LABEL[n.mode]} · ${n.playbook.label} · ${inr(n.amount)}`}</title>
                  </g>
                );
              })}
            </svg>
          )}
          <div className="border-t border-line px-4 py-2 text-xs2 text-fg-3">Circles are victim reports, squares are recordings or tips. Click a node to open the case.</div>
        </section>

        <section className="panel h-fit">
          <header className="panel-h"><h3 className="panel-t">Groups</h3>{sel && <button onClick={() => setSel(null)} className="text-xs2 font-medium text-accent">Show all</button>}</header>
          {groups.length === 0 ? <Empty title="No groups" /> : (
            <ul className="divide-y divide-line">
              {groups.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSel(r.id === sel ? null : r.id)} className={clsx("block w-full px-4 py-3 text-left hover:bg-bg", sel === r.id && "bg-accent-soft/50")}>
                    <div className="flex items-center justify-between">
                      <span className="mono font-medium">{r.id}</span>
                      <span className="font-medium tabular-nums">{inrShort(r.total_amount)}</span>
                    </div>
                    <div className="mt-0.5 text-xs2 text-fg-3">{r.size} cases · {r.districts.join(", ")}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.link_kinds.map((k) => <Tag key={k}>{KIND[k as keyof typeof KIND].label}</Tag>)}
                      {r.synthetic && <Tag title="Linked training scenarios">Training</Tag>}
                    </div>
                    {r.shared_identifiers.length > 0 && <div className="mono mt-1.5 text-[11.5px] text-fg-2">{r.shared_identifiers.join(", ")}</div>}
                    <div className="mt-1 text-xs2 text-fg-3">{r.confirmed} confirmed, {r.candidates} pending review</div>
                  </button>
                  {sel === r.id && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-3">
                      {r.cases.map((id) => <Link key={id} href={`/cases/${id}`} className="mono text-[12px] text-accent hover:underline">{id}</Link>)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
