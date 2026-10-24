"""Load SYNTHETIC demo cases (clearly labelled) to show cross-case linking.

All names, numbers, UPI IDs and stories below are invented for demonstration.
Run:  python -m anvesh.seed            (adds demo data)
      python -m anvesh.seed --reset    (wipes the database first)
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from . import audit, pipeline
from .models import Base, Case, SessionLocal, engine, init_db

O, C, S = "officer", "caller", "suspect"

DEMO = [
    # --- Ring A: "digital arrest" (fake CBI / customs parcel), shared UPI + phone + script
    dict(mode="victim", district="Pune", caller="R. Kulkarni (synthetic)", ago=35, lines=[
        (O, "Cyber helpline, boliye kya hua?"),
        (C, "Sir mujhe ek call aaya nau eight seven six five four three two one zero se, bole CBI se hain, "
            "mere naam pe parcel mein drugs mile hain customs mein"),
        (C, "unhone video call pe rakha aur bola kisi ko mat batana, warna arrest kar lenge"),
        (C, "maine dedh lakh rupaye bhej diye cbi.verification at the rate ybl pe, State Bank se, "
            "aadha ghanta pehle"),
        (C, "sir abhi bhi video call pe hain woh, please help"),
    ]),
    dict(mode="victim", district="Nashik", caller="S. Patil (synthetic)", ago=60 * 26, lines=[
        (O, "Namaste, cyber helpline. Batayiye."),
        (C, "kal ek aadmi ne call kiya, bola main customs officer hoon, aapke Aadhaar se parcel book hua hai "
            "jisme drugs hain, case darj hoga"),
        (C, "phir CBI wale ne Skype video call pe digital arrest bola, aur verification ke liye paise maange"),
        (C, "maine 85,000 rupaye transfer kiye cbi.verification@ybl pe, HDFC account se, kal shaam saat baje"),
    ]),
    dict(mode="victim", district="Indore", caller="A. Verma (synthetic)", ago=60 * 50, lines=[
        (O, "Cyber helpline, how can I help?"),
        (C, "Someone called from 9876543210 saying he is from CBI, a parcel in my name had drugs, "
            "customs ne pakda hai, digital arrest hoga"),
        (C, "they kept me on video call and said don't tell anyone. I paid 2 lakh in total to "
            "safe.account.rbi@okaxis from ICICI, two days ago"),
    ]),
    dict(mode="suspect_recording", district="Pune", caller="Recording shared by victim (synthetic)", ago=20, lines=[
        (S, "Main CBI se inspector bol raha hoon. Aapke Aadhaar se ek parcel book hua hai, customs mein drugs mile hain."),
        (S, "Aapke naam pe money laundering ka case darj hai, abhi digital arrest ho raha hai, "
            "video call pe raho, phone mat katna, kisi ko mat batana."),
        (S, "Verification ke liye abhi turant cbi.verification at the rate ybl pe paise bhejo, "
            "refundable hai, warna arrest warrant nikal jayega."),
    ]),
    # --- Ring B: investment / trading group, shared UPI + platform + script
    dict(mode="victim", district="Bengaluru", caller="K. Rao (synthetic)", ago=60 * 4, lines=[
        (O, "Cyber helpline, boliye."),
        (C, "Sir ek WhatsApp group mein share market trading tips milte the, phir ek trading app pe invest karwaya"),
        (C, "pehle profit dikhaya, phir withdraw nahi hone diya, tax bharna padega bole"),
        (C, "total maine chaar lakh pachaas hazaar invest kiye tradepro.desk@okaxis pe, Axis Bank se, "
            "aakhri payment do ghante pehle"),
    ]),
    dict(mode="victim", district="Hyderabad", caller="M. Reddy (synthetic)", ago=60 * 30, lines=[
        (O, "Cyber helpline, please tell me what happened."),
        (C, "I joined a Telegram group for stock trading and IPO allotment, they gave a trading app"),
        (C, "profit was showing but withdraw nahi hua, they asked tax before withdrawal"),
        (C, "I sent 1,20,000 to tradepro.desk@okaxis from Kotak, yesterday afternoon 3 pm"),
    ]),
    dict(mode="victim", district="Jaipur", caller="P. Sharma (synthetic)", ago=60 * 70, lines=[
        (O, "Haan ji boliye."),
        (C, "WhatsApp group pe trading app ka link aaya tha, IPO aur share market mein double returns bole"),
        (C, "maine teen lakh rupaye diye 9123456789 wale bande ke kehne pe, Paytm se, account Bank of Baroda"),
        (C, "UPI tha profit.returns at the rate ybl, teen din pehle"),
    ]),
    # --- Ring C: KYC / AnyDesk, shared phone
    dict(mode="victim", district="Lucknow", caller="N. Gupta (synthetic)", ago=50, lines=[
        (O, "Cyber helpline, batayiye."),
        (C, "Bank se call aaya bola KYC update nahi kiya to account block ho jayega, number tha 7012345678"),
        (C, "unhone AnyDesk app install karwaya aur OTP bataya maine, phir 64,999 rupaye debit ho gaye PNB se, "
            "ek ghanta pehle"),
    ]),
    dict(mode="victim", district="Kanpur", caller="V. Mishra (synthetic)", ago=60 * 8, lines=[
        (O, "Cyber helpline."),
        (C, "KYC pending bolke call aaya 7012345678 se, link pe click karke AnyDesk download karaya"),
        (C, "card block ho jayega bole, maine OTP share kiya aur 38,500 rupaye kat gaye Canara Bank se, "
            "subah das baje"),
    ]),
    # --- Unlinked cases (variety for the queue)
    dict(mode="victim", district="Patna", caller="R. Kumar (synthetic)", ago=15, lines=[
        (O, "Cyber helpline, boliye."),
        (C, "sir meri saari savings chali gayi, saadhe teen lakh rupaye kat gaye, Union Bank se, bees minute pehle"),
        (C, "part time job ka task tha, rating task ke liye joining fee aur deposit maange, maine diye"),
        (C, "sir sab khatam ho gaya, jeene ka mann nahi kar raha"),
    ]),
    dict(mode="victim", district="Nagpur", caller="T. Joshi (synthetic)", ago=60 * 3, lines=[
        (O, "Cyber helpline."),
        (C, "bijli wale ne call kiya bola aaj raat light connection kat jayega, bill update karo"),
        (C, "link bheja, maine 12,000 rupaye bheje Google Pay se, number 8899776655"),
    ]),
    dict(mode="informant", district="Jamtara", caller="Informant (synthetic)", ago=90, lines=[
        (O, "Informant line, aap kya batana chahte hain?"),
        (C, "mere gaon mein kuch ladke ek ghar se din bhar bank officer banke call karte hain, "
            "KYC update ke naam pe, number 7012345678 use karte hain"),
        (C, "mujhe dar lag raha hai, unko pata chala to problem hogi, kisi ko mera naam mat batana"),
    ]),
]


def seed(reset: bool = False) -> int:
    if reset:
        Base.metadata.drop_all(engine)
    init_db()
    now = datetime.now()
    made = 0
    with SessionLocal() as db:
        for i, d in enumerate(DEMO):
            started = now - timedelta(minutes=d["ago"])
            cid = f"AV-{started.year}-D{i + 1:04d}"
            if pipeline.get_case(db, cid):
                continue
            case = Case(id=cid, mode=d["mode"], channel="upload" if d["mode"] == "suspect_recording" else
                        ("informant_line" if d["mode"] == "informant" else "helpline"),
                        caller_label=d["caller"], district=d["district"], synthetic=True,
                        call_started_at=started, created_at=started)
            db.add(case)
            db.flush()
            audit.record(db, "seed", "case.created", case.id, {"mode": case.mode, "synthetic": True})
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
    n = seed(ap.parse_args().reset)
    print(f"Seeded {n} synthetic demo cases.")
