"""Load TRAINING SCENARIOS: scripted calls that reproduce scam types in official data.

No government body publishes real victim calls (they are personal data and evidence), so
the call audio/transcripts here are scripted. What is NOT invented:
  * every scenario reproduces a scam category that the Department of Telecommunications'
    Chakshu facility reports in official data (Rajya Sabha Session 270, USQ 647), and
  * every location is a district/city whose cyber-crime volume comes from NCRB
    Crime in India 2023 (see anvesh/official.py, data/official/).
Phone numbers, UPI handles and names are placeholders, never real people or accounts.

Run:  python -m anvesh.seed            (adds the scenarios)
      python -m anvesh.seed --reset    (wipes the database first)
      python -m anvesh.seed --none     (wipes the database, loads no scenarios)
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from . import audit, official, pipeline
from .models import Base, Case, Entity, Link, SessionLocal, engine, init_db

O, C, S = "officer", "caller", "suspect"

DEMO = [
    # --- Ring A: impersonation of CBI / customs ("digital arrest"); shared UPI + phone + script
    dict(mode="victim", district="Pune", caller="Training call", category="Impersonation as Police, CBI, Customs, Aadhaar, RBI etc", ago=35, lines=[
        (O, "Cyber helpline, boliye kya hua?"),
        (C, "Sir mujhe ek call aaya nau eight seven six five four three two one zero se, bole CBI se hain, "
            "mere naam pe parcel mein drugs mile hain customs mein"),
        (C, "unhone video call pe rakha aur bola kisi ko mat batana, warna arrest kar lenge"),
        (C, "maine dedh lakh rupaye bhej diye cbi.verification at the rate ybl pe, State Bank se, "
            "aadha ghanta pehle"),
        (C, "sir abhi bhi video call pe hain woh, please help"),
    ]),
    dict(mode="victim", district="Nashik", caller="Training call", category="Impersonation as Police, CBI, Customs, Aadhaar, RBI etc", ago=60 * 26, lines=[
        (O, "Namaste, cyber helpline. Batayiye."),
        (C, "kal ek aadmi ne call kiya, bola main customs officer hoon, aapke Aadhaar se parcel book hua hai "
            "jisme drugs hain, case darj hoga"),
        (C, "phir CBI wale ne Skype video call pe digital arrest bola, aur verification ke liye paise maange"),
        (C, "maine 85,000 rupaye transfer kiye cbi.verification@ybl pe, HDFC account se, kal shaam saat baje"),
    ]),
    dict(mode="victim", district="Indore", caller="Training call", category="Impersonation as Police, CBI, Customs, Aadhaar, RBI etc", ago=60 * 50, lines=[
        (O, "Cyber helpline, how can I help?"),
        (C, "Someone called from 9876543210 saying he is from CBI, a parcel in my name had drugs, "
            "customs ne pakda hai, digital arrest hoga"),
        (C, "they kept me on video call and said don't tell anyone. I paid 2 lakh in total to "
            "safe.account.rbi@okaxis from ICICI, two days ago"),
    ]),
    dict(mode="suspect_recording", district="Pune", caller="Suspect recording (training)", category="Impersonation as Police, CBI, Customs, Aadhaar, RBI etc", ago=20, lines=[
        (S, "Main CBI se inspector bol raha hoon. Aapke Aadhaar se ek parcel book hua hai, customs mein drugs mile hain."),
        (S, "Aapke naam pe money laundering ka case darj hai, abhi digital arrest ho raha hai, "
            "video call pe raho, phone mat katna, kisi ko mat batana."),
        (S, "Verification ke liye abhi turant cbi.verification at the rate ybl pe paise bhejo, "
            "refundable hai, warna arrest warrant nikal jayega."),
    ]),
    # --- Ring B: investment / stock-market trading groups; shared UPI + platform + script
    dict(mode="victim", district="Bengaluru", caller="Training call", category="Investment, Stock Market and Trading", ago=60 * 4, lines=[
        (O, "Cyber helpline, boliye."),
        (C, "Sir ek WhatsApp group mein share market trading tips milte the, phir ek trading app pe invest karwaya"),
        (C, "pehle profit dikhaya, phir withdraw nahi hone diya, tax bharna padega bole"),
        (C, "total maine chaar lakh pachaas hazaar invest kiye tradepro.desk@okaxis pe, Axis Bank se, "
            "aakhri payment do ghante pehle"),
    ]),
    dict(mode="victim", district="Hyderabad", caller="Training call", category="Investment, Stock Market and Trading", ago=60 * 30, lines=[
        (O, "Cyber helpline, please tell me what happened."),
        (C, "I joined a Telegram group for stock trading and IPO allotment, they gave a trading app"),
        (C, "profit was showing but withdraw nahi hua, they asked tax before withdrawal"),
        (C, "I sent 1,20,000 to tradepro.desk@okaxis from Kotak, yesterday afternoon 3 pm"),
    ]),
    dict(mode="victim", district="Jaipur", caller="Training call", category="Investment, Stock Market and Trading", ago=60 * 70, lines=[
        (O, "Haan ji boliye."),
        (C, "WhatsApp group pe trading app ka link aaya tha, IPO aur share market mein double returns bole"),
        (C, "maine teen lakh rupaye diye 9123456789 wale bande ke kehne pe, Paytm se, account Bank of Baroda"),
        (C, "UPI tha profit.returns at the rate ybl, teen din pehle"),
    ]),
    # --- Ring C: KYC update + remote-access app; shared phone number
    dict(mode="victim", district="Lucknow", caller="Training call", category="KYC and Payment related to Bank / Electricity / Gas / Insurance etc", ago=50, lines=[
        (O, "Cyber helpline, batayiye."),
        (C, "Bank se call aaya bola KYC update nahi kiya to account block ho jayega, number tha 7012345678"),
        (C, "unhone AnyDesk app install karwaya aur OTP bataya maine, phir 64,999 rupaye debit ho gaye PNB se, "
            "ek ghanta pehle"),
    ]),
    dict(mode="victim", district="Kanpur", caller="Training call", category="KYC and Payment related to Bank / Electricity / Gas / Insurance etc", ago=60 * 8, lines=[
        (O, "Cyber helpline."),
        (C, "KYC pending bolke call aaya 7012345678 se, link pe click karke AnyDesk download karaya"),
        (C, "card block ho jayega bole, maine OTP share kiya aur 38,500 rupaye kat gaye Canara Bank se, "
            "subah das baje"),
    ]),
    # --- Unlinked scenarios
    dict(mode="victim", district="Patna", caller="Training call", category="Online job / lottery /gifts/loan offers", ago=15, lines=[
        (O, "Cyber helpline, boliye."),
        (C, "sir meri saari savings chali gayi, saadhe teen lakh rupaye kat gaye, Union Bank se, bees minute pehle"),
        (C, "part time job ka task tha, rating task ke liye joining fee aur deposit maange, maine diye"),
        (C, "sir sab khatam ho gaya, jeene ka mann nahi kar raha"),
    ]),
    dict(mode="victim", district="Nagpur", caller="Training call", category="KYC and Payment related to Bank / Electricity / Gas / Insurance etc", ago=60 * 3, lines=[
        (O, "Cyber helpline."),
        (C, "bijli wale ne call kiya bola aaj raat light connection kat jayega, bill update karo"),
        (C, "link bheja, maine 12,000 rupaye bheje Google Pay se, number 8899776655"),
    ]),
    dict(mode="informant", district="Jamtara", caller="Informant (training)", category="KYC and Payment related to Bank / Electricity / Gas / Insurance etc", ago=90, lines=[
        (O, "Informant line, aap kya batana chahte hain?"),
        (C, "mere gaon mein kuch ladke ek ghar se din bhar bank officer banke call karte hain, "
            "KYC update ke naam pe, number 7012345678 use karte hain"),
        (C, "mujhe dar lag raha hai, unko pata chala to problem hogi, kisi ko mera naam mat batana"),
    ]),
]


def _basis(d: dict) -> dict:
    src = official.sources()
    ctx = official.context_for(d["district"])
    return {
        "kind": "training_scenario",
        "note": "Scripted call. The scam type and location are grounded in official data; "
                "names, numbers and UPI handles are placeholders.",
        "category": d["category"],
        "category_source": {k: src["chakshu"][k] for k in ("title", "report", "page")},
        "locality": ({"district": d["district"], "state": ctx["state"]["name"],
                      "state_cyber_crimes_2023": ctx["state"]["cases_2023"],
                      "source": {k: src["state_cyber"][k] for k in ("title", "report", "page")}} if ctx else None),
    }


def _retire_legacy_demo(db) -> None:
    """Remove the old invented demo cases (pre-official-data versions) so they never mix with real work."""
    legacy = [c for c in db.query(Case).filter(Case.synthetic.is_(True)).all() if not c.scenario]
    if not legacy:
        return
    ids = [c.id for c in legacy]
    db.query(Link).filter((Link.case_a.in_(ids)) | (Link.case_b.in_(ids))).delete(synchronize_session=False)
    db.query(Entity).filter(Entity.case_id.in_(ids)).delete(synchronize_session=False)
    for c in legacy:
        db.delete(c)
    audit.record(db, "seed", "demo.retired", None, {"cases": ids, "reason": "replaced by official-data training scenarios"})
    db.flush()


def seed(reset: bool = False, none: bool = False) -> int:
    if reset or none:
        Base.metadata.drop_all(engine)
    init_db()
    if none:
        return 0
    now = datetime.now()
    made = 0
    with SessionLocal() as db:
        _retire_legacy_demo(db)
        for i, d in enumerate(DEMO):
            started = now - timedelta(minutes=d["ago"])
            cid = f"AV-{started.year}-T{i + 1:04d}"
            if pipeline.get_case(db, cid):
                continue
            case = Case(id=cid, mode=d["mode"], channel="upload" if d["mode"] == "suspect_recording" else
                        ("informant_line" if d["mode"] == "informant" else "helpline"),
                        caller_label=d["caller"], district=d["district"], synthetic=True, scenario=_basis(d),
                        call_started_at=started, created_at=started)
            db.add(case)
            db.flush()
            audit.record(db, "seed", "case.created", case.id, {"mode": case.mode, "training_scenario": True,
                                                                  "category": d["category"]})
            t = 0.0
            items = []
            for spk, text in d["lines"]:
                dur = max(2.5, len(text) / 14)
                items.append({"start": round(t, 2), "end": round(t + dur, 2), "text": text, "speaker": spk})
                t += dur + 0.4
            pipeline.add_segments(db, case, items)
            db.refresh(case)
            pipeline.process(db, case, "seed", now=now)
            made += 1
        # second pass so earlier cases also see links to later ones
        for case in db.query(Case).all():
            pipeline.process(db, case, "seed", now=now)
        db.commit()
    return made


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--none", action="store_true", help="empty database, no training scenarios")
    a = ap.parse_args()
    n = seed(a.reset, a.none)
    print(f"Loaded {n} training scenarios." if not a.none else "Database reset; no training scenarios loaded.")
