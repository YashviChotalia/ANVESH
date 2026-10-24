"""Coercion and crisis signals in a victim's or informant's own words.

These are *assistance* signals for a human officer, never findings. They are
only computed for victim and informant roles.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

COERCION_PHRASES = [
    "kisi ko mat batana", "kisi ko nahi batana", "kisi ko na batau", "don't tell anyone",
    "do not tell anyone", "told me not to tell", "abhi bhi call pe", "abhi bhi video call",
    "video call pe hain", "video call chal raha", "call chal rahi hai", "still on the call",
    "still on video", "camera on rakhne", "camera on rakhna", "camera band mat", "ghar se bahar mat",
    "room se bahar mat", "phone mat katna", "call mat kaatna", "they are watching",
    "dekh rahe hain", "nazar rakh rahe", "digital arrest mein", "arrest kar lenge",
    "mujhe arrest", "family ko pata nahi", "किसी को मत बताना", "वीडियो कॉल पर",
]

CRISIS_PHRASES = [
    "jeene ka mann nahi", "jine ka man nahi", "sab khatam ho gaya", "sab khatam", "mar jaunga",
    "mar jaungi", "marna chahta", "marna chahti", "khud ko kuch kar", "kuch kar lunga",
    "kuch kar lungi", "suicide", "end my life", "kill myself", "no way out", "life is over",
    "zindagi barbaad", "sab kuch chala gaya", "jaan de dunga", "jaan de dungi",
    "जीने का मन नहीं", "मर जाऊंगा", "सब खत्म",
]

DISTRESS_LEXICON = [
    "please help", "help kijiye", "madad", "bachao", "ro raha", "ro rahi", "dar lag raha",
    "bahut dar", "ghabra", "panic", "scared", "darr", "pareshan", "please sir", "sir please",
    "kya karun", "kya karu", "meri saari savings", "saari savings", "life savings",
]

CRISIS_RESOURCE = "Tele-MANAS mental-health helpline: 14416 (24x7). Hand over to a trained person."


@dataclass
class SafetySignals:
    coercion_hits: list[dict] = field(default_factory=list)
    crisis_hits: list[dict] = field(default_factory=list)
    distress_lexical: list[dict] = field(default_factory=list)


def _find(text: str, phrases: list[str]) -> list[tuple[str, int, int]]:
    """Exact match first; otherwise a spelling-tolerant match (quote then spans the whole line)."""
    from .lexicon import fold
    low = text.lower()
    folded = fold(text)
    out = []
    for p in phrases:
        hits = [(p, m.start(), m.end()) for m in re.finditer(rf"(?<!\w){re.escape(p)}", low)]
        if not hits and re.search(rf"(?<!\w){re.escape(fold(p))}", folded):
            hits = [(p, 0, len(text))]
        out.extend(hits)
    return out


def scan(segments) -> SafetySignals:
    sig = SafetySignals()
    for seg in segments:
        if getattr(seg, "speaker", None) == "officer":
            continue
        for bucket, phrases in ((sig.coercion_hits, COERCION_PHRASES), (sig.crisis_hits, CRISIS_PHRASES),
                                (sig.distress_lexical, DISTRESS_LEXICON)):
            for p, s, e in _find(seg.text, phrases):
                n = max(len(seg.text), 1)
                dur = seg.end - seg.start
                bucket.append({
                    "segment_id": seg.id, "phrase": p, "quote": seg.text[s:e],
                    "t_start": round(seg.start + dur * s / n, 2), "t_end": round(seg.start + dur * e / n, 2),
                })
    return sig
