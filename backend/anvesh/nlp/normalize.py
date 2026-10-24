"""Hinglish / Hindi / English spoken-form normalisation.

Victims describe fraud the way people talk on the phone:
"saadhe paanch hazaar", "ramesh at the rate okaxis", "nau aath saat ...",
"aadha ghanta pehle". Speech-to-text keeps these as words, so pattern
matching on raw transcripts misses most identifiers. This module turns
spoken forms into canonical text *while keeping a character map back to the
original*, so every extracted field can still point at the exact words (and
audio timestamps) it came from.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# --- number vocabulary -------------------------------------------------------

UNITS: dict[str, float] = {
    # Romanised Hindi
    "ek": 1, "do": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5,
    "chhe": 6, "chhah": 6, "chah": 6, "che": 6, "saat": 7, "aath": 8, "aat": 8, "nau": 9,
    "das": 10, "dus": 10, "gyarah": 11, "gyaarah": 11, "barah": 12, "baarah": 12,
    "terah": 13, "chaudah": 14, "chaudha": 14, "pandrah": 15, "pandra": 15, "solah": 16,
    "satrah": 17, "atharah": 18, "athaarah": 18, "unnis": 19, "unnees": 19, "bees": 20,
    "pachees": 25, "pachchees": 25, "pachis": 25, "tees": 30, "paintees": 35,
    "chalis": 40, "chaalis": 40, "paintalis": 45, "pachaas": 50, "pachas": 50,
    "saath": 60, "sattar": 70, "pachattar": 75, "assi": 80, "nabbe": 90, "nabbey": 90,
    # English
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    # Devanagari
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6,
    "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "बीस": 20, "पच्चीस": 25, "तीस": 30,
    "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90,
}

MULTIPLIERS: dict[str, float] = {
    "sau": 100, "so": 100, "hundred": 100, "सौ": 100,
    "hazaar": 1_000, "hazar": 1_000, "hajar": 1_000, "hazaar.": 1_000, "thousand": 1_000,
    "k": 1_000, "हज़ार": 1_000, "हजार": 1_000,
    "lakh": 100_000, "lac": 100_000, "lakhs": 100_000, "laakh": 100_000, "लाख": 100_000,
    "crore": 10_000_000, "karod": 10_000_000, "karor": 10_000_000, "cr": 10_000_000,
    "करोड़": 10_000_000, "करोड": 10_000_000,
    "million": 1_000_000,
}

# Fraction words: "dedh lakh" = 1.5 lakh, "dhai hazaar" = 2,500
STANDALONE_FRACTIONS: dict[str, float] = {
    "dedh": 1.5, "derh": 1.5, "डेढ़": 1.5, "dhai": 2.5, "dhaai": 2.5, "ढाई": 2.5,
    "aadha": 0.5, "adha": 0.5, "half": 0.5, "आधा": 0.5,
}
# Modifiers on the following number: "saadhe paanch" = 5.5, "sava do" = 2.25
MODIFIERS: dict[str, float] = {
    "saadhe": 0.5, "sadhe": 0.5, "saade": 0.5, "sade": 0.5, "साढ़े": 0.5,
    "sava": 0.25, "savaa": 0.25, "सवा": 0.25,
    "paune": -0.25, "paune.": -0.25, "पौने": -0.25,
}

SINGLE_DIGITS: dict[str, str] = {
    "zero": "0", "shunya": "0", "sunya": "0", "one": "1", "ek": "1", "two": "2", "do": "2",
    "three": "3", "teen": "3", "four": "4", "char": "4", "chaar": "4", "five": "5",
    "paanch": "5", "panch": "5", "six": "6", "chhe": "6", "che": "6", "seven": "7",
    "saat": "7", "eight": "8", "aath": "8", "nine": "9", "nau": "9", "double": "",
    "triple": "",
}

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

AT_FORMS = [
    r"at\s+the\s+rate(?:\s+of)?", r"at\s+rate", r"एट\s+द\s+रेट", r"ऐट\s+द\s+रेट",
]


@dataclass
class Normalized:
    """Normalised text plus a map from each output char to an input char index."""

    original: str
    text: str
    index_map: list[int] = field(default_factory=list)

    def source_span(self, start: int, end: int) -> tuple[int, int]:
        """Map a span in normalised text back to the original text."""
        if not self.index_map:
            return start, end
        s = self.index_map[min(start, len(self.index_map) - 1)]
        e = self.index_map[min(max(end - 1, 0), len(self.index_map) - 1)] + 1
        return s, max(e, s + 1)


class _Builder:
    def __init__(self, original: str):
        self.original = original
        self.out: list[str] = []
        self.idx: list[int] = []

    def emit(self, text: str, src_start: int, src_end: int) -> None:
        if not text:
            return
        n = len(text)
        span = max(src_end - src_start, 1)
        for i, ch in enumerate(text):
            self.out.append(ch)
            off = 0 if n == 1 else round(i * (span - 1) / (n - 1))
            self.idx.append(src_start + off)

    def build(self) -> Normalized:
        return Normalized(self.original, "".join(self.out), self.idx)


_TOKEN_RE = re.compile(
    r"₹|\d{1,2}:\d{2}|\d+(?:,\d{2,3})*(?:\.\d+)?|[^\W_]+|[@.:/,\-]|\S", re.UNICODE
)
_DOT = "\x00."  # a "." that came from a spoken "dot" (safe to glue)


def _clean(word: str) -> str:
    return word.lower().strip(".,")


def parse_number_words(words: list[str]) -> tuple[float | None, int]:
    """Parse a spoken Indian-system number from the start of `words`.

    Returns (value, tokens_consumed); value is None if no number starts here.
    Handles "saadhe paanch hazaar" (5,500), "dedh lakh" (1,50,000),
    "do lakh pachaas hazaar" (2,50,000), "50k", "1.5 lakh", "25 hazaar".
    """
    total = 0.0
    current: float | None = None
    i = 0
    consumed_any = False
    pending_mod = 0.0
    can_add = True  # a new number may start only at the beginning or after a multiplier
    while i < len(words):
        w = _clean(words[i])
        is_num = bool(re.fullmatch(r"\d+(\.\d+)?", w.replace(",", ""))) or w in UNITS
        if is_num and not can_add:
            break
        if w in MODIFIERS and i + 1 < len(words):
            nxt = _clean(words[i + 1])
            if nxt in UNITS or re.fullmatch(r"\d+(\.\d+)?", nxt):
                pending_mod = MODIFIERS[w]
                i += 1
                consumed_any = True
                continue
            break
        if re.fullmatch(r"\d+(\.\d+)?", w.replace(",", "")):
            val = float(w.replace(",", ""))
            current = (current or 0) + val + pending_mod
            pending_mod = 0.0
            consumed_any = True
            can_add = False
            i += 1
            continue
        m = re.fullmatch(r"(\d+(?:\.\d+)?)k", w)
        if m:
            total += float(m.group(1)) * 1000
            consumed_any = True
            i += 1
            continue
        if w in STANDALONE_FRACTIONS and current is None and can_add:
            current = STANDALONE_FRACTIONS[w]
            consumed_any = True
            can_add = False
            i += 1
            continue
        if w in UNITS:
            current = (current or 0) + UNITS[w] + pending_mod
            pending_mod = 0.0
            consumed_any = True
            can_add = False
            i += 1
            continue
        if w in MULTIPLIERS and consumed_any and not (w == "so" and current is None):
            mult = MULTIPLIERS[w]
            base = current if current is not None else 1.0
            if mult == 100:
                current = base * 100
            else:
                total += base * mult
                current = None
            can_add = True
            i += 1
            continue
        break
    if not consumed_any:
        return None, 0
    value = total + (current or 0)
    return value, i


def _spoken_digit_run(words: list[str]) -> tuple[str | None, int]:
    """Parse runs like "nau aath saat six five ..." or "double five" into digits."""
    digits: list[str] = []
    group_lens: list[int] = []
    i = 0
    repeat = 1
    while i < len(words):
        w = _clean(words[i])
        if w == "double":
            repeat = 2
            i += 1
            continue
        if w == "triple":
            repeat = 3
            i += 1
            continue
        if re.fullmatch(r"\d{1,5}", w):
            if len(w) > 1:
                group_lens.append(len(w))
            digits.append(w * repeat if len(w) == 1 else w)
        elif w in SINGLE_DIGITS and SINGLE_DIGITS[w]:
            digits.append(SINGLE_DIGITS[w] * repeat)
        else:
            break
        repeat = 1
        i += 1
    joined = "".join(digits)
    if group_lens and len(set(group_lens[:-1] or group_lens)) > 1:
        return None, 0
    if group_lens and len(group_lens) == len(digits) and any(g.endswith("000") for g in digits):
        return None, 0  # "5000 2000 3000" are amounts, not an account number
    min_tokens = 2 if group_lens and len(group_lens) == len(digits) else 3
    if len(joined) >= 6 and i >= min_tokens:
        return joined, i
    return None, 0


def normalize(text: str) -> Normalized:
    """Normalise a transcript segment for pattern matching (keeps a char map)."""
    text = unicodedata.normalize("NFC", text).translate(DEVANAGARI_DIGITS)
    b = _Builder(text)

    # 1) "at the rate" -> "@", "dot" -> "." (inside handles) before tokenising.
    work = text
    spans: list[tuple[int, int, str]] = []
    for pat in AT_FORMS:
        for m in re.finditer(pat, work, flags=re.IGNORECASE):
            spans.append((m.start(), m.end(), "@"))
    for m in re.finditer(r"(?<=\w)\s+dot\s+(?=\w)", work, flags=re.IGNORECASE):
        spans.append((m.start(), m.end(), _DOT))
    spans.sort()

    tokens: list[tuple[str, int, int]] = []
    pos = 0
    for s, e, rep in spans:
        if s < pos:
            continue
        for m in _TOKEN_RE.finditer(work, pos, s):
            tokens.append((m.group(), m.start(), m.end()))
        tokens.append((rep, s, e))
        pos = e
    for m in _TOKEN_RE.finditer(work, pos):
        tokens.append((m.group(), m.start(), m.end()))

    # 2a) Glue spoken "word dot word" into "word.word".
    dotted: list[tuple[str, int, int]] = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t[0] == _DOT and dotted and i + 1 < len(tokens):
            prev = dotted.pop()
            nxt = tokens[i + 1]
            dotted.append((prev[0] + "." + nxt[0], prev[1], nxt[2]))
            i += 2
            continue
        dotted.append((". " if t[0] == _DOT else t[0], t[1], t[2]) if t[0] == _DOT else t)
        i += 1
    tokens = dotted

    # 2b) Glue "name @ handle" into "name@handle".
    glued: list[tuple[str, int, int]] = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t[0] == "@" and glued and i + 1 < len(tokens):
            prev = glued.pop()
            # absorb a typed "name.part" chain written without spaces, e.g. "safe.account.rbi"
            while (len(glued) >= 2 and glued[-1][0] == "." and glued[-1][2] == prev[1]
                   and glued[-2][2] == glued[-1][1] and glued[-2][0].replace("_", "").isalnum()):
                glued.pop()  # the '.'
                left = glued.pop()
                prev = (left[0] + "." + prev[0], left[1], prev[2])
            nxt = tokens[i + 1]
            handle = (prev[0] + "@" + nxt[0]).lower()
            glued.append((handle, prev[1], nxt[2]))
            i += 2
            # absorb ".something" continuation (rare, e.g. name@bank.upi)
            while i + 1 < len(tokens) and tokens[i][0] == "." and tokens[i + 1][0].isalnum():
                last = glued.pop()
                glued.append((last[0] + "." + tokens[i + 1][0].lower(), last[1], tokens[i + 1][2]))
                i += 2
            continue
        glued.append(t)
        i += 1
    tokens = glued

    # 3) Numbers: spoken digit runs (phones/accounts) first, then amounts.
    words = [t[0] for t in tokens]
    i = 0
    out_parts: list[tuple[str, int, int]] = []
    while i < len(tokens):
        run, n = _spoken_digit_run(words[i:])
        if run:
            out_parts.append((run, tokens[i][1], tokens[i + n - 1][2]))
            i += n
            continue
        val, n = parse_number_words(words[i:])
        if val is not None and n > 0:
            # keep plain single numerals as they are (e.g. "2" in "2 baje")
            if n == 1 and re.fullmatch(r"\d+(?:,\d{2,3})*(\.\d+)?", words[i]):
                out_parts.append((words[i].replace(",", ""), tokens[i][1], tokens[i][2]))
            else:
                v = int(val) if float(val).is_integer() else round(val, 2)
                out_parts.append((str(v), tokens[i][1], tokens[i + n - 1][2]))
            i += n
            continue
        out_parts.append(tokens[i])
        i += 1

    # 4) Re-join with single spaces, keeping the char map.
    for k, (tok, s, e) in enumerate(out_parts):
        if k > 0:
            gap_src = out_parts[k - 1][2]
            b.emit(" ", gap_src, max(s, gap_src + 1))
        b.emit(tok, s, e)
    return b.build()


__all__ = ["Normalized", "normalize", "parse_number_words"]
