"""Voice authenticity: is this a live human voice, or possibly synthetic / cloned / replayed?

Two independent signals, combined conservatively:

* A trained detector (ANVESH_SPOOF_MODEL, wav2vec2-style real-vs-fake classifier) when it is loaded.
* Acoustic cues that need no model and are explainable to an officer:
    - pitch micro-variation (jitter): human voices wobble; many TTS and cloned voices are unnaturally steady
    - loudness micro-variation (shimmer): same idea for amplitude
    - digital silence: perfectly clean gaps between words are rare on a real phone line
    - rhythm regularity: synthetic speech often has very even syllable timing

Rules that keep it responsible:
* It abstains on short (< 3 s voiced) or very noisy audio.
* Acoustic cues alone can only reach "needs verification", never "likely synthetic".
* The result is a prompt to verify identity (call back on a known number, ask a question only the real
  person can answer). It never decides that someone is lying or is not a victim.
"""

from __future__ import annotations

import numpy as np

SR = 16000
MIN_VOICED_S = 3.0
LIKELY_SYNTH = 0.75
LIKELY_REAL = 0.30


def _frames(x: np.ndarray, n: int, hop: int) -> np.ndarray:
    if len(x) < n:
        return np.zeros((0, n), dtype=np.float32)
    idx = np.arange(0, len(x) - n + 1, hop)
    return np.stack([x[i:i + n] for i in idx])


def _f0(frame: np.ndarray, sr: int = SR) -> float:
    f = frame - frame.mean()
    ac = np.correlate(f, f, "full")[len(f) - 1:]
    lo, hi = sr // 400, sr // 70  # 70-400 Hz
    if hi >= len(ac) or ac[0] <= 0:
        return 0.0
    k = lo + int(np.argmax(ac[lo:hi]))
    return sr / k if ac[k] / ac[0] > 0.45 else 0.0


def acoustic_cues(x: np.ndarray, sr: int = SR) -> dict:
    fr = _frames(x, int(0.04 * sr), int(0.01 * sr))
    if len(fr) == 0:
        return {"voiced_s": 0.0}
    rms = np.sqrt(np.mean(fr ** 2, axis=1))
    gate = max(0.01, float(np.percentile(rms, 70)) * 0.35)
    voiced = rms > gate
    voiced_s = float(voiced.sum() * 0.01)
    f0 = np.array([_f0(f) if v else 0.0 for f, v in zip(fr[::2], voiced[::2])])
    f0v = f0[f0 > 0]
    jitter = float(np.median(np.abs(np.diff(f0v)) / f0v[1:])) if len(f0v) > 10 else None
    rv = rms[voiced]
    shimmer = float(np.median(np.abs(np.diff(rv)) / (rv[1:] + 1e-9))) if len(rv) > 10 else None
    quiet = rms[~voiced]
    floor_db = float(20 * np.log10(np.percentile(quiet, 50) + 1e-9)) if len(quiet) > 10 else None
    # syllable-rate regularity: coefficient of variation of gaps between energy peaks
    env = np.convolve(rms, np.ones(5) / 5, "same")
    peaks = [i for i in range(1, len(env) - 1) if env[i] > env[i - 1] and env[i] >= env[i + 1] and env[i] > gate * 1.5]
    gaps = np.diff(peaks) if len(peaks) > 4 else np.array([])
    rhythm_cv = float(np.std(gaps) / (np.mean(gaps) + 1e-9)) if len(gaps) > 3 else None
    # speech-to-noise, measured only when there are pauses to measure the noise in
    snr = float(20 * np.log10((np.percentile(rv, 50) + 1e-9) / (np.percentile(quiet, 50) + 1e-9))) if len(quiet) > 10 and len(rv) else None
    return {"voiced_s": round(voiced_s, 1), "jitter": None if jitter is None else round(jitter, 4),
            "shimmer": None if shimmer is None else round(shimmer, 4),
            "noise_floor_db": None if floor_db is None else round(floor_db, 1),
            "rhythm_cv": None if rhythm_cv is None else round(rhythm_cv, 3), "snr_db": None if snr is None else round(snr, 1)}


def _cue_score(c: dict) -> tuple[float, list[str]]:
    """0 = natural, 1 = machine-like. Returns score and human-readable reasons."""
    pts, reasons = [], []
    if c.get("jitter") is not None:
        s = float(np.clip((0.012 - c["jitter"]) / 0.010, 0, 1))
        pts.append(s)
        if s > 0.6:
            reasons.append("Pitch is unusually steady (very little natural wobble)")
    if c.get("shimmer") is not None:
        s = float(np.clip((0.06 - c["shimmer"]) / 0.05, 0, 1))
        pts.append(s)
        if s > 0.6:
            reasons.append("Loudness is unusually even from moment to moment")
    if c.get("noise_floor_db") is not None:
        s = float(np.clip((-65 - c["noise_floor_db"]) / 20, 0, 1))
        pts.append(s)
        if s > 0.6:
            reasons.append("Gaps between words are digitally silent (no line or room noise)")
    if c.get("rhythm_cv") is not None:
        s = float(np.clip((0.35 - c["rhythm_cv"]) / 0.25, 0, 1))
        pts.append(s * 0.7)
        if s > 0.6:
            reasons.append("Syllable timing is unusually regular")
    return (float(np.mean(pts)) if pts else 0.0), reasons


def assess(x: np.ndarray, p_model: float | None, model_id: str | None = None, mode: str = "victim") -> dict:
    c = acoustic_cues(x)
    out = {"verdict": "not_checked", "score": None, "model_score": None if p_model is None else round(p_model, 3),
           "cue_score": None, "model": model_id if p_model is not None else None, "cues": c, "reasons": [],
           "abstain": [], "advice": None}
    if c.get("voiced_s", 0) < MIN_VOICED_S:
        out["abstain"].append(f"Less than {MIN_VOICED_S:.0f} s of clear speech")
    if c.get("snr_db") is not None and c["snr_db"] < 6:
        out["abstain"].append("Too much background noise to judge")
    if out["abstain"]:
        out["verdict"] = "insufficient_audio"
        return out
    cue, reasons = _cue_score(c)
    out["cue_score"] = round(cue, 3)
    out["reasons"] = reasons
    if p_model is not None:
        score = 0.75 * p_model + 0.25 * cue
        out["verdict"] = ("likely_synthetic" if score >= LIKELY_SYNTH else
                          "likely_real" if score <= LIKELY_REAL else "needs_verification")
        if p_model >= 0.8:
            out["reasons"].insert(0, f"Detector model rates the voice as machine-generated ({p_model:.0%})")
    else:
        score = cue
        out["abstain"].append("Synthetic-voice model not loaded: acoustic cues only")
        out["verdict"] = "needs_verification" if cue >= 0.65 else "likely_real" if cue <= 0.25 else "uncertain"
    out["score"] = round(score, 3)
    # what the officer sees: real voice / real victim vs. possible fake caller (never a final finding)
    role = {"victim": "victim", "informant": "informant", "suspect_recording": "speaker"}.get(mode, "caller")
    out["caller_class"] = {
        "likely_real": f"real_{role}", "likely_synthetic": f"possible_fake_{role}",
        "needs_verification": "verify_identity",
    }.get(out["verdict"], "undetermined")
    if out["verdict"] in ("likely_synthetic", "needs_verification"):
        who = {"victim": "the caller is the real complainant", "informant": "the informant is genuine",
               "suspect_recording": "this is a real person's voice"}.get(mode, "the caller is genuine")
        out["advice"] = (f"Verify that {who}: call back on a number from an independent source and ask something "
                         "only the real person would know. Do not treat this as proof of deception.")
    return out


LABEL = {"likely_real": "Consistent with a live human voice", "uncertain": "No clear signal",
         "needs_verification": "Possibly synthetic, verify the caller", "likely_synthetic": "Likely synthetic or cloned voice",
         "insufficient_audio": "Not enough clear speech to check", "not_checked": "Not checked"}
