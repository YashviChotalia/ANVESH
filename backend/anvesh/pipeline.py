"""Case pipeline: audio -> transcript -> facts -> triage -> links, with audit at each step."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import audit, distress as distress_mod, linker, storage, triage as triage_mod
from .config import settings
from .models import Case, Entity, FieldRow, Recording, Segment
from .nlp import playbooks, safety
from .nlp.extract import Field, Segment as Seg, entities, extract
from .speech import audio as A
from .speech import models as M

log = logging.getLogger("anvesh.pipeline")
PIPELINE_VERSION = "anvesh-pipeline/0.3"
ROLE = {"victim": "victim", "informant": "informant", "suspect_recording": "suspect"}


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10].upper()}"


def model_version() -> str:
    parts = [PIPELINE_VERSION]
    for s in M.statuses():
        if s["loaded"]:
            parts.append(f"{s['name']}={s['model']}")
    return "; ".join(parts)


# --- ingest --------------------------------------------------------------------------------

def add_segments(db: Session, case: Case, items: list[dict], recording_id: str | None = None) -> list[Segment]:
    rows = []
    for it in items:
        lp, nsp = it.get("avg_logprob"), it.get("no_speech_prob")
        low = (lp is not None and lp < -1.0) or (nsp is not None and nsp > 0.6)
        row = Segment(id=new_id("SG"), case_id=case.id, recording_id=recording_id, start=float(it["start"]),
                      end=float(it["end"]), text=it["text"].strip(), speaker=it.get("speaker"),
                      language=it.get("language"), avg_logprob=lp, no_speech_prob=nsp, low_confidence=low,
                      words=it.get("words"))
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def ingest_audio(db: Session, case: Case, data: bytes, filename: str, mime: str, kind: str, actor: str,
                 offset: float = 0.0, transcribe: bool = True, analyse: bool = True) -> Recording:
    digest = audit.sha256_bytes(data)
    path = storage.save(digest, data)
    rec = Recording(id=new_id("RC"), case_id=case.id, kind=kind, filename=filename, mime=mime or "audio/wav",
                    sha256=digest, size_bytes=len(data), stored_path=path)
    db.add(rec)
    db.flush()
    audit.record(db, actor, "recording.ingested", case.id,
                 {"recording_id": rec.id, "sha256": digest, "bytes": len(data), "filename": filename, "kind": kind},
                 model_version())
    x = A.decode(data)
    rec.duration = round(len(x) / A.SR, 2)
    if transcribe:
        segs, lang = M.asr.transcribe(x, offset=offset)
        speaker = "suspect" if kind == "suspect_audio" else None
        for s in segs:
            s["language"] = lang
            s["speaker"] = speaker
        add_segments(db, case, segs, rec.id)
        case.language = case.language or lang
    if analyse:
        analyse_windows(case, x, offset)
    if kind == "suspect_audio":
        emb = M.speaker.embed(x)
        if emb:
            rec.speaker_embedding = emb
    return rec


def analyse_windows(case: Case, x: np.ndarray, offset: float = 0.0) -> None:
    """Voice windows for the distress track. Never computed for suspects."""
    if case.mode == "suspect_recording":
        return
    win = list(case.windows or [])
    for t0, t1, chunk in A.windows(x, 3.0):
        emo = None
        try:
            emo = M.emotion.predict(chunk)
        except Exception as e:  # pragma: no cover
            log.warning("emotion inference failed: %s", e)
        win.append({"t_start": round(t0 + offset, 2), "t_end": round(t1 + offset, 2), "emotions": emo,
                    "acoustic": A.features(chunk)})
    case.windows = win


# --- analysis ------------------------------------------------------------------------------

def _segs(case: Case) -> list[Seg]:
    return [Seg(s.id, s.start, s.end, s.text, s.speaker, s.words) for s in case.segments]


def process(db: Session, case: Case, actor: str = "system", now: datetime | None = None) -> Case:
    now = now or datetime.now()
    segs = _segs(case)
    role = ROLE[case.mode]

    # narrative = what the caller / suspect said (officer lines excluded)
    caller = [s for s in segs if s.speaker != "officer"]
    case.narrative = " ".join(s.text for s in caller)

    # 1) facts with evidence; keep officer-verified or corrected values
    found = extract(caller, case.call_started_at)
    existing = {f.name: f for f in case.fields}
    for name, fld in found.items():
        row = existing.get(name)
        if row and row.status in ("verified", "corrected"):
            continue
        ev = [e.__dict__ for e in fld.evidence]
        if isinstance(fld.value, float) and fld.value.is_integer():
            fld.value = int(fld.value)
        if row:
            row.value, row.display, row.confidence, row.evidence, row.note = (
                str(fld.value), fld.display, fld.confidence, ev, fld.note)
            row.model_value = str(fld.value)
        else:
            db.add(FieldRow(case_id=case.id, name=name, value=str(fld.value), display=fld.display,
                            confidence=fld.confidence, status="predicted", evidence=ev, note=fld.note,
                            model_value=str(fld.value)))
    db.flush()
    db.refresh(case)
    current = {f.name: Field(f.name, f.value, f.display, f.confidence, [], f.status) for f in case.fields}

    # 2) entities for linking (from current values, including corrections)
    db.execute(delete(Entity).where(Entity.case_id == case.id))
    for typ, val in entities(current):
        db.add(Entity(case_id=case.id, type=typ, value=val))

    # 3) playbook + co-pilot (victim / informant) or tactics (suspect)
    pb, conf, cues = playbooks.classify(case.narrative)
    case.playbook_key, case.playbook_conf = pb.key, conf
    if role == "suspect":
        hits = playbooks.tactics_in(case.narrative)
        case.tactics = {"items": [{"key": k, "label": playbooks.TACTIC_LABELS[k], "cues": v} for k, v in hits.items()],
                        "note": "Investigative lead from the recording's words; not a finding of guilt."}
        case.copilot = []
    else:
        case.tactics = {}
        present = set(current)
        case.copilot = playbooks.copilot_prompts(pb, present, set(case.asked or []))

    # 4) human-safety signals (victim / informant only)
    if role == "suspect":
        sig = safety.SafetySignals()
    else:
        sig = safety.scan(caller)
    coercion = len(sig.coercion_hits) > 0
    crisis = len(sig.crisis_hits) > 0
    case.safety = {
        "coercion": coercion, "crisis": crisis,
        "coercion_hits": sig.coercion_hits, "crisis_hits": sig.crisis_hits,
        "coercion_message": ("Victim may be under active coercion. Tell them to end the scammer's call now: "
                             "police do not arrest anyone over a video call.") if coercion else None,
        "crisis_message": safety.CRISIS_RESOURCE if crisis else None,
        "playbook_advice": pb.advice,
    }

    # 5) distress track (role-gated, abstains when unsure)
    windows = [distress_mod.Window(w["t_start"], w["t_end"], w.get("emotions"), w.get("acoustic"))
               for w in (case.windows or [])]
    d = distress_mod.assess(role, windows, sig.distress_lexical, sig.crisis_hits, case.language,
                            set(settings.validated_languages))
    case.distress = d.to_dict()

    # 6) triage
    verified = {f.name for f in case.fields if f.status in ("verified", "corrected")}
    call_age = (now - case.call_started_at).total_seconds() / 60
    t = triage_mod.assess(case.mode, current, now, coercion, crisis, d.level if d.enabled else None, verified,
                          call_age)
    case.triage = t.to_dict()
    case.priority, case.priority_score = t.priority, t.score

    # 7) links
    db.flush()
    db.refresh(case)
    n_links = linker.link_case(db, case)

    audit.record(db, actor, "case.analysed", case.id,
                 {"fields": sorted(current), "priority": t.priority, "score": t.score, "links": n_links,
                  "playbook": pb.key, "coercion": coercion, "crisis": crisis,
                  "distress": d.level}, model_version())
    return case


# --- read-back -----------------------------------------------------------------------------

def readback(case: Case, lang: str = "hi") -> str:
    f = {x.name: x for x in case.fields}
    parts = []
    if lang == "en":
        if "amount_lost" in f:
            parts.append(f"You lost {f['amount_lost'].display.replace('₹', 'rupees ')}")
        if "incident_time" in f:
            parts.append(f"at {f['incident_time'].display.split(' (')[0]}")
        if "upi_id" in f:
            parts.append(f"sent to {f['upi_id'].value.replace('@', ' at ')}")
        if "bank" in f:
            parts.append(f"from your {f['bank'].display} account")
        return (" ".join(parts) + ". Is that correct?") if parts else "I have not captured the details yet."
    if "amount_lost" in f:
        parts.append(f"Aapke {f['amount_lost'].display.replace('₹', '')} rupaye gaye")
    if "incident_time" in f:
        parts.append(f"{f['incident_time'].display.split(' (')[0].split(', ')[-1]} baje")
    if "upi_id" in f:
        parts.append(f"{f['upi_id'].value.replace('@', ' at the rate ')} ko")
    if "bank" in f:
        parts.append(f"{f['bank'].display} khaate se")
    return (", ".join(parts) + ". Kya yeh sahi hai?") if parts else "Abhi tak details record nahi hui hain."


def get_case(db: Session, case_id: str) -> Case | None:
    return db.execute(select(Case).where(Case.id == case_id)).scalar_one_or_none()
