"use client";

import clsx from "clsx";
import { Activity, FileAudio2, LayoutGrid, Network, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Health } from "@/lib/types";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#F26B1D" />
      <circle cx="14" cy="14" r="7.2" fill="none" stroke="#0A0F1C" strokeWidth="2.6" />
      <path d="M19.4 19.4 25 25" stroke="#0A0F1C" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M9.8 14h1.6l1.1-2.6 1.9 5.2 1.4-3.6.8 1h1.6" fill="none" stroke="#0A0F1C" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Command", icon: LayoutGrid },
  { href: "/intake", label: "New intake", icon: FileAudio2 },
  { href: "/rings", label: "Ring Linker", icon: Network },
  { href: "/audit", label: "Audit trail", icon: ShieldCheck },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = () => api.get<Health>("/api/health").then((h) => { if (alive) { setHealth(h); setDown(false); } })
      .catch(() => alive && setDown(true));
    tick();
    const t = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const asr = health?.models.find((m) => m.name === "asr");
  const emo = health?.models.find((m) => m.name === "voice_emotion");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col bg-ink-900 px-4 py-5 text-white lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <Logo />
          <div className="leading-none">
            <div className="font-display text-[19px] font-bold tracking-tight">ANVESH</div>
            <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">Call intelligence</div>
          </div>
        </Link>
        <nav className="mt-9 space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" || path.startsWith("/cases") : path.startsWith(href);
            return (
              <Link key={href} href={href}
                className={clsx("group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition",
                  active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white")}>
                <Icon size={17} className={clsx(active ? "text-brand" : "text-white/40 group-hover:text-white/70")} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
              <Activity size={13} /> Pipeline
            </div>
            <ModelRow label="Speech-to-text" on={!!asr?.loaded} known={!!health} down={down} />
            <ModelRow label="Voice emotion" on={!!emo?.loaded} known={!!health} down={down} />
            <p className="mt-2 text-[10.5px] leading-snug text-white/35">Models load on first use. Missing models are reported, never simulated.</p>
          </div>
          <p className="px-2 text-[10.5px] leading-snug text-white/30">
            Decision support only. Anvesh never determines guilt, honesty or credibility.
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {down && (
          <div className="bg-signal-crit px-6 py-2 text-center text-[12.5px] font-medium text-white">
            Backend not reachable at the configured API URL. Start it with <span className="mono">uvicorn anvesh.api:app</span>.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function ModelRow({ label, on, known, down }: { label: string; on: boolean; known: boolean; down: boolean }) {
  const state = down ? "offline" : !known ? "…" : on ? "loaded" : "on demand";
  return (
    <div className="mt-2 flex items-center justify-between text-[12px]">
      <span className="text-white/70">{label}</span>
      <span className={clsx("flex items-center gap-1.5", on ? "text-emerald-400" : down ? "text-red-400" : "text-white/40")}>
        <span className={clsx("h-1.5 w-1.5 rounded-full", on ? "bg-emerald-400" : down ? "bg-red-400" : "bg-white/30")} />
        {state}
      </span>
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-8 pb-6 pt-8">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="h-display mt-1 text-[30px] leading-tight">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-[14px] text-ink-400">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
