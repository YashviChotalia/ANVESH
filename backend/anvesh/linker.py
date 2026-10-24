"""Ring Linker: connect a case to earlier complaints.

Three link types, in falling order of reliability:
  identifier  exact match on UPI ID / phone / account / IFSC / UTR  (deterministic)
  script      similar scam script (char n-gram TF-IDF, or a multilingual sentence model if configured)
  voice       similar caller voice on *suspect* recordings only (speaker embeddings) - a lead, never a match

Every link is a candidate with a score until an officer confirms it.
"""

from __future__ import annotations

import logging
from collections import defaultdict

import numpy as np
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .config import settings
from .models import Case, Entity, FieldRow, Link, Recording

log = logging.getLogger("anvesh.linker")

SCRIPT_THRESHOLD = 0.32
VOICE_THRESHOLD = 0.62
ENTITY_LABELS = {"upi_id": "UPI ID", "phone_number": "phone number", "account_number": "account number",
                 "ifsc": "IFSC", "transaction_id": "UTR", "email": "email"}

_st_model = None


def _sentence_model():  # pragma: no cover - optional dependency
    global _st_model
    if _st_model is None and settings.text_embedder:
        try:
            from sentence_transformers import SentenceTransformer
            _st_model = SentenceTransformer(settings.text_embedder)
        except Exception as e:
            log.warning("text embedder unavailable (%s); using TF-IDF", e)
            _st_model = False
    return _st_model or None


def script_similarity(target: str, others: list[str]) -> list[float]:
    if not target.strip() or not others:
        return [0.0] * len(others)
    model = _sentence_model()
    if model:
        vecs = model.encode([target, *others], normalize_embeddings=True)
        return [float(v) for v in vecs[1:] @ vecs[0]]
    from sklearn.feature_extraction.text import TfidfVectorizer
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=1, sublinear_tf=True, lowercase=True)
    m = vec.fit_transform([target, *others])
    sims = (m[1:] @ m[0].T).toarray().ravel()
    return [float(s) for s in sims]


def _upsert(db: Session, a: str, b: str, kind: str, score: float, detail: dict) -> None:
    a, b = sorted((a, b))
    existing = db.execute(select(Link).where(Link.case_a == a, Link.case_b == b, Link.kind == kind)).scalar_one_or_none()
    if existing:
        if existing.status != "rejected":
            existing.score = round(score, 3)
            existing.detail = detail
        return
    db.add(Link(case_a=a, case_b=b, kind=kind, score=round(score, 3), detail=detail))


def link_case(db: Session, case: Case) -> int:
    """(Re)compute links from `case` to every other case. Returns links found."""
    found = 0
    # 1) identifiers
    mine = db.execute(select(Entity).where(Entity.case_id == case.id)).scalars().all()
    for ent in mine:
        others = db.execute(select(Entity).where(Entity.type == ent.type, Entity.value == ent.value,
                                                 Entity.case_id != case.id)).scalars().all()
        for o in others:
            _upsert(db, case.id, o.case_id, "identifier", 1.0,
                    {"type": ent.type, "value": ent.value,
                     "reason": f"Same {ENTITY_LABELS.get(ent.type, ent.type)}: {ent.value}"})
            found += 1

    # 2) scam script
    if case.narrative and len(case.narrative) > 40:
        rows = db.execute(select(Case.id, Case.narrative).where(Case.id != case.id)).all()
        rows = [r for r in rows if r.narrative and len(r.narrative) > 40]
        sims = script_similarity(case.narrative, [r.narrative for r in rows])
        for r, s in zip(rows, sims):
            if s >= SCRIPT_THRESHOLD:
                _upsert(db, case.id, r.id, "script", s,
                        {"reason": f"Similar scam script (similarity {s:.2f})",
                         "method": "sentence-embedding" if _sentence_model() else "char n-gram TF-IDF"})
                found += 1

    # 3) voice (suspect recordings only)
    my_recs = [r for r in case.recordings if r.kind == "suspect_audio" and r.speaker_embedding]
    if my_recs:
        others = db.execute(select(Recording).where(Recording.kind == "suspect_audio",
                                                    Recording.case_id != case.id,
                                                    Recording.speaker_embedding.is_not(None))).scalars().all()
        for r in my_recs:
            a = np.array(r.speaker_embedding)
            for o in others:
                s = float(a @ np.array(o.speaker_embedding))
                if s >= VOICE_THRESHOLD:
                    _upsert(db, case.id, o.case_id, "voice", s,
                            {"reason": f"Possibly the same caller voice (cosine {s:.2f}); needs human review",
                             "recordings": [r.id, o.id]})
                    found += 1
    db.flush()
    return found


def case_links(db: Session, case_id: str) -> list[Link]:
    return db.execute(select(Link).where(or_(Link.case_a == case_id, Link.case_b == case_id),
                                         Link.status != "rejected").order_by(Link.score.desc())).scalars().all()


def _amount(db: Session, case_id: str) -> float:
    f = db.execute(select(FieldRow).where(FieldRow.case_id == case_id, FieldRow.name == "amount_lost")).scalar_one_or_none()
    try:
        return float(f.value) if f else 0.0
    except ValueError:
        return 0.0


def rings(db: Session, min_score: float = 0.0) -> list[dict]:
    """Connected components over non-rejected links."""
    links = db.execute(select(Link).where(Link.status != "rejected", Link.score >= min_score)).scalars().all()
    adj: dict[str, set[str]] = defaultdict(set)
    for l in links:
        adj[l.case_a].add(l.case_b)
        adj[l.case_b].add(l.case_a)
    seen: set[str] = set()
    out = []
    for start in sorted(adj):
        if start in seen:
            continue
        comp, stack = [], [start]
        while stack:
            n = stack.pop()
            if n in seen:
                continue
            seen.add(n)
            comp.append(n)
            stack.extend(adj[n] - seen)
        comp_set = set(comp)
        comp_links = [l for l in links if l.case_a in comp_set]
        cases = db.execute(select(Case).where(Case.id.in_(comp))).scalars().all()
        shared = sorted({l.detail.get("value") for l in comp_links if l.kind == "identifier" and l.detail.get("value")})
        out.append({
            "id": "RING-" + min(comp).split("-")[-1],
            "cases": sorted(comp),
            "size": len(comp),
            "districts": sorted({c.district for c in cases if c.district}),
            "total_amount": sum(_amount(db, c) for c in comp),
            "shared_identifiers": shared,
            "link_kinds": sorted({l.kind for l in comp_links}),
            "confirmed": sum(1 for l in comp_links if l.status == "confirmed"),
            "candidates": sum(1 for l in comp_links if l.status == "candidate"),
            "playbooks": sorted({c.playbook_key for c in cases if c.playbook_key}),
            "synthetic": all(c.synthetic for c in cases),
        })
    out.sort(key=lambda r: (-r["size"], -r["total_amount"]))
    return out
