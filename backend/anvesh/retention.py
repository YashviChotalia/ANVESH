"""Data retention: erase cases (and their encrypted evidence) when they are no longer needed.

ANVESH_RETENTION_DAYS (default 0 = keep) erases CLOSED cases older than N days on start-up.
Erasure removes the case, transcript, fields, identifiers, links and evidence files, and records a
redacted audit event; the audit chain itself is never deleted.
Run manually:  python -m anvesh.retention --days 180
"""

from __future__ import annotations

import argparse
import os
from datetime import timedelta

from sqlalchemy import select

from . import audit, storage
from .models import Case, Entity, Link, SessionLocal, utcnow


def erase_case(db, case: Case, actor: str, reason: str) -> None:
    for r in case.recordings:
        storage.delete(r.stored_path)
    db.query(Link).filter((Link.case_a == case.id) | (Link.case_b == case.id)).delete(synchronize_session=False)
    db.query(Entity).filter(Entity.case_id == case.id).delete(synchronize_session=False)
    cid = case.id
    db.delete(case)
    audit.record(db, actor, "case.erased", cid, {"reason": reason[:200]})
    db.flush()


def purge_expired(days: int | None = None) -> int:
    days = int(os.getenv("ANVESH_RETENTION_DAYS", "0")) if days is None else days
    if days <= 0:
        return 0
    cutoff = utcnow() - timedelta(days=days)
    n = 0
    with SessionLocal() as db:
        for c in db.execute(select(Case).where(Case.status == "closed", Case.updated_at < cutoff)).scalars().all():
            erase_case(db, c, "retention", f"closed and older than {days} days")
            n += 1
        db.commit()
    return n


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, required=True)
    print(f"Erased {purge_expired(ap.parse_args().days)} cases.")
