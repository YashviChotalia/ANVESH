"use client";

import clsx from "clsx";
import { AlertTriangle, Check, FileText, Mic, Pencil, Play, RotateCcw, Send, Square, Upload, Volume2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallAudio, type PlayerHandle } from "@/components/CallAudio";
import { TopBar } from "@/components/Shell";
import { Empty, ErrorNote, KV, n, Panel, PriorityBadge, SourceNote, StatusTag, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { inr, MODE_LABEL, SPEAKER_LABEL, ts } from "@/lib/format";
import { startLive, type LiveHandle } from "@/lib/live";
import type { CaseDetail, CaseField, Evidence, Health, LinkT, SegmentT } from "@/lib/types";

export default function CasePage() {
  return <Suspense fallback={<div className="p-6 text-fg-3">Loading case…</div>}><Workspace /></Suspense>;
}

const LABELS: Record<string, string> = {
  amount_lost: "Reported loss", incident_time: "Incident time", upi_id: "Recipient UPI ID", bank: "Debited bank",
  phone_number: "Caller number", transaction_id: "UTR / transaction ID", account_number: "Account number", ifsc: "IFSC",
  payment_app: "Payment app", claimed_agency: "Claimed agency", platform: "Platform / app", email: "Email",
};
const MONO = new Set(["upi_id", "phone_number", "account_number", "ifsc", "transaction_id", "email"]);

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ seg: string; s: number } | null>(null);
  const [report, setReport] = useState(false);
  const [readback, setReadback] = useState<string | null>(null);
  const player = useRef<PlayerHandle>(null);
  const [toasts, setToasts] = useState<{ id: number; tone: "crit" | "warn" | "accent" | "ok"; title: string; body?: string }[]>([]);
  const prev = useRef<CaseDetail | null>(null);

  const load = useCallback(() => api.get<CaseDetail>(`/api/cases/${id}`).then((x) => { prev.current = x; setC(x); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!c?.processing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [c?.processing, load]);

  const toast = (t: { tone: "crit" | "warn" | "accent" | "ok"; title: string; body?: string }) => {
    const tid = Date.now() + Math.random();
    setToasts((xs) => [...xs.slice(-3), { id: tid, ...t }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== tid)), t.tone === "crit" ? 12000 : 6000);
  };

  /** Live updates: compare with the previous state and raise in-call alerts. */
  const onLive = (next: CaseDetail) => {
    const p = prev.current;
    if (p) {
      if (next.safety?.crisis && !p.safety?.crisis) { toast({ tone: "crit", title: "Crisis language", body: next.safety.crisis_message || "" }); beep(); }
      if (next.safety?.coercion && !p.safety?.coercion) { toast({ tone: "crit", title: "Possible active coercion", body: next.safety.coercion_message || "" }); beep(); }
      if (next.priority === "IMMEDIATE" && p.priority !== "IMMEDIATE") toast({ tone: "crit", title: "Priority raised to Immediate", body: next.triage?.reasons?.[0] });
      const before = new Set(p.links.map((l) => l.other.id));
      const added = [...new Set(next.links.map((l) => l.other.id))].filter((x) => !before.has(x));
      if (added.length) toast({ tone: "accent", title: `Linked to ${added.length} earlier case${added.length > 1 ? "s" : ""}`, body: next.links.find((l) => added.includes(l.other.id))?.detail.reason });
      const had = new Set(p.fields.map((f) => f.name));
      next.fields.filter((f) => !had.has(f.name)).forEach((f) => toast({ tone: "ok", title: `Captured: ${LABELS[f.name] || f.label}`, body: f.display }));
      const pd = p.distress?.level, nd = next.distress?.level;
      if (nd === "high" && pd !== "high") toast({ tone: "warn", title: "Caller distress is high", body: "Consider slowing down and reassuring the caller." });
    }
    prev.current = next;
    setC(next);
  };

  const run = async (pr: Promise<CaseDetail>) => {
    try { const x = await pr; prev.current = x; setC(x); setErr(null); } catch (e: any) { setErr(e.message); }
  };

  const playAt = (ev: { segment_id: string; t_start: number; t_end: number; char_start: number }) => {
    setFocus({ seg: ev.segment_id, s: ev.char_start });
    document.getElementById(`seg-${ev.segment_id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    player.current?.playFrom(ev.t_start, ev.t_end);
  };

  const doReadback = async () => {
    if (!c) return;
    const r = await api.get<{ text: string }>(`/api/cases/${c.id}/readback?lang=hi`);
    setReadback(r.text);
    try { const u = new SpeechSynthesisUtterance(r.text); u.lang = "hi-IN"; u.rate = 0.92; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
  };

  if (!c) return <div className="p-6">{err ? <ErrorNote msg={err} /> : <div className="h-32 animate-pulse rounded-md bg-surface" />}</div>;
  const victimLike = c.mode !== "suspect_recording";

  return (
    <>
      <Toasts items={toasts} onClose={(tid) => setToasts((xs) => xs.filter((x) => x.id !== tid))} />
      <TopBar crumbs={[{ href: "/", label: "Case queue" }]} title={<span className="mono text-[14px]">{c.id}</span>}
        right={<>
          <IntakeTimer c={c} />
          {victimLike && <button onClick={doReadback} className="btn-secondary"><Volume2 size={14} /> Read back</button>}
          <button onClick={() => setReport(true)} className="btn-secondary"><FileText size={14} /> Draft complaint</button>
          {!c.intake_seconds && <button onClick={() => run(api.post(`/api/cases/${c.id}/complete`))} className="btn-primary"><Check size={14} /> Complete intake</button>}
        </>} />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <PriorityBadge p={c.priority} />
          <span className="font-medium">{MODE_LABEL[c.mode]}</span>
          <span className="text-fg-2">{c.caller_label}</span>
          <span className="text-fg-2">{c.district || "District not set"}</span>
          <span className="text-fg-2">{c.playbook.label}</span>
          {c.language && <span className="uppercase text-fg-3">{c.language}</span>}
          {c.synthetic && <Tag title={c.scenario?.note || "Scripted training call"}>Training scenario</Tag>}
        </div>

        {err && <ErrorNote msg={err} />}
        {c.processing && (
          <div className="flex items-center gap-2 rounded border border-accent-line bg-accent-soft px-3 py-2 text-[13px] text-accent">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            {c.processing} The live draft is shown until the refined transcript replaces it.
          </div>
        )}
        <SafetyAlert c={c} onJump={playAt} />
        {readback && (
          <div className="flex items-start gap-3 rounded border border-accent-line bg-accent-soft px-3 py-2 text-[13px]">
            <Volume2 size={15} className="mt-0.5 shrink-0 text-accent" />
            <div className="flex-1"><span className="font-medium">Read back to caller: </span>{readback}</div>
            <button onClick={() => setReadback(null)} className="text-fg-3 hover:text-fg"><X size={15} /></button>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_340px]">
          <Transcript c={c} focus={focus} onLive={onLive} run={run} autostart={search.get("start")} player={player} onPlaySeg={playAt} />
          <div className="space-y-4">
            {victimLike ? <Assessment c={c} /> : <RecordingAnalysis c={c} />}
            <Details c={c} run={run} onPlay={playAt} />
            <OfficialContext c={c} />
          </div>
          <SideTabs c={c} run={run} reload={load} />
        </div>
      </div>
      {report && <ReportModal id={c.id} onClose={() => setReport(false)} />}
    </>
  );
}

function IntakeTimer({ c }: { c: CaseDetail }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = c.intake_seconds ?? Math.max((now - new Date(c.created_at).getTime()) / 1000, 0);
  return (
    <span className="mr-2 text-[13px] text-fg-3">
      {c.intake_seconds ? "Intake completed in " : "Intake "}
      <span className={clsx("mono font-medium", c.intake_seconds ? "text-ok" : "text-fg")}>{ts(sec)}</span>
    </span>
  );
}

function SafetyAlert({ c, onJump }: { c: CaseDetail; onJump: (e: any) => void }) {
  const s = c.safety;
  if (!s || (!s.crisis && !s.coercion)) return null;
  const hit = s.crisis_hits?.[0] || s.coercion_hits?.[0];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-crit-line border-l-4 border-l-crit bg-crit-soft px-4 py-2.5">
      <AlertTriangle size={16} className="shrink-0 text-crit" />
      <div className="min-w-0 flex-1 text-[13px]">
        <span className="font-semibold text-crit">{s.crisis ? "Crisis language detected." : "Possible active coercion."} </span>
        <span className="text-fg">{s.crisis ? s.crisis_message : s.coercion_message}</span>
      </div>
      {hit && (
        <button onClick={() => onJump({ segment_id: hit.segment_id, t_start: hit.t_start, t_end: hit.t_end, char_start: -1 })}
          className="text-[12px] font-medium text-crit underline-offset-2 hover:underline">
          “{hit.quote}” at {ts(hit.t_start)}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ transcript */

function Transcript({ c, focus, onLive, run, autostart, player, onPlaySeg }: {
  c: CaseDetail; focus: { seg: string; s: number } | null; onLive: (c: CaseDetail) => void;
  run: (p: Promise<CaseDetail>) => Promise<void>; autostart: string | null;
  player: React.RefObject<PlayerHandle | null>; onPlaySeg: (e: { segment_id: string; t_start: number; t_end: number; char_start: number }) => void;
}) {
  const [playT, setPlayT] = useState<number | null>(null);
  const [native, setNative] = useState(false);
  const hasNative = c.segments.some((s) => s.text_native && s.text_native !== s.text);
  const [replaying, setReplaying] = useState(false);
  const playingSeg = playT === null ? null : c.segments.find((s) => playT >= s.start - 0.05 && playT <= s.end + 0.05)?.id;
  useEffect(() => { if (playingSeg) document.getElementById(`seg-${playingSeg}`)?.scrollIntoView({ block: "nearest" }); }, [playingSeg]);
  const [live, setLive] = useState<LiveHandle | null>(null);
  const [level, setLevel] = useState(0);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [text, setText] = useState("");
  const speakers = c.mode === "suspect_recording" ? ["suspect", "caller"] : c.mode === "informant" ? ["informant", "officer"] : ["caller", "officer"];
  const [speaker, setSpeaker] = useState(speakers[0]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
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
      setLive(await startLive(api.wsUrl(c.id), (msg) => {
        if (msg.type === "update") onLive(msg.case);
        if (msg.type === "error") setLiveErr(msg.message);
        if (msg.type === "status") setLiveNote(msg.message);
      }, setLevel, setLiveErr));
    } catch (e: any) { setLiveErr(e?.message || "Microphone permission denied"); }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (autostart === "upload") setTimeout(() => fileRef.current?.click(), 300);
  }, [autostart]);
  useEffect(() => () => live?.stop(), [live]);
  useEffect(() => { if (live) endRef.current?.scrollIntoView({ block: "end" }); }, [c.segments.length, live]);

  const add = async () => {
    if (!text.trim()) return;
    const last = c.segments.at(-1)?.end ?? 0;
    await run(api.post(`/api/cases/${c.id}/segments`, { segments: [{ start: last + 0.3, end: last + 0.3 + Math.max(2, text.length / 14), text: text.trim(), speaker }] }));
    setText("");
  };
  const upload = async (f: File) => {
    setUploading(true);
    await run(api.upload(`/api/cases/${c.id}/recordings`, f, c.mode === "suspect_recording" ? "suspect_audio" : "call"));
    setUploading(false);
  };
  const relabel = (s: SegmentT) => {
    const order = [...speakers, "unknown"];
    const next = order[(order.indexOf(s.speaker || "unknown") + 1) % order.length];
    run(api.patch(`/api/cases/${c.id}/segments/${s.id}`, { speaker: next }));
  };

  return (
    <section className="panel flex max-h-[calc(100vh-150px)] min-h-[520px] flex-col xl:sticky xl:top-[72px]">
      <header className="panel-h">
        <h3 className="panel-t">Transcript</h3>
        <div className="flex items-center gap-1.5">
          {hasNative && (
            <button onClick={() => setNative((x) => !x)} className="btn-quiet btn-xs" title="Switch between Roman Hinglish and the original script">
              {native ? "Roman" : "Original script"}
            </button>
          )}
          {!live && c.recordings.length > 0 && !c.processing && (
            <button onClick={() => api.post(`/api/recordings/${c.recordings.at(-1)!.id}/refine`).then(() => run(api.get(`/api/cases/${c.id}`)))}
              className="btn-quiet btn-xs" title="Re-transcribe the recording with the accurate model">Re-transcribe</button>
          )}
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading || !!live} className="btn-secondary btn-xs"><Upload size={13} /> {uploading ? "Transcribing…" : "Upload audio"}</button>
          {live && (
            <button onClick={async () => { setReplaying(true); await live.replay(15); setReplaying(false); }} disabled={replaying}
              className="btn-secondary btn-xs" title="Play back the last 15 seconds of this call"><RotateCcw size={13} /> {replaying ? "Playing…" : "Replay 15 s"}</button>
          )}
          <button onClick={toggleLive} className={clsx("btn btn-xs", live ? "border-crit bg-crit text-white" : "border-brand bg-brand text-white hover:bg-brand-600")}>
            {live ? <><Square size={11} fill="currentColor" /> Stop</> : <><Mic size={13} /> Start live</>}
          </button>
        </div>
      </header>
      {live && (
        <div className="flex items-center gap-2 border-b border-line bg-crit-soft px-4 py-1.5 text-xs2 text-crit">
          <span className="h-1.5 w-1.5 rounded-full bg-crit" /> Recording · transcribed in 5-second segments
          {c.mode !== "suspect_recording" && (() => {
            const last = [...(c.distress?.timeline || [])].reverse().find((p) => p.label);
            return last ? <span className="ml-3 text-fg-2">Voice: <b className="font-medium capitalize text-fg">{last.label}</b> {Math.round((last.p || 0) * 100)}%</span> : null;
          })()}
          <span className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-crit-line"><span className="block h-full bg-crit" style={{ width: `${Math.min(100, level * 300)}%` }} /></span>
        </div>
      )}
      {!live && c.recordings.length > 0 && (
        <CallAudio ref={player} recordings={c.recordings} segments={c.segments} onTime={setPlayT}
          marks={c.fields.flatMap((f) => f.evidence.map((e) => ({ t: e.t_start, label: `${LABELS[f.name] || f.label}: ${f.display}` })))} />
      )}
      {!live && c.recordings.length === 0 && c.segments.length > 0 && (
        <div className="border-b border-line bg-bg px-4 py-2 text-xs2 text-fg-3">No audio for this case (typed transcript). Audio becomes playable after a live call or an upload.</div>
      )}
      {liveErr && <div className="px-4 pt-3"><ErrorNote msg={liveErr} /></div>}
      {live && liveNote && !c.segments.length && <div className="border-b border-line bg-warn-soft px-4 py-1.5 text-xs2 text-warn">{liveNote}</div>}
      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-2">
        {c.segments.length === 0 && <Empty title="No transcript yet" body="Start live capture, upload a recording, or type what the caller says." />}
        {c.segments.map((s) => (
          <div key={s.id} id={`seg-${s.id}`} className={clsx("group grid grid-cols-[84px_1fr] gap-2 rounded px-2 py-1.5",
            playingSeg === s.id ? "bg-[#FEF0C7]/60" : focus?.seg === s.id && "bg-accent-soft")}>
            <div className="pt-px">
              <button onClick={() => relabel(s)} title="Change speaker" className={clsx("text-xs2 font-semibold hover:underline",
                s.speaker === "officer" ? "text-fg-3" : s.speaker === "suspect" ? "text-crit" : "text-fg")}>
                {SPEAKER_LABEL[s.speaker || "unknown"] || s.speaker}
              </button>
              {s.recording_id || c.recordings.length ? (
                <button onClick={() => onPlaySeg({ segment_id: s.id, t_start: s.start, t_end: s.end, char_start: -1 })} title="Play this line"
                  className="mono flex items-center gap-1 text-[11px] text-fg-4 hover:text-accent">
                  <Play size={9} className="opacity-0 group-hover:opacity-100" fill="currentColor" />{ts(s.start)}
                </button>
              ) : <div className="mono text-[11px] text-fg-4">{ts(s.start)}</div>}
            </div>
            <p className={clsx("leading-[1.6]", s.speaker === "officer" ? "text-fg-3" : "text-fg")}>
              {native && s.text_native ? <span title={s.text}>{s.text_native}</span>
                : <span title={s.text_native && s.text_native !== s.text ? s.text_native : undefined}><Highlighted text={s.text} marks={marks[s.id] || []} focusStart={focus?.seg === s.id ? focus.s : null} /></span>}
              {s.low_confidence && <span className="ml-1.5 align-middle"><Tag tone="warn">Low ASR confidence</Tag></span>}
            </p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <footer className="flex gap-2 border-t border-line p-2.5">
        <select value={speaker} onChange={(e) => setSpeaker(e.target.value)} className="input w-[110px] shrink-0">
          {speakers.map((k) => <option key={k} value={k}>{SPEAKER_LABEL[k]}</option>)}
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} className="input" placeholder="Add a transcript line" />
        <button onClick={add} className="btn-secondary shrink-0 px-2.5" title="Add line"><Send size={14} /></button>
      </footer>
    </section>
  );
}

function Highlighted({ text, marks, focusStart }: { text: string; marks: { s: number; e: number; label: string }[]; focusStart: number | null }) {
  const sorted = [...marks].sort((a, b) => a.s - b.s).filter((m, i, arr) => i === 0 || m.s >= arr[i - 1].e);
  const out: React.ReactNode[] = [];
  let pos = 0;
  sorted.forEach((m, i) => {
    if (m.s > pos) out.push(text.slice(pos, m.s));
    out.push(<mark key={i} title={m.label} className={clsx("rounded-[3px] px-0.5 text-fg",
      focusStart === m.s ? "bg-[#FEDF89]" : "bg-[#FEF0C7]")}>{text.slice(m.s, m.e)}</mark>);
    pos = m.e;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}

/* ------------------------------------------------------------------ assessment + details */

function Assessment({ c }: { c: CaseDetail }) {
  const t = c.triage;
  if (!t) return null;
  const f = Object.fromEntries(c.fields.map((x) => [x.name, x]));
  const bar = { IMMEDIATE: "border-l-crit", HIGH: "border-l-warn", STANDARD: "border-l-fg-4" }[t.priority];
  return (
    <section className={clsx("panel border-l-4", bar)}>
      <header className="panel-h">
        <h3 className="panel-t">Assessment</h3>
        <span className="text-xs2 text-fg-3">Rule-based · score {t.score}/100</span>
      </header>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-4">
        <KV k="Priority" v={<PriorityBadge p={t.priority} />} />
        <KV k="Evidence status" v={t.evidence_status} />
        <KV k="Reported loss" v={<span className="text-[18px] font-semibold tabular-nums">{f.amount_lost ? inr(Number(f.amount_lost.value)) : "Not captured"}</span>} />
        <KV k="Incident time" v={f.incident_time ? f.incident_time.display : "Not captured"} />
        <KV className="col-span-2" k="Missing details" v={t.missing.length ? t.missing.map((m) => LABELS[m] || m).join(", ") : "None of the critical fields"} />
        <KV className="col-span-2" k="Recommended action" v={t.next_action} />
      </div>
      {(t.human_safety.length > 0 || t.reasons.length > 0) && (
        <div className="border-t border-line px-4 py-3 text-xs2 text-fg-2">
          <div className="mb-1 font-medium text-fg-3">Basis</div>
          <ul className="space-y-0.5">
            {t.human_safety.map((r) => <li key={r} className="text-crit">{r}</li>)}
            {t.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="mt-2 text-fg-3">Priority reflects reported facts only. It does not estimate whether funds can be recovered.</p>
        </div>
      )}
    </section>
  );
}

function RecordingAnalysis({ c }: { c: CaseDetail }) {
  const items = c.tactics?.items || [];
  return (
    <Panel title="Recording analysis" action={<span className="text-xs2 text-fg-3">Investigative lead</span>} pad={false}>
      {items.length === 0 ? <Empty title="No scam tactics detected yet" /> : (
        <table className="w-full text-[13px]">
          <tbody>
            {items.map((t) => (
              <tr key={t.key}>
                <td className="td pl-4 font-medium">{t.label}</td>
                <td className="td pr-4 text-right"><span className="mono text-[11.5px] text-fg-3">{t.cues.slice(0, 3).join(", ")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="px-4 py-2.5 text-xs2 text-fg-3">Based on the recording's words. Emotion and voice-stress analysis are disabled for suspects. Not a finding of guilt.</p>
    </Panel>
  );
}

const ADDABLE = ["amount_lost", "incident_time", "upi_id", "bank", "phone_number", "transaction_id", "account_number", "ifsc", "payment_app", "claimed_agency", "platform"];

function Details({ c, run, onPlay }: { c: CaseDetail; run: (p: Promise<CaseDetail>) => Promise<void>; onPlay: (e: Evidence) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("upi_id");
  const [newVal, setNewVal] = useState("");
  const act = (f: string, action: string, value?: string) => run(api.patch(`/api/cases/${c.id}/fields/${f}`, { action, value }));
  const pending = c.fields.filter((f) => f.status === "predicted" || f.status === "reported");
  const missing = (c.triage?.missing || []).filter((m) => !c.fields.some((f) => f.name === m));

  return (
    <Panel title="Case details" pad={false}
      action={<div className="flex gap-1.5">
        <button onClick={() => setAdding((x) => !x)} className="btn-quiet btn-xs">Add field</button>
        {pending.length > 0 && <button onClick={() => pending.forEach((f) => act(f.name, "verify"))} className="btn-secondary btn-xs">Verify all ({pending.length})</button>}
      </div>}>
      {adding && (
        <div className="flex gap-2 border-b border-line bg-bg px-4 py-2.5">
          <select value={newName} onChange={(e) => setNewName(e.target.value)} className="input w-44 shrink-0">
            {ADDABLE.map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}
          </select>
          <input className="input" value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder="Value" />
          <button className="btn-primary shrink-0" onClick={() => { if (newVal.trim()) { act(newName, "correct", newVal.trim()); setNewVal(""); setAdding(false); } }}>Add</button>
        </div>
      )}
      {c.fields.length === 0 && missing.length === 0 ? <Empty title="No details captured" body="Fields are filled from the transcript as the caller speaks." /> : (
        <ul className="divide-y divide-line">
          {c.fields.map((f) => (
            <li key={f.name} className="group px-4 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="label">{LABELS[f.name] || f.label}</span>
                    <StatusTag s={f.status} />
                    {f.status === "predicted" && <span className="text-xs2 text-fg-4" title="Model confidence (uncalibrated)">{Math.round(f.confidence * 100)}%</span>}
                  </div>
                  {editing === f.name ? (
                    <div className="mt-1.5 flex gap-2">
                      <input autoFocus className="input" value={val} onChange={(e) => setVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { act(f.name, "correct", val); setEditing(null); } if (e.key === "Escape") setEditing(null); }} />
                      <button className="btn-primary btn-xs" onClick={() => { act(f.name, "correct", val); setEditing(null); }}>Save</button>
                      <button className="btn-quiet btn-xs" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className={clsx("mt-0.5 break-words text-[14px] font-medium", MONO.has(f.name) && "mono text-[13px]")}>{f.display}</div>
                  )}
                  {f.evidence.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {f.evidence.slice(0, 3).map((ev, i) => (
                        <button key={i} onClick={() => onPlay(ev)} title={`Play from ${ts(ev.t_start)}`}
                          className="inline-flex items-center gap-1 text-xs2 text-fg-3 hover:text-accent">
                          <Play size={10} /><span className="mono">{ts(ev.t_start)}</span> “{ev.quote.length > 28 ? ev.quote.slice(0, 28) + "…" : ev.quote}”
                        </button>
                      ))}
                    </div>
                  )}
                  {f.note && <p className="mt-1 text-xs2 text-warn">{f.note}</p>}
                </div>
                {editing !== f.name && (
                  <div className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
                    {f.status !== "verified" && <IconBtn title="Verify" onClick={() => act(f.name, "verify")}><Check size={14} /></IconBtn>}
                    <IconBtn title="Correct" onClick={() => { setEditing(f.name); setVal(f.value); }}><Pencil size={13} /></IconBtn>
                    <IconBtn title="Remove" onClick={() => act(f.name, "reject")}><X size={14} /></IconBtn>
                  </div>
                )}
              </div>
            </li>
          ))}
          {missing.map((m) => (
            <li key={m} className="flex items-center gap-2 px-4 py-2.5">
              <span className="label">{LABELS[m] || m}</span><StatusTag s="missing" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return <button title={title} onClick={onClick} className="grid h-7 w-7 place-items-center rounded text-fg-2 hover:bg-bg hover:text-fg">{children}</button>;
}

/* ------------------------------------------------------------------ side tabs */

function SideTabs({ c, run, reload }: { c: CaseDetail; run: (p: Promise<CaseDetail>) => Promise<void>; reload: () => void }) {
  const victimLike = c.mode !== "suspect_recording";
  const linkedCount = new Set(c.links.map((l) => l.other.id)).size;
  const tabs = [
    ...(victimLike ? [{ k: "questions", label: "Questions", n: c.copilot.length }] : []),
    { k: "linked", label: "Linked cases", n: linkedCount },
    { k: "distress", label: "Distress", n: undefined },
  ];
  const [tab, setTab] = useState(tabs[0].k);
  return (
    <section className="panel h-fit xl:col-span-2 2xl:col-span-1">
      <div className="flex border-b border-line px-2">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={clsx("-mb-px flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium",
            tab === t.k ? "border-brand text-fg" : "border-transparent text-fg-3 hover:text-fg")}>
            {t.label}{t.n !== undefined && t.n > 0 && <span className="rounded bg-bg px-1.5 text-xs2 text-fg-3">{t.n}</span>}
          </button>
        ))}
      </div>
      {tab === "questions" && <Questions c={c} run={run} />}
      {tab === "linked" && <Linked c={c} reload={reload} />}
      {tab === "distress" && <Distress c={c} />}
    </section>
  );
}

function Questions({ c, run }: { c: CaseDetail; run: (p: Promise<CaseDetail>) => Promise<void> }) {
  return (
    <div>
      <div className="px-4 pt-3 text-xs2 text-fg-3">Suggested for: {c.playbook.label}</div>
      {c.copilot.length === 0 ? <Empty title="No open questions" /> : (
        <ol className="divide-y divide-line">
          {c.copilot.slice(0, 6).map((p, i) => (
            <li key={p.key} className="flex items-start gap-3 px-4 py-3">
              <span className="mono mt-px w-4 shrink-0 text-fg-4">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-fg">{p.question}</p>
                <span className="text-xs2 text-fg-3">{p.kind === "missing_field" ? "Missing detail" : "Scam-type follow-up"}</span>
              </div>
              <button onClick={() => run(api.post(`/api/cases/${c.id}/copilot/${p.key}/asked`))} className="btn-quiet btn-xs shrink-0">Mark asked</button>
            </li>
          ))}
        </ol>
      )}
      {c.safety?.playbook_advice && (
        <div className="border-t border-line px-4 py-3 text-xs2">
          <div className="font-medium text-fg-3">Advice to give the caller</div>
          <p className="mt-0.5 text-fg">{c.safety.playbook_advice}</p>
        </div>
      )}
    </div>
  );
}

const KIND_LABEL = { identifier: "Identifier", script: "Script", voice: "Voice lead" } as const;

function Linked({ c, reload }: { c: CaseDetail; reload: () => void }) {
  const groups = Object.values(c.links.reduce<Record<string, { other: LinkT["other"]; links: LinkT[] }>>((acc, l) => {
    (acc[l.other.id] ||= { other: l.other, links: [] }).links.push(l);
    return acc;
  }, {}));
  const reviewAll = async (ls: LinkT[], status: string) => { await Promise.all(ls.map((l) => api.patch(`/api/links/${l.id}`, { status }))); reload(); };
  const total = groups.reduce((s, g) => s + (g.other.amount || 0), 0) + (c.amount || 0);
  if (groups.length === 0) return <Empty title="No linked cases" body="Checked against all earlier cases by UPI ID, phone, account, IFSC, UTR, scam script and suspect voice." />;
  return (
    <div>
      <div className="border-b border-line px-4 py-3">
        <div className="font-medium">{groups.length} linked case{groups.length > 1 ? "s" : ""}</div>
        <div className="text-xs2 text-fg-3">{inr(total)} reported across this group · <Link href="/rings" className="text-accent hover:underline">view graph</Link></div>
      </div>
      <ul className="divide-y divide-line">
        {groups.map(({ other, links }) => {
          const confirmed = links.every((l) => l.status === "confirmed");
          return (
            <li key={other.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/cases/${other.id}`} className="mono font-medium hover:text-accent">{other.id}</Link>
                <span className="flex gap-1">{links.map((l) => <Tag key={l.id} tone={l.kind === "identifier" ? "accent" : l.kind === "voice" ? "warn" : "neutral"}>{KIND_LABEL[l.kind]}</Tag>)}</span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs2 text-fg-2">{links.map((l) => <li key={l.id}>{l.detail.reason}</li>)}</ul>
              <div className="mt-2 flex items-center justify-between text-xs2 text-fg-3">
                <span>{[MODE_LABEL[other.mode], other.district, other.amount ? inr(other.amount) : null].filter(Boolean).join(" · ")}</span>
                {confirmed ? <Tag tone="ok">Confirmed</Tag> : (
                  <span className="flex gap-1">
                    <button onClick={() => reviewAll(links, "confirmed")} className="btn-secondary btn-xs">Confirm</button>
                    <button onClick={() => reviewAll(links, "rejected")} className="btn-quiet btn-xs">Reject</button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-xs2 text-fg-3">Links are leads. Confirm each one before acting on it.</p>
    </div>
  );
}

const EMO_TONE: Record<string, string> = { fearful: "text-crit", sad: "text-warn", angry: "text-warn", disgusted: "text-warn", neutral: "text-fg-2", happy: "text-ok", surprised: "text-fg-2", uncertain: "text-fg-3" };

function Distress({ c }: { c: CaseDetail }) {
  const d = c.distress;
  const [emoState, setEmoState] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => api.get<Health>("/api/health").then((h) => alive && setEmoState(h.models.find((m) => m.name === "voice_emotion")?.state || null)).catch(() => {});
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!d) return null;
  if (!d.enabled) return <div className="p-4 text-[13px] text-fg-2">Disabled for this call type. Anvesh does not analyse emotion in suspect recordings.</div>;
  const level = { high: ["High", "text-crit"], elevated: ["Elevated", "text-warn"], low: ["Low", "text-ok"], abstain: ["Not assessed", "text-fg-3"], off: ["Off", "text-fg-3"] }[d.level];
  const pts = d.timeline;
  const labelled = pts.filter((p) => p.label);
  const latest = labelled.at(-1);
  const W = 300, H = 56;
  const maxT = Math.max(...pts.map((p) => p.t), 1);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${((p.t / maxT) * W).toFixed(1)},${(H - p.score * H).toFixed(1)}`).join(" ");
  return (
    <div className="space-y-3 p-4">
      {emoState && emoState !== "ready" && (
        <div className="rounded border border-warn-line bg-warn-soft px-3 py-2 text-xs2 text-warn">
          {emoState === "loading" ? "Voice emotion model is loading (first run downloads about 1 GB). Pitch and energy are analysed meanwhile." :
            emoState === "error" ? "Voice emotion model failed to load; only pitch and energy are analysed. See the backend log." :
              "Voice emotion model not loaded; only pitch and energy are analysed."}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <KV k="Distress level" v={<span className={clsx("text-[15px] font-semibold", level[1])}>{level[0]}</span>} />
        <KV k="Latest voice emotion" v={latest ? <span className={clsx("text-[15px] font-semibold capitalize", EMO_TONE[latest.label || ""] || "text-fg")}>{latest.label} <span className="text-[12px] font-normal text-fg-3">{Math.round((latest.p || 0) * 100)}%</span></span> : <span className="text-fg-3">—</span>} />
      </div>
      {pts.length > 1 && (
        <svg viewBox={`0 0 ${W} ${H + 2}`} className="w-full" role="img" aria-label="Distress over the call">
          <line x1="0" x2={W} y1={H * 0.28} y2={H * 0.28} stroke="#FECDCA" strokeDasharray="3 3" />
          <line x1="0" x2={W} y1={H} y2={H} stroke="#E4E7EC" />
          <path d={path} fill="none" stroke="#475467" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
      {labelled.length > 0 && (
        <div>
          <div className="label mb-1">Per 3-second window</div>
          <div className="scroll-thin max-h-40 overflow-y-auto rounded border border-line">
            <table className="w-full text-xs2">
              <tbody>
                {[...labelled].reverse().map((p, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="mono px-2 py-1 text-fg-3">{ts(p.t)}</td>
                    <td className={clsx("px-2 py-1 font-medium capitalize", EMO_TONE[p.label || ""] || "text-fg")}>{p.label}</td>
                    <td className="px-2 py-1 text-right text-fg-3">{Math.round((p.p || 0) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="text-xs2 text-fg-3">{d.score !== null ? `Score ${d.score.toFixed(2)} · ` : ""}confidence {d.confidence}</div>
      <ul className="space-y-0.5 text-xs2 text-fg-2">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {d.abstain_reasons.length > 0 && (
        <div className="rounded border border-line bg-bg px-3 py-2 text-xs2 text-fg-2">
          <div className="font-medium text-fg">Voice not scored</div>
          {d.abstain_reasons.map((r) => <div key={r}>{r}</div>)}
        </div>
      )}
      <p className="text-xs2 text-fg-3">Indicative only, used to prioritise human help. Never used as evidence.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ report */

function ReportModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => { api.get(`/api/cases/${id}/report`).then(setR); }, [id]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/40 p-6" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-md border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px]">Complaint draft <span className="mono ml-1 text-fg-3">{id}</span></h2>
          <div className="flex gap-1.5">
            <button onClick={() => window.print()} className="btn-secondary btn-xs"><FileText size={13} /> Print</button>
            <button onClick={onClose} className="btn-quiet btn-xs"><X size={14} /></button>
          </div>
        </div>
        {!r ? <div className="p-5 text-fg-3">Preparing…</div> : (
          <div className="space-y-5 p-5">
            <p className="rounded border border-warn-line bg-warn-soft px-3 py-2 text-xs2 text-warn">{r.disclaimer}</p>
            <div className="grid grid-cols-4 gap-4">
              <KV k="Call type" v={MODE_LABEL[r.case.mode]} /><KV k="Incident type" v={r.case.playbook.label} />
              <KV k="Caller" v={r.case.caller_label} /><KV k="District" v={r.case.district || "—"} />
            </div>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className="th pl-0">Field</th><th className="th">Value</th><th className="th">Status</th><th className="th pr-0">Source in call</th></tr></thead>
              <tbody>
                {r.fields.map((f: CaseField) => (
                  <tr key={f.name}>
                    <td className="td pl-0 font-medium">{LABELS[f.name] || f.label}</td>
                    <td className={clsx("td", MONO.has(f.name) && "mono")}>{f.display}</td>
                    <td className="td"><StatusTag s={f.status} /></td>
                    <td className="td pr-0 text-xs2 text-fg-3">{f.evidence.map((e) => `${ts(e.t_start)} “${e.quote}”`).join("; ") || "Entered by officer"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.links.length > 0 && (
              <div>
                <div className="label mb-1">Linked cases (leads)</div>
                <ul className="space-y-0.5 text-[13px]">{r.links.map((l: LinkT) => <li key={l.id}><span className="mono">{l.other.id}</span> · {l.detail.reason} · {l.status}</li>)}</ul>
              </div>
            )}
            <div className="rounded border border-line bg-bg px-3 py-2.5 text-xs2 text-fg-2">
              <div>Audit chain: <b className={r.integrity.audit_chain_ok ? "text-ok" : "text-crit"}>{r.integrity.audit_chain_ok ? "intact" : "broken"}</b> · head <span className="mono">{r.integrity.audit_head?.slice(0, 16)}</span></div>
              {r.recordings.map((x: any) => <div key={x.id}>{x.filename} · SHA-256 <span className="mono">{x.sha256.slice(0, 24)}</span></div>)}
              <div>Pipeline <span className="mono">{r.integrity.pipeline}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ in-call alerts */

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 220);
  } catch {}
}

function Toasts({ items, onClose }: { items: { id: number; tone: "crit" | "warn" | "accent" | "ok"; title: string; body?: string }[]; onClose: (id: number) => void }) {
  const bar = { crit: "border-l-crit", warn: "border-l-warn", accent: "border-l-accent", ok: "border-l-ok" };
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-40 flex w-[340px] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={clsx("pointer-events-auto rounded border border-line border-l-4 bg-surface px-3 py-2 shadow-lg", bar[t.tone])}>
          <div className="flex items-start justify-between gap-2">
            <div className="text-[13px] font-medium text-fg">{t.title}</div>
            <button onClick={() => onClose(t.id)} className="text-fg-4 hover:text-fg"><X size={13} /></button>
          </div>
          {t.body && <div className="mt-0.5 text-xs2 text-fg-2">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}


function OfficialContext({ c }: { c: CaseDetail }) {
  const lc = c.local_context, st = c.official_scam_type, sc = c.scenario;
  if (!lc && !st && !sc) return null;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
  const srcs = [...(st ? [st.source] : []), ...(lc?.sources || [])];
  return (
    <Panel title="Official context" action={<span className="text-xs2 text-fg-3">Published government data</span>}>
      {sc && (
        <div className="mb-4 rounded border border-line bg-bg px-3 py-2 text-xs2 leading-[17px] text-fg-2">
          <span className="font-medium text-fg">Training scenario.</span> {sc.note} Scam type reproduced: <span className="text-fg">{sc.category}</span>.
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {st && (
          <>
            <KV className="col-span-2" k="This scam type, reported nationally (Chakshu)" v={
              <span><span className="text-[18px] font-semibold tabular-nums">{n(st.reports_2025)}</span> <span className="text-fg-3">reports in 2025 · {pct(st.share_2025_pct)} of all · {n(st.reports_2024)} in 2024</span></span>} />
            <div className="col-span-2 -mt-3 text-xs2 text-fg-3">{st.categories.join(" · ")}</div>
          </>
        )}
        {lc && (
          <>
            <KV k={`Cyber crimes, ${lc.state.name} (2023)`} v={<span className="tabular-nums"><b className="font-semibold">{n(lc.state.cases_2023)}</b> <span className="text-fg-3">{lc.state.change_2022_2023_pct !== null && `${lc.state.change_2022_2023_pct > 0 ? "+" : ""}${lc.state.change_2022_2023_pct}% vs 2022`}</span></span>} />
            <KV k="Share with fraud motive" v={<span className="tabular-nums"><b className="font-semibold">{pct(lc.state.fraud_share_2023_pct)}</b> <span className="text-fg-3">India {pct(lc.india.fraud_share_2023_pct)}</span></span>} />
            <KV k="Crime rate per lakh" v={<span className="tabular-nums"><b className="font-semibold">{lc.state.rate_2023 ?? "—"}</b> <span className="text-fg-3">India {lc.india.rate_2023}</span></span>} />
            <KV k="Chargesheeting rate" v={<span className="tabular-nums"><b className="font-semibold">{pct(lc.state.chargesheet_rate_2023)}</b> <span className="text-fg-3">India {pct(lc.india.chargesheet_rate_2023)}</span></span>} />
            {lc.city && <KV className="col-span-2" k={`${lc.city.name}, metropolitan city (2023)`} v={<span className="tabular-nums"><b className="font-semibold">{n(lc.city.cases_2023)}</b> cyber crimes · {n(lc.city.fraud_2023)} with fraud motive</span>} />}
          </>
        )}
      </div>
      {srcs.length > 0 && <SourceNote sources={srcs} className="mt-4 border-t border-line pt-3" />}
    </Panel>
  );
}
