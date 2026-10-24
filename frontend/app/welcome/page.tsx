"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import s from "./welcome.module.css";
import { Score } from "./score";

/* Scroll-driven film. Each scene writes --p (0..1) on its own element every frame; CSS reads it.
   Only text that changes (subtitles, balance, timer) touches React state or refs. */

const seg = (a: number, b: number) => `clamp(0, calc((var(--p) - ${a}) / ${b - a}), 1)`;
const fadeInOut = (a: number, b: number, c: number, d: number) =>
  `min(${seg(a, b)}, calc(1 - ${seg(c, d)}))`;

type Line = { at: number; to: number; who: "caller" | "victim"; hi: string; en: string };
const SCRIPT: Line[] = [
  { at: 0.16, to: 0.27, who: "caller", hi: "Namaste, main Inspector Sharma, CBI cyber cell, Delhi se bol raha hoon.", en: "Hello, this is Inspector Sharma, CBI cyber cell, Delhi." },
  { at: 0.27, to: 0.36, who: "caller", hi: "Aapke Aadhaar se ek parcel mein drugs mile hain. Aapke naam pe FIR darj hai.", en: "A parcel with drugs was found on your Aadhaar. There's an FIR in your name." },
  { at: 0.36, to: 0.45, who: "victim", hi: "Kya? Sir… maine kuch nahi kiya. Main kya karoon?", en: "What? Sir… I haven't done anything. What do I do?" },
  { at: 0.45, to: 0.55, who: "caller", hi: "Ghabraiye mat. Video call pe rahiye, kisi ko mat bataiye. Yeh digital arrest hai.", en: "Don't panic. Stay on video call, tell no one. This is a digital arrest." },
  { at: 0.55, to: 0.65, who: "caller", hi: "Verification ke liye account number aur abhi aaya OTP bataiye.", en: "For verification, tell me your account number and the OTP you just got." },
  { at: 0.65, to: 0.76, who: "victim", hi: "Ji… OTP hai 4… 8… 2… 9… 1… 6.", en: "Yes… the OTP is 4… 8… 2… 9… 1… 6." },
  { at: 0.76, to: 0.88, who: "caller", hi: "Theek hai. Paise RBI safe account mein verify hone tak rahenge.", en: "Fine. The money stays in an RBI safe account until verification." },
];

const PACKETS = [
  { t: "A/C ••• 4471", at: 0.58, y: -70 },
  { t: "OTP 482916", at: 0.68, y: -10 },
  { t: "UPI PIN ••••", at: 0.74, y: 50 },
  { t: "Aadhaar XXXX 2207", at: 0.8, y: 110 },
];

const START = 482316;
const TXS = [
  { to: "IMPS · SAFE-RBI-VERIFY", amt: 199000, t: "21:58:03" },
  { to: "UPI · rbi.secure@okaxis", amt: 100000, t: "21:58:11" },
  { to: "UPI · verify.kyc@ybl", amt: 98000, t: "21:58:19" },
  { to: "IMPS · NODAL-AC-0091", amt: 60000, t: "21:58:27" },
  { to: "UPI · refund.cbi@paytm", amt: 25316, t: "21:58:41" },
];
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");


function Film({ src, pos = "50% 50%", style, start = 0 }: { src: string; pos?: string; style?: React.CSSProperties; start?: number }) {
  return (
    <video className={s.film} src={`/landing/${src}.mp4`} poster={`/landing/${src}.jpg`} autoPlay muted loop playsInline preload="auto"
      aria-hidden style={{ objectPosition: pos, ...style }}
      onLoadedMetadata={(e) => { if (start) e.currentTarget.currentTime = start; }} />
  );
}




const FEATURES = [
  { n: "01", h: "Live speech emotion & distress", p: "Fear, anger, distress and nervousness read from the voice every few seconds, against the caller's own baseline. Shown as indicative signals, never as proof of intent or honesty.", meter: true },
  { n: "02", h: "Synthetic-voice check", p: "Flags voices that sound cloned or machine-generated, so a real victim, a real informant and a staged \"victim\" can be told apart before action is taken." },
  { n: "03", h: "Call to case file, in Hinglish", p: "Live transcript, scam playbook, UPI IDs, phone numbers, amounts and banks extracted as the caller speaks. Read-back and complaint draft in one click." },
  { n: "04", h: "Ring linker", p: "Connects cases that share a mule account, number or script, so one call can expose a whole network across districts." },
  { n: "05", h: "Golden-hour triage", p: "Money moved in the last few hours, active coercion or a crisis phrase pushes the call to the top of the queue, with the reason shown." },
  { n: "06", h: "Sealed, tamper-evident evidence", p: "Every recording is SHA-256 hashed at intake; every action joins an HMAC-chained audit log; case fields are AES-256-GCM encrypted at rest." },
];

const hex = (seed: number) => {
  let x = seed * 2654435761 >>> 0, out = "";
  for (let i = 0; i < 16; i++) { x = (x ^ (x << 13)) >>> 0; x = (x ^ (x >>> 17)) >>> 0; x = (x ^ (x << 5)) >>> 0; out += (x & 0xffff).toString(16).padStart(4, "0"); }
  return out.slice(0, 64);
};
const BLOCKS = [
  "Call audio received", "Transcript sealed", "Entities extracted", "Distress 0.82 · high", "Officer verified fields",
  "Complaint drafted", "Linked to ring R-14", "Supervisor confirmed link",
].map((h, i) => ({ h, hash: hex(i + 7), prev: hex(i + 6) }));

export default function Welcome() {
  const root = useRef<HTMLDivElement>(null);
  const scenes = useRef<(HTMLElement | null)[]>([]);
  const wire = useRef<HTMLCanvasElement>(null);
  const balRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState(-1);
  const [ringing, setRinging] = useState(true);
  const [txN, setTxN] = useState(0);
  const [solid, setSolid] = useState(false);
  const lineRef = useRef(-1);
  const score = useRef<Score | null>(null);
  const beatRef = useRef(0);
  const [sound, setSound] = useState(false);
  const toggleSound = async () => {
    if (score.current) { score.current.stop(); score.current = null; setSound(false); return; }
    const sc = new Score(); score.current = sc; setSound(true);
    try { await sc.start(); } catch { setSound(false); score.current = null; }
  };
  useEffect(() => () => score.current?.stop(), []);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = { line: -2, ring: true, tx: -1, solid: false };
    const speakAmp = { cur: 0.2 };
    const sm: number[] = [];
    const frame = (t: number) => {
      const vh = innerHeight;
      const ps = scenes.current.map((el, i) => {
        if (!el) return 0;
        const r = el.getBoundingClientRect();
        const target = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - vh)));
        // eased follow: scroll jumps become a glide instead of a cut
        const cur = sm[i] ?? target;
        const p = reduce || Math.abs(target - cur) < 0.0005 ? target : cur + (target - cur) * 0.09;
        sm[i] = p;
        el.style.setProperty("--p", p.toFixed(4));
        return p;
      });
      // the score follows the story
      if (score.current) {
        const scene = ps[3] >= 1 ? 4 : ps[3] > 0.08 ? 3 : ps[2] > 0 ? 2 : ps[1] > 0 ? 1 : 0;
        const tension = scene === 0 ? 0.08 + ps[0] * 0.12 : scene === 1 ? 0.2 + ps[1] * 0.45 : scene === 2 ? Math.min(1, 0.7 + ps[2] * 0.6) : 0;
        score.current.mood = { tension, scene };
        const { beat, bar } = score.current.pulse();
        root.current?.style.setProperty("--beat", beat.toFixed(3));
        root.current?.style.setProperty("--bar", bar.toFixed(3));
        beatRef.current = beat;
      } else if (beatRef.current) {
        beatRef.current = 0;
        root.current?.style.setProperty("--beat", "0");
        root.current?.style.setProperty("--bar", "0");
      }
      const [pOpen, pCall, pLoss] = ps;
      scenes.current[0]?.style.setProperty("--lb", Math.min(1, pOpen * 1.6).toFixed(3));

      // call: ringing, subtitles, timer
      const ring = pCall < 0.13;
      const li = SCRIPT.findIndex((l) => pCall >= l.at && pCall < l.to);
      if (li !== last.line) { last.line = li; lineRef.current = li; setLine(li); }
      if (ring !== last.ring) { last.ring = ring; setRinging(ring); }
      if (timerRef.current) {
        const secs = Math.max(0, Math.round((pCall - 0.13) * 420));
        timerRef.current.textContent = ring ? "ringing…" : `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
      }

      // loss: balance drains, transactions stack, alarm
      const drain = Math.min(1, Math.max(0, (pLoss - 0.12) / 0.4));
      const n = drain <= 0 ? 0 : Math.min(TXS.length, Math.floor(drain * (TXS.length - 1)) + 1);
      const spent = TXS.slice(0, n).reduce((a, x) => a + x.amt, 0);
      if (balRef.current) {
        const shown = n === TXS.length && drain >= 1 ? 0 : START - spent;
        balRef.current.textContent = inr(Math.max(0, shown));
        balRef.current.style.color = drain >= 1 ? "#f97a0f" : "#fff";
      }
      if (n !== last.tx) { last.tx = n; setTxN(n); }
      if (clockRef.current) {
        const sec = Math.round(drain * 47);
        clockRef.current.textContent = `00:00:${String(sec).padStart(2, "0")}`;
      }
      scenes.current[2]?.style.setProperty("--alarm", drain >= 1 ? "1" : (drain * 0.4).toFixed(3));

      const sol = scrollY > vh * 0.5;
      if (sol !== last.solid) { last.solid = sol; setSolid(sol); }

      // the line between them: live waveform, louder on the side that is speaking
      const c = wire.current;
      if (c && pCall > 0 && pCall < 1) {
        const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
        if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
        const g = c.getContext("2d")!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const l = lineRef.current >= 0 ? SCRIPT[lineRef.current] : null;
        const target = ring ? 0.05 : l ? 1 : 0.18;
        speakAmp.cur += (target - speakAmp.cur) * 0.08;
        const amp = speakAmp.cur * (1 + beatRef.current * 0.9);
        const tt = reduce ? 0 : t / 1000;
        const from = l?.who === "victim" ? 0 : 1; // speech travels from the speaker's side
        const grad = g.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, "rgba(249,122,15,0.95)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.9)");
        grad.addColorStop(1, "rgba(255,177,92,0.95)");
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          for (let x = 0; x <= w; x += 3) {
            const u = x / w, d = Math.abs(u - from);
            const env = Math.exp(-d * 2.2) * (0.55 + 0.45 * Math.sin(tt * 3.1 + k));
            const y = h / 2 + Math.sin(u * 44 - tt * 9 * (from ? 1 : -1) + k * 1.7) * Math.sin(u * 7 + tt * 2.3 + k)
              * (h * 0.42) * amp * env * (k === 0 ? 1 : 0.5);
            x ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.strokeStyle = grad;
          g.globalAlpha = k === 0 ? 0.9 : 0.35;
          g.lineWidth = k === 0 ? 1.6 : 1;
          g.shadowColor = "rgba(249,122,15,0.7)";
          g.shadowBlur = k === 0 ? 10 : 0;
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add(s.in)), { threshold: 0.15 });
    root.current?.querySelectorAll(`.${s.card}`).forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const cur = line >= 0 ? SCRIPT[line] : null;
  const hashCols = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ l: (i * 4.7) % 100, d: 7 + (i % 6) * 2.2, dl: -(i * 1.3), h: hex(i + 40) + hex(i + 90) })), []);

  return (
    <div ref={root} className={s.root}>
      <div className={s.grain} aria-hidden />

      <header className={`${s.bar} ${solid ? s.barSolid : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/anvesh-wordmark.png" alt="Anvesh" className={s.barLogo} />
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={toggleSound} className={`${s.barCta} ${s.soundBtn}`} aria-pressed={sound}>
            <span className={`${s.eq} ${sound ? s.eqOn : ""}`} aria-hidden><i /><i /><i /><i /></span>
            {sound ? "Sound on" : "Play with sound"}
          </button>
          <Link href="/login" className={s.barCta}>Open console</Link>
        </div>
      </header>

      {/* ---------------- 1. cold open ---------------- */}
      <section ref={(el) => { scenes.current[0] = el; }} className={s.scene} style={{ height: "170vh" }}>
        <div className={`${s.stage} ${s.open} ${s.letterbox}`}>
          <Film src="rain" style={{ transform: `scale(calc(1.15 + ${seg(0, 1)} * 0.15))`, filter: `brightness(calc(0.75 - ${seg(0.4, 1)} * 0.5 + var(--bar) * 0.2))` }} />
          <div className={s.shade} />
          <div className={s.slate} style={{ opacity: `calc(1 - ${seg(0.5, 0.95)})`, transform: `translate(-50%, calc(-50% - ${seg(0.3, 1)} * 80px)) scale(calc(1 + ${seg(0.3, 1)} * 0.08))` }}>
            <div className={s.kicker}>Pune · 9:47 PM · an unknown number calls</div>
            <h1 className={s.headline}>It takes one call<br />to empty a <em>lifetime</em>.</h1>
            <p className={s.sub}>Every day, thousands of Indians are talked out of their savings by a voice they trust. This is how it happens, in under a minute.</p>
          </div>
          <div className={s.scrollHint} style={{ opacity: `calc(1 - ${seg(0, 0.15)})` }}>Scroll<span /></div>
          <div className={s.vignette} />
          <div className={s.edge} />
        </div>
      </section>

      {/* ---------------- 2. the call ---------------- */}
      <section ref={(el) => { scenes.current[1] = el; }} className={s.scene} style={{ height: "460vh" }}>
        <div className={`${s.stage} ${s.letterbox}`} style={{ ["--lb" as string]: 0 }}>
          <div className={s.split}>
            <div className={`${s.side} ${s.victimRoom}`} style={{ transform: `translateX(calc((1 - ${seg(0, 0.08)}) * -12%))` }}>
              <Film src="victim" pos="58% 40%" style={{ transform: `scale(calc(1.08 + ${seg(0, 1)} * 0.12))` }} />
              <div className={s.shade} />
              {ringing && <i className={s.phoneGlow} style={{ left: "18%", top: "58%", width: 90, height: 90 }} />}
              <div className={s.label} style={{ left: "clamp(16px, 4vw, 48px)" }}>The victim<b>Sneha K., 34 · Pune</b></div>
              <div className={s.vignette} />
            </div>
            <div className={`${s.side} ${s.hackerRoom} ${s.scan}`} style={{ transform: `translateX(calc((1 - ${seg(0.04, 0.13)}) * 30%))`, opacity: seg(0.04, 0.11) }}>
              <Film src="hacker" pos="42% 40%" style={{ transform: `scale(calc(1.1 + ${seg(0, 1)} * 0.14))` }} />
              <div className={s.shade} />
              <div className={s.label} style={{ right: "clamp(16px, 4vw, 48px)", textAlign: "right" }}>The caller<b>&quot;Inspector Sharma, CBI&quot;</b></div>
              <div className={s.vignette} />
            </div>
          </div>

          <canvas ref={wire} className={s.wire} style={{ width: "100%", opacity: seg(0.12, 0.17) }} aria-hidden />

          <div className={s.callCard} style={{ opacity: seg(0.02, 0.06) }}>
            <span className={s.callDot} style={ringing ? { background: "#ffb36b", boxShadow: "0 0 12px #ffb36b" } : undefined} />
            <span>{ringing ? "Incoming · +91 11 2xxx xxxx · “CBI DELHI”" : "On call · CBI DELHI"}</span>
            <span ref={timerRef} className={s.callTimer}>ringing…</span>
          </div>

          <div className={s.changer} style={{ opacity: fadeInOut(0.14, 0.2, 0.9, 0.97), transform: `translateY(calc((1 - ${seg(0.14, 0.2)}) * 20px))` }}>
            <h4>VOICE CHANGER · LIVE</h4>
            <div>preset: officer_male_hi · AI clone</div>
            <div className={s.knobs}>
              <div className={s.knob}>pitch −4 st<i style={{ width: "62%" }} /></div>
              <div className={s.knob}>formant 0.86<i style={{ width: "48%" }} /></div>
              <div className={s.knob}>room: office<i style={{ width: "80%" }} /></div>
            </div>
          </div>

          <div className={s.packets} aria-hidden>
            {PACKETS.map((k) => (
              <span key={k.t} className={s.packet} style={{
                left: `calc(14% + ${seg(k.at, k.at + 0.1)} * 62%)`,
                marginTop: k.y,
                opacity: fadeInOut(k.at, k.at + 0.02, k.at + 0.09, k.at + 0.11),
              }}>{k.t}</span>
            ))}
          </div>

          <div className={s.subtitle} style={{ opacity: cur ? 1 : 0 }} aria-live="polite">
            {cur && (
              <>
                <span className={s.speaker} style={{ color: cur.who === "caller" ? "var(--cold)" : "var(--warm)" }}>
                  {cur.who === "caller" ? "Caller · voice changed" : "Victim"}
                </span>
                “{cur.hi}”
                <span className={s.subEn}>{cur.en}</span>
              </>
            )}
          </div>
          <div className={s.edge} />
        </div>
      </section>

      {/* ---------------- 3. the loss ---------------- */}
      <section ref={(el) => { scenes.current[2] = el; }} className={s.scene} style={{ height: "300vh" }}>
        <div className={`${s.stage} ${s.loss}`}>
          <Film src="victim" pos="60% 40%" start={8} style={{ opacity: `calc(0.42 * (1 - ${seg(0.62, 0.75)}))`, filter: "grayscale(.6) sepia(.35) hue-rotate(-25deg) saturate(1.6) brightness(calc(.75 + var(--bar) * .25))" }} />
          <Film src="loss" pos="70% 50%" style={{ opacity: `calc(0.5 * ${seg(0.62, 0.75)})`, filter: "grayscale(.5) brightness(calc(.8 + var(--bar) * .25))", transform: `scale(calc(1.05 + ${seg(0.6, 1)} * 0.1))` }} />
          <div className={s.shade} />
          <div className={s.alarm} />
          <div className={s.lossGrid}>
            <div className={s.lossCopy} style={{ opacity: seg(0.02, 0.12), transform: `translateX(calc((1 - ${seg(0.02, 0.12)}) * -40px))` }}>
              <div className={s.kicker}>Time since OTP shared</div>
              <div ref={clockRef} className={s.clock}>00:00:00</div>
              <h2>Gone in<br />forty-seven seconds.</h2>
              <p>The &quot;safe account&quot; is a chain of mule accounts. By the time she calls 1930, the money has split across seven accounts in three states.</p>
            </div>

            <div className={s.phone} style={{ transform: `translateY(calc((1 - ${seg(0, 0.12)}) * 60px)) rotate(calc(${seg(0.55, 0.7)} * -2deg))` }}>
              <div className={s.notch} />
              <div className={s.screen}>
                <div className={s.bankHead}>
                  <div className={s.bankName}>Savings A/C ••• 4471</div>
                  <div ref={balRef} className={s.balance}>{inr(START)}</div>
                  <div className={s.balanceLabel}>Available balance</div>
                </div>
                <div className={s.txList}>
                  {TXS.map((x, i) => (
                    <div key={i} className={s.tx} style={{ opacity: i < txN ? 1 : 0, transform: i < txN ? "none" : "translateY(-8px)" }}>
                      <span>{x.to}<small>Debited · {x.t}</small></span><b>−{inr(x.amt)}</b>
                    </div>
                  )).reverse()}
                </div>
              </div>
            </div>

            <div style={{ position: "relative", minHeight: 560, alignSelf: "center" }}>
              {TXS.map((x, i) => (
                <div key={i} className={s.sms} style={{
                  top: i * 74, opacity: i < txN ? 1 - (txN - 1 - i) * 0.12 : 0,
                  transform: i < txN ? `scale(${1 - (txN - 1 - i) * 0.02})` : "translateY(-14px)",
                }}>
                  <b><span>VM-HDFCBK</span><span>now</span></b>
                  Rs.{x.amt.toLocaleString("en-IN")}.00 debited from A/c XX4471 to {x.to.split(" · ")[1]}. Not you? Call 1930.
                </div>
              ))}
              <div className={s.stat} style={{ position: "absolute", top: TXS.length * 74 + 34, left: 0, right: 0, opacity: seg(0.6, 0.72) }}>
                <strong>She is not the only one.</strong>
                <span>24.0 lakh cyber financial fraud complaints in 2025, one every 13 seconds. ₹22,495 crore lost (NCRP, MHA in Rajya Sabha).</span>
              </div>
            </div>
          </div>
          <div className={s.vignette} />
          <div className={s.edge} />
        </div>
      </section>

      {/* ---------------- 4. introducing Anvesh (parallax) ---------------- */}
      <section ref={(el) => { scenes.current[3] = el; }} className={s.scene} style={{ height: "300vh" }}>
        <div className={`${s.stage} ${s.intro}`}>
          <div className={s.introBg} style={{ opacity: `calc(0.35 + ${seg(0, 0.4)} * 0.65)`, transform: `scale(calc(1.3 - ${seg(0, 0.6)} * 0.3))` }} />
          <div className={s.hashRain} style={{ transform: `translateY(calc(${seg(0, 1)} * -18vh))`, opacity: seg(0, 0.25) }}>
            {hashCols.map((c, i) => <span key={i} className={s.hashCol} style={{ left: `${c.l}%`, animationDuration: `${c.d}s`, animationDelay: `${c.dl}s` }}>{c.h}</span>)}
          </div>
          <div className={s.gridFloor} style={{ transform: `perspective(500px) rotateX(62deg) translateY(calc(${seg(0, 1)} * 64px))`, opacity: seg(0.15, 0.45) }} />
          <div className={s.introText}>
            <div className={s.kicker} style={{ opacity: `calc(1 - ${seg(0.9, 1)})`, transform: `translateY(calc((1 - ${seg(0, 0.2)}) * 40px)) scale(calc(1.6 - ${seg(0, 0.2)} * 0.6))` }}>
              Introducing
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/anvesh-wordmark.png" alt="Anvesh" className={s.introLogo} style={{
              margin: "22px auto 0", opacity: seg(0.12, 0.32),
              transform: `translateY(calc((1 - ${seg(0.15, 0.45)}) * 120px)) scale(calc(0.7 + ${seg(0.15, 0.5)} * 0.3))`,
              filter: `blur(calc((1 - ${seg(0.15, 0.4)}) * 14px)) drop-shadow(0 0 60px rgba(249,122,15,.45))`,
            }} />
            <div className={s.tagline} style={{ opacity: seg(0.42, 0.55), transform: `translateY(calc((1 - ${seg(0.42, 0.6)}) * 60px))` }}>
              Hear the <em>distress</em>. Catch the <em>script</em>. Seal the <em>evidence</em>.
            </div>
            <p className={s.introSub} style={{ opacity: seg(0.55, 0.68), transform: `translateY(calc((1 - ${seg(0.55, 0.72)}) * 80px))` }}>
              Real-time speech emotion analysis for cybercrime cells. Anvesh listens alongside the officer, flags fear and coercion
              as the victim speaks, spots cloned voices, and turns the call into a sealed, SHA-256 hashed case file.
            </p>
          </div>
          <div className={s.vignette} />
          <div className={s.edge} />
        </div>
      </section>

      <div className={s.wipe} aria-hidden />
      <div className={s.light}>
      {/* ---------------- features ---------------- */}
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div className={s.kicker} style={{ color: "var(--brand)" }}>What Anvesh does on every call</div>
          <h2>The first sixty seconds decide whether money can be frozen.</h2>
          <p>Anvesh gives the duty officer a second pair of ears: who is in distress, what script is being run, and what details must reach the bank before the golden hour runs out.</p>
        </div>
        <div className={s.cards}>
          {FEATURES.map((f, i) => (
            <article key={f.n} className={s.card} style={{ transitionDelay: `${(i % 3) * 90}ms` }}>
              <div className={s.cardNum}>{f.n}</div>
              <h3>{f.h}</h3>
              <p>{f.p}</p>
              {f.meter && (
                <div className={s.meter}>
                  {[["Distress", 0.82], ["Fear", 0.71], ["Nervousness", 0.64], ["Anger", 0.12]].map(([k, v], j) => (
                    <div key={k as string}><span>{k}</span><i><b style={{ width: `${(v as number) * 100}%`, animationDelay: `${j * 0.3}s` }} /></i><span>{(v as number).toFixed(2)}</span></div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className={s.section} style={{ paddingTop: 0 }}>
        <div className={s.sectionHead}>
          <div className={s.kicker} style={{ color: "var(--brand)" }}>Tamper-evident by design</div>
          <h2>Every step is hashed into the next.</h2>
          <p>Change one byte of a recording or one line of the log and the chain stops verifying. Court-ready integrity, without trusting anyone&apos;s word for it.</p>
        </div>
        <div className={s.chain} aria-hidden>
          <div className={s.chainTrack}>
            {[...BLOCKS, ...BLOCKS].map((b, i) => (
              <div key={i} className={s.block}>
                <b>#{String((i % BLOCKS.length) + 1).padStart(3, "0")} · {b.h}</b><br />
                prev {b.prev.slice(0, 24)}…<br />
                sha256 {b.hash.slice(0, 22)}…
              </div>
            ))}
          </div>
        </div>
        <div className={s.stats}>
          <div><strong>24.0 lakh</strong><span>cyber financial fraud complaints on NCRP in 2025</span></div>
          <div><strong>₹22,495 cr</strong><span>reported lost to those frauds in 2025</span></div>
          <div><strong>5.2 lakh</strong><span>fraud calls and messages reported on Chakshu in 2025</span></div>
          <div><strong>54,639</strong><span>of them impersonated police, CBI, customs or RBI</span></div>
        </div>
        <div className={s.source}>Sources: MHA replies in Rajya Sabha (Sessions 269–270), DoT Chakshu (Sanchar Saathi), NCRB Crime in India 2023. Published under GODL-India.</div>
      </section>

      <section className={`${s.cta} ${s.light}`}>
        <div className={s.kicker}>Built for cybercrime cells and police inspectors</div>
        <h2 style={{ marginTop: 16 }}>Answer the next call<br />with <span style={{ color: "var(--brand)" }}>Anvesh</span>.</h2>
        <div className={s.ctaBtns}>
          <Link href="/login" className={`${s.btn} ${s.btnPrimary}`}>Open the console →</Link>
          <a href="#top" onClick={(e) => { e.preventDefault(); scrollTo({ top: 0, behavior: "smooth" }); }} className={`${s.btn} ${s.btnGhost}`}>Watch again</a>
        </div>
      </section>

      <footer className={`${s.footer} ${s.light}`}>
        <span>Anvesh · Real-time speech emotion analysis for cybercrime investigation</span>
        <span>Emotion readings are indicative signals, not evidence of intent, honesty or guilt.</span>
        <span>Footage: Pexels (free licence). People shown are actors, not real victims or offenders.</span>
      </footer>
      </div>
    </div>
  );
}
