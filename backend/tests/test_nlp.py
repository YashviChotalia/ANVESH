from datetime import datetime

import pytest

from anvesh.nlp.extract import Segment, entities, extract
from anvesh.nlp.normalize import normalize
from anvesh.nlp import playbooks, safety

NOW = datetime(2026, 10, 24, 15, 0)


@pytest.mark.parametrize("spoken,expected", [
    ("saadhe paanch hazaar bheje", "5500 bheje"),
    ("dedh lakh rupaye", "150000 rupaye"),
    ("do lakh pachaas hazaar", "250000"),
    ("sava do lakh", "225000"),
    ("paanch sau pachaas", "550"),
    ("ek lakh bees hazaar paanch sau", "120500"),
    ("50k gaye", "50000 gaye"),
    ("₹48,000 debit", "₹ 48000 debit"),
    ("Rs 1,50,000 gaye", "Rs 150000 gaye"),
    ("maine 5000 2000 3000 bheje", "maine 5000 2000 3000 bheje"),
])
def test_amount_words(spoken, expected):
    assert normalize(spoken).text == expected


@pytest.mark.parametrize("spoken,expected", [
    ("ramesh at the rate okaxis", "ramesh@okaxis"),
    ("ramesh dot kumar at the rate ybl", "ramesh.kumar@ybl"),
    ("safe.account.rbi at the rate okaxis", "safe.account.rbi@okaxis"),
    ("nau aath saat six five four three two one zero", "9876543210"),
    ("98765 43210", "9876543210"),
    ("double five triple nine one two three four", "559991234"),
])
def test_identifiers(spoken, expected):
    assert expected in normalize(spoken).text


def test_span_maps_back_to_original_words():
    r = normalize("maine saadhe paanch hazaar bheje")
    i = r.text.index("5500")
    s, e = r.source_span(i, i + 4)
    assert r.original[s:e] == "saadhe paanch hazaar"


def _segs(*texts):
    return [Segment(f"s{i}", i * 6.0, i * 6.0 + 6.0, t, "caller") for i, t in enumerate(texts)]


def test_extract_full_victim_report():
    f = extract(_segs(
        "Sir mere account se saadhe paanch hazaar kat gaye, aadha ghanta pehle",
        "maine PhonePe se ramesh at the rate okaxis pe bheja, SBI account hai",
        "unka number tha nau aath saat six five four three two one zero, bole CBI se hain",
    ), NOW)
    assert f["amount_lost"].value == 5500
    assert f["upi_id"].value == "ramesh@okaxis"
    assert f["phone_number"].value == "9876543210"
    assert f["bank"].value == "State Bank of India"
    assert f["payment_app"].value == "PhonePe"
    assert f["claimed_agency"].value == "CBI"
    assert f["incident_time"].value == "2026-10-24T14:30"
    # evidence points at the spoken words and the right segment/time
    ev = f["upi_id"].evidence[0]
    assert ev.segment_id == "s1" and ev.quote == "ramesh at the rate okaxis"
    assert 6.0 <= ev.t_start <= ev.t_end <= 12.0


def test_amount_total_and_multi_payments():
    f = extract(_segs("total maine chaar lakh pachaas hazaar invest kiye"), NOW)
    assert f["amount_lost"].value == 450000 and "total" in f["amount_lost"].note.lower()
    f = extract(_segs("pehle 5000 bheje", "phir 20000 bhej diye"), NOW)
    assert f["amount_lost"].value == 25000 and f["amount_lost"].confidence < 0.7


def test_demanded_amount_is_not_a_loss():
    f = extract(_segs("woh 50000 rupaye maang rahe the par maine nahi diye"), NOW)
    assert "amount_lost" not in f


def test_phone_not_mistaken_for_amount_and_utr():
    f = extract(_segs("UTR number 412345678901 hai, 9876543210 se call aaya, 20000 rupaye kat gaye"), NOW)
    assert f["transaction_id"].value == "412345678901"
    assert f["phone_number"].value == "9876543210"
    assert f["amount_lost"].value == 20000
    assert "account_number" not in f


def test_clock_time_with_daypart():
    f = extract(_segs("kal shaam saat baje 85,000 rupaye transfer kiye"), NOW)
    assert f["incident_time"].value == "2026-10-23T19:00"


def test_entities_for_linking():
    f = extract(_segs("ramesh at the rate okaxis pe 10000 bheje, number 9876543210"), NOW)
    assert ("upi_id", "ramesh@okaxis") in entities(f)
    assert ("phone_number", "9876543210") in entities(f)


def test_playbook_and_copilot():
    pb, conf, cues = playbooks.classify("CBI officer bola parcel mein drugs hain, digital arrest, video call pe raho")
    assert pb.key == "digital_arrest" and conf > 0.5
    prompts = playbooks.copilot_prompts(pb, {"amount_lost"})
    keys = [p["key"] for p in prompts]
    assert "upi_id" in keys and "_still_connected" in keys and "amount_lost" not in keys


def test_tactics_only_flag_cues():
    t = playbooks.tactics_in("Main CBI se bol raha hoon, abhi turant paise bhejo, kisi ko mat batana, otp batao")
    assert {"authority_impersonation", "urgency", "secrecy_demand", "credential_request"} <= set(t)


def test_safety_scan_skips_officer_lines():
    segs = [Segment("a", 0, 3, "kisi ko mat batana unhone bola", "caller"),
            Segment("b", 3, 6, "jeene ka mann nahi kar raha", "officer")]
    sig = safety.scan(segs)
    assert sig.coercion_hits and not sig.crisis_hits


def test_lexicon_ignores_words_inside_upi_ids():
    f = extract(_segs("cbi.verification at the rate ybl pe 5000 bheje"), NOW)
    assert "claimed_agency" not in f and f["upi_id"].value == "cbi.verification@ybl"
