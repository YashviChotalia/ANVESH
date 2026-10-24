"use client";

/**
 * Microphone → 16 kHz mono PCM16 → WebSocket. Runs in an AudioWorklet so the UI never stutters.
 */
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.acc = 0; this.sum = 0; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      // average the samples of each output step (simple anti-alias filter when the device rate is not 16 kHz)
      this.sum += ch[i]; this.n += 1; this.acc += 1;
      if (this.acc >= this.ratio) { this.acc -= this.ratio; this.buf.push(this.sum / this.n); this.sum = 0; this.n = 0; }
    }
    if (this.buf.length >= 4000) {
      const out = new Int16Array(this.buf.length);
      let peak = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const s = Math.max(-1, Math.min(1, this.buf[i]));
        peak = Math.max(peak, Math.abs(s));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage({ pcm: out.buffer, peak }, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor("pcm16", Pcm16);
`;

export interface LiveHandle {
  stop: () => void;
  replay: (seconds: number) => Promise<void>;
  /** true while the browser has not yet allowed audio to start (needs a click) */
  suspended: () => boolean;
  resume: () => Promise<void>;
}

function micError(e: any): string {
  const n = e?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError") return "Microphone access was blocked. Allow the microphone for this site (lock icon in the address bar) and try again.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No microphone was found. Connect a microphone or headset and try again.";
  if (n === "NotReadableError") return "The microphone is being used by another app (Zoom, Teams…). Close it and try again.";
  return e?.message || "Could not start the microphone.";
}

function wavBlob(pcm: Int16Array, sr = 16000): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

export async function startLive(
  wsUrl: string,
  onMessage: (msg: any) => void,
  onLevel: (peak: number) => void,
  onError: (e: string) => void,
): Promise<LiveHandle> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot record audio here. Open Anvesh at http://localhost:3000 in Chrome or Edge.");
  let stream: MediaStream;
  try {
    // automatic gain is OFF on purpose: it flattens loudness, which is one of the voice-stress cues
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
  } catch (e) { throw new Error(micError(e)); }
  let ctx: AudioContext;
  try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); } // native resampling when supported
  await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]);
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm16");
  src.connect(node);
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch {} };
  let stopped = false;
  let finished = false;
  ws.onerror = () => onError("Live connection failed. Is the backend running (start.bat)?");
  ws.onclose = (ev) => {
    if (finished) return;
    if (ev.code === 4401) onError("Your session expired. Sign in again, then restart live capture.");
    else if (ev.code === 4403) onError("Live capture was refused: open Anvesh at http://localhost:3000.");
    else if (!stopped) onError("The live connection closed unexpectedly. The audio received so far has been saved.");
  };
  const prevOnMessage = onMessage;
  onMessage = (m: any) => { if (m?.type === "update" && m.final) finished = true; prevOnMessage(m); };
  // keep the last ~60 s locally so the officer can replay during the call
  const recent: Int16Array[] = [];
  let recentLen = 0;
  node.port.onmessage = (ev) => {
    onLevel(ev.data.peak);
    const chunk = new Int16Array(ev.data.pcm.slice(0));
    recent.push(chunk); recentLen += chunk.length;
    while (recentLen > 16000 * 60 && recent.length > 1) recentLen -= recent.shift()!.length;
    if (ws.readyState === WebSocket.OPEN) ws.send(ev.data.pcm);
  };
  return {
    suspended: () => ctx.state !== "running",
    resume: async () => { await ctx.resume(); },
    replay: (seconds: number) => new Promise<void>((resolve) => {
      const need = 16000 * seconds;
      const parts: Int16Array[] = [];
      let n = 0;
      for (let i = recent.length - 1; i >= 0 && n < need; i--) { parts.unshift(recent[i]); n += recent[i].length; }
      const pcm = new Int16Array(n);
      let o = 0;
      parts.forEach((p) => { pcm.set(p, o); o += p.length; });
      const url = URL.createObjectURL(wavBlob(pcm.subarray(Math.max(0, n - need))));
      const a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); resolve(); };
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    }),
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" })); } catch {}
      node.disconnect(); src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      URL.revokeObjectURL(url);
    },
  };
}
