"use client";

import clsx from "clsx";
import { BarChart3, FilePlus2, Inbox, ScrollText, Share2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Health } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

export function Logo({ height = 22 }: { height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/anvesh-wordmark.png" alt="Anvesh" style={{ height }} className="w-auto select-none" draggable={false} />;
}

const NAV = [
  { href: "/", label: "Case queue", icon: Inbox, match: (p: string) => p === "/" || p.startsWith("/cases") },
  { href: "/intake", label: "New intake", icon: FilePlus2, match: (p: string) => p.startsWith("/intake") },
  { href: "/rings", label: "Linked cases", icon: Share2, match: (p: string) => p.startsWith("/rings") },
  { href: "/insights", label: "National data", icon: BarChart3, match: (p: string) => p.startsWith("/insights") },
  { href: "/audit", label: "Audit log", icon: ScrollText, match: (p: string) => p.startsWith("/audit") },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  const [ws, setWs] = useWorkspace();

  useEffect(() => {
    let alive = true;
    const tick = () => api.get<Health>("/api/health").then((h) => { if (alive) { setHealth(h); setDown(false); } })
      .catch(() => alive && setDown(true));
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const models = health?.models || [];
  const m = (n: string) => models.find((x) => x.name === n);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[216px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Link href="/" className="flex h-14 items-center border-b border-line px-4" aria-label="Anvesh home">
          <Logo height={21} />
        </Link>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ href, label, icon: Icon, match }) => (
            <Link key={href} href={href}
              className={clsx("relative flex h-8 items-center gap-2.5 rounded px-2.5 text-[13px] font-medium",
                match(path) ? "bg-brand-soft text-fg" : "text-fg-2 hover:bg-bg hover:text-fg")}>
              {match(path) && <span className="absolute -left-2 top-1.5 h-5 w-[3px] rounded-r bg-brand" />}
              <Icon size={15} strokeWidth={1.8} className={match(path) ? "text-brand-700" : "text-fg-3"} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4 pb-3">
          <div className="mb-1.5 text-xs2 font-medium text-fg-3">Workspace</div>
          <div className="grid grid-cols-2 rounded border border-line2 p-0.5 text-xs2 font-medium">
            {(["live", "training"] as const).map((w) => (
              <button key={w} onClick={() => setWs(w)}
                className={clsx("rounded-[4px] py-1", ws === w ? (w === "live" ? "bg-brand text-white" : "bg-warn-soft text-warn") : "text-fg-3 hover:text-fg")}>
                {w === "live" ? "Live cases" : "Training"}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-line p-4 text-xs2">
          <div className="mb-2 font-medium text-fg-3">System</div>
          <Status label="API" state={down ? "off" : health ? "on" : "wait"} text={down ? "Unreachable" : health ? "Online" : "…"} />
          <ModelStatus label="Speech-to-text (live)" m={m("asr")} down={down} />
          <ModelStatus label="Speech-to-text (accurate)" m={m("asr_final")} down={down} />
          <ModelStatus label="Voice emotion" m={m("voice_emotion")} down={down} />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {down && (
          <div className="border-b border-crit-line bg-crit-soft px-6 py-2 text-[13px] text-crit">
            Cannot reach the Anvesh API. Start the backend (start.bat) and reload.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

const STATE_TEXT: Record<string, string> = { ready: "Ready", loading: "Loading…", idle: "Not loaded", error: "Error", disabled: "Off" };

function ModelStatus({ label, m, down }: { label: string; m?: Health["models"][number]; down: boolean }) {
  const st = down ? "off" : m?.state || (m?.loaded ? "ready" : "idle");
  const dot = st === "ready" ? "on" : st === "error" || st === "off" ? "off" : "idle";
  return <span title={m?.error || ""}><Status label={label} state={dot} text={down ? "—" : STATE_TEXT[st] || st} /></span>;
}

function Status({ label, state, text }: { label: string; state: "on" | "off" | "idle" | "wait"; text: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-fg-2">{label}</span>
      <span className="flex items-center gap-1.5 text-fg-3">
        <span className={clsx("h-1.5 w-1.5 rounded-full", { on: "bg-ok", off: "bg-crit", idle: "bg-fg-4", wait: "bg-fg-4" }[state])} />
        {text}
      </span>
    </div>
  );
}

export function TopBar({ title, crumbs, right }: { title: React.ReactNode; crumbs?: { href: string; label: string }[]; right?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line bg-surface/95 px-6 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        {crumbs?.map((c) => (
          <span key={c.href} className="flex items-center gap-2 text-fg-3">
            <Link href={c.href} className="hover:text-fg">{c.label}</Link><span>/</span>
          </span>
        ))}
        <h1 className="truncate text-[15px] font-semibold text-fg">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </div>
  );
}
