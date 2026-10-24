"use client";

import clsx from "clsx";
import { ArrowRight, Check, FileAudio, Mic, PhoneIncoming, ShieldQuestion, Upload, UserRoundSearch, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/Shell";
import { ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import type { CaseDetail, Mode } from "@/lib/types";

const MODES: { key: Mode; title: string; icon: React.ReactNode; channel: string; runs: string[]; never: string[] }[] = [
  { key: "victim", title: "Victim report", icon: <PhoneIncoming size={20} />, channel: "helpline",
    runs: ["Financial detail extraction with evidence", "Golden-hour triage", "Interview co-pilot", "Distress + coercion assist"],
    never: ["Scam-cue scoring of the victim's own words"] },
  { key: "suspect_recording", title: "Suspected scam recording", icon: <ShieldQuestion size={20} />, channel: "upload",
    runs: ["Scam-tactic tagging", "Identifier extraction", "Ring Linker incl. caller-voice leads"],
    never: ["Emotion or voice-stress scoring of the suspect", "Any judgement of guilt"] },
  { key: "informant", title: "Informant tip", icon: <UserRoundSearch size={20} />, channel: "informant_line",
    runs: ["Lead extraction", "Ring Linker", "Safety and confidentiality prompts"],
    never: ["Emotion as a sign of credibility"] },
];

export default function Intake() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("victim");
  const [caller, setCaller] = useState("");
  const [district, setDistrict] = useState("");
  const [start, setStart] = useState<"live" | "upload" | "text">("live");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = MODES.find((x) => x.key === mode)!;

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const c = await api.post<CaseDetail>("/api/cases", {
        mode, channel: m.channel, caller_label: caller.trim() || (mode === "suspect_recording" ? "Recording shared by victim" : "Unnamed caller"),
        district: district.trim() || null,
      });
      router.push(`/cases/${c.id}?start=${start}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="pb-16">
      <PageHeader eyebrow="New intake" title="Who is on the line?"
        sub="The operator confirms the mode. It decides which analysis runs, and which is switched off by policy." />
      <div className="grid gap-6 px-8 xl:grid-cols-[1fr_400px]">
        <div className="grid gap-4 md:grid-cols-3">
          {MODES.map((x) => (
            <button key={x.key} onClick={() => { setMode(x.key); setStart(x.key === "suspect_recording" ? "upload" : "live"); }}
              className={clsx("card relative flex flex-col p-5 text-left transition hover:shadow-lift",
                mode === x.key ? "ring-2 ring-ink-900" : "hover:-translate-y-0.5")}>
              <span className={clsx("grid h-10 w-10 place-items-center rounded-xl", mode === x.key ? "bg-brand text-white" : "bg-canvas text-ink-800")}>{x.icon}</span>
              <span className="mt-4 font-display text-[17px] font-semibold">{x.title}</span>
              <span className="mt-3 eyebrow">Runs</span>
              <ul className="mt-1.5 space-y-1.5">
                {x.runs.map((r) => <li key={r} className="flex gap-2 text-[12.5px] text-ink-800"><Check size={14} className="mt-0.5 shrink-0 text-signal-ok" />{r}</li>)}
              </ul>
              <span className="mt-4 eyebrow">Never runs</span>
              <ul className="mt-1.5 space-y-1.5">
                {x.never.map((r) => <li key={r} className="flex gap-2 text-[12.5px] text-ink-400"><X size={14} className="mt-0.5 shrink-0 text-signal-crit" />{r}</li>)}
              </ul>
              {mode === x.key && <span className="absolute right-4 top-4 grid h-6 w-6 place-items-center rounded-full bg-ink-900 text-white"><Check size={14} /></span>}
            </button>
          ))}
        </div>

        <div className="card p-6">
          <h2 className="font-display text-[17px] font-semibold">{m.title}</h2>
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-[12.5px] font-semibold text-ink-800">{mode === "suspect_recording" ? "Source" : "Caller reference"}</span>
              <input className="input mt-1.5" value={caller} onChange={(e) => setCaller(e.target.value)}
                placeholder={mode === "suspect_recording" ? "e.g. Recording shared by complainant" : "Name or reference (optional)"} />
            </label>
            <label className="block">
              <span className="text-[12.5px] font-semibold text-ink-800">District</span>
              <input className="input mt-1.5" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="e.g. Pune" />
            </label>
            <div>
              <span className="text-[12.5px] font-semibold text-ink-800">Start with</span>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {([["live", "Live mic", <Mic key="m" size={16} />], ["upload", "Recording", <Upload key="u" size={16} />], ["text", "Transcript", <FileAudio key="t" size={16} />]] as const).map(([k, l, i]) => (
                  <button key={k} onClick={() => setStart(k)}
                    className={clsx("flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[12px] font-semibold transition",
                      start === k ? "border-ink-900 bg-ink-900 text-white" : "border-line bg-white text-ink-800 hover:bg-canvas")}>{i}{l}</button>
                ))}
              </div>
            </div>
            {err && <ErrorNote msg={err} />}
            <button onClick={go} disabled={busy} className="btn-primary w-full py-3 text-[14px]">
              {busy ? "Opening case…" : <>Open case file <ArrowRight size={16} /></>}
            </button>
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              Opening a case starts the intake timer and writes a tamper-evident audit event. Recordings are hashed (SHA-256) and encrypted at rest.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
