/* Anxiety score, generated live with Web Audio (no copyrighted track needed).
   tension 0..1 drives tempo, filter and layers; scene picks the texture.
   If /landing/score.mp3 exists (a track you hold the rights to), it is played instead. */

export type Mood = { tension: number; scene: number }; // scene: 0 open, 1 call, 2 loss, 3 intro, 4 after

export class Score {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private drone!: BiquadFilterNode;
  private droneGain!: GainNode;
  private timer = 0;
  private nextBeat = 0;
  private nextTick = 0;
  private resolved = false;
  private track: HTMLAudioElement | null = null;
  mood: Mood = { tension: 0, scene: 0 };
  /* the Anvesh track: 172.3 bpm, first beat at 0.232 s (measured from the file) */
  static BPM = 172.27;
  static OFFSET = 0.232;
  private synthStart = 0;

  /** 0..1 pulse on every beat (sharp attack, fast decay) and a stronger one on each bar of 4. */
  pulse(): { beat: number; bar: number } {
    const t = this.track ? this.track.currentTime : this.ctx ? this.ctx.currentTime - this.synthStart : 0;
    if (this.track && this.track.paused) return { beat: 0, bar: 0 };
    const P = 60 / Score.BPM, x = t - Score.OFFSET;
    if (x < 0) return { beat: 0, bar: 0 };
    const inBeat = (x % P) / P, inBar = (x % (4 * P)) / (4 * P);
    return { beat: Math.exp(-inBeat * 6), bar: Math.exp(-inBar * 9) };
  }

  async start() {
    if (await this.tryTrack()) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.5);
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // low detuned drone through a moving low-pass
    this.drone = ctx.createBiquadFilter();
    this.drone.type = "lowpass";
    this.drone.Q.value = 6;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.12;
    for (const [f, d] of [[55, -9], [55.4, 7], [82.4, 3], [110.6, -4]]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(this.drone);
      o.start();
    }
    this.drone.connect(this.droneGain).connect(this.master);
    this.synthStart = ctx.currentTime;
    this.nextBeat = this.nextTick = ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  private async tryTrack() {
    try {
      const r = await fetch("/landing/score.mp3", { method: "HEAD" });
      if (!r.ok || !(r.headers.get("content-type") || "").includes("audio")) return false;
      this.track = new Audio("/landing/score.mp3");
      this.track.loop = true;
      this.track.volume = 0.85;
      await this.track.play();
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    window.clearInterval(this.timer);
    this.track?.pause();
    this.track = null;
    this.ctx?.close();
    this.ctx = null;
  }

  private thump(t: number, f: number, g: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), v = ctx.createGain();
    o.frequency.setValueAtTime(f * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(g, t + 0.01);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(v).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noise(t: number, dur: number, g: number, hp: number) {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain();
    s.buffer = b;
    f.type = "highpass";
    f.frequency.value = hp;
    v.gain.value = g;
    s.connect(f).connect(v).connect(this.master);
    s.start(t);
  }

  private chord(t: number) {
    const ctx = this.ctx!;
    for (const f of [130.8, 196, 261.6, 329.6, 392]) {
      const o = ctx.createOscillator(), v = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(0.05, t + 1.2);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 7);
      o.connect(v).connect(this.master);
      o.start(t);
      o.stop(t + 7.2);
    }
    this.thump(t, 40, 0.9);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { tension: k, scene } = this.mood;
    const now = ctx.currentTime;
    // drone opens up and gets louder as tension rises; ducks for the reveal
    const calm = scene >= 3;
    this.drone.frequency.setTargetAtTime(calm ? 220 : 160 + k * 2400, now, 0.3);
    this.droneGain.gain.setTargetAtTime(calm ? 0.04 : 0.08 + k * 0.16, now, 0.4);
    if (scene === 3 && !this.resolved) { this.resolved = true; this.chord(now + 0.05); }
    if (scene < 3) this.resolved = false;

    // heartbeat: 58 bpm at rest to 170 bpm at the loss
    const bpm = 58 + k * 112;
    while (!calm && this.nextBeat < now + 0.15) {
      this.thump(this.nextBeat, 48, 0.55 + k * 0.4);
      this.thump(this.nextBeat + 0.16, 44, 0.35 + k * 0.3);
      if (k > 0.55) this.noise(this.nextBeat, 0.06, 0.08 * k, 3000); // snare-ish hit on the beat
      this.nextBeat += 60 / bpm;
    }
    if (calm) this.nextBeat = now + 0.2;
    // clock ticks: during the call (sparse) and frantic during the loss
    const tickEvery = scene === 2 ? 0.125 : scene === 1 ? 0.5 : 0;
    while (tickEvery && this.nextTick < now + 0.15) {
      this.noise(this.nextTick, 0.025, 0.05 + k * 0.06, 6000);
      this.nextTick += tickEvery;
    }
    if (!tickEvery) this.nextTick = now + 0.2;
  }
}
