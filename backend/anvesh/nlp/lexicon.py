"""Domain vocabulary for Indian cyber-fraud calls (Hinglish, English, Hindi)."""

from __future__ import annotations

BANKS: dict[str, list[str]] = {
    "State Bank of India": ["sbi", "state bank", "एसबीआई"],
    "HDFC Bank": ["hdfc"],
    "ICICI Bank": ["icici"],
    "Axis Bank": ["axis"],
    "Kotak Mahindra Bank": ["kotak"],
    "Punjab National Bank": ["pnb", "punjab national"],
    "Bank of Baroda": ["bank of baroda", "bob"],
    "Canara Bank": ["canara"],
    "Union Bank of India": ["union bank"],
    "IDFC First Bank": ["idfc"],
    "Yes Bank": ["yes bank"],
    "IndusInd Bank": ["indusind"],
    "Bank of India": ["bank of india"],
    "Indian Bank": ["indian bank"],
    "Federal Bank": ["federal bank"],
    "Airtel Payments Bank": ["airtel payments"],
    "India Post Payments Bank": ["ippb", "india post payments"],
}

PAYMENT_APPS: dict[str, list[str]] = {
    "PhonePe": ["phonepe", "phone pe"],
    "Google Pay": ["google pay", "gpay", "g pay"],
    "Paytm": ["paytm", "pay tm"],
    "Amazon Pay": ["amazon pay"],
    "BHIM": ["bhim"],
    "CRED": ["cred"],
    "Net banking": ["net banking", "netbanking", "internet banking"],
    "Card": ["credit card", "debit card", "card se"],
}

# UPI PSP handles (suffix after @). Not exhaustive; anything @letters is still captured.
UPI_HANDLES = {
    "okaxis", "okhdfcbank", "okicici", "oksbi", "ybl", "ibl", "axl", "paytm", "ptyes",
    "ptaxis", "pthdfc", "ptsbi", "upi", "apl", "yapl", "axisbank", "icici", "sbi", "hdfcbank",
    "kotak", "idfcbank", "fbl", "airtel", "jupiteraxis", "freecharge", "waaxis", "wahdfcbank",
    "wasbi", "waicici", "ikwik", "pockets", "ezeepay", "abfspay", "axisb", "barodampay",
}

AGENCIES: dict[str, list[str]] = {
    "CBI": ["cbi"],
    "Enforcement Directorate": ["ed office", "enforcement directorate", " ed "],
    "Customs": ["customs", "kastam"],
    "Police": ["police", "thana", "cyber cell", "crime branch", "पुलिस"],
    "TRAI": ["trai", "telecom department", "dot department"],
    "Narcotics (NCB)": ["narcotics", "ncb", "narcotics bureau"],
    "Income Tax": ["income tax", "it department"],
    "RBI": ["rbi", "reserve bank"],
    "Courier company": ["fedex", "dhl", "bluedart", "blue dart", "courier company"],
    "Electricity board": ["electricity", "bijli", "light bill"],
}

PLATFORMS: dict[str, list[str]] = {
    "WhatsApp": ["whatsapp", "whats app", "watsapp"],
    "Telegram": ["telegram"],
    "Instagram": ["instagram", "insta"],
    "Facebook": ["facebook", "fb"],
    "Skype": ["skype"],
    "Video call": ["video call", "videocall"],
    "Trading app": ["trading app", "trading group", "share market app", "stock app"],
    "Loan app": ["loan app"],
    "AnyDesk": ["anydesk", "any desk"],
    "TeamViewer": ["teamviewer", "team viewer"],
    "QuickSupport": ["quicksupport", "quick support"],
}

# Words near an amount that signal money actually lost (vs. merely mentioned).
LOSS_CUES = [
    "kat gaye", "kat gaya", "kat liye", "kaat liye", "debit", "debited", "bhej diye", "bheje",
    "bheja", "bhej diya", "transfer", "transferred", "chale gaye", "chala gaya", "nikal gaye",
    "nikal liye", "lost", "lose", "gaye", "gaya", "paid", "pay kiya", "pay kar diya", "diye",
    "de diye", "jama kiye", "invest kiye", "invested", "deducted", "withdrawn", "luta",
    "sent", "send kiye", "send kar diye", "gave", "given", "paid", "transferred", "lost",
    "ठगी", "कट गए", "भेज दिए",
]
NEGATED_LOSS = ["nahi diye", "nahi bheje", "nahi bheja", "nahi kiya", "nahi kiye", "didn't pay", "did not pay",
                "not paid", "didn't send", "did not send", "nahi diya"]
# Words that signal a demand or a mention, not a loss.
DEMAND_CUES = ["maange", "maang rahe", "maang raha", "demand", "asking", "keh rahe the dena", "dena hoga"]

# Relative-time phrases: (pattern, minutes ago). Patterns are applied to normalised text.
RELATIVE_TIME_UNITS = {
    "minute": 1, "minutes": 1, "min": 1, "mins": 1, "minat": 1, "मिनट": 1,
    "ghanta": 60, "ghante": 60, "ghanto": 60, "hour": 60, "hours": 60, "hr": 60, "घंटे": 60, "घंटा": 60,
    "din": 1440, "day": 1440, "days": 1440, "दिन": 1440,
}
AGO_WORDS = ["pehle", "pahle", "ago", "back", "पहले"]
TODAY_WORDS = {"aaj": 0, "today": 0, "kal": 1, "yesterday": 1, "parso": 2}
DAYPART_HOURS = {
    "subah": 9, "morning": 9, "dopahar": 14, "afternoon": 14, "shaam": 18, "sham": 18,
    "evening": 18, "raat": 21, "night": 21,
}
JUST_NOW = ["abhi abhi", "just now", "abhi thodi der pehle", "thodi der pehle", "abhi kuch der pehle"]
