"""Transparent, configurable triage rules.

Financial urgency is driven by reported facts (recency, loss, missing critical
fields), never by emotion scores. Human-safety flags (crisis, coercion) are a
separate track that can raise a case to immediate human attention.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime

from .nlp.extract import Field, minutes_since

RULES = {
    "immediate_window_min": 24 * 60,  # loss reported within 24 h
    "high_window_min": 7 * 24 * 60,
    "large_loss_inr": 100_000,
    "critical_fields": ["amount_lost", "incident_time", "upi_id", "bank"],
    "safety_live_window_min": 6 * 60,  # crisis / coercion flags escalate for 6 h after the call
}

NEXT_ACTION_FIN = ("Follow the financial-fraud reporting procedure promptly: register on 1930 / NCRP and "
                   "contact the debited bank through its official channel.")


@dataclass
class Triage:
    priority: str  # IMMEDIATE | HIGH | STANDARD
    score: int
    headline: str
    reasons: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    next_action: str = ""
    human_safety: list[str] = field(default_factory=list)
    evidence_status: str = "Awaiting verification"

    def to_dict(self) -> dict:
        return asdict(self)


FIELD_LABELS = {
    "amount_lost": "Reported loss", "incident_time": "Incident time", "upi_id": "Recipient UPI ID",
    "bank": "Debited bank", "phone_number": "Caller number", "transaction_id": "UTR / transaction ID",
    "account_number": "Account number", "ifsc": "IFSC", "payment_app": "Payment app",
    "claimed_agency": "Claimed agency", "platform": "Platform / app", "email": "Email",
}


def assess(mode: str, fields: dict[str, Field], now: datetime, coercion: bool, crisis: bool,
           distress_level: str | None, verified: set[str] | None = None,
           call_age_min: float | None = None) -> Triage:
    """`call_age_min`: minutes since the call. Safety flags escalate only while still actionable."""
    verified = verified or set()
    live = call_age_min is None or call_age_min <= RULES["safety_live_window_min"]
    reasons: list[str] = []
    safety: list[str] = []
    score = 0

    if mode == "suspect_recording":
        t = Triage("STANDARD", 20, "Investigative lead: suspected scam recording",
                   ["Recording analysed for scam tactics and identifiers"], [],
                   "Review flagged tactics and identifiers; link to open complaints before action.")
        return t

    amt = fields.get("amount_lost")
    mins = minutes_since(fields.get("incident_time"), now)
    amount = float(amt.value) if amt else 0.0

    if amt and mins is not None and mins <= RULES["immediate_window_min"]:
        score += 60
        reasons.append(f"Financial loss reported {mins} min after the incident")
    elif amt and mins is not None and mins <= RULES["high_window_min"]:
        score += 35
        reasons.append("Financial loss within the last 7 days")
    elif amt:
        score += 20
        reasons.append("Financial loss reported (incident time not yet captured)" if mins is None
                       else "Financial loss older than 7 days")
    if amount >= RULES["large_loss_inr"]:
        score += 15
        reasons.append(f"Large reported loss ({amt.display})")

    missing = [f for f in RULES["critical_fields"] if f not in fields]
    if missing and amt:
        score += 5
        reasons.append("Critical details still missing: " + ", ".join(FIELD_LABELS.get(m, m) for m in missing))

    if crisis:
        safety.append("Crisis language: hand over to a trained person now" if live
                      else "Crisis language during the call: arrange a welfare follow-up")
        score = max(score, 90 if live else score + 10)
    if coercion:
        safety.append("Possible active coercion: caller may still be under the scammer's control" if live
                      else "Coercion reported during the call: confirm the caller is safe")
        score = max(score, 85 if live else score + 10)
    if distress_level == "high" and not crisis:
        # shown to the officer, but never added to the financial priority score
        safety.append("Sustained high distress in the caller's voice (indicative)")

    score = min(score, 100)
    if score >= 60 or ((crisis or coercion) and live):
        priority = "IMMEDIATE"
    elif score >= 30:
        priority = "HIGH"
    else:
        priority = "STANDARD"

    headline = "Financial fraud triage" if amt else "Incident intake"
    if crisis or coercion:
        headline = "Human safety first"
    status = ("Verified by officer" if verified and all(f in verified for f in fields)
              else "Partly verified" if verified else "Awaiting verification")
    return Triage(priority, score, headline, reasons, missing, NEXT_ACTION_FIN if amt else
                  "Capture the incident details; ask how it started.", safety, status)
