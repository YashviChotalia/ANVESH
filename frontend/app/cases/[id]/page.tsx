"use client";

import clsx from "clsx";
import {
  AlertOctagon, Ban, CheckCheck, ChevronRight, ClipboardList, FileText, Fingerprint, HeartPulse, Link2, ListChecks,
  Mic, MicOff, Network, PencilLine, Play, Plus, Send, ShieldAlert, Sparkles, Upload, Volume2, X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Confidence, Empty, ErrorNote, PriorityPill, Section, StatusChip, SyntheticBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { inr, MODE_LABEL, SPEAKER_LABEL, ts } from "@/lib/format";
import { startLive, type LiveHandle } from "@/lib/live";
import type { CaseDetail, CaseField, Evidence, LinkT, SegmentT } from "@/lib/types";

export default function CasePage() {
  return <Suspense fallback={<div className="p-8 text-ink-400">Loading case…</div>}><Workspace /></Suspense>;
}

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ seg: string; s: number; e: number } | null>(null);
  const [report, setReport] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCache = useRef<Record<string, string>>({});

  const load = useCallback(() => api.get<CaseDetail>(`/api/cases/${id}`).then(setC).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (p: Promise<CaseDetail>) => {
    try { setC(await p); setErr(null); } catch (e: any) { setErr(e.message); }
  };

  const playAt = async (ev: Evidence) => {
    setFocus({ seg: ev.segment_id, s: ev.char_start, e: ev.char_end });
    document.getElementById(`seg-${ev.segment_id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const seg = c?.segments.find((s) => s.id === ev.segment_id);
    const recId = seg?.recording_id || c?.recordings.find((r) => r.kind !== "suspect_audio" || c.mode === "suspect_recording")?.id;
    if (!recId || !audioRef.current) return;
    try {
      if (!audioCache.current[recId]) audioCache.current[recId] = await api.audioUrl(recId);
      const a = audioRef.current;
      if (a.src !== audioCache.current[recId]) a.src = audioCache.current[recId];
      a.currentTime = Math.max(ev.t_start - 0.6, 0);
      await a.play();
      const stopAt = ev.t_end + 0.8;
      const h = () => { if (a.currentTime >= stopAt) { a.pause(); a.removeEventListener("timeupdate", h); } };
      a.addEventListener("timeupdate", h);
    } catch (e: any) { setErr(e.message); }
  };

  if (!c) return <div className="p-8">{err ? <ErrorNote msg={err} /> : <div className="h-40 animate-pulse rounded-2xl bg-white" />}</div>;
  const victimLike = c.mode !== "suspect_recording";

  return (
    <div className="pb-16">
      <audio ref={audioRef} className="hidden" />
      <CaseHeader c={c} onComplete={() => run(api.post(`/api/cases/${c.id}/complete`))} onReport={() => setReport(true)} />
      {err && <div className="px-8 pt-4"><ErrorNote msg={err} /></div>}
      <SafetyBanner c={c} onJump={playAt} />
      <div className="grid gap-6 px-8 pt-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_340px]">
        <TranscriptPanel c={c} focus={focus} setC={setC} run={run} autostart={search.get("start")} />
        <div className="space-y-6">
          {victimLike ? <TriageCard c={c} /> : <TacticsPanel c={c} />}
          <FieldsPanel c={c} run={run} onPlay={playAt} />
        </div>
        <div className="space-y-6 xl:col-span-2 2xl:col-span-1">
          {victimLike && <CopilotPanel c={c} run={run} />}
          <LinksPanel c={c} reload={load} />
          <DistressPanel c={c} />
        </div>
      </div>
      {report && <ReportModal id={c.id} onClose={() => setReport(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- header */

function CaseHeader({ c, onComplete, onReport }: { c: CaseDetail; onComplete: () => void; onReport: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [rb, setRb] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = c.intake_seconds ?? Math.max((now - new Date(c.created_at).getTime()) / 1000, 0);

  const readBack = async () => {
    const r = await api.get<{ text: string }>(`/api/cases/${c.id}/readback?lang=hi`);
    setRb(r.text);
    try {
      const u = new SpeechSynthesisUtterance(r.text);
      u.lang = "hi-IN"; u.rate = 0.92;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch {}
  };

  return (
    <div className="grain border-b border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-6 px-8 pb-6 pt-7">
        <div className="min-w-0">
          <Link href="/" className="flex items-center gap-1 text-[12px] font-semibold text-ink-400 hover:text-ink-800">Command <ChevronRight size={13} /> Case</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="mono text-[26px] font-semibold tracking-tight text-ink-900">{c.id}</h1>
            <PriorityPill p={c.priority} size="lg" />
            {c.synthetic && <SyntheticBadge />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-400">
            <span className="font-semibold text-ink-800">{MODE_LABEL[c.mode]}</span>
            <span>{c.caller_label}</span>
            <span>{c.district || "District not set"}</span>
            <span>{c.playbook.label}{c.playbook.confidence ? ` · ${Math.round(c.playbook.confidence * 100)}%` : ""}</span>
            {c.language && <span className="uppercase">{c.language}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={clsx("rounded-2xl px-4 py-2.5 text-right", c.intake_seconds ? "bg-signal-okbg" : "bg-ink-900 text-white")}>
            <div className={clsx("text-[10.5px] font-semibold uppercase tracking-wider", c.intake_seconds ? "text-signal-ok" : "text-white/50")}>
              {c.intake_seconds ? "Case file ready in" : "Intake time"}
            </div>
            <div className="font-display text-[22px] font-bold tabular-nums leading-tight">{ts(elapsed)}</div>
          </div>
          {c.mode !== "suspect_recording" && <button onClick={readBack} className="btn-ghost"><Volume2 size={16} /> Read back</button>}
          <button onClick={onReport} className="btn-ghost"><FileText size={16} /> Complaint draft</button>
          {!c.intake_seconds && <button onClick={onComplete} className="btn-brand"><CheckCheck size={16} /> Complete intake</button>}
        </div>
      </div>
      {rb && (
        <div className="mx-8 mb-5 flex items-start gap-3 rounded-xl bg-ink-900 px-4 py-3 text-white animate-fadein">
          <Volume2 size={16} className="mt-0.5 shrink-0 text-brand" />
          <div className="flex-1 text-[13.5px]"><span className="eyebrow mr-2 text-white/50">Read-back to caller</span>{rb}</div>
          <button onClick={() => setRb(null)} className="text-white/50 hover:text-white"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

function SafetyBanner({ c, onJump }: { c: CaseDetail; onJump: (e: Evidence) => void }) {
  const s = c.safety || ({} as CaseDetail["safety"]);
  if (!s.crisis && !s.coercion) return null;
  const hit = (s.crisis_hits?.[0] || s.coercion_hits?.[0]);
  return (
    <div className="px-8 pt-6">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-signal-crit px-5 py-4 text-white shadow-lift">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 animate-pulsering">
          {s.crisis ? <HeartPulse size={22} /> : <ShieldAlert size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-bold">{s.crisis ? "Human safety first: crisis language" : "Possible active coercion"}</div>
          <div className="text-[13px] text-white/90">{s.crisis ? s.crisis_message : s.coercion_message}</div>
        </div>
        {hit && (
          <button onClick={() => onJump({ segment_id: hit.segment_id, t_start: hit.t_start, t_end: hit.t_end, char_start: 0, char_end: 0, quote: hit.quote })}
            className="btn bg-white/15 text-white hover:bg-white/25">“{hit.quote}” <span className="mono opacity-70">{ts(hit.t_start)}</span></button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- transcript */

function TranscriptPanel({ c, focus, setC, run, autostart }: {
  c: CaseDetail; focus: { seg: string; s: number; e: number } | null; setC: (c: CaseDetail) => void;
  run: (p: Promise<CaseDetail>) => void; autostart: string | null;
}) {
  const [live, setLive] = useState<LiveHandle | null>(null);
  const [level, setLevel] = useState(0);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [speaker, setSpeaker] = useState(c.mode === "suspect_recording" ? "suspect" : "caller");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const marks = useMemo(() => {
    const m: Record<string, { s: number; e: number; label: string }[]> = {};
    c.fields.forEach((f) => f.evidence.forEach((ev) => (m[ev.segment_id] ||= []).push({ s: ev.char_start, e: ev.char_end, label: f.label })));
    return m;
  }, [c.fields]);

  const toggleLive = async () => {
    if (live) { live.stop(); setLive(null); setLevel(0); return; }
    setLiveErr(null);
    try {
      const h = await startLive(api.wsUrl(c.id), (msg) => {
        if (msg.type === "update") setC(msg.case);
        if (msg.type === "error") { setLiveErr(msg.message); }
      }, (p) => setLevel(p), (e) => setLiveErr(e));
      setLive(h);
    } catch (e: any) { setLiveErr(e?.message || "Microphone permission denied"); }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (autostart === "upload") setTimeout(() => fileRef.current?.click(), 300);
  }, [autostart]);
  useEffect(() => () => live?.stop(), [live]);
  useEffect(() => { if (live) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [c.segments.length, live]);

  const add = async () => {
    if (!text.trim()) return;
    const last = c.segments.at(-1)?.end ?? 0;
    const dur = Math.max(2, text.length / 14);
    await run(api.post(`/api/cases/${c.id}/segments`, { segments: [{ start: last + 0.3, end: last + 0.3 + dur, text: text.trim(), speaker }] }));
    setText("");
  };

  const upload = async (f: File) => {
    setUploading(true);
    await run(api.upload(`/api/cases/${c.id}/recordings`, f, c.mode === "suspect_recording" ? "suspect_audio" : "call"));
    setUploading(false);
  };

  const relabel = (s: SegmentT) => {
    const order = c.mode === "suspect_recording" ? ["suspect", "caller", "unknown"] : c.mode === "informant" ? ["informant", "officer", "unknown"] : ["caller", "officer", "unknown"];
    const next = order[(order.indexOf(s.speaker || "unknown") + 1) % order.length];
    run(api.patch(`/api/cases/${c.id}/segments/${s.id}`, { speaker: next }));
  };

  return (
    <section className="card flex max-h-[calc(100vh-120px)] min-h-[560px] flex-col overflow-hidden xl:sticky xl:top-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h3 className="font-display text-[14px] font-semibold">Call transcript</h3>
          <p className="text-[11.5px] text-ink-400">Highlighted words are the evidence behind each case field. Click a speaker to relabel.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading || !!live} className="btn-ghost btn-sm"><Upload size={14} /> {uploading ? "Transcribing…" : "Upload audio"}</button>
          <button onClick={toggleLive} className={clsx("btn btn-sm", live ? "bg-signal-crit text-white hover:bg-signal-crit/90" : "bg-ink-900 text-white hover:bg-ink-700")}>
            {live ? <><MicOff size={14} /> Stop</> : <><Mic size={14} /> Go live</>}
          </button>
        </div>
      </header>
      {live && (
        <div className="flex items-center gap-3 border-b border-line bg-signal-critbg/60 px-5 py-2 text-[12px] font-semibold text-signal-crit">
          <span className="h-2 w-2 animate-pulse rounded-full bg-signal-crit" /> Live · transcribing in ~5 s chunks
          <span className="ml-auto flex h-3 items-end gap-0.5">
            {Array.from({ length: 16 }).map((_, i) => (
              <span key={i} className="w-1 rounded-sm bg-signal-crit transition-all" style={{ height: `${Math.max(15, Math.min(100, level * 260 - i * 6))}%`, opacity: level * 16 > i ? 1 : 0.2 }} />
            ))}
          </span>
        </div>
      )}
      {liveErr && <div className="px-5 pt-3"><ErrorNote msg={liveErr} /></div>}
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {c.segments.length === 0 && <Empty title="Waiting for the caller" body="Go live, upload a recording, or type what the caller says below." />}
        {c.segments.map((s) => (
          <div key={s.id} id={`seg-${s.id}`} className={clsx("group flex gap-3 rounded-xl px-2 py-1.5 transition animate-fadein", focus?.seg === s.id && "bg-brand-50")}>
            <div className="w-[72px] shrink-0 pt-0.5">
              <button onClick={() => relabel(s)} title="Click to relabel speaker"
                className={clsx("chip w-full justify-center", s.speaker === "officer" ? "bg-ink-900 text-white" : s.speaker === "suspect" ? "bg-signal-critbg text-signal-crit" : "bg-canvas text-ink-800 ring-1 ring-inset ring-line")}>
                {SPEAKER_LABEL[s.speaker || "unknown"] || s.speaker}
              </button>
              <div className="mono mt-1 text-center text-[10.5px] text-ink-400">{ts(s.start)}</div>
            </div>
            <p className={clsx("flex-1 text-[14px] leading-relaxed", s.speaker === "officer" ? "text-ink-400" : "text-ink-900")}>
              <Highlighted text={s.text} marks={marks[s.id] || []} focus={focus?.seg === s.id ? focus : null} />
              {s.low_confidence && <span className="ml-2 chip bg-signal-highbg text-signal-high">low ASR confidence</span>}
            </p>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <footer className="border-t border-line bg-canvas/60 p-3">
        <div className="flex gap-2">
          <select value={speaker} onChange={(e) => setSpeaker(e.target.value)} className="rounded-xl border border-line bg-white px-2 text-[12.5px] font-semibold">
            {(c.mode === "suspect_recording" ? ["suspect", "caller"] : c.mode === "informant" ? ["informant", "officer"] : ["caller", "officer"]).map((k) => <option key={k} value={k}>{SPEAKER_LABEL[k]}</option>)}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
            className="input py-2" placeholder="Type a line (Hinglish is fine): “saadhe paanch hazaar kat gaye…”" />
          <button onClick={add} className="btn-primary px-3"><Send size={15} /></button>
        </div>
      </footer>
    </section>
  );
}

function Highlighted({ text, marks, focus }: { text: string; marks: { s: number; e: number; label: string }[]; focus: { s: number; e: number } | null }) {
  const sorted = [...marks].sort((a, b) => a.s - b.s).filter((m, i, arr) => i === 0 || m.s >= arr[i - 1].e);
  const out: React.ReactNode[] = [];
  let pos = 0;
  sorted.forEach((m, i) => {
    if (m.s > pos) out.push(text.slice(pos, m.s));
    const isFocus = focus && focus.s === m.s;
    out.push(
      <mark key={i} title={m.label} className={clsx("rounded px-0.5 font-semibold transition", isFocus ? "bg-brand text-white" : "bg-brand-100 text-ink-900")}>{text.slice(m.s, m.e)}</mark>,
    );
    pos = m.e;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}

/* ---------------------------------------------------------------- triage + fields */

function TriageCard({ c }: { c: CaseDetail }) {
  const t = c.triage;
  if (!t) return null;
  const f = Object.fromEntries(c.fields.map((x) => [x.name, x]));
  const tone = { IMMEDIATE: "from-signal-crit to-[#B42318]", HIGH: "from-signal-high to-[#B54708]", STANDARD: "from-ink-800 to-ink-900" }[t.priority];
  return (
    <section className={clsx("overflow-hidden rounded-2xl bg-gradient-to-br text-white shadow-lift", tone)}>
      <div className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">{t.headline}</span>
          <span className="chip bg-white/15 text-white">{t.priority === "IMMEDIATE" ? "Immediate review" : t.priority === "HIGH" ? "High priority" : "Standard"}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] text-white/70">Reported financial loss</div>
            <div className="font-display text-[30px] font-bold leading-tight tabular-nums">{f.amount_lost ? inr(Number(f.amount_lost.value)) : "—"}</div>
          </div>
          <div>
            <div className="text-[11px] text-white/70">Reported incident time</div>
            <div className="font-display text-[17px] font-semibold leading-snug">{f.incident_time ? f.incident_time.display : "Not captured"}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 text-[12.5px]">
          <div><div className="text-white/70">Evidence status</div><div className="font-semibold">{t.evidence_status}</div></div>
          <div><div className="text-white/70">Missing</div><div className="font-semibold">{t.missing.length ? t.missing.map((m) => LABELS[m] || m).join(", ") : "Nothing critical"}</div></div>
        </div>
      </div>
      <div className="border-t border-white/15 bg-black/15 px-5 py-3.5 text-[12.5px]">
        <div className="text-white/70">Suggested next action</div>
        <div className="mt-0.5 font-medium">{t.next_action}</div>
        {t.human_safety.length > 0 && <div className="mt-2 font-semibold">⚑ {t.human_safety.join(" · ")}</div>}
        <ul className="mt-2 space-y-0.5 text-white/75">{t.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
        <p className="mt-2 text-[11px] text-white/55">Priority is computed from reported facts with transparent rules. It does not predict whether money can be recovered.</p>
      </div>
    </section>
  );
}

const LABELS: Record<string, string> = { amount_lost: "Reported loss", incident_time: "Incident time", upi_id: "Recipient UPI ID", bank: "Debited bank", phone_number: "Caller number", claimed_agency: "Claimed agency", platform: "Platform / app" };
const ADDABLE = ["amount_lost", "incident_time", "upi_id", "bank", "phone_number", "transaction_id", "account_number", "ifsc", "payment_app", "claimed_agency", "platform"];

function FieldsPanel({ c, run, onPlay }: { c: CaseDetail; run: (p: Promise<CaseDetail>) => void; onPlay: (e: Evidence) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const missing = c.triage?.missing || [];
  const act = (f: string, action: string, value?: string) => run(api.patch(`/api/cases/${c.id}/fields/${f}`, { action, value }));
  const allVerified = c.fields.length > 0 && c.fields.every((f) => ["verified", "corrected"].includes(f.status));

  return (
    <Section title="Case file" icon={<ClipboardList size={16} className="text-brand" />}
      action={<div className="flex gap-2">
        <button onClick={() => setAdding((x) => !x)} className="btn-ghost btn-sm"><Plus size={13} /> Add</button>
        {!allVerified && c.fields.length > 0 && <button onClick={() => c.fields.filter((f) => f.status === "predicted" || f.status === "reported").forEach((f) => act(f.name, "verify"))} className="btn-ghost btn-sm"><CheckCheck size={13} /> Verify all</button>}
      </div>}>
      {adding && <AddField onAdd={(n, v) => { act(n, "correct", v); setAdding(false); }} />}
      {c.fields.length === 0 && missing.length === 0 && <Empty title="No details yet" body="Fields fill in automatically as the caller speaks." />}
      <ul className="divide-y divide-line">
        {c.fields.map((f) => (
          <li key={f.name} className="py-3 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-400">{f.label}</div>
                {editing === f.name ? (
                  <div className="mt-1 flex gap-2">
                    <input autoFocus className="input py-1.5" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { act(f.name, "correct", val); setEditing(null); } }} />
                    <button className="btn-primary btn-sm" onClick={() => { act(f.name, "correct", val); setEditing(null); }}>Save</button>
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className={clsx("mt-0.5 break-words font-display text-[17px] font-semibold", ["upi_id", "phone_number", "account_number", "ifsc", "transaction_id"].includes(f.name) && "mono text-[15px]")}>{f.display}</div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusChip s={f.status} />
                  {f.status === "predicted" && <Confidence v={f.confidence} />}
                  {f.evidence.slice(0, 3).map((ev, i) => (
                    <button key={i} onClick={() => onPlay(ev)} className="inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink-800 hover:bg-brand-50 hover:text-brand-700" title={`“${ev.quote}”`}>
                      <Play size={10} /> {ts(ev.t_start)} “{ev.quote.length > 26 ? ev.quote.slice(0, 26) + "…" : ev.quote}”
                    </button>
                  ))}
                </div>
                {f.note && <p className="mt-1.5 text-[12px] text-signal-high">{f.note}</p>}
              </div>
              {editing !== f.name && (
                <div className="flex shrink-0 gap-1 opacity-70 transition hover:opacity-100">
                  {f.status !== "verified" && <IconBtn title="Verify" onClick={() => act(f.name, "verify")}><CheckCheck size={15} /></IconBtn>}
                  <IconBtn title="Correct" onClick={() => { setEditing(f.name); setVal(f.value); }}><PencilLine size={15} /></IconBtn>
                  <IconBtn title="Reject" onClick={() => act(f.name, "reject")}><Ban size={15} /></IconBtn>
                </div>
              )}
            </div>
          </li>
        ))}
        {missing.filter((m) => !c.fields.some((f) => f.name === m)).map((m) => (
          <li key={m} className="flex items-center justify-between py-3">
            <div>
              <div className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-400">{LABELS[m] || m}</div>
              <StatusChip s="missing" />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AddField({ onAdd }: { onAdd: (name: string, v: string) => void }) {
  const [n, setN] = useState("upi_id");
  const [v, setV] = useState("");
  return (
    <div className="mb-4 flex gap-2 rounded-xl bg-canvas p-2">
      <select value={n} onChange={(e) => setN(e.target.value)} className="rounded-lg border border-line bg-white px-2 text-[12.5px]">
        {ADDABLE.map((k) => <option key={k} value={k}>{LABELS[k] || k.replace("_", " ")}</option>)}
      </select>
      <input className="input py-1.5" value={v} onChange={(e) => setV(e.target.value)} placeholder="Value from the caller" />
      <button className="btn-primary btn-sm" onClick={() => v.trim() && onAdd(n, v.trim())}>Add</button>
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return <button title={title} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-800 hover:border-ink-900">{children}</button>;
}

/* ---------------------------------------------------------------- right rail */

function CopilotPanel({ c, run }: { c: CaseDetail; run: (p: Promise<CaseDetail>) => void }) {
  return (
    <Section title="Interview co-pilot" icon={<Sparkles size={16} className="text-brand" />}
      action={<span className="text-[11.5px] text-ink-400">{c.playbook.label}</span>}>
      {c.copilot.length === 0 ? <Empty title="All key questions covered" /> : (
        <ol className="space-y-2.5">
          {c.copilot.slice(0, 5).map((p, i) => (
            <li key={p.key} className={clsx("flex items-start gap-3 rounded-xl p-3", i === 0 ? "bg-ink-900 text-white" : "bg-canvas")}>
              <span className={clsx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold", i === 0 ? "bg-brand text-white" : "bg-white text-ink-800")}>{i + 1}</span>
              <div className="flex-1">
                <p className="text-[13px] font-medium leading-snug">{p.question}</p>
                <span className={clsx("text-[10.5px] font-semibold uppercase tracking-wider", i === 0 ? "text-white/50" : "text-ink-400")}>{p.kind === "missing_field" ? "Missing detail" : "Playbook"}</span>
              </div>
              <button onClick={() => run(api.post(`/api/cases/${c.id}/copilot/${p.key}/asked`))} title="Mark as asked"
                className={clsx("rounded-lg px-2 py-1 text-[11px] font-semibold", i === 0 ? "bg-white/10 hover:bg-white/20" : "bg-white hover:bg-line")}>Asked</button>
            </li>
          ))}
        </ol>
      )}
      {c.safety?.playbook_advice && <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-2 text-[12px] text-ink-800"><b>Advice for the caller:</b> {c.safety.playbook_advice}</p>}
    </Section>
  );
}

function LinksPanel({ c, reload }: { c: CaseDetail; reload: () => void }) {
  const reviewAll = async (ls: LinkT[], status: string) => {
    await Promise.all(ls.map((l) => api.patch(`/api/links/${l.id}`, { status })));
    reload();
  };
  const groups = Object.values(c.links.reduce<Record<string, { other: LinkT["other"]; links: LinkT[] }>>((acc, l) => {
    (acc[l.other.id] ||= { other: l.other, links: [] }).links.push(l);
    return acc;
  }, {}));
  const distinct = new Set(c.links.map((l) => l.other.id));
  const total = [...distinct].reduce((s, id) => s + (c.links.find((l) => l.other.id === id)?.other.amount || 0), 0) + (c.amount || 0);
  const icon = { identifier: <Fingerprint size={14} />, script: <ListChecks size={14} />, voice: <Mic size={14} /> };
  return (
    <Section title="Ring Linker" icon={<Network size={16} className="text-signal-info" />}
      action={distinct.size > 0 ? <Link href="/rings" className="text-[12px] font-semibold text-signal-info hover:underline">View graph</Link> : undefined}>
      {c.links.length === 0 ? <Empty title="No linked complaints yet" body="Anvesh checks every UPI ID, phone, account, script and suspect voice against earlier cases." /> : (
        <>
          <div className="mb-4 rounded-xl bg-signal-infobg p-3.5">
            <div className="font-display text-[15px] font-bold text-ink-900">Linked to {distinct.size} other complaint{distinct.size > 1 ? "s" : ""}</div>
            <div className="text-[12.5px] text-ink-800">{inr(total)} reported across this ring · {[...new Set(c.links.map((l) => l.other.district).filter(Boolean))].join(", ")}</div>
          </div>
          <ul className="space-y-2.5">
            {groups.map(({ other, links }) => {
              const confirmed = links.every((l) => l.status === "confirmed");
              return (
                <li key={other.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/cases/${other.id}`} className="mono font-semibold hover:text-brand-700">{other.id}</Link>
                    <span className="flex flex-wrap justify-end gap-1">
                      {links.map((l) => (
                        <span key={l.id} className={clsx("chip", l.kind === "identifier" ? "bg-ink-900 text-white" : l.kind === "voice" ? "bg-signal-highbg text-signal-high" : "bg-signal-infobg text-signal-info")}>
                          {icon[l.kind]} {l.kind === "identifier" ? "Identifier" : l.kind === "voice" ? "Voice lead" : "Script"}
                        </span>
                      ))}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-ink-800">{links.map((l) => <li key={l.id}>{l.detail.reason}</li>)}</ul>
                  <div className="mt-2 flex items-center justify-between text-[11.5px] text-ink-400">
                    <span>{MODE_LABEL[other.mode] || ""} · {other.district || "—"} · {inr(other.amount)}</span>
                    {confirmed ? <span className="chip bg-signal-okbg text-signal-ok">Confirmed</span> : (
                      <span className="flex gap-1.5">
                        <button onClick={() => reviewAll(links, "confirmed")} className="rounded-md bg-ink-900 px-2 py-0.5 font-semibold text-white">Confirm</button>
                        <button onClick={() => reviewAll(links, "rejected")} className="rounded-md border border-line px-2 py-0.5 font-semibold text-ink-800">Reject</button>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] text-ink-400">Links are investigative leads with a score. A human confirms every link before action.</p>
        </>
      )}
    </Section>
  );
}

function DistressPanel({ c }: { c: CaseDetail }) {
  const d = c.distress;
  if (!d) return null;
  if (!d.enabled) {
    return (
      <Section title="Distress track" icon={<HeartPulse size={16} className="text-ink-400" />}>
        <div className="flex items-start gap-3 rounded-xl bg-canvas p-3.5 text-[12.5px] text-ink-800">
          <AlertOctagon size={16} className="mt-0.5 shrink-0" />
          <div><b>Off by policy for this role.</b> {d.reasons[0]} Emotion is never used to judge honesty or guilt.</div>
        </div>
      </Section>
    );
  }
  const tone = { high: "text-signal-crit", elevated: "text-signal-high", low: "text-signal-ok", abstain: "text-ink-400", off: "text-ink-400" }[d.level];
  const pts = d.timeline;
  const W = 300, H = 64;
  const maxT = Math.max(...pts.map((p) => p.t), 1);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${(p.t / maxT) * W},${H - p.score * H}`).join(" ");
  return (
    <Section title="Distress track" icon={<HeartPulse size={16} className="text-signal-crit" />}
      action={<span className={clsx("font-display text-[13px] font-bold uppercase", tone)}>{d.level === "abstain" ? "Abstained" : d.level}</span>}>
      {pts.length > 1 ? (
        <svg viewBox={`0 0 ${W} ${H + 4}`} className="w-full" role="img" aria-label="Distress over the call">
          <line x1="0" x2={W} y1={H - 0.72 * H} y2={H - 0.72 * H} stroke="#D92D20" strokeDasharray="3 3" strokeOpacity=".5" />
          <path d={path} fill="none" stroke="#0A0F1C" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      ) : null}
      <ul className="mt-2 space-y-1 text-[12.5px] text-ink-800">{d.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
      {d.abstain_reasons.length > 0 && (
        <div className="mt-3 rounded-xl bg-canvas p-3 text-[12px] text-ink-800">
          <div className="font-semibold">Why Anvesh is not scoring the voice:</div>
          <ul className="mt-1 space-y-0.5">{d.abstain_reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
        </div>
      )}
      <p className="mt-3 text-[11px] text-ink-400">{d.label} Confidence: {d.confidence}.</p>
    </Section>
  );
}

function TacticsPanel({ c }: { c: CaseDetail }) {
  const items = c.tactics?.items || [];
  return (
    <section className="overflow-hidden rounded-2xl bg-ink-900 text-white shadow-lift">
      <div className="p-5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">Investigative lead · suspected scam recording</span>
        <div className="mt-2 font-display text-[22px] font-bold">{items.length} scam tactic{items.length === 1 ? "" : "s"} flagged</div>
        <div className="mt-4 flex flex-wrap gap-2">
          {items.map((t) => <span key={t.key} className="rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold" title={t.cues.join(", ")}>{t.label}</span>)}
          {items.length === 0 && <span className="text-[13px] text-white/60">No tactics detected yet.</span>}
        </div>
      </div>
      <div className="border-t border-white/10 bg-black/20 px-5 py-3 text-[12px] text-white/70">{c.tactics?.note || "Emotion and voice-stress scoring are switched off for suspects."}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- report */

function ReportModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => { api.get(`/api/cases/${id}/report`).then(setR); }, [id]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-lift print:shadow-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-[18px] font-bold">{r?.title || "Complaint draft"}</h2>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="btn-ghost btn-sm"><FileText size={14} /> Print / PDF</button>
            <button onClick={onClose} className="btn-ghost btn-sm"><X size={14} /></button>
          </div>
        </div>
        {!r ? <div className="p-6 text-ink-400">Preparing draft…</div> : (
          <div className="space-y-5 p-6 text-[13.5px]">
            <p className="rounded-xl bg-signal-highbg px-4 py-2.5 text-[12.5px] text-signal-high">{r.disclaimer}</p>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div><span className="text-ink-400">Mode</span><div className="font-semibold">{MODE_LABEL[r.case.mode]}</div></div>
              <div><span className="text-ink-400">Incident type</span><div className="font-semibold">{r.case.playbook.label}</div></div>
              <div><span className="text-ink-400">Caller</span><div className="font-semibold">{r.case.caller_label}</div></div>
              <div><span className="text-ink-400">District</span><div className="font-semibold">{r.case.district || "—"}</div></div>
            </div>
            <table className="w-full text-left text-[13px]">
              <thead><tr className="text-[11px] uppercase tracking-wider text-ink-400"><th className="py-2">Field</th><th>Value</th><th>Status</th><th>Evidence</th></tr></thead>
              <tbody>
                {r.fields.map((f: CaseField) => (
                  <tr key={f.name} className="border-t border-line align-top">
                    <td className="py-2 font-semibold">{f.label}</td><td className="py-2">{f.display}</td><td className="py-2"><StatusChip s={f.status} /></td>
                    <td className="py-2 text-[12px] text-ink-400">{f.evidence.map((e) => `${ts(e.t_start)} “${e.quote}”`).join("; ") || "Entered by officer"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.links.length > 0 && <div><div className="eyebrow">Linked complaints (leads)</div><ul className="mt-1 list-disc pl-5">{r.links.map((l: LinkT) => <li key={l.id}><span className="mono">{l.other.id}</span>: {l.detail.reason} ({l.status})</li>)}</ul></div>}
            <div className="rounded-xl bg-canvas p-3 text-[12px]">
              <div className="flex items-center gap-2 font-semibold"><Link2 size={14} /> Integrity</div>
              <div className="mt-1">Audit chain: {r.integrity.audit_chain_ok ? "intact" : "BROKEN"} · head <span className="mono">{r.integrity.audit_head?.slice(0, 16)}…</span></div>
              {r.recordings.map((x: any) => <div key={x.id}>Recording {x.filename}: SHA-256 <span className="mono">{x.sha256.slice(0, 24)}…</span></div>)}
              <div>Pipeline: <span className="mono">{r.integrity.pipeline}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
