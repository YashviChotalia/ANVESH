"use client";

/**
 * Microphone → 16 kHz mono PCM16 → WebSocket. Runs in an AudioWorklet so the UI never stutters.
 */
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.acc = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) { this.acc -= this.ratio; this.buf.push(ch[i]); }
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

export interface LiveHandle { stop: () => void }

export async function startLive(
  wsUrl: string,
  onMessage: (msg: any) => void,
  onLevel: (peak: number) => void,
  onError: (e: string) => void,
): Promise<LiveHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm16");
  src.connect(node);
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch {} };
  ws.onerror = () => onError("Live connection failed. Is the backend running?");
  node.port.onmessage = (ev) => {
    onLevel(ev.data.peak);
    if (ws.readyState === WebSocket.OPEN) ws.send(ev.data.pcm);
  };
  let stopped = false;
  return {
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
