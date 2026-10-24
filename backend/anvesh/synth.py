"""Generate synthetic training cases, grounded in official data.

* Scam types are drawn in proportion to DoT Chakshu 2025 reports (official.summary()["scam_types"]).
* Locations are drawn in proportion to NCRB 2023 cyber-crime counts of the state each city belongs to.
* Some cases share a UPI handle, phone number or script so the Ring Linker has rings to find.
Everything personal (names, numbers, UPI handles, amounts) is invented; cases are marked synthetic and
appear only in the Training workspace. Deterministic for a given seed.
"""

from __future__ import annotations

import random

from . import official

BANKS = ["SBI", "HDFC", "ICICI", "Axis Bank", "PNB", "Kotak", "Bank of Baroda", "Canara Bank", "Union Bank"]
PSP = ["ybl", "okaxis", "oksbi", "paytm", "okicici", "ibl"]
WHEN = ["aadha ghanta pehle", "ek ghanta pehle", "do ghante pehle", "aaj subah das baje", "kal shaam saat baje",
        "kal dopahar", "teen din pehle", "pichle hafte"]
OPEN = ["Cyber helpline, boliye kya hua?", "Namaste, cyber helpline. Batayiye.", "Cyber helpline, how can I help?",
        "Haan ji, boliye.", "Cyber crime helpline, aap safe hain? Batayiye kya hua."]

# Per playbook: slots of alternative sentences (one picked per slot) with {amt} {upi} {bank} {when} {phone},
# so no two generated calls read the same. Written the way callers speak.
SCRIPTS = {
    "digital_arrest": [
        ["Sir {phone} se call aaya, bole CBI se hain", "Ek aadmi ne khud ko Mumbai police ka officer bataya, number {phone}",
         "Customs department se hoon bolke call aaya {phone} se", "Narcotics bureau ka inspector bola, {phone} se phone aaya"],
        ["mere Aadhaar se parcel book hua hai jisme drugs mile", "mere naam pe money laundering ka case darj hai bole",
         "FedEx parcel mein illegal passport aur drugs hain bola", "mera SIM card illegal kaam mein use hua hai bola"],
        ["phir video call pe digital arrest bola, kisi ko mat batana", "Skype pe video call pe rakha, phone mat katna bola",
         "warrant ki copy WhatsApp pe bheji aur bola ghar se bahar mat jaana", "do ghante tak camera on rakhwaya"],
        ["verification ke liye {amt} rupaye bheje {upi} pe, {bank} se, {when}", "maine {amt} transfer kiye {upi} pe {bank} account se {when}",
         "RBI account mein safe rakhne ke naam pe {amt} liye, {upi}, {bank} se, {when}"],
    ],
    "investment": [
        ["WhatsApp group mein share market tips milte the", "Telegram pe stock trading ka group join kiya tha",
         "Instagram ad se ek trading app download kiya", "ek advisor ne IPO allotment ka offer diya"],
        ["pehle profit dikhaya, phir withdraw nahi hone diya", "app pe double returns dikh rahe the par paise nahi nikle",
         "withdraw ke liye tax aur fees maang rahe hain", "account freeze bolke aur paise maange"],
        ["total {amt} invest kiye {upi} pe, {bank} se, aakhri payment {when}", "maine {amt} bheje {upi} pe {bank} se {when}",
         "{amt} rupaye diye {bank} account se, UPI {upi}, {when}"],
    ],
    "kyc_update": [
        ["Bank se call aaya {phone} se, KYC update nahi kiya to account block ho jayega", "Customer care ka number Google pe mila {phone}",
         "SMS aaya ki PAN link nahi hai, {phone} pe call karo", "credit card reward points ke naam pe call aaya {phone} se"],
        ["unhone AnyDesk app install karwaya aur OTP pucha", "link pe card details dali aur OTP share kiya",
         "screen share karwaya aur net banking login karwaya", "ek APK file bheji, install ki to phone hang ho gaya"],
        ["phir {amt} rupaye debit ho gaye {bank} se, {when}", "{amt} rupaye kat gaye {bank} account se {when}",
         "{bank} se teen transaction hue, total {amt}, {when}"],
    ],
    "utility": [
        ["Bijli wale ne call kiya {phone} se", "electricity board ka message aaya, number {phone}", "gas connection wale bolke call aaya {phone} se"],
        ["bola aaj raat connection kat jayega, bill update karo", "pichla bill pending bataya aur turant pay karne ko bola"],
        ["link bheja, maine {amt} rupaye bheje {upi} pe {when}", "maine {amt} pay kiye {upi} pe, {bank} se, {when}"],
    ],
    "job": [
        ["Part time job ka message aaya, YouTube video like karne ka task tha", "work from home data entry ka offer aaya",
         "hotel review ka task diya, har review pe commission bola", "loan app ne loan diya phir {phone} se dhamki aane lagi"],
        ["pehle thode paise diye phir prepaid task ke liye deposit maanga", "joining fee aur security deposit maanga",
         "bole task complete karne ke liye aur paisa lagao"],
        ["maine {amt} rupaye diye {upi} pe, {bank} se, {when}", "total {amt} bheje {upi} pe {when}"],
    ],
    "sextortion": [
        ["Ek video call aaya unknown number {phone} se", "Instagram pe dosti hui phir video call aaya {phone} se"],
        ["phir morphed video bana ke blackmail kar rahe hain", "bole paise nahi diye to video sabko bhej denge"],
        ["maine {amt} rupaye bheje {upi} pe {when}", "{amt} de chuka hoon {upi} pe, aur maang rahe hain"],
    ],
}
CONTEXT = ["main retired teacher hoon, pension account tha", "beti ki shaadi ke liye paise jama kiye the",
           "mera chhota sa kirana store hai", "main college student hoon, papa ke account se gaya",
           "ghar pe akeli thi us waqt", "office mein meeting chal rahi thi tab call aaya", "hindi thodi kam aati hai",
           "pehle kabhi aisa nahi hua", "mere husband abroad hain", "medical emergency ke liye savings thi",
           "maine screenshot le liye hain", "unka naam Vikram bata rahe the", "awaaz bahut confident thi",
           "unhone mera pura address bataya", "train mein travel kar raha tha", "naya phone liya tha kal hi",
           "mummy ke naam ka account hai", "loan ki EMI ke paise the", "unhone ID card ki photo bheji",
           "bank branch band thi isliye app se kiya"]

FIRST = ["A.", "R.", "S.", "K.", "M.", "P.", "N.", "V.", "D.", "J."]
LAST = ["Sharma", "Patil", "Reddy", "Iyer", "Khan", "Das", "Gupta", "Singh", "Nair", "Joshi", "Verma", "Rao"]


def _phone(rng: random.Random) -> str:
    return "9" + "".join(rng.choice("0123456789") for _ in range(9))


def _upi(rng: random.Random) -> str:
    stem = rng.choice(["verify", "refund", "support", "desk", "secure", "help", "trade", "pay"])
    return f"{stem}.{rng.randint(100, 999)}@{rng.choice(PSP)}"


def _amount(rng: random.Random, key: str) -> int:
    lo, hi = {"digital_arrest": (40_000, 900_000), "investment": (25_000, 1_200_000), "kyc_update": (5_000, 150_000),
              "job": (3_000, 250_000), "sextortion": (5_000, 120_000)}[key]
    return int(round(rng.uniform(lo, hi), -3))


def generate(n: int = 60, seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    o = official.summary()
    types = [t for t in o["scam_types"] if t["playbook"] in SCRIPTS]
    t_weights = [t["y2025"] for t in types]
    state_cases = {s["name"]: s["cases_2023"] for s in o["states"]}
    cities = [(c.title(), st) for c, st in official.CITY_STATE.items() if st in state_cases and c not in ("cyberabad", "bangalore", "new delhi", "gautam buddh nagar")]
    c_weights = [state_cases[st] / sum(1 for _, s2 in cities if s2 == st) for _, st in cities]
    # shared identifiers per scam type -> rings
    rings = {k: [{"upi": _upi(rng), "phone": _phone(rng)} for _ in range(3)] for k in SCRIPTS}

    out = []
    for i in range(n):
        t = rng.choices(types, t_weights)[0]
        key = t["playbook"]
        city, _state = rng.choices(cities, c_weights)[0]
        shared = rng.random() < 0.25
        ring = rng.choice(rings[key])
        vals = {"amt": f"{_amount(rng, key):,}", "bank": rng.choice(BANKS), "when": rng.choice(WHEN),
                "upi": ring["upi"] if shared else _upi(rng),
                "phone": ring["phone"] if shared else _phone(rng)}
        if key == "kyc_update" and rng.random() < 0.3:
            key = "utility"
        slots = SCRIPTS[key]
        lines = [("officer", rng.choice(OPEN))] + [("caller", rng.choice(slot).format(**vals)) for slot in slots]
        for extra in rng.sample(CONTEXT, 2):
            lines.insert(rng.randint(2, len(lines)), ("caller", extra))
        if key == "digital_arrest" and rng.random() < 0.3:
            lines.append(("caller", "sir abhi bhi video call pe hain woh, please help"))
        if rng.random() < 0.05:
            lines.append(("caller", "sab khatam ho gaya, jeene ka mann nahi kar raha"))
        out.append({"mode": "victim", "district": city, "caller": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
                    "category": t["category"], "ago": rng.randint(5, 60 * 24 * 7), "lines": lines})
    return out
