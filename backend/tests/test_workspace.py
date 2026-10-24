from fastapi.testclient import TestClient

from anvesh.api import app

client = TestClient(app)


def _case(synthetic: bool, upi: str) -> str:
    c = client.post("/api/cases", json={"mode": "victim", "district": "Pune", "synthetic": synthetic}).json()
    client.post(f"/api/cases/{c['id']}/segments", json={"segments": [
        {"start": 0, "end": 4, "speaker": "caller", "text": f"maine 20000 rupaye bheje {upi} pe kal"}]})
    return c["id"]


def test_training_scenarios_never_appear_in_live_workspace_or_link_to_real_cases():
    real = _case(False, "ws.shared@ybl")
    train = _case(True, "ws.shared@ybl")
    live_ids = {c["id"] for c in client.get("/api/cases").json()}
    train_ids = {c["id"] for c in client.get("/api/cases?training=true").json()}
    assert real in live_ids and train not in live_ids
    assert train in train_ids and real not in train_ids
    # sanity: two real cases sharing the UPI do link
    real2 = _case(False, "ws.shared@ybl")
    assert any(l["other"]["id"] == real2 for l in client.get(f"/api/cases/{real}").json()["links"])
    detail = client.get(f"/api/cases/{real}").json()
    assert all(l["other"]["id"] != train for l in detail["links"])
    for r in client.get("/api/graph").json()["rings"]:
        assert train not in r["cases"]
    assert client.get("/api/stats").json()["workspace"] == "live"
