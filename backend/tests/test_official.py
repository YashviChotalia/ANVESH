import hashlib
import json

import pytest

from anvesh import official


def test_files_match_published_hashes():
    meta = json.loads((official.DIR / "sources.json").read_text(encoding="utf-8"))["sources"]
    assert len(meta) == 6
    for m in meta:
        assert hashlib.sha256((official.DIR / m["filename"]).read_bytes()).hexdigest() == m["sha256"]
        assert m["page"].startswith("https://www.data.gov.in/resource/")


def test_headline_numbers_are_the_published_ones():
    h = official.summary()["headline"]
    assert h["cyber_crimes_2023"] == 86420 and h["cyber_crimes_2022"] == 65893  # NCRB CII 2023, Table 9A.1
    assert h["chargesheet_rate_2023"] == 33.9
    assert h["ncrp_complaints_latest"] == 2402579 and h["ncrp_amount_crore_latest"] == 22495  # RS 270 USQ 1341


def test_context_maps_city_to_state_and_metro():
    ctx = official.context_for("Bengaluru")
    assert ctx["state"]["name"] == "Karnataka" and ctx["state"]["cases_2023"] == 21889
    assert ctx["city"]["cases_2023"] == 17631
    assert official.context_for("Atlantis") is None


def test_scam_type_context():
    c = official.playbook_context("digital_arrest")
    assert c["reports_2025"] == 54639 + 15595
    assert official.playbook_context("other") is None


def test_tampered_file_is_rejected(tmp_path, monkeypatch):
    for f in official.DIR.iterdir():
        (tmp_path / f.name).write_bytes(f.read_bytes())
    p = tmp_path / "NCRB_CII_2023_Table_9A.1.csv"
    p.write_text(p.read_text().replace("Karnataka,8136", "Karnataka,9136"))
    monkeypatch.setattr(official, "DIR", tmp_path)
    official.sources.cache_clear()
    official.load.cache_clear()
    with pytest.raises(official.OfficialDataError):
        official.load()
    official.sources.cache_clear()
    official.load.cache_clear()
