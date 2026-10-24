"""Encrypted-at-rest evidence storage (Fernet / AES-128-CBC + HMAC)."""

from __future__ import annotations

import logging
from pathlib import Path

from cryptography.fernet import Fernet

from .config import settings

log = logging.getLogger("anvesh.storage")
_KEY_FILE = settings.data_dir / ".dev_data_key"


def _key() -> bytes:
    if settings.data_key:
        return settings.data_key.encode()
    if not _KEY_FILE.exists():
        _KEY_FILE.write_bytes(Fernet.generate_key())
        log.warning("ANVESH_DATA_KEY not set: generated a development key at %s. "
                    "Set ANVESH_DATA_KEY from a secret manager in any real deployment.", _KEY_FILE)
    return _KEY_FILE.read_bytes().strip()


_fernet = Fernet(_key())
EVIDENCE_DIR = settings.data_dir / "evidence"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


def save(sha256: str, data: bytes) -> str:
    path = EVIDENCE_DIR / f"{sha256}.bin"
    if not path.exists():
        path.write_bytes(_fernet.encrypt(data))
    return str(path)


def load(path: str) -> bytes:
    return _fernet.decrypt(Path(path).read_bytes())
