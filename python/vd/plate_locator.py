"""Dedicated number-plate localizer using OpenCV (no model weights).

Inside a vehicle crop: vertical-edge (Sobel x) response -> binarize -> horizontal
morphological close (merge characters) -> contours -> score by plate-like aspect
ratio / size / position. Returns (x, y, w, h) relative to the crop, or None.
"""

import cv2
import numpy as np


def locate_plate(vehicle_bgr):
    if vehicle_bgr is None or vehicle_bgr.size == 0:
        return None
    H, W = vehicle_bgr.shape[:2]
    if H < 20 or W < 30:
        return None

    # Downscale wide crops for speed; keep scale to map back.
    target = 320
    scale = min(1.0, target / W)
    work = cv2.resize(vehicle_bgr, (max(8, int(W * scale)), max(8, int(H * scale))))
    wh, ww = work.shape[:2]

    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    # Emphasise vertical edges (character strokes).
    sobel = cv2.Sobel(gray, cv2.CV_8U, 1, 0, ksize=3)
    _, thr = cv2.threshold(sobel, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Horizontal close: merge characters into bands.
    k = max(5, int(ww * 0.06)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, 5))
    closed = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best, best_score = None, 0.0
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if h < 6 or w < 14:
            continue
        aspect = w / float(h)
        fill = cv2.contourArea(c) / float(w * h + 1e-6)
        if aspect < 1.8 or aspect > 7:
            continue
        if h < wh * 0.06 or h > wh * 0.45:
            continue
        if w < ww * 0.12 or w > ww * 0.97:
            continue
        if fill < 0.25:
            continue
        aspect_score = np.exp(-((aspect - 3.2) ** 2) / 6.0)
        pos_score = 0.5 + 0.5 * ((y + h / 2.0) / wh)   # lower in box is better
        size_score = min(1.0, (w * h) / (ww * wh * 0.18))
        score = aspect_score * pos_score * (0.5 + 0.5 * fill) * (0.6 + 0.4 * size_score)
        if score > best_score:
            best_score, best = score, (x, y, w, h)

    if best is None:
        return None

    x, y, w, h = best
    px, py = w * 0.06, h * 0.12
    rx = max(0, int((x - px) / scale))
    ry = max(0, int((y - py) / scale))
    rw = int((w + 2 * px) / scale)
    rh = int((h + 2 * py) / scale)
    return (rx, ry, rw, rh)
