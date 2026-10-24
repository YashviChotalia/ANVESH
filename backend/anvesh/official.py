"""Official, published cybercrime statistics (NCRB / I4C via data.gov.in).

The CSV files in data/official/ are byte-identical copies of the files published on
data.gov.in (SHA-256 recorded in sources.json and checked on load). Nothing here is
estimated or modelled: every number shown in the UI comes from one of these files.
"""

from __future__ import annotations

import csv
import hashlib
import json
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).parent / "data" / "official"


class OfficialDataError(RuntimeError):
    pass


def _num(v: str) -> float | None:
    v = (v or "").strip()
    if v in ("", "NA", "-"):
        return None
    f = float(v.replace(",", ""))
    return int(f) if f.is_integer() else f


def _rows(name: str) -> list[dict]:
    with open(DIR / name, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


@lru_cache(maxsize=1)
def sources() -> dict[str, dict]:
    meta = json.loads((DIR / "sources.json").read_text(encoding="utf-8"))["sources"]
    out = {}
    for m in meta:
        digest = hashlib.sha256((DIR / m["filename"]).read_bytes()).hexdigest()
        if digest != m["sha256"]:
            raise OfficialDataError(f"{m['filename']} does not match the published file (hash mismatch)")
        out[m["key"]] = m
    return out


def _cite(key: str) -> dict:
    s = sources()[key]
    return {k: s[k] for k in ("key", "title", "publisher", "report", "page", "reference", "note", "sha256", "retrieved")}


# Chakshu category -> Anvesh playbook (the scam scripts Anvesh recognises in a call)
CHAKSHU_PLAYBOOK = {
    "Impersonation as Police, CBI, Customs, Aadhaar, RBI etc": "digital_arrest",
    "Impersonation as DoT / TRAI": "digital_arrest",
    "Investment, Stock Market and Trading": "investment",
    "KYC and Payment related to Bank / Electricity / Gas / Insurance etc": "kyc_update",
    "Fake Customer Care Helpline": "kyc_update",
    "Online job / lottery /gifts/loan offers": "job",
    "Sextortion": "sextortion",
}

MOTIVE_COLS = ["Fraud", "Extortion", "Sexual Exploitation", "Causing Disrepute", "Personal Revenge",
               "Emotional motives like Anger etc", "Developing own business", "Others"]


def _is_total(row: dict, col: str) -> bool:
    return row[col].lower().startswith("total")


@lru_cache(maxsize=1)
def load() -> dict:
    src = sources()

    # --- Table 9A.1: State/UT-wise cyber crimes 2021-2023
    st_rows = _rows(src["state_cyber"]["filename"])
    states: dict[str, dict] = {}
    totals: dict[str, dict] = {}
    for r in st_rows:
        rec = {
            "name": r["State/UT"],
            "cases": {y: _num(r[y]) for y in ("2021", "2022", "2023")},
            "population_lakh": _num(r["Mid-Year Projected Population (in Lakhs)"]),
            "rate": _num(r["Rate of Total Cyber Crimes (2023)"]),
            "chargesheet_rate": _num(r["Chargesheeting Rate (2023)"]),
        }
        (totals if _is_total(r, "Sl. No.") else states)[r["State/UT"]] = rec

    # --- Table 9A.3: motives (2023)
    for r in _rows(src["state_motives"]["filename"]):
        tgt = totals if _is_total(r, "Sl. No.") else states
        key = r["State/UT"]
        if tgt is totals:
            key = {"Total State(S)": "Total State(S)", "Total UT(S)": "Total UT (S)"}.get(key, key)
        if key not in tgt:
            raise OfficialDataError(f"motives row {key!r} has no matching state row")
        tgt[key]["motives"] = {c: _num(r[c]) for c in MOTIVE_COLS}
        tgt[key]["motives_total"] = _num(r["Total"])

    # --- Table 9B.3: metropolitan cities (2023)
    cities: dict[str, dict] = {}
    city_total = None
    for r in _rows(src["city_motives"]["filename"]):
        rec = {"name": r["City"], "motives": {c: _num(r[c]) for c in MOTIVE_COLS}, "total": _num(r["Total"])}
        if _is_total(r, "Sl. No."):
            city_total = rec
        else:
            cities[r["City"]] = rec

    # --- Rajya Sabha: crime heads 2019-2023
    heads = []
    for r in _rows(src["crime_heads"]["filename"]):
        heads.append({"head": r["Crime Heads"], "category": r["Category"], "is_total": not r["Sl. No."].isdigit(),
                      "years": {y: _num(r[y]) for y in ("2019", "2020", "2021", "2022", "2023")}})

    # --- Rajya Sabha / I4C: NCRP financial fraud complaints 2021-2025
    ncrp = [{"year": int(r["Year"]), "complaints": _num(r["Number of Financial Frauds Complaints on NCRP"]),
             "amount_crore": _num(r["Amount Reported"])}
            for r in _rows(src["ncrp_fraud"]["filename"])]

    # --- Rajya Sabha / DoT: Chakshu suspected-fraud communications by category
    chakshu = []
    chakshu_total = None
    for r in _rows(src["chakshu"]["filename"]):
        rec = {"category": r["Category"], "years": {y: _num(r[y]) for y in ("2024", "2025", "2026")},
               "playbook": CHAKSHU_PLAYBOOK.get(r["Category"])}
        if r["Sl. No."].lower() == "total":
            chakshu_total = rec
        else:
            chakshu.append(rec)

    data = {"chakshu": chakshu, "chakshu_total": chakshu_total, "states": states, "totals": totals, "cities": cities, "city_total": city_total,
            "heads": heads, "ncrp": ncrp}
    _validate(data)
    return data


def _validate(d: dict) -> None:
    """Fail loudly if a file was altered: published totals must equal the sum of the rows."""
    for y in ("2024", "2025", "2026"):
        if sum(c["years"][y] for c in d["chakshu"]) != d["chakshu_total"]["years"][y]:
            raise OfficialDataError(f"Chakshu categories do not add up for {y}")
    states = [s for s in d["states"].values()]
    for y in ("2021", "2022", "2023"):
        if sum(s["cases"][y] for s in states) != d["totals"]["Total All India"]["cases"][y]:
            raise OfficialDataError(f"State rows do not add up to the all-India total for {y}")
    for s in states + list(d["totals"].values()):
        if s.get("motives_total") is not None and s["motives_total"] != s["cases"]["2023"]:
            raise OfficialDataError(f"Motive total for {s['name']} differs from Table 9A.1")
    all_india = next(h for h in d["heads"] if h["head"] == "Total Cyber Crimes")
    for y in ("2021", "2022", "2023"):
        if all_india["years"][y] != d["totals"]["Total All India"]["cases"][y]:
            raise OfficialDataError("Crime-head totals differ from NCRB Table 9A.1")


# ----------------------------------------------------------------------------- views

def _pct(a, b) -> float | None:
    return round(100 * a / b, 1) if a is not None and b else None


def _state_view(s: dict) -> dict:
    c = s["cases"]
    fraud = (s.get("motives") or {}).get("Fraud")
    return {
        "name": s["name"], "cases_2021": c["2021"], "cases_2022": c["2022"], "cases_2023": c["2023"],
        "change_2022_2023_pct": _pct((c["2023"] or 0) - (c["2022"] or 0), c["2022"]),
        "rate_2023": s["rate"], "chargesheet_rate_2023": s["chargesheet_rate"],
        "fraud_2023": fraud, "fraud_share_2023_pct": _pct(fraud, c["2023"]),
        "extortion_2023": (s.get("motives") or {}).get("Extortion"),
        "sexual_exploitation_2023": (s.get("motives") or {}).get("Sexual Exploitation"),
    }


def summary() -> dict:
    d = load()
    india = d["totals"]["Total All India"]
    heads = {h["head"]: h["years"] for h in d["heads"]}
    trend = [{"year": int(y), "cases": heads["Total Cyber Crimes"][y],
              "fraud_ipc": heads["Fraud"][y], "cheating_ipc": heads["Cheating"][y],
              "computer_related_it_act": heads["Computer Related Offences"][y]}
             for y in ("2019", "2020", "2021", "2022", "2023")]
    motives = india["motives"]
    total23 = india["cases"]["2023"]
    motive_split = sorted(({"motive": k if k != "Emotional motives like Anger etc" else "Anger / emotional",
                            "cases": v, "share_pct": _pct(v, total23)} for k, v in motives.items()),
                          key=lambda m: -m["cases"])
    states = sorted((_state_view(s) for s in d["states"].values()), key=lambda s: -(s["cases_2023"] or 0))
    cities = sorted(({"name": c["name"], "cases_2023": c["total"], "fraud_2023": c["motives"]["Fraud"],
                      "fraud_share_2023_pct": _pct(c["motives"]["Fraud"], c["total"])}
                     for c in d["cities"].values()), key=lambda c: -c["cases_2023"])
    ncrp = d["ncrp"]
    last, prev = ncrp[-1], ncrp[-2]
    return {
        "headline": {
            "cyber_crimes_2023": total23,
            "cyber_crimes_2022": india["cases"]["2022"],
            "growth_2022_2023_pct": _pct(total23 - india["cases"]["2022"], india["cases"]["2022"]),
            "growth_2019_2023_x": round(total23 / heads["Total Cyber Crimes"]["2019"], 2),
            "fraud_share_2023_pct": _pct(motives["Fraud"], total23),
            "chargesheet_rate_2023": india["chargesheet_rate"],
            "rate_2023": india["rate"],
            "ncrp_complaints_latest": last["complaints"], "ncrp_year_latest": last["year"],
            "ncrp_amount_crore_latest": last["amount_crore"],
            "ncrp_amount_crore_prev": prev["amount_crore"], "ncrp_year_prev": prev["year"],
            "ncrp_complaints_growth_x": round(last["complaints"] / ncrp[0]["complaints"], 1),
            "ncrp_amount_total_crore": round(sum(r["amount_crore"] for r in ncrp), 0),
        },
        "scam_types": sorted(({"category": c["category"], "playbook": c["playbook"], "y2024": c["years"]["2024"],
                               "y2025": c["years"]["2025"], "y2026_partial": c["years"]["2026"],
                               "share_2025_pct": _pct(c["years"]["2025"], d["chakshu_total"]["years"]["2025"])}
                              for c in d["chakshu"]), key=lambda c: -c["y2025"]),
        "scam_types_total": d["chakshu_total"]["years"],
        "trend": trend,
        "ncrp": ncrp,
        "motives_2023": motive_split,
        "states": states,
        "cities": cities,
        "sources": [_cite(k) for k in ("state_cyber", "state_motives", "city_motives", "crime_heads", "ncrp_fraud", "chakshu")],
    }


# District / city -> State/UT, for the case "local context" panel. Metro cities map to
# their NCRB Table 9B.3 row as well.
CITY_STATE = {
    "ahmedabad": "Gujarat", "surat": "Gujarat", "vadodara": "Gujarat", "rajkot": "Gujarat",
    "bengaluru": "Karnataka", "bangalore": "Karnataka", "mysuru": "Karnataka", "mangaluru": "Karnataka",
    "chennai": "Tamil Nadu", "coimbatore": "Tamil Nadu", "madurai": "Tamil Nadu",
    "delhi": "Delhi", "new delhi": "Delhi",
    "ghaziabad": "Uttar Pradesh", "kanpur": "Uttar Pradesh", "lucknow": "Uttar Pradesh", "noida": "Uttar Pradesh",
    "gautam buddh nagar": "Uttar Pradesh", "varanasi": "Uttar Pradesh", "prayagraj": "Uttar Pradesh", "agra": "Uttar Pradesh",
    "hyderabad": "Telangana", "warangal": "Telangana", "cyberabad": "Telangana",
    "indore": "Madhya Pradesh", "bhopal": "Madhya Pradesh",
    "jaipur": "Rajasthan", "jodhpur": "Rajasthan", "bharatpur": "Rajasthan", "alwar": "Rajasthan",
    "kochi": "Kerala", "kozhikode": "Kerala", "thiruvananthapuram": "Kerala",
    "kolkata": "West Bengal", "howrah": "West Bengal",
    "mumbai": "Maharashtra", "pune": "Maharashtra", "nagpur": "Maharashtra", "nashik": "Maharashtra", "thane": "Maharashtra",
    "patna": "Bihar", "nalanda": "Bihar", "gaya": "Bihar",
    "jamtara": "Jharkhand", "deoghar": "Jharkhand", "ranchi": "Jharkhand",
    "nuh": "Haryana", "gurugram": "Haryana", "faridabad": "Haryana",
    "visakhapatnam": "Andhra Pradesh", "vijayawada": "Andhra Pradesh",
    "bhubaneswar": "Odisha", "cuttack": "Odisha", "guwahati": "Assam", "chandigarh": "Chandigarh",
    "ludhiana": "Punjab", "dehradun": "Uttarakhand", "raipur": "Chhattisgarh", "panaji": "Goa", "srinagar": "Jammu and Kashmir",
}


def playbook_context(key: str | None) -> dict | None:
    """Official national volume for the scam type Anvesh detected in a call."""
    if not key:
        return None
    d = load()
    rows = [c for c in d["chakshu"] if c["playbook"] == key]
    if not rows:
        return None
    return {"categories": [c["category"] for c in rows],
            "reports_2025": sum(c["years"]["2025"] for c in rows),
            "reports_2024": sum(c["years"]["2024"] for c in rows),
            "share_2025_pct": _pct(sum(c["years"]["2025"] for c in rows), d["chakshu_total"]["years"]["2025"]),
            "source": _cite("chakshu")}


def context_for(district: str | None) -> dict | None:
    if not district:
        return None
    d = load()
    q = district.strip().lower()
    state_name = CITY_STATE.get(q) or next((n for n in d["states"] if n.lower() == q), None)
    if not state_name:
        return None
    city = next((c for n, c in d["cities"].items() if n.lower().split(" (")[0] == q
                 or (q == "delhi" and n == "Delhi City")), None)
    out = {"district": district, "state": _state_view(d["states"][state_name]),
           "india": _state_view(d["totals"]["Total All India"]),
           "sources": [_cite("state_cyber"), _cite("state_motives")]}
    if city:
        out["city"] = {"name": city["name"], "cases_2023": city["total"], "fraud_2023": city["motives"]["Fraud"],
                       "fraud_share_2023_pct": _pct(city["motives"]["Fraud"], city["total"])}
        out["sources"].append(_cite("city_motives"))
    return out
