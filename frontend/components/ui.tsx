import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import type { Priority } from "@/lib/types";

const PRI: Record<Priority, { label: string; dot: string; text: string }> = {
  IMMEDIATE: { label: "Immediate", dot: "bg-crit", text: "text-crit" },
  HIGH: { label: "High", dot: "bg-warn", text: "text-warn" },
  STANDARD: { label: "Standard", dot: "bg-fg-4", text: "text-fg-2" },
};

export function PriorityLabel({ p, className }: { p: Priority; className?: string }) {
  const s = PRI[p];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 font-medium", s.text, className)}>
      <span className={clsx("h-2 w-2 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function PriorityBadge({ p }: { p: Priority }) {
  const cls = { IMMEDIATE: "border-crit-line bg-crit-soft text-crit", HIGH: "border-warn-line bg-warn-soft text-warn", STANDARD: "border-line bg-bg text-fg-2" }[p];
  return <span className={clsx("tag", cls)}><span className={clsx("h-1.5 w-1.5 rounded-full", PRI[p].dot)} />{PRI[p].label}</span>;
}

const STATUS: Record<string, [string, string]> = {
  predicted: ["Unverified", "border-line bg-bg text-fg-2"],
  reported: ["Confirmed by caller", "border-accent-line bg-accent-soft text-accent"],
  verified: ["Verified", "border-ok-line bg-ok-soft text-ok"],
  corrected: ["Corrected", "border-ok-line bg-ok-soft text-ok"],
  missing: ["Missing", "border-crit-line bg-crit-soft text-crit"],
};

export function StatusTag({ s }: { s: string }) {
  const [label, cls] = STATUS[s] || STATUS.predicted;
  return <span className={clsx("tag", cls)}>{label}</span>;
}

export function Tag({ children, tone = "neutral", title }: { children: React.ReactNode; tone?: "neutral" | "crit" | "warn" | "ok" | "accent"; title?: string }) {
  const cls = {
    neutral: "border-line bg-bg text-fg-2", crit: "border-crit-line bg-crit-soft text-crit",
    warn: "border-warn-line bg-warn-soft text-warn", ok: "border-ok-line bg-ok-soft text-ok", accent: "border-accent-line bg-accent-soft text-accent",
  }[tone];
  return <span title={title} className={clsx("tag", cls)}>{children}</span>;
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-[13px] font-medium text-fg-2">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-xs text-xs2 text-fg-3">{body}</p>}
    </div>
  );
}

export function ErrorNote({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 rounded border border-crit-line bg-crit-soft px-3 py-2 text-[13px] text-crit">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{msg}</span>
    </div>
  );
}

export function Panel({ title, action, children, className, pad = true }: {
  title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={clsx("panel", className)}>
      {title && <header className="panel-h"><h3 className="panel-t">{title}</h3>{action}</header>}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function KV({ k, v, className }: { k: string; v: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="label">{k}</div>
      <div className="mt-0.5 text-[13px] text-fg">{v}</div>
    </div>
  );
}

export function SourceNote({ sources, className }: { sources: import("@/lib/types").SourceRef[]; className?: string }) {
  return (
    <div className={clsx("text-xs2 leading-[17px] text-fg-3", className)}>
      Source:{" "}
      {sources.map((s, i) => (
        <span key={s.page}>
          {i > 0 && "; "}
          <a href={s.page} target="_blank" rel="noreferrer" className="text-fg-2 underline decoration-line2 underline-offset-2 hover:text-fg">{s.report}</a>
        </span>
      ))}
      {" "}via data.gov.in
    </div>
  );
}

export const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-IN"));
