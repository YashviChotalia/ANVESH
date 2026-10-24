import clsx from "clsx";
import { AlertTriangle, CheckCircle2, CircleDashed, PencilLine, ShieldAlert } from "lucide-react";
import type { Priority } from "@/lib/types";

export function PriorityPill({ p, size = "sm" }: { p: Priority; size?: "sm" | "lg" }) {
  const style = {
    IMMEDIATE: "bg-signal-crit text-white",
    HIGH: "bg-signal-high text-white",
    STANDARD: "bg-ink-800/90 text-white",
  }[p];
  const label = { IMMEDIATE: "Immediate", HIGH: "High", STANDARD: "Standard" }[p];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-wider", style,
      size === "lg" ? "px-3.5 py-1.5 text-[12px]" : "px-2.5 py-0.5 text-[10px]")}>
      {p === "IMMEDIATE" && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
      {label}
    </span>
  );
}

export function StatusChip({ s }: { s: string }) {
  const map: Record<string, [string, string, React.ReactNode]> = {
    predicted: ["AI extracted", "bg-signal-infobg text-signal-info", <CircleDashed key="i" size={11} />],
    reported: ["Caller confirmed", "bg-brand-50 text-brand-700", <CheckCircle2 key="i" size={11} />],
    verified: ["Officer verified", "bg-signal-okbg text-signal-ok", <CheckCircle2 key="i" size={11} />],
    corrected: ["Officer corrected", "bg-signal-okbg text-signal-ok", <PencilLine key="i" size={11} />],
    missing: ["Missing", "bg-signal-critbg text-signal-crit", <AlertTriangle key="i" size={11} />],
  };
  const [label, cls, icon] = map[s] || map.predicted;
  return <span className={clsx("chip", cls)}>{icon}{label}</span>;
}

export function Confidence({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const tone = v >= 0.8 ? "bg-signal-ok" : v >= 0.6 ? "bg-signal-high" : "bg-signal-crit";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-400" title="Model confidence (not calibrated)">
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-line">
        <span className={clsx("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}

export function SyntheticBadge() {
  return <span className="chip bg-ink-900/5 text-ink-600 ring-1 ring-inset ring-ink-900/10">Synthetic demo data</span>;
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-display text-[15px] font-semibold text-ink-800">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-400">{body}</p>}
    </div>
  );
}

export function ErrorNote({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-signal-crit/20 bg-signal-critbg px-4 py-3 text-[13px] text-signal-crit">
      <ShieldAlert size={16} className="mt-0.5 shrink-0" /> <span>{msg}</span>
    </div>
  );
}

export function Section({ title, icon, action, children, className }: {
  title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={clsx("card", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h3 className="flex items-center gap-2 font-display text-[14px] font-semibold text-ink-900">{icon}{title}</h3>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
