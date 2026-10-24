"""Devanagari -> casual Roman Hinglish, the way people type it ("paanch hazaar", "kat gaye").

Whisper in Hindi mode writes accurate words in Devanagari. Officers and the
extractor work in Roman Hinglish, so each transcript line keeps the original
Devanagari and gets a Roman version. English loanwords that Whisper writes in
Devanagari ("अकाउंट", "यूपीआई") are mapped back to their English spelling.
"""

from __future__ import annotations

import re

VOWELS = {"अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai",
          "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e"}
MATRAS = {"ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o",
          "ौ": "au", "ॉ": "o", "ॅ": "e"}
CONS = {"क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh",
        "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh",
        "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v",
        "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ळ": "l"}
NUKTA = {"क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "d", "ढ": "dh", "फ": "f", "य": "y"}
PRECOMPOSED = {"क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "d", "ढ़": "dh", "फ़": "f", "य़": "y"}
VIRAMA, NUKTA_SIGN, ANUSVARA, CHANDRA, VISARGA = "्", "़", "ं", "ँ", "ः"
DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

# English (and brand) words Whisper writes in Devanagari -> how an officer would type them.
LOANWORDS = {
    "अकाउंट": "account", "अकाउन्ट": "account", "एकाउंट": "account", "यूपीआई": "UPI", "ओटीपी": "OTP",
    "बैंक": "bank", "नंबर": "number", "नम्बर": "number", "ट्रांसफर": "transfer", "लिंक": "link", "ऐप": "app",
    "एप": "app", "वीडियो": "video", "कॉल": "call", "काल": "call", "पुलिस": "police", "सीबीआई": "CBI",
    "कस्टम्स": "customs", "कस्टम": "customs", "पार्सल": "parcel", "केवाईसी": "KYC", "ब्लॉक": "block",
    "कार्ड": "card", "जॉब": "job", "टास्क": "task", "ट्रेडिंग": "trading", "इन्वेस्ट": "invest",
    "इन्वेस्टमेंट": "investment", "सर": "sir", "मैडम": "madam", "फोनपे": "PhonePe", "फ़ोनपे": "PhonePe",
    "फोन": "phone", "फ़ोन": "phone", "पे": "pe", "पेटीएम": "Paytm", "गूगल": "Google", "एसबीआई": "SBI",
    "एचडीएफसी": "HDFC", "आईसीआईसीआई": "ICICI", "एक्सिस": "Axis", "कोटक": "Kotak", "पीएनबी": "PNB",
    "केनरा": "Canara", "एनीडेस्क": "AnyDesk", "व्हाट्सएप": "WhatsApp", "व्हाट्सऐप": "WhatsApp",
    "टेलीग्राम": "Telegram", "स्काइप": "Skype", "एट": "at", "द": "the", "रेट": "rate", "डॉट": "dot",
    "डिजिटल": "digital", "अरेस्ट": "arrest", "फ्रॉड": "fraud", "स्कैम": "scam", "मैसेज": "message",
    "आधार": "Aadhaar", "पैन": "PAN", "आईएफएससी": "IFSC", "यूटीआर": "UTR", "ट्रांजैक्शन": "transaction",
    "आईडी": "ID", "डेबिट": "debit", "क्रेडिट": "credit", "ओके": "ok", "हेलो": "hello", "हैलो": "hello",
    "ओकेएक्सिस": "okaxis", "वाईबीएल": "ybl", "जीपे": "GPay",
}

# casual spellings for very common words after transliteration
CASUAL = {"pahale": "pehle", "pahle": "pehle", "naheen": "nahi", "nahin": "nahi", "kie": "kiye", "die": "diye",
          "lie": "liye", "mainne": "maine", "unhonne": "unhone", "hamane": "humne", "ham": "hum",
          "tum": "tum", "aap": "aap", "kyaa": "kya", "haan": "haan", "jee": "ji", "bhee": "bhi"}

_DEV = re.compile(r"[ऀ-ॿ]")
_WORD = re.compile(r"[ऀ-ॿ]+")


def has_devanagari(text: str) -> bool:
    return bool(_DEV.search(text))


def _word(w: str) -> str:
    if w in LOANWORDS:
        return LOANWORDS[w]
    out: list[str] = []
    inherent: list[int] = []  # indices in `out` holding an inherent 'a'
    i = 0
    n = len(w)
    while i < n:
        ch = w[i]
        nxt = w[i + 1] if i + 1 < n else ""
        if ch in PRECOMPOSED or (ch in CONS and nxt == NUKTA_SIGN):
            base = PRECOMPOSED.get(ch) or NUKTA.get(ch, CONS[ch])
            i += 1 if ch in PRECOMPOSED else 2
        elif ch in CONS:
            base = CONS[ch]
            i += 1
        elif ch in VOWELS:
            out.append(VOWELS[ch])
            i += 1
            continue
        elif ch in (ANUSVARA, CHANDRA):
            out.append("n")
            i += 1
            continue
        elif ch == VISARGA:
            out.append("h")
            i += 1
            continue
        else:
            out.append(ch.translate(DIGITS))
            i += 1
            continue
        out.append(base)
        nxt = w[i] if i < n else ""
        if nxt == VIRAMA:
            i += 1
        elif nxt in MATRAS:
            out.append(MATRAS[nxt])
            i += 1
        else:
            out.append("a")
            inherent.append(len(out) - 1)
    # schwa deletion: drop a word-final inherent 'a' (kar, not kara) ...
    if inherent and inherent[-1] == len(out) - 1 and len(out) > 2:
        out[-1] = ""
    # ... and a medial one between consonants when a vowel follows (karna, not karana)
    for k in reversed(inherent[:-1] if inherent else []):
        if 1 <= k < len(out) - 2 and out[k - 1] not in ("a", "aa", "i", "ee", "u", "oo", "e", "ai", "o", "au") \
                and out[k + 1] not in ("", "a") and k + 2 < len(out) and out[k + 2] in (
                "a", "aa", "i", "ee", "u", "oo", "e", "ai", "o", "au") and k >= 2:
            out[k] = ""
    s = "".join(out)
    s = s.replace("aae", "aaye").replace("gae", "gaye")
    if s in CASUAL:
        return CASUAL[s]
    if len(s) > 3 and s.endswith("aa"):
        s = s[:-1]  # mera, aadha, batana
    elif len(s) > 2 and s.endswith("ee"):
        s = s[:-2] + "i"  # abhi, kisi
    return CASUAL.get(s, s)


def to_roman(text: str) -> str:
    """Transliterate Devanagari words; leave Latin text, digits and punctuation as they are."""
    if not has_devanagari(text):
        return text
    text = text.replace("।", ".")
    return _WORD.sub(lambda m: _word(m.group()), text)
