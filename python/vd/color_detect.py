"""Shade-aware dominant colour detection for a vehicle crop (OpenCV/NumPy).

Samples the vehicle BODY (lower-centre, below the glass), classifies pixels into
named colours via HSV, takes the most common label, and builds the swatch from
the average of pixels in that winning bucket only.
"""

import cv2
import numpy as np

NAMES = [
    "Black", "White", "Silver/Gray", "Dark Gray",        # 0-3 greyscale
    "Maroon", "Navy", "Dark Green", "Olive", "Brown", "Indigo",  # 4-9 dark shades
    "Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Magenta",  # 10-17
    "Unknown",  # 18
]


def _classify_codes(h, s, v):
    """Vectorised classification -> integer code array (see NAMES)."""
    red = (h < 15) | (h >= 345)
    orange = (h >= 15) & (h < 40)
    yellow = (h >= 40) & (h < 70)
    green = (h >= 70) & (h < 160)
    cyan = (h >= 160) & (h < 200)
    blue = (h >= 200) & (h < 255)
    purple = (h >= 255) & (h < 290)
    magenta = (h >= 290) & (h < 345)
    dark = v < 0.5

    conds = [
        v < 0.20,                              # Black
        (s < 0.18) & (v > 0.78),               # White
        (s < 0.18) & (v > 0.45),               # Silver/Gray
        (s < 0.18),                            # Dark Gray
        dark & red,                            # Maroon
        dark & blue,                           # Navy
        dark & green,                          # Dark Green
        dark & yellow,                         # Olive
        dark & orange & (s > 0.5),             # Brown
        dark & orange & (s <= 0.5),            # Olive (low-sat dark orange)
        dark & purple,                         # Indigo
        red, orange, yellow, green, cyan, blue, purple, magenta,
    ]
    choices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17]
    return np.select(conds, choices, default=18)


def detect_color(region_bgr):
    """Return (name, hex) for a BGR vehicle crop."""
    if region_bgr is None or region_bgr.size == 0:
        return "Unknown", "#888888"
    h, w = region_bgr.shape[:2]
    if h < 6 or w < 6:
        return "Unknown", "#888888"

    y0, y1 = int(h * 0.45), int(h * 0.90)
    x0, x1 = int(w * 0.22), int(w * 0.78)
    crop = region_bgr[y0:y1, x0:x1]
    if crop.size == 0:
        crop = region_bgr

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    H = hsv[..., 0].astype(np.float32) * 2.0       # 0-360
    S = hsv[..., 1].astype(np.float32) / 255.0
    V = hsv[..., 2].astype(np.float32) / 255.0

    codes = _classify_codes(H, S, V).astype(np.int32)
    counts = np.bincount(codes.ravel(), minlength=len(NAMES))
    best = int(np.argmax(counts))
    if counts[best] == 0:
        return "Unknown", "#888888"

    mask = codes == best
    avg = crop[mask].reshape(-1, 3).mean(axis=0)   # BGR
    b, g, r = (int(avg[0]), int(avg[1]), int(avg[2]))
    return NAMES[best], "#%02x%02x%02x" % (r, g, b)
