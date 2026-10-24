"""Database schema (SQLAlchemy 2.0). SQLite for development, PostgreSQL in deployment."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine,
                        event)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    type_annotation_map = {dict: JSON, list: JSON}


class Case(Base):
    __tablename__ = "cases"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    call_started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    mode: Mapped[str] = mapped_column(String(32))  # victim | suspect_recording | informant
    channel: Mapped[str] = mapped_column(String(32), default="helpline")
    status: Mapped[str] = mapped_column(String(16), default="open")
    caller_label: Mapped[str] = mapped_column(String(120), default="Unnamed caller")
    district: Mapped[str | None] = mapped_column(String(80), nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    priority: Mapped[str] = mapped_column(String(16), default="STANDARD")
    priority_score: Mapped[int] = mapped_column(Integer, default=0)
    playbook_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    playbook_conf: Mapped[float] = mapped_column(Float, default=0.0)
    narrative: Mapped[str] = mapped_column(Text, default="")
    triage: Mapped[dict] = mapped_column(JSON, default=dict)
    distress: Mapped[dict] = mapped_column(JSON, default=dict)
    safety: Mapped[dict] = mapped_column(JSON, default=dict)
    tactics: Mapped[dict] = mapped_column(JSON, default=dict)
    copilot: Mapped[list] = mapped_column(JSON, default=list)
    asked: Mapped[list] = mapped_column(JSON, default=list)
    windows: Mapped[list] = mapped_column(JSON, default=list)
    intake_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    segments: Mapped[list["Segment"]] = relationship(back_populates="case", cascade="all, delete-orphan",
                                                     order_by="Segment.start")
    fields: Mapped[list["FieldRow"]] = relationship(back_populates="case", cascade="all, delete-orphan")
    recordings: Mapped[list["Recording"]] = relationship(back_populates="case", cascade="all, delete-orphan")


class Recording(Base):
    __tablename__ = "recordings"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"))
    kind: Mapped[str] = mapped_column(String(24), default="call")  # call | suspect_audio | live
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(64), default="audio/wav")
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    stored_path: Mapped[str] = mapped_column(String(512))
    speaker_embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    case: Mapped[Case] = relationship(back_populates="recordings")


class Segment(Base):
    __tablename__ = "segments"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    recording_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    start: Mapped[float] = mapped_column(Float)
    end: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)
    speaker: Mapped[str | None] = mapped_column(String(24), nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    avg_logprob: Mapped[float | None] = mapped_column(Float, nullable=True)
    no_speech_prob: Mapped[float | None] = mapped_column(Float, nullable=True)
    low_confidence: Mapped[bool] = mapped_column(Boolean, default=False)
    words: Mapped[list | None] = mapped_column(JSON, nullable=True)
    case: Mapped[Case] = relationship(back_populates="segments")


class FieldRow(Base):
    __tablename__ = "fields"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    value: Mapped[str] = mapped_column(Text)
    display: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default="predicted")
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    case: Mapped[Case] = relationship(back_populates="fields")


class Entity(Base):
    __tablename__ = "entities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    type: Mapped[str] = mapped_column(String(24), index=True)
    value: Mapped[str] = mapped_column(String(255), index=True)


class Link(Base):
    __tablename__ = "links"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_a: Mapped[str] = mapped_column(String(32), index=True)
    case_b: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # identifier | script | voice
    score: Mapped[float] = mapped_column(Float)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="candidate")  # candidate | confirmed | rejected
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(64))
    case_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    payload: Mapped[str] = mapped_column(Text, default="{}")  # canonical JSON string
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    model_version: Mapped[str | None] = mapped_column(String(120), nullable=True)


engine = create_engine(settings.database_url, future=True,
                       connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {})


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - driver hook
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(engine)


def dumps(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
