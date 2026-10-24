import numpy as np
from helpers import make_client

from anvesh import pipeline, voice_auth
from anvesh.models import SessionLocal
from anvesh.speech import audio as A
from anvesh.speech import models as M

SR = 16000


def _tts_like(seconds=6.0):
    """Perfectly steady pitch and loudness with digitally silent gaps: typical of naive synthesis."""
    t = np.arange(int(SR * seconds)) / SR
    return (0.2 * np.sin(2 * np.pi * 150 * t) * (np.sin(2 * np.pi * 4 * t) > 0)).astype(np.float32)


def _human_like(seconds=6.0, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(SR * seconds)) / SR
    f0 = 140 + np.cumsum(rng.normal(0, 0.9, len(t))) / 40
    syll = np.abs(np.sin(2 * np.pi * np.cumsum(3.2 + rng.normal(0, 2.0, len(t))) / SR))
    env = (syll > 0.35) * (0.12 + 0.05 * np.abs(rng.normal(0, 1, len(t))))
    return (env * np.sin(2 * np.pi * np.cumsum(f0) / SR) + rng.normal(0, 0.004, len(t))).astype(np.float32)


def test_cues_alone_can_only_ask_for_verification():
    r = voice_auth.assess(_tts_like(), None, mode="victim")
    assert r["verdict"] == "needs_verification" and r["reasons"] and "call back" in r["advice"]
    assert "acoustic cues only" in " ".join(r["abstain"])


def test_model_and_cues_combine():
    assert voice_auth.assess(_tts_like(), 0.97)["verdict"] == "likely_synthetic"
    real = voice_auth.assess(_human_like(), 0.05)
    assert real["verdict"] == "likely_real" and real["advice"] is None


def test_abstains_on_short_audio():
    r = voice_auth.assess(_tts_like(1.5), 0.99)
    assert r["verdict"] == "insufficient_audio" and r["score"] is None


def test_case_gets_flagged_and_audited(monkeypatch):
    monkeypatch.setattr(M.spoof, "p_fake", lambda x, sr=16000: 0.95)
    c = make_client(("operator",))
    cid = c.post("/api/cases", json={"mode": "victim"}).json()["id"]
    x = _tts_like()
    with SessionLocal() as db:
        case = pipeline.get_case(db, cid)
        pipeline.ingest_audio(db, case, A.to_wav_bytes(x), "call.wav", "audio/wav", "call", "t", 0,
                              precomputed={"voice_auth": pipeline.check_voice(x, "victim")})
        db.commit()
    d = c.get(f"/api/cases/{cid}").json()
    assert d["voice_flag"] and d["voice_auth"]["verdict"] == "likely_synthetic"
    assert d["recordings"][0]["voice_auth"]["model_score"] == 0.95
    assert any(e["action"] == "voice.flagged" for e in make_client(("supervisor",)).get(f"/api/audit?case_id={cid}").json())
