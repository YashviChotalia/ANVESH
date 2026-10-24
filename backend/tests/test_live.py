"""Live WebSocket path with stand-in model adapters (real models are not downloaded in CI)."""

import numpy as np
from fastapi.testclient import TestClient

from anvesh.api import app
from anvesh.speech import models as M


class FakeASR:
    calls = 0

    def status(self):
        return M.ModelStatus("asr", "fake", True, "ready")

    def start_loading(self):
        pass

    def transcribe(self, audio, offset=0.0, language=None, previous_text=""):
        FakeASR.calls += 1
        dur = len(audio) / 16000
        return ([{"start": offset, "end": offset + dur, "text": "mere 20000 rupaye kat gaye abhi abhi, kisi ko mat batana bola",
                  "avg_logprob": -0.3, "no_speech_prob": 0.01, "words": None}], "en")


def test_live_session_transcribes_scores_voice_and_saves_evidence(monkeypatch):
    monkeypatch.setattr(M, "asr", FakeASR())
    monkeypatch.setattr(M.asr_final, "enabled", False)
    monkeypatch.setattr(M.emotion, "predict", lambda chunk: {"fearful": 0.7, "neutral": 0.3})
    client = TestClient(app)
    case = client.post("/api/cases", json={"mode": "victim"}).json()
    sr = 16000
    t = np.arange(sr * 6) / sr
    tone = (0.3 * np.sin(2 * np.pi * (150 + 40 * np.sin(t)) * t) * 32767).astype(np.int16).tobytes()
    with client.websocket_connect(f"/ws/cases/{case['id']}/live") as ws:
        for i in range(0, len(tone), 8000):
            ws.send_bytes(tone[i:i + 8000])
        ws.send_bytes(b"\x00\x00" * 16000)  # a 1 s pause: the server cuts the chunk here
        first = ws.receive_json()
        assert first["type"] == "update" and first["case"]["segments"]
        ws.send_text('{"type":"stop"}')
        final = ws.receive_json()
    c = final["case"]
    fields = {f["name"]: f for f in c["fields"]}
    assert fields["amount_lost"]["value"] == "20000"
    assert c["safety"]["coercion"] is True
    assert c["distress"]["enabled"] and c["distress"]["timeline"], "voice windows should be scored"
    assert any(p["label"] == "fearful" for p in c["distress"]["timeline"])
    assert c["recordings"] and len(c["recordings"][0]["sha256"]) == 64  # live audio saved as hashed evidence
    rec = c["recordings"][0]
    assert all(s["recording_id"] == rec["id"] for s in c["segments"])  # lines are playable from the saved audio
    audio = client.get(f"/api/recordings/{rec['id']}/audio")
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF"
