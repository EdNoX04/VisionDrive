"""Country-specific plate format validation + OCR auto-correction.

OCR routinely confuses letters and digits (O/0, I/1, S/5, B/8...). When we know
the expected plate structure for a region we can fix these per position: a slot
that must be a LETTER turns 0->O, 1->I, 5->S...; a slot that must be a DIGIT turns
O->0, I->1, S->5...  This both cleans reads and rejects garbage.
"""

import re
import math

# Digit seen where a letter is expected -> letter.
TO_ALPHA = {"0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B"}
# Letter seen where a digit is expected -> digit.
TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "J": "1",
            "Z": "2", "A": "4", "S": "5", "G": "6", "T": "7", "B": "8"}

# Each format is a list of (type, min_len, max_len); type 'A'=letters, 'D'=digits.
FORMATS = {
    "none": None,
    "india": {
        "label": "India",
        "segments": [("A", 2, 2), ("D", 1, 2), ("A", 1, 3), ("D", 3, 4)],
    },
    "uk": {
        "label": "UK (current)",
        "segments": [("A", 2, 2), ("D", 2, 2), ("A", 3, 3)],
    },
    "generic": {"label": "Generic (length only)", "generic": True, "min": 4, "max": 9},
}


def format_options():
    out = []
    for key, f in FORMATS.items():
        out.append((key, "None / off" if f is None else f["label"]))
    return out


def _expand(segments):
    """Expand segment ranges into concrete templates: (chars, groups)."""
    templates = [("", [])]
    for typ, lo, hi in segments:
        nxt = []
        for length in range(lo, hi + 1):
            for chars, groups in templates:
                nxt.append((chars + typ * length, groups + [length]))
        templates = nxt
        if len(templates) > 400:
            break
    return templates


_CACHE = {}


def _templates_for(key):
    if key not in _CACHE:
        f = FORMATS.get(key)
        _CACHE[key] = _expand(f["segments"]) if f and "segments" in f else None
    return _CACHE[key]


def _group(text, groups):
    out, i = [], 0
    for g in groups:
        out.append(text[i:i + g])
        i += g
    return " ".join(out)


def apply_plate_format(raw, format_key):
    """Validate + auto-correct a raw OCR plate string.

    Returns dict: enabled, valid, text, display, corrections.
    """
    s = re.sub(r"[^A-Z0-9]", "", (raw or "").upper())
    f = FORMATS.get(format_key)

    if f is None:
        return {"enabled": False, "valid": True, "text": s, "display": s, "corrections": 0}

    if f.get("generic"):
        valid = f["min"] <= len(s) <= f["max"]
        return {"enabled": True, "valid": valid, "text": s, "display": s, "corrections": 0}

    candidates = [t for t in (_templates_for(format_key) or []) if len(t[0]) == len(s)]
    if not candidates:
        return {"enabled": True, "valid": False, "text": s, "display": s, "corrections": 0}

    best = None
    for chars, groups in candidates:
        out, cost, ok = [], 0, True
        for ch, expect in zip(s, chars):
            if expect == "A":
                if "A" <= ch <= "Z":
                    out.append(ch)
                elif ch in TO_ALPHA:
                    out.append(TO_ALPHA[ch]); cost += 1
                else:
                    ok = False; break
            else:
                if "0" <= ch <= "9":
                    out.append(ch)
                elif ch in TO_DIGIT:
                    out.append(TO_DIGIT[ch]); cost += 1
                else:
                    ok = False; break
        if ok and (best is None or cost < best[1]):
            best = ("".join(out), cost, groups)

    if best is None:
        return {"enabled": True, "valid": False, "text": s, "display": s, "corrections": 0}

    valid = best[1] <= math.ceil(len(s) * 0.4)
    return {
        "enabled": True,
        "valid": valid,
        "text": best[0],
        "display": _group(best[0], best[2]),
        "corrections": best[1],
    }
