"""Number-plate OCR using EasyOCR, on a localised plate crop.

Preprocesses the crop (grayscale, upscale, Otsu threshold), runs EasyOCR, cleans
the text, and applies country plate-format validation/correction.
"""

import re
import cv2
import numpy as np

from .plate_format import apply_plate_format

_reader = None


def get_reader(gpu=True):
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["en"], gpu=gpu)
    return _reader


def _prep(crop_bgr):
    if crop_bgr is None or crop_bgr.size == 0:
        return None
    h, w = crop_bgr.shape[:2]
    if h < 4 or w < 8:
        return None
    scale = max(2.0, min(6.0, 90.0 / h))
    crop = cv2.resize(crop_bgr, (int(w * scale), int(h * scale)))
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 7, 50, 50)
    _, thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thr


def read_plate(crop_bgr, format_key="none", min_conf=0.4, gpu=True):
    """Returns dict {text, display, confidence, valid} or None."""
    img = _prep(crop_bgr)
    if img is None:
        return None
    reader = get_reader(gpu=gpu)
    results = reader.readtext(img, allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    if not results:
        return None
    # Take the highest-confidence line.
    results.sort(key=lambda r: r[2], reverse=True)
    _, text, prob = results[0]
    if prob < min_conf:
        return None
    raw = re.sub(r"[^A-Za-z0-9]", "", text).upper()
    if len(raw) < 4:
        return None
    fmt = apply_plate_format(raw, format_key)
    return {
        "text": raw,
        "display": fmt["display"],
        "confidence": int(prob * 100),
        "valid": fmt["valid"] if fmt["enabled"] else None,
        "enabled": fmt["enabled"],
    }
