"""Structured incident extraction with evidence links.

Every field carries the transcript segment, character span and audio time it
came from, so an officer can jump from "UPI ID: ramesh@okaxis" straight to
the second of audio where the caller said it.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta

from . import lexicon as L
from .normalize import Normalized, normalize


@dataclass
class Segment:
    id: str
    start: float  # seconds from recording start
    end: float
    text: str
    speaker: str | None = None  # "caller", "officer", "suspect", ... (operator-assigned)
    words: list[dict] | None = None  # optional word timestamps [{word, start, end}]


@dataclass
class Evidence:
    segment_id: str
    t_start: float
    t_end: float
    char_start: int
    char_end: int
    quote: str


@dataclass
class Field:
    name: str
    value: str | float | int
    display: str
    confidence: float
    evidence: list[Evidence] = field(default_factory=list)
    status: str = "predicted"  # predicted | reported | verified | corrected | missing
    note: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def _seg_time(seg: Segment, char_start: int, char_end: int) -> tuple[float, float]:
    """Approximate audio time of a char span inside a segment."""
    n = max(len(seg.text), 1)
    if seg.words:
        # map by cumulative character length of words
        pos = 0
        t0 = t1 = None
        for w in seg.words:
            wl = len(w.get("word", "")) + 1
            if t0 is None and pos + wl > char_start:
                t0 = float(w["start"])
            if pos <= char_end:
                t1 = float(w["end"])
            pos += wl
        if t0 is not None and t1 is not None:
            return round(t0, 2), round(max(t1, t0), 2)
    dur = max(seg.end - seg.start, 0.0)
    return (round(seg.start + dur * char_start / n, 2), round(seg.start + dur * char_end / n, 2))


def _evidence(seg: Segment, norm: Normalized, s: int, e: int) -> Evidence:
    os_, oe = norm.source_span(s, e)
    t0, t1 = _seg_time(seg, os_, oe)
    return Evidence(seg.id, t0, t1, os_, oe, seg.text[os_:oe])


def _window(text: str, s: int, e: int, size: int = 40) -> str:
    return text[max(0, s - size): min(len(text), e + size)].lower()


def _has_any(text: str, cues: list[str]) -> bool:
    return any(re.search(rf"(?<!\w){re.escape(c)}(?!\w)", text) for c in cues)


def _fmt_inr(v: float) -> str:
    v = int(round(v))
    s = str(v)
    if len(s) <= 3:
        return f"₹{s}"
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return "₹" + ",".join(parts + [tail])


PHONE_RE = re.compile(r"(?<!\d)(?:\+?91[\s-]?|0)?([6-9]\d{9})(?!\d)")
UPI_RE = re.compile(r"(?<![\w.])([a-z0-9][a-z0-9._-]{1,63})@([a-z][a-z0-9.]{1,63})(?![\w@])", re.I)
IFSC_RE = re.compile(r"(?<![A-Za-z0-9])([A-Za-z]{4}0[A-Za-z0-9]{6})(?![A-Za-z0-9])")
LONG_NUM_RE = re.compile(r"(?<![\d.])(\d{9,18})(?![\d.])")
NUM_RE = re.compile(r"(?<![\w.@])(\d+(?:\.\d+)?)(?![\w@])")
CLOCK_RE = re.compile(r"(?<!\d)(\d{1,2})(?::(\d{2})|\.(5))?\s*(baje|bje|am|pm|o'?clock)", re.I)
REL_RE = re.compile(
    r"(?<!\w)(\d+(?:\.\d+)?|aadha|adha|half|an|a|ek)?\s*(" + "|".join(L.RELATIVE_TIME_UNITS) + r")\s*(?:"
    + "|".join(L.AGO_WORDS) + r")",
    re.I,
)
UTR_CUE_RE = re.compile(r"(utr|transaction id|txn id|reference number|ref no|ref number|transaction number)", re.I)
CURRENCY_CUES = ["₹", "rs", "rupees", "rupaye", "rupay", "rupiya", "inr", "रुपये", "rupee"]


def _lexicon_hits(text: str, table: dict[str, list[str]]) -> list[tuple[str, int, int]]:
    hits = []
    low = f" {text.lower()} "
    for canon, aliases in table.items():
        for a in aliases:
            # not inside a UPI ID / email / dotted handle such as "cbi.verification@ybl"
            for m in re.finditer(rf"(?<![\w.@]){re.escape(a.strip())}(?![\w@]|\.\w)", low):
                hits.append((canon, m.start() - 1, m.end() - 1))
    return hits


def extract(segments: list[Segment], call_started_at: datetime | None = None) -> dict[str, Field]:
    """Extract incident fields from transcript segments."""
    call_started_at = call_started_at or datetime.now()
    fields: dict[str, Field] = {}
    amounts: list[tuple[float, Evidence, bool, bool]] = []  # value, ev, is_total, strong
    times: list[tuple[datetime, Evidence, float, bool]] = []  # when, ev, conf, near_loss
    multi: dict[str, list[tuple[str, Evidence]]] = {k: [] for k in
                                                    ("upi_id", "phone_number", "account_number",
                                                     "ifsc", "transaction_id", "email")}

    for seg in segments:
        norm = normalize(seg.text)
        t = norm.text
        tl = t.lower()

        # --- UPI IDs and emails
        for m in UPI_RE.finditer(t):
            user, handle = m.group(1), m.group(2).lower()
            ev = _evidence(seg, norm, m.start(), m.end())
            if "." in handle:
                multi["email"].append((f"{user}@{handle}".lower(), ev))
            else:
                multi["upi_id"].append((f"{user}@{handle}".lower(), ev))

        # --- UTR / transaction ids (12-digit after a cue)
        utr_spans = []
        for cm in UTR_CUE_RE.finditer(t):
            nm = re.search(r"\d{10,22}", t[cm.end(): cm.end() + 40])
            if nm:
                s = cm.end() + nm.start()
                utr_spans.append((s, s + len(nm.group())))
                multi["transaction_id"].append((nm.group(), _evidence(seg, norm, s, s + len(nm.group()))))

        def in_utr(s: int, e: int) -> bool:
            return any(a <= s and e <= b for a, b in utr_spans)

        # --- phones
        phone_spans = []
        for m in PHONE_RE.finditer(t):
            if in_utr(m.start(1), m.end(1)):
                continue
            phone_spans.append((m.start(), m.end()))
            multi["phone_number"].append((m.group(1), _evidence(seg, norm, m.start(), m.end())))

        # --- account numbers (long numbers that are not phones/UTRs)
        acct_spans = []
        for m in LONG_NUM_RE.finditer(t):
            s, e = m.span(1)
            if in_utr(s, e) or any(a <= s < b for a, b in phone_spans):
                continue
            acct_spans.append((s, e))
            multi["account_number"].append((m.group(1), _evidence(seg, norm, s, e)))

        # --- IFSC
        for m in IFSC_RE.finditer(t):
            multi["ifsc"].append((m.group(1).upper(), _evidence(seg, norm, m.start(), m.end())))

        # --- clock times (exclude from amounts)
        clock_spans = []
        for m in CLOCK_RE.finditer(t):
            clock_spans.append((m.start(), m.end()))
            h = int(m.group(1))
            mins = int(m.group(2)) if m.group(2) else (30 if m.group(3) else 0)
            suffix = m.group(4).lower()
            win = _window(t, m.start(), m.end(), 30)
            if suffix == "pm" and h < 12:
                h += 12
            elif suffix in ("baje", "bje"):
                for dp, base in L.DAYPART_HOURS.items():
                    if dp in win:
                        if base >= 12 and h < 12:
                            h += 12
                        break
                else:
                    # no day part: assume the most recent past occurrence
                    cand = call_started_at.replace(hour=h % 24, minute=mins, second=0, microsecond=0)
                    if cand > call_started_at and h < 12:
                        cand2 = cand.replace(hour=h + 12)
                        if cand2 <= call_started_at:
                            h += 12
            if h > 23 or mins > 59:
                continue
            day_off = 0
            for w, off in L.TODAY_WORDS.items():
                if re.search(rf"(?<!\w){w}(?!\w)", win):
                    day_off = off
                    break
            when = (call_started_at - timedelta(days=day_off)).replace(hour=h, minute=mins, second=0, microsecond=0)
            if when > call_started_at:
                when -= timedelta(days=1)
            times.append((when, _evidence(seg, norm, m.start(), m.end()), 0.75,
                          _has_any(win, L.LOSS_CUES)))

        # --- relative times ("aadha ghanta pehle", "20 minutes ago")
        for m in REL_RE.finditer(t):
            qty_raw = (m.group(1) or "1").lower()
            qty = {"aadha": 0.5, "adha": 0.5, "half": 0.5, "an": 1, "a": 1, "ek": 1}.get(qty_raw)
            if qty is None:
                try:
                    qty = float(qty_raw)
                except ValueError:
                    qty = 1
            unit = L.RELATIVE_TIME_UNITS[m.group(2).lower()]
            when = call_started_at - timedelta(minutes=qty * unit)
            times.append((when, _evidence(seg, norm, m.start(), m.end()), 0.85,
                          _has_any(_window(t, m.start(), m.end(), 60), L.LOSS_CUES)))
            clock_spans.append((m.start(), m.end()))
        for jn in L.JUST_NOW:
            for m in re.finditer(re.escape(jn), tl):
                times.append((call_started_at - timedelta(minutes=5), _evidence(seg, norm, m.start(), m.end()),
                              0.6, True))
        if re.search(r"(?<!\w)(kal|yesterday)(?!\w)", tl) and not any(
                ev.segment_id == seg.id for _, ev, _, _ in times):
            m = re.search(r"(?<!\w)(kal|yesterday)(?!\w)", tl)
            dp_hour = next((hh for dp, hh in L.DAYPART_HOURS.items() if dp in tl), 12)
            when = (call_started_at - timedelta(days=1)).replace(hour=dp_hour, minute=0, second=0, microsecond=0)
            times.append((when, _evidence(seg, norm, m.start(), m.end()), 0.45, _has_any(tl, L.LOSS_CUES)))

        # --- amounts
        for m in NUM_RE.finditer(t):
            s, e = m.span(1)
            if any(a <= s < b for a, b in phone_spans + acct_spans + clock_spans + utr_spans):
                continue
            val = float(m.group(1))
            win = _window(t, s, e, 45)
            has_cur = _has_any(win, CURRENCY_CUES) or "₹" in win
            loss = _has_any(win, L.LOSS_CUES)
            demand = _has_any(win, L.DEMAND_CUES)
            if val < 50 and not has_cur:
                continue
            if not (has_cur or loss):
                continue
            if demand and (not loss or _has_any(win, L.NEGATED_LOSS)):
                continue
            if _has_any(win, L.NEGATED_LOSS) and not has_cur:
                continue
            is_total = bool(re.search(r"(total|kul|सब मिला|overall|in total|milake|mila ke)", win))
            # include a preceding "₹" in the evidence span
            ss = s - 2 if t[max(0, s - 2):s].strip() == "₹" else s
            amounts.append((val, _evidence(seg, norm, ss, e), is_total, loss and has_cur))

        # --- lexicon fields
        for name, table in (("bank", L.BANKS), ("payment_app", L.PAYMENT_APPS),
                            ("claimed_agency", L.AGENCIES), ("platform", L.PLATFORMS)):
            for canon, s, e in _lexicon_hits(t, table):
                ev = _evidence(seg, norm, max(s, 0), max(e, s + 1))
                f = fields.get(name)
                if f is None:
                    fields[name] = Field(name, canon, canon, 0.7, [ev])
                elif canon == f.value:
                    f.evidence.append(ev)
                elif name in ("platform", "claimed_agency"):
                    if canon not in str(f.value).split(", "):
                        f.value = f"{f.value}, {canon}"
                        f.display = f.value
                        f.evidence.append(ev)

    # --- resolve multi-valued identifiers
    for name, items in multi.items():
        if not items:
            continue
        values: dict[str, list[Evidence]] = {}
        for v, ev in items:
            values.setdefault(v, []).append(ev)
        ordered = list(values.items())
        display = ", ".join(v for v, _ in ordered)
        conf = 0.9 if name in ("upi_id", "ifsc") else 0.8
        f = Field(name, display, display, conf, [ev for _, evs in ordered for ev in evs])
        if len(ordered) > 1:
            f.note = f"{len(ordered)} different values heard; confirm which is the recipient."
            f.confidence = round(conf - 0.15, 2)
        fields[name] = f

    # --- resolve amount lost
    if amounts:
        totals = [a for a in amounts if a[2]]
        if totals:
            val, ev, _, _ = max(totals, key=lambda a: a[0])
            fields["amount_lost"] = Field("amount_lost", val, _fmt_inr(val), 0.85, [ev],
                                          note="Caller stated a total.")
        else:
            distinct: dict[float, list[Evidence]] = {}
            for v, ev, _, _ in amounts:
                distinct.setdefault(v, []).append(ev)
            if len(distinct) == 1:
                (val, evs), = distinct.items()
                strong = any(a[3] for a in amounts)
                fields["amount_lost"] = Field("amount_lost", val, _fmt_inr(val), 0.85 if strong else 0.65, evs)
            else:
                total = sum(distinct)
                evs = [e for es in distinct.values() for e in es]
                fields["amount_lost"] = Field(
                    "amount_lost", total, _fmt_inr(total), 0.55, evs,
                    note=f"Sum of {len(distinct)} amounts heard ({', '.join(_fmt_inr(v) for v in distinct)}); "
                         "confirm the total with the caller.")

    # --- resolve incident time: prefer times near a loss cue, then highest confidence
    if times:
        when, ev, conf, _ = sorted(times, key=lambda x: (not x[3], -x[0].timestamp(), -x[2]))[0]
        mins_ago = max(int((call_started_at - when).total_seconds() // 60), 0)
        fields["incident_time"] = Field("incident_time", when.isoformat(timespec="minutes"),
                                        f"{when.strftime('%d %b, %H:%M')} ({_ago(mins_ago)})", conf, [ev])

    return fields


def _ago(mins: int) -> str:
    if mins < 60:
        return f"{mins} min ago"
    if mins < 1440:
        h = mins / 60
        return f"{h:.1f} h ago" if h < 10 else f"{int(h)} h ago"
    return f"{mins // 1440} d ago"


def minutes_since(field_: Field | None, now: datetime) -> int | None:
    if not field_:
        return None
    try:
        when = datetime.fromisoformat(str(field_.value))
    except ValueError:
        return None
    return max(int((now - when).total_seconds() // 60), 0)


ENTITY_FIELDS = ("upi_id", "phone_number", "account_number", "ifsc", "transaction_id", "email")


def entities(fields: dict[str, Field]) -> list[tuple[str, str]]:
    """(type, normalised value) pairs used for cross-case linking."""
    out = []
    for name in ENTITY_FIELDS:
        f = fields.get(name)
        if not f:
            continue
        for v in str(f.value).split(", "):
            v = v.strip().lower()
            if v:
                out.append((name, v))
    return out
