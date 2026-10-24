"""Scam-type playbooks: how to recognise each type, what to ask, what to capture.

Classification here only labels the *kind of incident the caller describes*.
It never scores the caller. In suspect-recording mode the same cues are used
to tag tactics in the suspect's speech, as investigative leads.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Playbook:
    key: str
    label: str
    cues: tuple[str, ...]
    required: tuple[str, ...]
    questions: dict[str, str] = field(default_factory=dict)
    advice: str = ""


# Field-level questions used for any scam type (officer co-pilot).
FIELD_QUESTIONS: dict[str, str] = {
    "amount_lost": "How much money left your account in total? (Kitne paise gaye, total?)",
    "incident_time": "When did the last payment go out? (Aakhri payment kab gaya?)",
    "upi_id": "Which UPI ID or account did you send the money to? Check the payment app history.",
    "bank": "Which bank or wallet was the money debited from?",
    "phone_number": "Which number did they call or message you from?",
    "transaction_id": "Can you read the UTR / transaction ID from the bank SMS?",
    "payment_app": "Which app did you pay with: PhonePe, Google Pay, Paytm, net banking?",
}

PLAYBOOKS: list[Playbook] = [
    Playbook(
        key="digital_arrest",
        label="Digital arrest / impersonation of officials",
        cues=("digital arrest", "arrest", "cbi", "customs", "narcotics", "money laundering",
              "aadhaar misuse", "aadhar misuse", "warrant", "video call pe", "camera on",
              "case darj", "fir darj", "parcel mein drugs", "ed office", "kisi ko mat batana"),
        required=("amount_lost", "incident_time", "upi_id", "bank", "phone_number", "claimed_agency"),
        questions={
            "claimed_agency": "Which agency did they claim to be from (CBI, customs, police, ED)?",
            "_still_connected": "Are you still on a call or video call with them right now?",
            "_platform": "Did they use Skype, WhatsApp video or a normal call?",
        },
        advice="Police never arrest anyone over a video call. Ask the caller to disconnect from the scammer now.",
    ),
    Playbook(
        key="investment",
        label="Investment / trading scam",
        cues=("trading", "share market", "stock", "invest", "profit", "returns", "ipo", "crypto",
              "bitcoin", "usdt", "telegram group", "whatsapp group", "withdraw nahi", "tax bharna"),
        required=("amount_lost", "incident_time", "upi_id", "bank", "platform"),
        questions={
            "platform": "What is the name of the app, website or group they used?",
            "_first_deposit": "When did you make the first deposit, and how many payments in total?",
        },
        advice="List every payment with date and UPI ID; the earliest recipient accounts are often still active.",
    ),
    Playbook(
        key="kyc_update",
        label="KYC / bank account block scam",
        cues=("kyc", "pan update", "account block", "account band", "card block", "link pe click",
              "apk", "anydesk", "screen share", "otp bataya", "otp diya", "otp share"),
        required=("amount_lost", "incident_time", "bank", "phone_number"),
        questions={
            "_remote_app": "Did they ask you to install any app (AnyDesk, QuickSupport, an APK)?",
            "_otp": "Did you share any OTP? How many?",
        },
        advice="Uninstall any remote-access app and call the bank's official number to block cards and net banking.",
    ),
    Playbook(
        key="courier",
        label="Courier / parcel scam",
        cues=("parcel", "courier", "fedex", "dhl", "bluedart", "package", "customs duty"),
        required=("amount_lost", "incident_time", "upi_id", "phone_number"),
        questions={"_parcel": "What did they say was in the parcel, and which company did they name?"},
        advice="Courier companies do not ask for payment over personal UPI IDs.",
    ),
    Playbook(
        key="sextortion",
        label="Sextortion / video-call blackmail",
        cues=("nude", "video viral", "blackmail", "obscene", "intimate", "video call recording",
              "photo viral", "morph"),
        required=("incident_time", "phone_number", "platform"),
        questions={"_paid": "Have you paid anything so far? Please don't pay more."},
        advice="Do not pay. Preserve chats and numbers; report the account on the platform.",
    ),
    Playbook(
        key="job",
        label="Job / task scam",
        cues=("part time job", "work from home", "task", "like and subscribe", "review task",
              "rating task", "joining fee", "registration fee"),
        required=("amount_lost", "incident_time", "upi_id", "platform"),
        questions={"_tasks": "How did the tasks work, and when did they stop paying you?"},
        advice="Record every UPI ID used for 'task deposits'; these are typically mule accounts.",
    ),
    Playbook(
        key="utility",
        label="Electricity / utility disconnection scam",
        cues=("electricity", "bijli", "light bill", "connection kat", "meter", "power cut tonight"),
        required=("amount_lost", "incident_time", "phone_number"),
        questions={"_link": "Did they send a link or ask you to install an app to pay the bill?"},
        advice="Utilities do not disconnect over a phone call; pay only through the official portal.",
    ),
]

PLAYBOOK_BY_KEY = {p.key: p for p in PLAYBOOKS}
GENERIC = Playbook(
    key="other",
    label="Financial cyber fraud (type unclear)",
    cues=(),
    required=("amount_lost", "incident_time", "upi_id", "bank", "phone_number"),
    questions={"_how": "How did it start: a call, a message, a link or an app?"},
    advice="Collect every transaction with its date, amount and recipient.",
)

# Tactics in a suspect's own speech (suspected-recording mode only).
TACTICS: dict[str, tuple[str, ...]] = {
    "authority_impersonation": ("cbi", "police", "customs", "officer", "inspector", "rbi",
                                "income tax", "narcotics", "court", "trai", "ed se"),
    "threat": ("arrest", "jail", "warrant", "case darj", "fir", "band ho jayega",
               "block ho jayega", "legal action", "viral kar denge", "kat jayega"),
    "urgency": ("abhi", "turant", "immediately", "within 1 hour", "aaj hi", "jaldi", "last chance",
                "2 ghante mein", "right now"),
    "secrecy_demand": ("kisi ko mat batana", "don't tell", "do not tell", "confidential",
                       "family ko mat", "secret"),
    "credential_request": ("otp", "pin", "cvv", "password", "card number", "aadhaar number",
                           "pan number"),
    "payment_instruction": ("transfer karo", "bhejo", "pay karo", "upi", "account mein daalo",
                            "safe account", "verification amount", "refundable"),
    "remote_access": ("anydesk", "teamviewer", "quick support", "quicksupport", "screen share",
                      "apk", "app install"),
    "surveillance": ("camera on", "video call pe raho", "phone mat katna", "call mat kaatna",
                     "stay on the call"),
}

TACTIC_LABELS = {
    "authority_impersonation": "Impersonates an authority",
    "threat": "Threat or intimidation",
    "urgency": "Pressure to act immediately",
    "secrecy_demand": "Demands secrecy",
    "credential_request": "Asks for OTP / credentials",
    "payment_instruction": "Payment instruction",
    "remote_access": "Remote-access app request",
    "surveillance": "Keeps victim under watch",
}


def _count(text: str, cues: tuple[str, ...]) -> list[str]:
    t = f" {text.lower()} "
    hits = []
    for c in cues:
        if re.search(rf"(?<!\w){re.escape(c.strip())}(?!\w)", t):
            hits.append(c.strip())
    return hits


def classify(text: str) -> tuple[Playbook, float, list[str]]:
    """Return (playbook, confidence 0-1, matched cues) for a narrative."""
    best, best_hits = GENERIC, []
    for pb in PLAYBOOKS:
        hits = _count(text, pb.cues)
        if len(hits) > len(best_hits):
            best, best_hits = pb, hits
    if not best_hits:
        return GENERIC, 0.0, []
    conf = min(0.35 + 0.15 * len(best_hits), 0.95)
    return best, round(conf, 2), best_hits


def tactics_in(text: str) -> dict[str, list[str]]:
    return {k: hits for k, cues in TACTICS.items() if (hits := _count(text, cues))}


def copilot_prompts(playbook: Playbook, present: set[str], asked: set[str] | None = None) -> list[dict]:
    """Next questions for the officer: missing required fields first, then type-specific ones."""
    asked = asked or set()
    prompts = []
    for f in playbook.required:
        if f in present or f in asked:
            continue
        q = playbook.questions.get(f) or FIELD_QUESTIONS.get(f)
        if q:
            prompts.append({"key": f, "question": q, "kind": "missing_field", "priority": 1})
    for k, q in playbook.questions.items():
        if k.startswith("_") and k not in asked:
            prompts.append({"key": k, "question": q, "kind": "playbook", "priority": 2})
    return prompts
