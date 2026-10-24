"use client";

import clsx from "clsx";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/Shell";
import { ErrorNote, n, SourceNote, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import type { OfficialSummary, SourceRef } from "@/lib/types";

const PLAYBOOK_LABEL: Record<string, string> = {
  digital_arrest: "Digital arrest", investment: "Investment", kyc_update: "KYC / payment", job: "Job / loan", sextortion: "Sextortion",
};

export default function Insights() {
  const [d, setD] = useState<OfficialSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stateSort, setStateSort] = useState<"cases_2023" | "rate_2023" | "chargesheet_rate_2023">("cases_2023");

  useEffect(() => { api.get<OfficialSummary>("/api/official").then(setD).catch((e) => setErr(e.message)); }, []);

  if (err) return <><TopBar title="National data" /><div className="p-6"><ErrorNote msg={err} /></div></>;
  if (!d) return <><TopBar title="National data" /><div className="space-y-3 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-surface" />)}</div></>;

  const h = d.headline;
  const src = (k: string) => d.sources.filter((s) => s.key === k);
  const states = [...d.states].sort((a, b) => ((b[stateSort] ?? -1) as number) - ((a[stateSort] ?? -1) as number));

  return (
    <>
      <TopBar title="National data" right={<span className="flex items-center gap-1.5 text-xs2 text-fg-3"><ShieldCheck size={14} className="text-ok" /> Official files, hash-verified</span>} />
      <div className="space-y-5 p-6">
        <p className="max-w-[880px] text-[13px] leading-5 text-fg-2">
          Published statistics from the National Crime Records Bureau, the Indian Cybercrime Coordination Centre (via Parliament answers)
          and the Department of Telecommunications&apos; Chakshu facility. Each file is an unmodified copy of the one on data.gov.in; Anvesh checks
          its SHA-256 and that published totals add up before showing a number.
        </p>

        <div className="panel grid grid-cols-2 divide-x divide-line lg:grid-cols-4">
          <Hero label="Cyber crimes registered, 2023" value={n(h.cyber_crimes_2023)} sub={`+${h.growth_2022_2023_pct}% on 2022 · ${h.growth_2019_2023_x}× 2019`} src="NCRB" />
          <Hero label="With fraud as the motive" value={`${h.fraud_share_2023_pct}%`} sub={`Chargesheeting rate ${h.chargesheet_rate_2023}%`} src="NCRB" />
          <Hero label={`Financial fraud complaints, ${h.ncrp_year_latest}`} value={lakh(h.ncrp_complaints_latest)} sub={`${h.ncrp_complaints_growth_x}× ${d.ncrp[0].year}`} src="I4C · NCRP" />
          <Hero label={`Amount reported lost, ${h.ncrp_year_latest}`} value={`₹${n(h.ncrp_amount_crore_latest)} Cr`} sub={`₹${n(h.ncrp_amount_crore_prev)} Cr in ${h.ncrp_year_prev}`} src="I4C · CFCFRMS" />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Cyber crimes registered, India" sources={src("crime_heads")}>
            <Columns data={d.trend.map((t) => ({ label: String(t.year), value: t.cases }))} fmt={n} />
          </Card>
          <Card title="Financial fraud complaints on NCRP" sources={src("ncrp_fraud")}
            note="Complaints are not FIRs: far more frauds are reported to the 1930 helpline and portal than are registered as cases.">
            <Columns data={d.ncrp.map((r) => ({ label: String(r.year), value: r.complaints, extra: `₹${n(r.amount_crore)} Cr reported` }))} fmt={lakh} />
          </Card>
        </div>

        <Card title="Suspected fraud communications by scam type" sources={src("chakshu")}
          right={<span className="text-xs2 text-fg-3">Reports in 2025 · {n(d.scam_types_total["2025"])} total</span>}
          note="Reported by citizens through Chakshu (Sanchar Saathi). The tag shows the Anvesh playbook that recognises this script in a call.">
          <Bars rows={d.scam_types.map((s) => ({
            label: s.category, value: s.y2025, right: `${s.share_2025_pct}%`,
            tag: s.playbook ? PLAYBOOK_LABEL[s.playbook] : undefined, sub: `${n(s.y2024)} in 2024`,
          }))} />
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card title="States and UTs, 2023" pad={false} sources={[...src("state_cyber"), ...src("state_motives")]}
            right={
              <div className="flex gap-1 text-xs2">
                {([["cases_2023", "Cases"], ["rate_2023", "Rate"], ["chargesheet_rate_2023", "Chargesheet"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setStateSort(k)}
                    className={clsx("rounded px-2 py-1 font-medium", stateSort === k ? "bg-brand-soft text-brand-700" : "text-fg-3 hover:bg-bg hover:text-fg")}>{l}</button>
                ))}
              </div>}>
            <div className="max-h-[868px] overflow-auto scroll-thin">
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 bg-surface">
                  <tr>
                    <th className="th pl-4">State / UT</th><th className="th text-right">2021</th><th className="th text-right">2022</th>
                    <th className="th text-right">2023</th><th className="th text-right">Rate / lakh</th><th className="th text-right">Fraud share</th>
                    <th className="th pr-4 text-right">Chargesheet</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {states.map((s) => (
                    <tr key={s.name} className="hover:bg-bg">
                      <td className="td pl-4 text-fg">{s.name}</td>
                      <td className="td text-right text-fg-3">{n(s.cases_2021)}</td>
                      <td className="td text-right text-fg-3">{n(s.cases_2022)}</td>
                      <td className="td text-right font-medium">{n(s.cases_2023)}</td>
                      <td className="td text-right">{s.rate_2023 ?? "—"}</td>
                      <td className="td text-right">{s.fraud_share_2023_pct === null ? "—" : `${s.fraud_share_2023_pct}%`}</td>
                      <td className="td pr-4 text-right">{s.chargesheet_rate_2023 === null ? "NA" : `${s.chargesheet_rate_2023}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-5">
            <Card title="Metropolitan cities, 2023" sources={src("city_motives")} note="Bars show all cyber crimes; the figure on the right is the share with a fraud motive.">
              <Bars rows={d.cities.slice(0, 10).map((c) => ({ label: c.name, value: c.cases_2023, right: c.fraud_share_2023_pct === null ? "—" : `${c.fraud_share_2023_pct}%` }))} />
            </Card>
            <Card title="Motives, India 2023" sources={src("state_motives")}>
              <Bars rows={d.motives_2023.slice(0, 6).map((m) => ({ label: m.motive, value: m.cases, right: `${m.share_pct}%` }))} />
            </Card>
          </div>
        </div>

        <section className="panel">
          <header className="panel-h"><h3 className="panel-t">Data sources</h3><span className="text-xs2 text-fg-3">Government Open Data License – India</span></header>
          <ul className="divide-y divide-line">
            {d.sources.map((s) => <SourceRow key={s.page} s={s} />)}
          </ul>
        </section>
      </div>
    </>
  );
}

function lakh(v: number) { return v >= 1e5 ? `${(v / 1e5).toFixed(1)} lakh` : n(v); }

function Hero({ label, value, sub, src }: { label: string; value: string; sub: string; src: string }) {
  return (
    <div className="px-4 py-3.5">
      <div className="label">{label}</div>
      <div className="mt-1 text-[24px] font-semibold leading-8 tabular-nums text-fg">{value}</div>
      <div className="text-xs2 text-fg-3">{sub}</div>
      <div className="mt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-fg-4">{src}</div>
    </div>
  );
}

function Card({ title, right, note, sources, children, pad = true }: {
  title: string; right?: React.ReactNode; note?: string; sources: SourceRef[]; children: React.ReactNode; pad?: boolean;
}) {
  return (
    <section className="panel flex flex-col">
      <header className="panel-h"><h3 className="panel-t">{title}</h3>{right}</header>
      <div className={clsx("flex-1", pad && "p-4")}>{children}</div>
      <div className="border-t border-line px-4 py-2.5">
        {note && <p className="mb-1 text-xs2 text-fg-2">{note}</p>}
        <SourceNote sources={sources} />
      </div>
    </section>
  );
}

/** Single-series column chart: one hue, thin columns, value on hover and on the last column. */
function Columns({ data, fmt }: { data: { label: string; value: number; extra?: string }[]; fmt: (v: number) => string }) {
  const max = Math.max(...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? data.length - 1;
  return (
    <div>
      <div className="mb-3 h-9">
        <div className="text-[18px] font-semibold tabular-nums text-fg">{fmt(data[shown].value)}</div>
        <div className="text-xs2 text-fg-3">{data[shown].label}{data[shown].extra ? ` · ${data[shown].extra}` : ""}</div>
      </div>
      <div className="relative flex h-[170px] items-end gap-3 border-b border-line2" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((g) => <div key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />)}
        {data.map((d, i) => (
          <div key={d.label} className="relative flex h-full flex-1 cursor-default items-end justify-center" onMouseEnter={() => setHover(i)}>
            <div className={clsx("w-full max-w-[44px] rounded-t transition-colors", i === shown ? "bg-brand-600" : "bg-brand/45")}
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-3">{data.map((d, i) => <div key={d.label} className={clsx("flex-1 text-center text-xs2 tabular-nums", i === shown ? "font-medium text-fg" : "text-fg-3")}>{d.label}</div>)}</div>
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; value: number; right?: string; tag?: string; sub?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${n(r.value)}${r.sub ? ` (${r.sub})` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-fg">{r.label}</span>
              {r.tag && <Tag tone="accent">{r.tag}</Tag>}
            </span>
            <span className="shrink-0 tabular-nums"><b className="font-semibold">{n(r.value)}</b>{r.right && <span className="ml-2 inline-block w-11 text-right text-fg-3">{r.right}</span>}</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg"><div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function SourceRow({ s }: { s: SourceRef }) {
  return (
    <li className="grid gap-1 px-4 py-3 text-[13px] md:grid-cols-[minmax(0,1fr)_auto] md:gap-6">
      <div className="min-w-0">
        <a href={s.page} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-fg hover:text-brand-700">
          {s.title}<ExternalLink size={12} className="text-fg-3" />
        </a>
        <div className="text-xs2 text-fg-3">{s.publisher} · {s.report}</div>
        {s.note && <div className="mt-0.5 text-xs2 text-fg-3">{s.note}</div>}
      </div>
      <div className="text-xs2 text-fg-3 md:text-right">
        <div>Retrieved {s.retrieved}</div>
        <div className="mono text-[11px]" title={s.sha256}>sha256 {s.sha256?.slice(0, 12)}…</div>
      </div>
    </li>
  );
}
