"""Runtime configuration from environment variables (12-factor style)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("ANVESH_DATA_DIR", "./data")).resolve())
    db_url: str = os.getenv("ANVESH_DB_URL", "")
    data_key: str | None = os.getenv("ANVESH_DATA_KEY")
    api_token: str | None = os.getenv("ANVESH_API_TOKEN")  # if set, required as Bearer token
    operator: str = os.getenv("ANVESH_OPERATOR", "Officer on duty")
    cors_origins: tuple[str, ...] = tuple(
        o.strip() for o in os.getenv("ANVESH_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip())

    # Speech models (all optional; the API reports what is loaded at /api/health)
    asr_model: str = os.getenv("ANVESH_ASR_MODEL", "small")
    asr_device: str = os.getenv("ANVESH_ASR_DEVICE", "cpu")
    asr_compute: str = os.getenv("ANVESH_ASR_COMPUTE", "int8")
    enable_asr: bool = _bool("ANVESH_ENABLE_ASR", True)
    # "en" decodes Hinglish speech as Roman script (best for extraction); "hi" gives Devanagari;
    # "auto" detects but only among ANVESH_ASR_LANGS (prevents mislabels such as 'jw').
    asr_language: str = os.getenv("ANVESH_ASR_LANGUAGE", "en")
    asr_languages: tuple[str, ...] = tuple(os.getenv("ANVESH_ASR_LANGS", "hi,en").split(","))
    asr_report_language: str = os.getenv("ANVESH_ASR_REPORT_LANGUAGE", "")
    emotion_model: str = os.getenv("ANVESH_EMOTION_MODEL", "iic/emotion2vec_plus_base")
    enable_emotion: bool = _bool("ANVESH_ENABLE_EMOTION", True)
    enable_speaker: bool = _bool("ANVESH_ENABLE_SPEAKER", True)
    text_embedder: str = os.getenv("ANVESH_TEXT_EMBEDDER", "")  # e.g. paraphrase-multilingual-MiniLM-L12-v2

    live_chunk_seconds: float = float(os.getenv("ANVESH_LIVE_CHUNK_SECONDS", "5"))
    validated_languages: tuple[str, ...] = tuple(os.getenv("ANVESH_VALIDATED_LANGS", "en,hi").split(","))

    @property
    def database_url(self) -> str:
        return self.db_url or f"sqlite:///{self.data_dir / 'anvesh.db'}"


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
