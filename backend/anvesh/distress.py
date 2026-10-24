"""Distress track: role-gated, uncertainty-aware fusion of voice and words.

Output is an *indicative assistance signal* for human prioritisation. It is
never computed for suspects and never used as evidence of honesty or guilt.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from statistics import mean, pstdev

DISTRESS_EMOTIONS = {"fearful": 1.0, "fear": 1.0, "sad": 0.8, "angry": 0.6, "anger": 0.6, "disgusted": 0.3}
ALLOWED_ROLES = {"victim", "informant"}


@dataclass
class Window:
    t_start: float
    t_end: float
    emotions: dict[str, float] | None = None  # label -> probability (from the emotion model)
    acoustic: dict[str, float] | None = None  # pitch_std, rms, speech_rate, pause_ratio, snr_db
    silent: bool = False


@dataclass
class DistressResult:
    enabled: bool
    level: str  # off | abstain | low | elevated | high
    score: float | None
    confidence: str  # none | low | medium
    timeline: list[dict] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    abstain_reasons: list[str] = field(default_factory=list)
    label: str = "Acoustic and lexical observation, indicative only, not evidence."

    def to_dict(self) -> dict:
        return asdict(self)


def _emo_score(emotions: dict[str, float] | None) -> float | None:
    if not emotions:
        return None
    return min(sum(p * DISTRESS_EMOTIONS.get(k.lower(), 0.0) for k, p in emotions.items()), 1.0)


def _acoustic_scores(windows: list[Window]) -> list[float | None]:
    """Change against the speaker's own baseline (first 20% of windows)."""
    feats = [w.acoustic for w in windows]
    usable = [f for f in feats if f]
    if len(usable) < 3:
        return [None] * len(windows)
    k = max(2, len(usable) // 5)
    base = usable[:k]

    def stat(key):
        vals = [f.get(key, 0.0) for f in base]
        return mean(vals), (pstdev(vals) or 1e-6)

    stats = {key: stat(key) for key in ("pitch_std", "rms", "speech_rate", "pause_ratio")}
    out: list[float | None] = []
    for f in feats:
        if not f:
            out.append(None)
            continue
        z = 0.0
        for key, wgt in (("pitch_std", 0.35), ("rms", 0.25), ("speech_rate", 0.2), ("pause_ratio", 0.2)):
            mu, sd = stats[key]
            z += wgt * max(min((f.get(key, mu) - mu) / sd, 3.0), -3.0)
        out.append(max(min(0.5 + z / 6.0, 1.0), 0.0))
    return out


def assess(role: str, windows: list[Window], lexical_hits: list[dict], crisis_hits: list[dict],
           language: str | None = None, validated_languages: set[str] | None = None) -> DistressResult:
    if role not in ALLOWED_ROLES:
        return DistressResult(False, "off", None, "none",
                              reasons=[f"Distress analysis is disabled for the '{role}' role by policy."])

    abstain: list[str] = []
    validated_languages = validated_languages or {"en", "hi"}
    if language and language not in validated_languages:
        abstain.append(f"Language '{language}' is not validated for voice distress; showing word cues only.")
    if not windows:
        abstain.append("No usable audio windows.")
    low_snr = [w for w in windows if w.acoustic and w.acoustic.get("snr_db", 99) < 8]
    if windows and len(low_snr) > len(windows) / 2:
        abstain.append("Audio quality too low for reliable voice analysis.")

    windows = [w for w in windows if not w.silent]  # silence carries no emotion
    acoustic = _acoustic_scores(windows)
    timeline = []
    scores = []
    model_used = False
    for w, a in zip(windows, acoustic):
        e = _emo_score(w.emotions)
        if e is not None:
            model_used = True
        if e is not None and a is not None:
            s = 0.6 * e + 0.4 * a
        else:
            s = e if e is not None else a
        if s is None:
            continue
        scores.append(s)
        top = max(w.emotions.items(), key=lambda kv: kv[1]) if w.emotions else None
        if top and top[1] < 0.45:
            top = ("uncertain", top[1])  # no emotion clearly dominant
        timeline.append({"t": round((w.t_start + w.t_end) / 2, 2), "score": round(s, 3),
                         "emotion": round(e, 3) if e is not None else None,
                         "acoustic": round(a, 3) if a is not None else None,
                         "label": top[0] if top else None, "p": round(top[1], 3) if top else None})

    reasons = []
    lex_boost = min(0.05 * len(lexical_hits), 0.2)
    if lexical_hits:
        reasons.append(f"{len(lexical_hits)} distress phrase(s) in the caller's words")
    if crisis_hits:
        reasons.append("Crisis language detected: hand over to a trained person")

    voice_ok = bool(scores) and not abstain
    if not voice_ok:
        level = "high" if crisis_hits else ("elevated" if len(lexical_hits) >= 2 else "abstain")
        return DistressResult(True, level, None, "low" if (lexical_hits or crisis_hits) else "none",
                              timeline, reasons, abstain or ["Voice signal unavailable."])

    peak_window = sorted(scores)[-max(1, len(scores) // 4):]  # sustained top quartile, not one spike
    sustained = mean(peak_window)
    score = min(sustained + lex_boost + (0.25 if crisis_hits else 0.0), 1.0)
    if crisis_hits or score >= 0.72:
        level = "high"
    elif score >= 0.5:
        level = "elevated"
    else:
        level = "low"
    if model_used:
        reasons.insert(0, "Voice emotion model + pitch/energy change vs the caller's own baseline")
    else:
        reasons.insert(0, "Pitch/energy/pace change vs the caller's own baseline (emotion model not loaded)")
    conf = "medium" if model_used and len(scores) >= 4 else "low"
    return DistressResult(True, level, round(score, 3), conf, timeline, reasons, [])
