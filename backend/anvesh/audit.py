"""Tamper-evident, hash-chained audit log.

Each event stores SHA-256(prev_hash || canonical JSON of the event). Editing
or deleting any past row breaks every later hash, which `verify()` reports.
This proves the log was not silently altered; it does not by itself prove a
recording is authentic, complete or lawfully obtained.
"""

from __future__ import annotations

import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditEvent, dumps, utcnow

GENESIS = "0" * 64


def _digest(prev_hash: str, ts: str, actor: str, action: str, case_id: str | None, payload: str,
            model_version: str | None) -> str:
    body = dumps({"ts": ts, "actor": actor, "action": action, "case_id": case_id, "payload": payload,
                  "model_version": model_version})
    return hashlib.sha256((prev_hash + body).encode("utf-8")).hexdigest()


def record(db: Session, actor: str, action: str, case_id: str | None = None, payload: dict | None = None,
           model_version: str | None = None) -> AuditEvent:
    last = db.execute(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(1)).scalar_one_or_none()
    prev = last.hash if last else GENESIS
    ts = utcnow().replace(microsecond=0)
    payload_s = dumps(payload or {})
    h = _digest(prev, ts.isoformat(), actor, action, case_id, payload_s, model_version)
    ev = AuditEvent(ts=ts, actor=actor, action=action, case_id=case_id, payload=payload_s, prev_hash=prev,
                    hash=h, model_version=model_version)
    db.add(ev)
    db.flush()
    return ev


def verify(db: Session) -> dict:
    prev = GENESIS
    count = 0
    for ev in db.execute(select(AuditEvent).order_by(AuditEvent.id)).scalars():
        expected = _digest(prev, ev.ts.replace(microsecond=0).isoformat(), ev.actor, ev.action, ev.case_id,
                           ev.payload, ev.model_version)
        if ev.prev_hash != prev or ev.hash != expected:
            return {"ok": False, "events_checked": count, "broken_at": ev.id,
                    "message": f"Chain broken at event #{ev.id}: the log was altered after it was written."}
        prev = ev.hash
        count += 1
    return {"ok": True, "events_checked": count, "head": prev,
            "message": f"All {count} events verified; the chain is intact."}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
