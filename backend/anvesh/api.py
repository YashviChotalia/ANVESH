"""Anvesh HTTP + WebSocket API."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field as PField
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import audit, linker, pipeline, storage
from .config import settings
from .models import AuditEvent, Case, FieldRow, Link, Recording, Segment, SessionLocal, init_db, utcnow
from .nlp import playbooks
from .speech import audio as A
from .speech import models as M
from .triage import FIELD_LABELS

log = logging.getLogger("anvesh.api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

@asynccontextmanager
async def lifespan(_app):
    init_db()
    M.warmup()  # load speech models in the background so the first live call does not wait
    yield


init_db()
app = FastAPI(title="Anvesh API", version="0.3.0", lifespan=lifespan,
              description="Role-aware cybercrime call intelligence: call → case file → linked rings.")
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


def db_session():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def actor(authorization: str | None = Header(default=None), x_operator: str | None = Header(default=None)) -> str:
    if settings.api_token and authorization != f"Bearer {settings.api_token}":
        raise HTTPException(401, "Missing or invalid API token")
    return (x_operator or settings.operator)[:80]


# --- serialisation ----------------------------------------------------------------------------

def _field_json(f: FieldRow) -> dict:
    return {"name": f.name, "label": FIELD_LABELS.get(f.name, f.name), "value": f.value, "display": f.display,
            "confidence": f.confidence, "status": f.status, "evidence": f.evidence, "note": f.note,
            "model_value": f.model_value, "updated_by": f.updated_by}


def _amount(case: Case) -> float:
    for f in case.fields:
        if f.name == "amount_lost":
            try:
                return float(f.value)
            except ValueError:
                return 0.0
    return 0.0


def case_summary(case: Case) -> dict:
    pb = playbooks.PLAYBOOK_BY_KEY.get(case.playbook_key or "")
    return {
        "id": case.id, "created_at": case.created_at.isoformat() + "Z", "mode": case.mode, "channel": case.channel,
        "status": case.status, "caller_label": case.caller_label, "district": case.district,
        "priority": case.priority, "priority_score": case.priority_score, "synthetic": case.synthetic,
        "playbook": {"key": case.playbook_key, "label": pb.label if pb else "Type unclear", "confidence": case.playbook_conf},
        "amount": _amount(case), "headline": (case.triage or {}).get("headline"),
        "coercion": bool((case.safety or {}).get("coercion")), "crisis": bool((case.safety or {}).get("crisis")),
        "language": case.language, "intake_seconds": case.intake_seconds,
    }


def case_detail(db: Session, case: Case) -> dict:
    links = linker.case_links(db, case.id)
    other_ids = {l.case_b if l.case_a == case.id else l.case_a for l in links}
    others = {c.id: c for c in db.execute(select(Case).where(Case.id.in_(other_ids))).scalars()} if other_ids else {}
    d = case_summary(case)
    d.update({
        "call_started_at": case.call_started_at.isoformat() + "Z",
        "segments": [{"id": s.id, "start": s.start, "end": s.end, "text": s.text, "speaker": s.speaker,
                      "language": s.language, "low_confidence": s.low_confidence, "recording_id": s.recording_id}
                     for s in case.segments],
        "fields": sorted((_field_json(f) for f in case.fields),
                         key=lambda f: list(FIELD_LABELS).index(f["name"]) if f["name"] in FIELD_LABELS else 99),
        "triage": case.triage, "distress": case.distress, "safety": case.safety, "tactics": case.tactics,
        "copilot": case.copilot,
        "recordings": [{"id": r.id, "kind": r.kind, "filename": r.filename, "sha256": r.sha256,
                        "duration": r.duration, "size_bytes": r.size_bytes, "offset": r.offset or 0.0,
                        "has_voiceprint": bool(r.speaker_embedding)} for r in case.recordings],
        "links": [{"id": l.id, "kind": l.kind, "score": l.score, "status": l.status, "detail": l.detail,
                   "other": case_summary(others[o]) if (o := (l.case_b if l.case_a == case.id else l.case_a)) in others else {"id": o}}
                  for l in links],
    })
    return d


def _get(db: Session, case_id: str) -> Case:
    c = pipeline.get_case(db, case_id)
    if not c:
        raise HTTPException(404, "Case not found")
    return c


# --- schemas ----------------------------------------------------------------------------------

class CaseIn(BaseModel):
    mode: str = PField(pattern="^(victim|suspect_recording|informant)$")
    channel: str = PField(default="helpline", pattern="^(helpline|upload|informant_line|walk_in)$")
    caller_label: str = "Unnamed caller"
    district: str | None = None
    call_started_at: datetime | None = None
    synthetic: bool = False


class CasePatch(BaseModel):
    status: str | None = PField(default=None, pattern="^(open|review|closed)$")
    mode: str | None = PField(default=None, pattern="^(victim|suspect_recording|informant)$")
    district: str | None = None
    caller_label: str | None = None


class SegmentIn(BaseModel):
    start: float
    end: float
    text: str
    speaker: str | None = None


class SegmentsIn(BaseModel):
    segments: list[SegmentIn]


class FieldAction(BaseModel):
    action: str = PField(pattern="^(verify|correct|reject|reported)$")
    value: str | None = None
    display: str | None = None


class SpeakerPatch(BaseModel):
    speaker: str = PField(pattern="^(caller|officer|suspect|informant|unknown)$")


class LinkPatch(BaseModel):
    status: str = PField(pattern="^(confirmed|rejected|candidate)$")


# --- routes -----------------------------------------------------------------------------------

@app.get("/api/health")
def health(db: Session = Depends(db_session)):
    db.execute(select(func.count(Case.id))).scalar()
    return {"ok": True, "version": app.version, "pipeline": pipeline.PIPELINE_VERSION, "models": M.statuses(),
            "validated_languages": list(settings.validated_languages)}


@app.get("/api/stats")
def stats(db: Session = Depends(db_session), who: str = Depends(actor)):
    cases = db.execute(select(Case)).scalars().all()
    open_ = [c for c in cases if c.status != "closed"]
    rings = linker.rings(db)
    timed = [c.intake_seconds for c in cases if c.intake_seconds]
    since = utcnow() - timedelta(hours=24)
    return {
        "open_cases": len(open_), "immediate": sum(1 for c in open_ if c.priority == "IMMEDIATE"),
        "safety_alerts": sum(1 for c in open_ if (c.safety or {}).get("coercion") or (c.safety or {}).get("crisis")),
        "rings": len([r for r in rings if r["size"] >= 2]),
        "linked_cases": sum(r["size"] for r in rings),
        "reported_loss": sum(_amount(c) for c in open_),
        "median_intake_seconds": float(np.median(timed)) if timed else None,
        "last_24h": sum(1 for c in cases if c.created_at >= since),
    }


@app.get("/api/cases")
def list_cases(status: str | None = None, priority: str | None = None, db: Session = Depends(db_session),
               who: str = Depends(actor)):
    q = select(Case)
    if status:
        q = q.where(Case.status == status)
    if priority:
        q = q.where(Case.priority == priority)
    rows = db.execute(q).scalars().all()
    rows.sort(key=lambda c: (-c.priority_score, -(c.created_at.timestamp())))
    return [case_summary(c) for c in rows]


@app.post("/api/cases", status_code=201)
def create_case(body: CaseIn, db: Session = Depends(db_session), who: str = Depends(actor)):
    now = datetime.now()
    year = now.year
    n = (db.execute(select(func.count(Case.id))).scalar() or 0) + 1
    case = Case(id=f"AV-{year}-{n:05d}", mode=body.mode, channel=body.channel, caller_label=body.caller_label,
                district=body.district, synthetic=body.synthetic,
                call_started_at=(body.call_started_at or now).replace(tzinfo=None))
    while pipeline.get_case(db, case.id):
        n += 1
        case.id = f"AV-{year}-{n:05d}"
    db.add(case)
    db.flush()
    audit.record(db, who, "case.created", case.id, {"mode": body.mode, "channel": body.channel,
                                                    "synthetic": body.synthetic})
    pipeline.process(db, case, who)
    return case_detail(db, case)


@app.get("/api/cases/{case_id}")
def get_case(case_id: str, db: Session = Depends(db_session), who: str = Depends(actor)):
    case = _get(db, case_id)
    audit.record(db, who, "case.viewed", case.id)
    return case_detail(db, case)


@app.patch("/api/cases/{case_id}")
def patch_case(case_id: str, body: CasePatch, db: Session = Depends(db_session), who: str = Depends(actor)):
    case = _get(db, case_id)
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(case, k, v)
    audit.record(db, who, "case.updated", case.id, changes)
    pipeline.process(db, case, who)
    return case_detail(db, case)


@app.post("/api/cases/{case_id}/segments")
def add_segments(case_id: str, body: SegmentsIn, db: Session = Depends(db_session), who: str = Depends(actor)):
    """Add transcript lines (operator notes, a typed transcript, or seed data)."""
    case = _get(db, case_id)
    pipeline.add_segments(db, case, [s.model_dump() for s in body.segments])
    audit.record(db, who, "transcript.added", case.id, {"segments": len(body.segments), "source": "text"})
    db.refresh(case)
    pipeline.process(db, case, who)
    return case_detail(db, case)


@app.patch("/api/cases/{case_id}/segments/{seg_id}")
def label_segment(case_id: str, seg_id: str, body: SpeakerPatch, db: Session = Depends(db_session),
                  who: str = Depends(actor)):
    case = _get(db, case_id)
    seg = db.get(Segment, seg_id)
    if not seg or seg.case_id != case.id:
        raise HTTPException(404, "Segment not found")
    seg.speaker = body.speaker
    audit.record(db, who, "speaker.labelled", case.id, {"segment_id": seg_id, "speaker": body.speaker})
    pipeline.process(db, case, who)
    return case_detail(db, case)


@app.post("/api/cases/{case_id}/recordings")
async def upload_recording(case_id: str, file: UploadFile = File(...), kind: str = Form("call"),
                           db: Session = Depends(db_session), who: str = Depends(actor)):
    if kind not in ("call", "suspect_audio"):
        raise HTTPException(422, "kind must be 'call' or 'suspect_audio'")
    case = _get(db, case_id)
    data = await file.read()
    if not data:
        raise HTTPException(422, "Empty file")
    st = M.asr.status()
    if st.state in ("disabled", "error"):
        raise HTTPException(503, f"Speech-to-text model is not available on this server: {st.error}. "
                                 "Install requirements-ml.txt (see README).")
    offset = max((s.end for s in case.segments), default=0.0)
    x = await asyncio.to_thread(A.decode, data)
    res = await asyncio.to_thread(pipeline.transcribe_and_analyse, x, case.mode, kind, offset)
    pipeline.ingest_audio(db, case, data, file.filename or "upload", file.content_type, kind, who, offset,
                          precomputed=res)
    db.refresh(case)
    pipeline.process(db, case, who)
    return case_detail(db, case)


@app.get("/api/recordings/{rec_id}/audio")
def recording_audio(rec_id: str, db: Session = Depends(db_session), who: str = Depends(actor)):
    rec = db.get(Recording, rec_id)
    if not rec:
        raise HTTPException(404, "Recording not found")
    data = storage.load(rec.stored_path)
    if audit.sha256_bytes(data) != rec.sha256:
        raise HTTPException(409, "Integrity check failed: stored evidence does not match its recorded hash")
    audit.record(db, who, "evidence.accessed", rec.case_id, {"recording_id": rec.id, "sha256": rec.sha256})
    return Response(content=data, media_type=rec.mime or "audio/wav",
                    headers={"X-Evidence-SHA256": rec.sha256, "Cache-Control": "no-store"})


@app.patch("/api/cases/{case_id}/fields/{name}")
def act_on_field(case_id: str, name: str, body: FieldAction, db: Session = Depends(db_session),
                 who: str = Depends(actor)):
    case = _get(db, case_id)
    row = next((f for f in case.fields if f.name == name), None)
    if body.action == "correct" and row is None:
        row = FieldRow(case_id=case.id, name=name, value="", display="", confidence=1.0, evidence=[],
                       model_value=None)
        db.add(row)
    if row is None:
        raise HTTPException(404, "Field not found")
    before = {"value": row.value, "status": row.status}
    if body.action == "verify":
        row.status = "verified"
    elif body.action == "reported":
        row.status = "reported"
    elif body.action == "correct":
        if body.value is None:
            raise HTTPException(422, "value is required to correct a field")
        row.value = body.value
        row.display = body.display or body.value
        row.status = "corrected"
        row.confidence = 1.0
    elif body.action == "reject":
        db.delete(row)
    row.updated_by = who
    audit.record(db, who, f"field.{body.action}", case.id, {"field": name, "before": before,
                                                             "after": {"value": body.value}})
    db.flush()
    db.refresh(case)
    pipeline.process(db, case, who)
    return case_detail(db, case)


@app.post("/api/cases/{case_id}/copilot/{key}/asked")
def mark_asked(case_id: str, key: str, db: Session = Depends(db_session), who: str = Depends(actor)):
    case = _get(db, case_id)
    case.asked = sorted(set(case.asked or []) | {key})
    pipeline.process(db, case, who)
    return case_detail(db, case)


@app.post("/api/cases/{case_id}/complete")
def complete_intake(case_id: str, db: Session = Depends(db_session), who: str = Depends(actor)):
    case = _get(db, case_id)
    case.status = "review"
    case.intake_seconds = round((utcnow() - case.created_at).total_seconds(), 1)
    audit.record(db, who, "intake.completed", case.id, {"intake_seconds": case.intake_seconds})
    return case_detail(db, case)


@app.get("/api/cases/{case_id}/readback")
def readback(case_id: str, lang: str = Query("hi", pattern="^(hi|en)$"), db: Session = Depends(db_session),
             who: str = Depends(actor)):
    case = _get(db, case_id)
    text = pipeline.readback(case, lang)
    audit.record(db, who, "readback.generated", case.id, {"lang": lang})
    return {"lang": lang, "text": text}


@app.get("/api/cases/{case_id}/report")
def report(case_id: str, db: Session = Depends(db_session), who: str = Depends(actor)):
    """Editable complaint draft; every field points to its evidence. Not a legal determination."""
    case = _get(db, case_id)
    detail = case_detail(db, case)
    head = audit.verify(db)
    audit.record(db, who, "report.generated", case.id)
    return {
        "title": f"Complaint draft · {case.id}",
        "disclaimer": "Draft for officer review. AI outputs are indicative and must be verified; "
                      "this document does not determine guilt or credibility.",
        "case": {k: detail[k] for k in ("id", "mode", "channel", "caller_label", "district", "created_at",
                                        "priority", "playbook")},
        "fields": detail["fields"], "triage": detail["triage"], "tactics": detail["tactics"],
        "links": detail["links"], "recordings": detail["recordings"],
        "integrity": {"audit_chain_ok": head["ok"], "audit_head": head.get("head"),
                      "pipeline": pipeline.model_version()},
    }


@app.get("/api/graph")
def graph(db: Session = Depends(db_session), who: str = Depends(actor)):
    links = db.execute(select(Link).where(Link.status != "rejected")).scalars().all()
    ids = {l.case_a for l in links} | {l.case_b for l in links}
    cases = db.execute(select(Case).where(Case.id.in_(ids))).scalars().all() if ids else []
    return {"nodes": [case_summary(c) for c in cases],
            "edges": [{"id": l.id, "source": l.case_a, "target": l.case_b, "kind": l.kind, "score": l.score,
                       "status": l.status, "reason": l.detail.get("reason")} for l in links],
            "rings": linker.rings(db)}


@app.patch("/api/links/{link_id}")
def review_link(link_id: int, body: LinkPatch, db: Session = Depends(db_session), who: str = Depends(actor)):
    l = db.get(Link, link_id)
    if not l:
        raise HTTPException(404, "Link not found")
    l.status = body.status
    audit.record(db, who, f"link.{body.status}", l.case_a, {"link_id": l.id, "case_b": l.case_b, "kind": l.kind})
    return {"id": l.id, "status": l.status}


@app.get("/api/audit")
def audit_log(case_id: str | None = None, limit: int = 200, db: Session = Depends(db_session),
              who: str = Depends(actor)):
    q = select(AuditEvent).order_by(AuditEvent.id.desc()).limit(min(limit, 1000))
    if case_id:
        q = q.where(AuditEvent.case_id == case_id)
    return [{"id": e.id, "ts": e.ts.isoformat() + "Z", "actor": e.actor, "action": e.action, "case_id": e.case_id,
             "payload": e.payload, "hash": e.hash, "prev_hash": e.prev_hash, "model_version": e.model_version}
            for e in db.execute(q).scalars()]


@app.get("/api/audit/verify")
def audit_verify(db: Session = Depends(db_session), who: str = Depends(actor)):
    return audit.verify(db)


@app.get("/api/radar")
def radar(days: int = 7, db: Session = Depends(db_session), who: str = Depends(actor)):
    """Campaign radar: which scam types are rising, where. Counts complaints, not verified crimes."""
    now = utcnow()
    since = now - timedelta(days=days)
    cases = [c for c in db.execute(select(Case).where(Case.created_at >= since)).scalars() if c.mode != "suspect_recording"]
    out = []
    for key in {c.playbook_key or "other" for c in cases}:
        group = [c for c in cases if (c.playbook_key or "other") == key]
        last24 = [c for c in group if c.created_at >= now - timedelta(hours=24)]
        prior_daily = (len(group) - len(last24)) / max(days - 1, 1)
        pb = playbooks.PLAYBOOK_BY_KEY.get(key)
        out.append({
            "key": key, "label": pb.label if pb else "Type unclear", "last_24h": len(last24), "last_period": len(group),
            "prior_daily_avg": round(prior_daily, 2), "rising": len(last24) >= 2 and len(last24) > 2 * prior_daily,
            "districts": sorted({c.district for c in group if c.district}),
            "reported_loss": sum(_amount(c) for c in group),
        })
    out.sort(key=lambda r: (-r["last_24h"], -r["last_period"]))
    return {"days": days, "groups": out}


@app.get("/api/playbooks")
def list_playbooks(who: str = Depends(actor)):
    return [{"key": p.key, "label": p.label, "required": list(p.required), "advice": p.advice}
            for p in [*playbooks.PLAYBOOKS, playbooks.GENERIC]]


# --- live streaming ---------------------------------------------------------------------------

@app.websocket("/ws/cases/{case_id}/live")
async def live(ws: WebSocket, case_id: str, token: str | None = None, operator: str | None = None):
    """Browser sends 16 kHz mono PCM16 frames; server transcribes ~5 s chunks and pushes case updates."""
    if settings.api_token and token != settings.api_token:
        await ws.close(code=4401)
        return
    await ws.accept()
    who = (operator or settings.operator)[:80]
    st = M.asr.status()
    if st.state in ("disabled", "error"):
        await ws.send_json({"type": "error", "message": f"Speech-to-text model not available: {st.error}"})
        await ws.close()
        return
    if st.state != "ready":
        M.asr.start_loading()
        await ws.send_json({"type": "status", "message": "Speech-to-text model is still loading; audio is buffered "
                                                         "and will be transcribed as soon as it is ready."})
    buf = bytearray()
    full = bytearray()
    chunk_bytes = int(settings.live_chunk_seconds * A.SR) * 2
    with SessionLocal() as db0:
        c0 = pipeline.get_case(db0, case_id)
        if not c0:
            await ws.send_json({"type": "error", "message": "Case not found"})
            await ws.close()
            return
        offset = max((s.end for s in c0.segments), default=0.0)
        mode = c0.mode
    start_offset = offset

    async def flush(final: bool = False):
        nonlocal offset
        if len(buf) < A.SR * 2 * 0.8 and not final:
            return
        x = A.pcm16_to_float(bytes(buf))
        buf.clear()
        # slow model work first, with no database transaction open
        res = ({"segments": [], "language": None, "windows": []} if len(x) < A.SR // 2 else
               await asyncio.to_thread(pipeline.transcribe_and_analyse, x, mode, "call", offset))
        with SessionLocal() as db:
            case = pipeline.get_case(db, case_id)
            if res["segments"]:
                pipeline.add_segments(db, case, res["segments"])
            case.language = case.language or res["language"]
            if res["windows"]:
                case.windows = list(case.windows or []) + res["windows"]
            db.flush()
            db.refresh(case)
            pipeline.process(db, case, who)
            if final and full:
                wav = A.to_wav_bytes(A.pcm16_to_float(bytes(full)))
                rec = pipeline.ingest_audio(db, case, wav, f"live-{case.id}.wav", "audio/wav", "call", who,
                                            start_offset, precomputed={})
                for sg in case.segments:  # tie this session's lines to the saved audio for playback
                    if sg.recording_id is None and sg.start >= start_offset - 0.01:
                        sg.recording_id = rec.id
                db.flush()
                db.refresh(case)
            db.commit()
            detail = case_detail(db, case)
        offset += len(x) / A.SR
        await ws.send_json({"type": "update", "case": detail, "final": final})

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes"):
                buf.extend(msg["bytes"])
                full.extend(msg["bytes"])
                if len(buf) >= chunk_bytes:
                    await flush()
            elif msg.get("text"):
                if '"stop"' in msg["text"]:
                    await flush(final=True)
                    await ws.close()
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:  # pragma: no cover
        log.exception("live session failed")
        try:
            await ws.send_json({"type": "error", "message": str(e)[:300]})
        except Exception:
            pass
