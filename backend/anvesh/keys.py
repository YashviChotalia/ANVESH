"""Key management and field-level encryption.

One 256-bit master key (KEK) is loaded from ANVESH_MASTER_KEY (base64) or a key file that lives
OUTSIDE the data directory (default ~/.anvesh/keys/master.key), so a copied database or backup
does not carry the key that decrypts it. Purpose-specific keys are derived with HKDF-SHA256:

  field   - AES-256-GCM for personal data in database columns (column name bound as AAD)
  index   - HMAC-SHA256 "blind index" so identifiers can be matched across cases without storing them
  audit   - HMAC-SHA256 for the audit chain (a DB-only attacker cannot re-forge the chain)
  evidence- Fernet key for evidence files
  session - HMAC for session-token and CSRF hashing

Production deployments should supply the master key from a KMS/HSM via ANVESH_MASTER_KEY.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import stat
from functools import lru_cache
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

log = logging.getLogger("anvesh.keys")

PREFIX = "enc1:"


class DecryptionError(RuntimeError):
    pass


def key_dir() -> Path:
    return Path(os.getenv("ANVESH_KEY_DIR", str(Path.home() / ".anvesh" / "keys"))).expanduser().resolve()


def _restrict(path: Path) -> None:
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:  # pragma: no cover - Windows ACLs are not managed by chmod
        pass


@lru_cache(maxsize=1)
def master_key() -> bytes:
    env = os.getenv("ANVESH_MASTER_KEY")
    if env:
        k = base64.urlsafe_b64decode(env.encode() + b"=" * (-len(env) % 4))
        if len(k) != 32:
            raise RuntimeError("ANVESH_MASTER_KEY must be 32 random bytes, base64-encoded")
        return k
    d = key_dir()
    f = d / "master.key"
    if not f.exists():
        d.mkdir(parents=True, exist_ok=True)
        f.write_text(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())
        _restrict(f)
        log.warning("Generated a new master key at %s (outside the data folder). Back it up securely: "
                    "without it the encrypted case data cannot be read.", f)
    k = base64.urlsafe_b64decode(f.read_text().strip().encode())
    if len(k) != 32:
        raise RuntimeError(f"{f} is not a valid master key")
    return k


@lru_cache(maxsize=8)
def derived(purpose: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"anvesh-v1", info=purpose.encode()).derive(master_key())


def reset_cache() -> None:
    """Testing / rotation helper."""
    master_key.cache_clear()
    derived.cache_clear()
    _aead.cache_clear()


@lru_cache(maxsize=1)
def _aead() -> AESGCM:
    return AESGCM(derived("field"))


def encrypt_str(plain: str | None, context: str) -> str | None:
    if plain is None:
        return None
    nonce = os.urandom(12)
    ct = _aead().encrypt(nonce, plain.encode("utf-8"), context.encode())
    return PREFIX + base64.urlsafe_b64encode(nonce + ct).decode()


def decrypt_str(stored: str | None, context: str) -> str | None:
    if stored is None:
        return None
    if not stored.startswith(PREFIX):
        return stored  # legacy plaintext row; re-encrypted by migrate_plaintext()
    raw = base64.urlsafe_b64decode(stored[len(PREFIX):].encode())
    try:
        return _aead().decrypt(raw[:12], raw[12:], context.encode()).decode("utf-8")
    except InvalidTag as e:
        raise DecryptionError(f"Cannot decrypt {context}: wrong key or tampered data") from e


def blind_index(kind: str, value: str) -> str:
    norm = " ".join(value.strip().lower().split())
    return hmac.new(derived("index"), f"{kind}\x1f{norm}".encode(), hashlib.sha256).hexdigest()


def audit_mac(message: str) -> str:
    return hmac.new(derived("audit"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def token_hash(token: str) -> str:
    return hmac.new(derived("session"), token.encode(), hashlib.sha256).hexdigest()


def redact_digest(value: object) -> str:
    """Short keyed fingerprint used in audit payloads instead of personal data."""
    return "hmac:" + hmac.new(derived("audit"), str(value).encode(), hashlib.sha256).hexdigest()[:16]


@lru_cache(maxsize=1)
def evidence_fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(derived("evidence")))
