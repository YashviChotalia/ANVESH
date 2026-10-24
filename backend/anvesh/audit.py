"""Tamper-evident, keyed hash chain for the audit log.

Each event stores HMAC-SHA256(audit_key, prev_hash || canonical JSON of the event). Editing, deleting or
re-ordering any past row breaks every later link, and because the chain is keyed, someone with write
access to the database alone cannot recompute a valid chain after tampering. Events written before
keying (alg NULL) are verified with plain SHA-256 and reported as such.

Audit payloads never carry personal data: values under sensitive keys are replaced by a keyed
fingerprint, so the log proves *what changed and who changed it* without becoming a second copy of
the case file. It does not by itself prove a recording is authentic, complete or lawfully obtained.
"""

from __future__ import annotations

import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import keys
from .models import AuditEvent, dumps, utcnow

GENESIS = "0" * 64
SENSITIVE_KEYS = {"before", "after", "value", "caller_label", "model_value", "narrative", "text", "filename",
                  "display", "note", "quote", "name", "phone", "upi", "account", "password"}


def redact(obj):
    if isinstance(obj, dict):
        return {k: (keys.redact_digest(dumps(v)) if k in SENSITIVE_KEYS and v not in (None, "", {}, [])
                    else redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


def _body(ts: str, actor: str, action: str, case_id: str | None, payload: str, model_version: str | None) -> str:
    return dumps({"ts": ts, "actor": actor, "action": action, "case_id": case_id, "payload": payload,
                  "model_version": model_version})


def _digest(prev_hash: str, body: str, alg: str | None) -> str:
    if alg == "hmac":
        return keys.audit_mac(prev_hash + body)
    return hashlib.sha256((prev_hash + body).encode("utf-8")).hexdigest()


def record(db: Session, actor: str, action: str, case_id: str | None = None, payload: dict | None = None,
           model_version: str | None = None) -> AuditEvent:
    last = db.execute(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(1)).scalar_one_or_none()
    prev = last.hash if last else GENESIS
    ts = utcnow().replace(microsecond=0)
    payload_s = dumps(redact(payload or {}))
    h = _digest(prev, _body(ts.isoformat(), actor, action, case_id, payload_s, model_version), "hmac")
    ev = AuditEvent(ts=ts, actor=actor[:80], action=action, case_id=case_id, payload=payload_s, prev_hash=prev,
                    hash=h, model_version=model_version, alg="hmac")
    db.add(ev)
    db.flush()
    return ev


def verify(db: Session) -> dict:
    prev = GENESIS
    count = legacy = 0
    for ev in db.execute(select(AuditEvent).order_by(AuditEvent.id)).scalars():
        body = _body(ev.ts.replace(microsecond=0).isoformat(), ev.actor, ev.action, ev.case_id, ev.payload,
                     ev.model_version)
        if ev.prev_hash != prev or ev.hash != _digest(prev, body, ev.alg):
            return {"ok": False, "events_checked": count, "broken_at": ev.id,
                    "message": f"Chain broken at event #{ev.id}: the log was altered after it was written."}
        legacy += ev.alg != "hmac"
        prev = ev.hash
        count += 1
    msg = f"All {count} events verified; the chain is intact."
    if legacy:
        msg += f" {legacy} early events use unkeyed SHA-256 (written before keyed signing)."
    return {"ok": True, "events_checked": count, "legacy_unkeyed": legacy, "head": prev, "message": msg}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
