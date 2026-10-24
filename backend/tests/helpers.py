"""Test helpers: signed-in clients for each role."""

import itertools

from fastapi.testclient import TestClient

from anvesh import auth
from anvesh.api import app
from anvesh.models import SessionLocal, User

PASSWORD = "Correct-Horse-42!"
ORIGIN = "http://localhost:3000"
_n = itertools.count(1)


def make_user(roles=("operator",), username=None, password=PASSWORD, **kw) -> str:
    username = username or f"user{next(_n)}"
    with SessionLocal() as db:
        db.add(User(username=username, display_name=username.title(), roles=list(roles),
                    pw_hash=auth.hash_password(password), **kw))
        db.commit()
    return username


def make_client(roles=("operator", "supervisor"), username=None) -> TestClient:
    username = make_user(roles, username)
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    c.username = username
    auth.limiter.reset()
    return c
