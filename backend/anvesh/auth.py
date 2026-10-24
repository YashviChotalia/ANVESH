"""Accounts, roles, sessions, CSRF and rate limiting.

* Passwords: scrypt (N=2^15, r=8, p=1, 16-byte salt), constant-time comparison, policy checks.
* Sessions: 256-bit random token in an HttpOnly, SameSite=Strict cookie; only its HMAC is stored,
  so a stolen database cannot be replayed as a login. Idle timeout and absolute lifetime.
* CSRF: every state-changing request must carry X-CSRF-Token matching the session (double submit,
  stored hashed), on top of SameSite=Strict and an origin allowlist.
* Brute force: per-account lockout after repeated failures, plus per-client rate limits.
* Roles (least privilege, separation of duties):
    operator   - take calls, work cases
    supervisor - operator + review case links, reveal protected informant identity, read audit
    admin      - manage accounts, read and verify audit; cannot read case content unless also given
                 an operator/supervisor role
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response, WebSocket
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import keys
from .models import AuthSession, SessionLocal, User, utcnow

COOKIE = "anvesh_session"
IDLE_MINUTES = int(os.getenv("ANVESH_SESSION_IDLE_MIN", "30"))
MAX_HOURS = int(os.getenv("ANVESH_SESSION_MAX_HOURS", "12"))
LOCK_AFTER = 5
LOCK_MINUTES = 15

ROLE_PERMS: dict[str, set[str]] = {
    "operator": {"case:read", "case:write"},
    "supervisor": {"case:read", "case:write", "link:review", "informant:reveal", "audit:read"},
    "admin": {"user:admin", "audit:read", "audit:verify"},
}
ROLES = tuple(ROLE_PERMS)
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
_COMMON = {"password", "password123", "123456789012", "qwertyuiop12", "anvesh123456", "admin1234567",
           "welcome12345", "letmein12345", "iloveyou1234", "india1234567"}


# ----------------------------------------------------------------------------- passwords

def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 15, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
    return "scrypt$32768$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(pw: str, stored: str) -> bool:
    try:
        alg, n, r, p, salt, dk = stored.split("$")
        if alg != "scrypt":
            return False
        cand = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                              maxmem=64 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(cand, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    return _DUMMY_HASH


def password_problems(pw: str, username: str = "") -> list[str]:
    out = []
    if len(pw) < 12:
        out.append("at least 12 characters")
    if len(pw) > 128:
        out.append("at most 128 characters")
    classes = sum(bool(re.search(p, pw)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
    if classes < 3:
        out.append("three of: lowercase, uppercase, digit, symbol")
    if pw.lower() in _COMMON or (username and username.lower() in pw.lower()):
        out.append("not a common password or your username")
    return out


# ----------------------------------------------------------------------------- rate limiting

class RateLimiter:
    """Sliding-window limiter, in memory (per process). Replace with Redis when running several workers."""

    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_key(request: Request | WebSocket) -> str:
    return request.client.host if request.client else "unknown"


# ----------------------------------------------------------------------------- principal

@dataclass
class Principal:
    id: int
    username: str
    display_name: str
    roles: list[str]
    perms: set[str]
    session_hash: str
    must_change_password: bool = False

    def can(self, perm: str) -> bool:
        return perm in self.perms

    @property
    def actor(self) -> str:
        return f"{self.display_name} ({self.username})"[:80]


def perms_for(roles: list[str]) -> set[str]:
    out: set[str] = set()
    for r in roles or []:
        out |= ROLE_PERMS.get(r, set())
    return out


def user_count(db: Session) -> int:
    return db.execute(select(func.count(User.id))).scalar() or 0


# ----------------------------------------------------------------------------- sessions

def create_session(db: Session, user: User, response: Response, request: Request) -> str:
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    now = utcnow()
    db.add(AuthSession(token_hash=keys.token_hash(token), csrf_hash=keys.encrypt_str(csrf, "auth.csrf"), user_id=user.id,
                       created_at=now, last_seen=now, expires_at=now + timedelta(hours=MAX_HOURS),
                       client=client_key(request)[:64]))
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=request.url.scheme == "https",
                        max_age=MAX_HOURS * 3600, path="/")
    return csrf


def _load(db: Session, token: str | None) -> tuple[AuthSession, User] | None:
    if not token or len(token) > 128:
        return None
    s = db.get(AuthSession, keys.token_hash(token))
    if not s or s.revoked:
        return None
    now = utcnow()
    if now >= s.expires_at or now - s.last_seen > timedelta(minutes=IDLE_MINUTES):
        s.revoked = True
        return None
    u = db.get(User, s.user_id)
    if not u or u.disabled:
        return None
    if now - s.last_seen > timedelta(seconds=30):
        s.last_seen = now
    return s, u


def principal_from_token(db: Session, token: str | None) -> Principal | None:
    loaded = _load(db, token)
    if not loaded:
        return None
    s, u = loaded
    return Principal(u.id, u.username, u.display_name, list(u.roles or []), perms_for(u.roles),
                     s.token_hash, u.must_change_password)


def _session_csrf(s: AuthSession) -> str | None:
    """The session's CSRF token (stored encrypted, so every tab of the same session can get it back)."""
    try:
        return keys.decrypt_str(s.csrf_hash, "auth.csrf") if s.csrf_hash.startswith(keys.PREFIX) else None
    except keys.DecryptionError:
        return None


def check_csrf(db: Session, p: Principal, header: str | None) -> bool:
    s = db.get(AuthSession, p.session_hash)
    expected = _session_csrf(s) if s is not None else None
    return bool(header) and expected is not None and hmac.compare_digest(expected, header)


def rotate_csrf(db: Session, p: Principal) -> str:
    """Return the session's CSRF token; issue one only if the session has none (older sessions)."""
    s = db.get(AuthSession, p.session_hash)
    csrf = _session_csrf(s)
    if csrf is None:
        csrf = secrets.token_urlsafe(32)
        s.csrf_hash = keys.encrypt_str(csrf, "auth.csrf")
    return csrf


def revoke_user_sessions(db: Session, user_id: int, keep: str | None = None) -> None:
    for s in db.execute(select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked.is_(False))).scalars():
        if s.token_hash != keep:
            s.revoked = True


def register_failure(user: User | None) -> None:
    if user is None:
        return
    user.failed_attempts = (user.failed_attempts or 0) + 1
    if user.failed_attempts >= LOCK_AFTER:
        user.locked_until = utcnow() + timedelta(minutes=LOCK_MINUTES)
        user.failed_attempts = 0


def is_locked(user: User) -> bool:
    return bool(user.locked_until and user.locked_until > utcnow())


# ----------------------------------------------------------------------------- FastAPI dependencies

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def db_dep():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def current(request: Request, db: Session = Depends(db_dep)) -> Principal:
    p = principal_from_token(db, request.cookies.get(COOKIE))
    if p is None:
        db.commit()  # persist revocation of an expired session
        raise HTTPException(401, "Sign in required")
    if not limiter.allow(f"user:{p.id}", 600, 60):
        raise HTTPException(429, "Too many requests")
    if request.method not in SAFE_METHODS and not check_csrf(db, p, request.headers.get("x-csrf-token")):
        raise HTTPException(403, "Missing or invalid CSRF token")
    if p.must_change_password and request.url.path not in ("/api/auth/password", "/api/auth/logout"):
        raise HTTPException(403, "Password change required")
    return p


def require(perm: str):
    def dep(p: Principal = Depends(current)) -> Principal:
        if not p.can(perm):
            raise HTTPException(403, "Your role does not allow this action")
        return p
    return dep


def utc_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None
