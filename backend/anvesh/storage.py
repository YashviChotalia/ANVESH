"""Encrypted-at-rest evidence storage (Fernet: AES-128-CBC + HMAC-SHA256, key derived from the master key).

Files are named by a keyed hash, not the plain SHA-256 of the audio, so the filename does not reveal
which recording it is. Evidence written with the old development key is still readable and is
re-encrypted under the current key by `rekey_legacy()`.
"""

from __future__ import annotations

import logging
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from . import keys
from .config import settings

log = logging.getLogger("anvesh.storage")
EVIDENCE_DIR = settings.data_dir / "evidence"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
_LEGACY_KEY_FILE = settings.data_dir / ".dev_data_key"


class EvidenceError(RuntimeError):
    pass


def _fernet() -> MultiFernet:
    ring = [keys.evidence_fernet()]
    if settings.data_key:
        ring.append(Fernet(settings.data_key.encode()))
    if _LEGACY_KEY_FILE.exists():
        ring.append(Fernet(_LEGACY_KEY_FILE.read_bytes().strip()))
    return MultiFernet(ring)


def save(sha256: str, data: bytes) -> str:
    path = EVIDENCE_DIR / f"{keys.redact_digest(sha256)[5:]}.bin"
    if not path.exists():
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(_fernet().encrypt(data))
        tmp.replace(path)
    return str(path)


def _resolve(path: str) -> Path:
    p = Path(path).resolve()
    if EVIDENCE_DIR.resolve() not in p.parents:
        raise EvidenceError("Evidence path is outside the evidence store")
    return p


def load(path: str) -> bytes:
    try:
        return _fernet().decrypt(_resolve(path).read_bytes())
    except InvalidToken as e:
        raise EvidenceError("Evidence file failed authentication (tampered or wrong key)") from e


def delete(path: str) -> None:
    p = _resolve(path)
    if p.exists():
        size = p.stat().st_size
        with open(p, "r+b") as fh:  # overwrite before unlinking (best effort on SSDs)
            fh.write(b"\0" * size)
        p.unlink()


def rekey_legacy() -> int:
    """Re-encrypt evidence written under a legacy key with the current key, then retire the legacy key."""
    if not _LEGACY_KEY_FILE.exists():
        return 0
    f = _fernet()
    n = 0
    for p in EVIDENCE_DIR.glob("*.bin"):
        tok = p.read_bytes()
        try:
            keys.evidence_fernet().decrypt(tok)
            continue
        except InvalidToken:
            pass
        p.write_bytes(f.rotate(tok))
        n += 1
    try:
        _LEGACY_KEY_FILE.unlink()
        log.warning("Re-encrypted %d evidence files and removed the legacy key stored beside the data.", n)
    except OSError:
        log.warning("Re-encrypted %d evidence files; could not remove %s", n, _LEGACY_KEY_FILE)
    return n
