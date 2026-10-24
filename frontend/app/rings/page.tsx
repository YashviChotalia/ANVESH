"use client";

import clsx from "clsx";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { Fingerprint, ListChecks, Mic } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Empty, SyntheticBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { inr, inrShort, MODE_LABEL } from "@/lib/format";
import type { CaseSummary, Ring } from "@/lib/types";

interface Edge { id: number; source: string; target: string; kind: "identifier" | "script" | "voice"; score: number; status: string; reason?: string }
type N = CaseSummary & SimulationNodeDatum;

const KIND = {
  identifier: { label: "Same identifier", color: "#0A0F1C", dash: "" },
  script: { label: "Similar script", color: "#3E4BDB", dash: "6 4" },
  voice: { label: "Possible same voice", color: "#DC6803", dash: "2 4" },
};

export default function RingsPage() {
  return <Suspense><Rings /></Suspense>;
}

function Rings() {
  const params = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<{ nodes: CaseSummary[]; edges: Edge[]; rings: Ring[] } | null>(null);
  const [sel, setSel] = useState<string | null>(params.get("ring"));
  const [hover, setHover] = useState<string | null>(null);
  const [layout, setLayout] = useState<{ nodes: N[]; edges: Edge[] } | null>(null);
  const [pairs, setPairs] = useState<Map<string, Edge[]>>(new Map());
  const W = 860, H = 560;

  useEffect(() => { api.get<{ nodes: CaseSummary[]; edges: Edge[]; rings: Ring[] }>("/api/graph").then(setData); }, []);

  useEffect(() => {
    if (!data) return;
    // lay out each ring in its own cell so rings never overlap
    const comps = data.rings.filter((r) => r.size >= 1);
    const cols = Math.max(1, Math.ceil(Math.sqrt(comps.length)));
    const rows = Math.max(1, Math.ceil(comps.length / cols));
    const cw = W / cols, ch = H / rows;
    const all: N[] = [];
    comps.forEach((ring, i) => {
      const cx = cw * (i % cols) + cw / 2, cy = ch * Math.floor(i / cols) + ch / 2;
      const nodes: N[] = data.nodes.filter((n) => ring.cases.includes(n.id)).map((n) => ({ ...n }));
      const links = data.edges.filter((e) => ring.cases.includes(e.source) && ring.cases.includes(e.target)).map((e) => ({ ...e }));
      const sim = forceSimulation(nodes)
        .force("link", forceLink<N, any>(links).id((d) => d.id).distance(118).strength(0.5))
        .force("charge", forceManyBody().strength(-700))
        .force("x", forceX(cx).strength(0.08))
        .force("y", forceY(cy).strength(0.12))
        .force("collide", forceCollide(62))
        .stop();
      for (let k = 0; k < 400; k++) sim.tick();
      nodes.forEach((n) => {
        n.x = Math.max(cw * (i % cols) + 56, Math.min(cw * (i % cols + 1) - 56, n.x || cx));
        n.y = Math.max(ch * Math.floor(i / cols) + 44, Math.min(ch * (Math.floor(i / cols) + 1) - 58, n.y || cy));
      });
      all.push(...nodes);
    });
    // one visual edge per case pair; kinds drawn as parallel strands
    const pairs = new Map<string, Edge[]>();
    data.edges.forEach((e) => {
      const k = [e.source, e.target].sort().join("|");
      pairs.set(k, [...(pairs.get(k) || []), e]);
    });
    setLayout({ nodes: all, edges: [...pairs.values()].flat() });
    setPairs(pairs);
  }, [data]);

  const byId = useMemo(() => Object.fromEntries((layout?.nodes || []).map((n) => [n.id, n])), [layout]);
  const ring = data?.rings.find((r) => r.id === sel) || null;
  const inRing = (id: string) => !ring || ring.cases.includes(id);
  const maxAmt = Math.max(...(data?.nodes || []).map((n) => n.amount || 0), 1);

  return (
    <div className="pb-16">
      <PageHeader eyebrow="Ring Linker" title="One call can reveal a whole fraud ring."
        sub="Complaints are linked by exact identifiers, similar scam scripts and, for suspect recordings, possible caller-voice matches. Every link is a lead until an officer confirms it." />
      <div className="grid gap-6 px-8 2xl:grid-cols-[1fr_380px]">
        <section className="card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="font-display text-[15px] font-semibold">Case graph</h2>
            <div className="flex flex-wrap gap-4 text-[12px] text-ink-800">
              {Object.entries(KIND).map(([k, v]) => (
                <span key={k} className="flex items-center gap-2">
                  <svg width="26" height="6"><line x1="0" x2="26" y1="3" y2="3" stroke={v.color} strokeWidth="2.5" strokeDasharray={v.dash} /></svg>{v.label}
                </span>
              ))}
              <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-signal-crit" /> Immediate</span>
            </div>
          </header>
          {!layout ? <div className="h-[560px] animate-pulse bg-canvas" /> : layout.nodes.length === 0 ? (
            <div className="p-8"><Empty title="No links yet" body="Seed the demo data or record a few complaints to see rings form." /></div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-[radial-gradient(#E3E6EC_1px,transparent_1px)] [background-size:18px_18px]" role="img" aria-label="Graph of linked cases">
              {[...pairs.entries()].map(([key, es]) => {
                const [ia, ib] = key.split("|");
                const a = byId[ia], b = byId[ib];
                if (!a || !b) return null;
                const dim = !(inRing(a.id) && inRing(b.id));
                const hi = hover && (hover === a.id || hover === b.id);
                const dx = (b.x || 0) - (a.x || 0), dy = (b.y || 0) - (a.y || 0);
                const len = Math.hypot(dx, dy) || 1;
                const ox = -dy / len, oy = dx / len;
                const kinds = [...new Set(es.map((e) => e.kind))];
                return (
                  <g key={key} opacity={dim ? 0.12 : 1}>
                    {kinds.map((k, j) => {
                      const off = (j - (kinds.length - 1) / 2) * 5;
                      const e = es.find((x) => x.kind === k)!;
                      return (
                        <line key={k} x1={(a.x || 0) + ox * off} y1={(a.y || 0) + oy * off} x2={(b.x || 0) + ox * off} y2={(b.y || 0) + oy * off}
                          stroke={KIND[k].color} strokeWidth={hi ? 3.2 : 2.2} strokeDasharray={KIND[k].dash}
                          strokeOpacity={e.status === "confirmed" ? 1 : 0.8}><title>{es.map((x) => x.reason).join(" · ")}</title></line>
                      );
                    })}
                  </g>
                );
              })}
              {layout.nodes.map((n) => {
                const r = 14 + 16 * Math.sqrt((n.amount || 0) / maxAmt);
                const fill = n.priority === "IMMEDIATE" ? "#D92D20" : n.priority === "HIGH" ? "#DC6803" : "#475467";
                return (
                  <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={inRing(n.id) ? 1 : 0.18}
                    className="cursor-pointer" onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                    onClick={() => router.push(`/cases/${n.id}`)}>
                    <circle r={r + 5} fill="white" />
                    <circle r={r} fill={fill} stroke={n.mode === "suspect_recording" ? "#0A0F1C" : "white"} strokeWidth={n.mode === "suspect_recording" ? 3 : 2} />
                    {n.mode !== "victim" && <text textAnchor="middle" y="4" fontSize="11" fontWeight="700" fill="white">{n.mode === "suspect_recording" ? "REC" : "TIP"}</text>}
                    <text textAnchor="middle" y={r + 17} fontSize="11.5" fontWeight="600" fill="#0A0F1C" fontFamily="JetBrains Mono" stroke="#F4F5F8" strokeWidth="4" paintOrder="stroke">{n.id.split("-").at(-1)}</text>
                    <text textAnchor="middle" y={r + 31} fontSize="10.5" fill="#7A859B" stroke="#F4F5F8" strokeWidth="4" paintOrder="stroke">{n.district || ""}{n.amount ? ` · ${inrShort(n.amount)}` : ""}</text>
                    <title>{`${n.id} · ${MODE_LABEL[n.mode]} · ${n.playbook.label} · ${inr(n.amount)}`}</title>
                  </g>
                );
              })}
            </svg>
          )}
        </section>

        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[17px] font-semibold">Rings</h2>
            {sel && <button onClick={() => setSel(null)} className="text-[12px] font-semibold text-signal-info">Show all</button>}
          </div>
          {data?.rings.filter((r) => r.size >= 2).map((r) => (
            <button key={r.id} onClick={() => setSel(r.id === sel ? null : r.id)}
              className={clsx("card block w-full p-4 text-left transition hover:shadow-lift", sel === r.id && "ring-2 ring-ink-900")}>
              <div className="flex items-center justify-between">
                <span className="mono font-semibold">{r.id}</span>
                {r.synthetic && <SyntheticBadge />}
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-display text-[26px] font-bold">{r.size}</span><span className="text-[12.5px] text-ink-400">cases · {r.districts.length} districts</span>
                <span className="ml-auto font-display text-[18px] font-semibold">{inrShort(r.total_amount)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.link_kinds.map((k) => (
                  <span key={k} className="chip bg-canvas text-ink-800">
                    {k === "identifier" ? <Fingerprint size={11} /> : k === "voice" ? <Mic size={11} /> : <ListChecks size={11} />}{KIND[k as keyof typeof KIND].label}
                  </span>
                ))}
              </div>
              {r.shared_identifiers.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{r.shared_identifiers.map((x) => <span key={x} className="mono rounded-md bg-ink-900 px-2 py-0.5 text-[11px] text-white">{x}</span>)}</div>}
              <div className="mt-3 text-[12px] text-ink-400">{r.districts.join(" · ")} · {r.confirmed} confirmed / {r.candidates} candidate links</div>
              {sel === r.id && (
                <div className="mt-3 space-y-1 border-t border-line pt-3">
                  {r.cases.map((id) => <Link key={id} href={`/cases/${id}`} onClick={(e) => e.stopPropagation()} className="mono block text-[12.5px] hover:text-brand-700">{id} →</Link>)}
                </div>
              )}
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}
