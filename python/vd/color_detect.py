"""Two-stage dominant-colour detection for a vehicle crop (OpenCV/NumPy).

Stage 1 decides whether the vehicle body is ACHROMATIC (white / silver / grey /
black) using the *median saturation* of the region. Only if the region is
genuinely colourful does Stage 2 classify a hue (using saturated pixels only).
This removes the common white→blue error caused by sky reflections on light cars.
"""

import cv2
import numpy as np

GRAY_S = 0.20        # below this median saturation -> achromatic
SAT_GATE = 0.28      # a pixel must beat this saturation to vote a hue
MIN_SAT_FRAC = 0.22  # need this fraction of saturated pixels to be chromatic


def _hue_base(h):
    """Vectorised hue (0-360) -> base-colour code 0..7."""
    conds = [
        (h < 15) | (h >= 345),   # 0 Red
        (h >= 15) & (h < 40),    # 1 Orange
        (h >= 40) & (h < 70),    # 2 Yellow
        (h >= 70) & (h < 160),   # 3 Green
        (h >= 160) & (h < 200),  # 4 Cyan
        (h >= 200) & (h < 255),  # 5 Blue
        (h >= 255) & (h < 290),  # 6 Purple
    ]
    return np.select(conds, [0, 1, 2, 3, 4, 5, 6], default=7)  # 7 Magenta


BASE_NAMES = ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Magenta"]


def _shade(base, v):
    if v < 0.5:
        return {
            "Red": "Maroon", "Blue": "Navy", "Green": "Dark Green",
            "Yellow": "Olive", "Orange": "Brown", "Purple": "Indigo",
        }.get(base, base)
    return base


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
    H = hsv[..., 0].astype(np.float32).ravel() * 2.0     # 0-360
    S = hsv[..., 1].astype(np.float32).ravel() / 255.0
    V = hsv[..., 2].astype(np.float32).ravel() / 255.0
    flat = crop.reshape(-1, 3)                            # BGR

    med_s = float(np.median(S))
    med_v = float(np.median(V))
    sat_mask = (S > SAT_GATE) & (V > 0.2)
    sat_frac = float(sat_mask.mean())

    # ---- Stage 1: achromatic ----
    if med_s < GRAY_S or sat_frac < MIN_SAT_FRAC:
        if med_v < 0.22:
            name = "Black"
        elif med_v > 0.70:
            name = "White"
        elif med_v > 0.42:
            name = "Silver/Gray"
        else:
            name = "Dark Gray"
        avg = flat.mean(axis=0)
        b, g, r = int(avg[0]), int(avg[1]), int(avg[2])
        return name, "#%02x%02x%02x" % (r, g, b)

    # ---- Stage 2: chromatic — vote a hue using saturated pixels only ----
    codes = _hue_base(H[sat_mask]).astype(np.int32)
    counts = np.bincount(codes, minlength=len(BASE_NAMES))
    best = int(np.argmax(counts))
    name = _shade(BASE_NAMES[best], med_v)

    sat_flat = flat[sat_mask]
    chosen = sat_flat[codes == best]
    avg = chosen.mean(axis=0) if len(chosen) else sat_flat.mean(axis=0)
    b, g, r = int(avg[0]), int(avg[1]), int(avg[2])
    return name, "#%02x%02x%02x" % (r, g, b)
