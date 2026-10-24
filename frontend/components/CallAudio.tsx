"use client";

import clsx from "clsx";
import { Pause, Play, RotateCcw } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ts } from "@/lib/format";
import type { Recording, SegmentT } from "@/lib/types";

export interface PlayerHandle {
  /** Play from a point on the case timeline (seconds); stop after `until` if given. */
  playFrom: (t: number, until?: number) => void;
}

interface Props {
  recordings: Recording[];
  segments: SegmentT[];
  marks: { t: number; label: string }[];
  onTime: (caseTime: number | null) => void;
}

export const CallAudio = forwardRef<PlayerHandle, Props>(function CallAudio({ recordings, segments, marks, onTime }, ref) {
  const playable = recordings.filter((r) => r.kind !== "suspect_audio" || true);
  const [recId, setRecId] = useState<string | null>(playable.at(-1)?.id ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  const cache = useRef<Record<string, string>>({});
  const rec = playable.find((r) => r.id === recId) || null;
  const offset = rec?.offset || 0;

  useEffect(() => { if (!recId && playable.length) setRecId(playable.at(-1)!.id); }, [playable.length]); // eslint-disable-line

  const load = async (id: string) => {
    if (cache.current[id]) return cache.current[id];
    const u = await api.audioUrl(id);
    cache.current[id] = u;
    return u;
  };

  useEffect(() => {
    if (!recId) return;
    let alive = true;
    load(recId).then((u) => alive && setUrl(u)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [recId]);

  useImperativeHandle(ref, () => ({
    playFrom: async (t: number, until?: number) => {
      const target = playable.find((r) => t >= (r.offset || 0) - 0.5 && t <= (r.offset || 0) + (r.duration || 1e9)) || rec;
      if (!target || !audio.current) return;
      if (target.id !== recId) {
        setRecId(target.id);
        const u = await load(target.id);
        setUrl(u);
        audio.current.src = u;
      }
      const a = audio.current;
      a.currentTime = Math.max(t - (target.offset || 0) - 0.4, 0);
      stopAt.current = until !== undefined ? until - (target.offset || 0) + 0.6 : null;
      a.play().catch(() => {});
    },
  }), [playable, rec, recId]);

  if (!playable.length) return null;

  const pct = dur ? (cur / dur) * 100 : 0;
  return (
    <div className="border-b border-line bg-bg px-4 py-2.5">
      <audio ref={audio} src={url || undefined} preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || rec?.duration || 0)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCur(t);
          onTime(t + offset);
          if (stopAt.current !== null && t >= stopAt.current) { e.currentTarget.pause(); stopAt.current = null; }
        }}
        onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); onTime(null); }} onEnded={() => { setPlaying(false); onTime(null); }} />
      <div className="flex items-center gap-3">
        <button onClick={() => { const a = audio.current; if (!a) return; stopAt.current = null; a.paused ? a.play() : a.pause(); }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fg text-white hover:bg-[#1D2939]" title={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>
        <button onClick={() => { const a = audio.current; if (a) a.currentTime = Math.max(a.currentTime - 10, 0); }} title="Back 10 s"
          className="grid h-7 w-7 shrink-0 place-items-center rounded text-fg-2 hover:bg-surface"><RotateCcw size={14} /></button>
        <span className="mono w-[104px] shrink-0 whitespace-nowrap text-[11.5px] text-fg-2">{ts(cur)} / {ts(dur || rec?.duration || 0)}</span>
        <div className="relative h-6 flex-1 cursor-pointer" onClick={(e) => {
          const a = audio.current; if (!a || !dur) return;
          const r = e.currentTarget.getBoundingClientRect();
          a.currentTime = ((e.clientX - r.left) / r.width) * dur; stopAt.current = null;
        }}>
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line2" />
          <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-fg" style={{ width: `${pct}%` }} />
          {dur > 0 && segments.filter((s) => s.recording_id === rec?.id).map((s) => (
            <span key={s.id} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-fg-4" style={{ left: `${((s.start - offset) / dur) * 100}%` }} />
          ))}
          {dur > 0 && marks.map((m, i) => (
            <span key={i} title={m.label} className="absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#F79009]" style={{ left: `${Math.min(Math.max(((m.t - offset) / dur) * 100, 0), 100)}%` }} />
          ))}
          <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-fg shadow" style={{ left: `${pct}%` }} />
        </div>
        <button onClick={() => { const n = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(n); if (audio.current) audio.current.playbackRate = n; }}
          className="mono h-6 w-10 shrink-0 rounded border border-line2 bg-surface text-[11px] text-fg-2" title="Playback speed">{rate}×</button>
        {playable.length > 1 && (
          <select value={recId || ""} onChange={(e) => setRecId(e.target.value)} className="input h-7 w-36 shrink-0 text-xs2">
            {playable.map((r, i) => <option key={r.id} value={r.id}>{i + 1}. {r.filename}</option>)}
          </select>
        )}
      </div>
      {err && <div className="mt-1 text-xs2 text-crit">{err}</div>}
      <div className={clsx("mt-1 flex items-center gap-3 text-[11px] text-fg-3")}>
        <span>Evidence audio · SHA-256 <span className="mono">{rec?.sha256.slice(0, 12)}</span></span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#F79009]" /> extracted detail</span>
      </div>
    </div>
  );
});
