"""Centroid tracker with stable IDs and speed estimation.

Fixes the original's index-based IDs (which reshuffled every frame). Associates
detections across frames by nearest centroid with a distance gate, assigns stable
IDs, and estimates speed from centroid displacement with a pixel->metre
calibration and EMA smoothing.
"""

import math


def _centroid(box):
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


class Track:
    __slots__ = ("id", "box", "cls", "score", "centroid", "last_time",
                 "speed_kmh", "max_speed", "missed", "hits",
                 "color", "color_hex", "plate", "plate_box", "thumb", "plate_thumb")

    def __init__(self, tid, box, cls, score, t):
        self.id = tid
        self.box = box
        self.cls = cls
        self.score = score
        self.centroid = _centroid(box)
        self.last_time = t
        self.speed_kmh = 0.0
        self.max_speed = 0.0
        self.missed = 0
        self.hits = 1
        self.color = None
        self.color_hex = None
        self.plate = None
        self.plate_box = None
        self.thumb = None
        self.plate_thumb = None


class Tracker:
    def __init__(self, meters_per_pixel=0.05, max_distance=120,
                 max_missed=12, smoothing=0.4):
        self.meters_per_pixel = meters_per_pixel
        self.max_distance = max_distance
        self.max_missed = max_missed
        self.smoothing = smoothing
        self.tracks = {}
        self._next_id = 1

    def set_calibration(self, mpp):
        self.meters_per_pixel = mpp

    def update(self, detections, t):
        """detections: list of (box, cls, score); t: timestamp in seconds.

        Returns list of active Track objects (matched this frame).
        """
        ids = list(self.tracks.keys())
        unmatched = set(range(len(detections)))

        pairs = []
        for tid in ids:
            tr = self.tracks[tid]
            best_i, best_d = -1, float("inf")
            for i in unmatched:
                d = _dist(tr.centroid, _centroid(detections[i][0]))
                if d < best_d:
                    best_d, best_i = d, i
            if best_i != -1 and best_d <= self.max_distance:
                pairs.append((best_d, tid, best_i))
        pairs.sort(key=lambda p: p[0])

        used_t, used_d = set(), set()
        for _, tid, i in pairs:
            if tid in used_t or i in used_d:
                continue
            used_t.add(tid)
            used_d.add(i)
            unmatched.discard(i)
            self._match(tid, detections[i], t)

        for i in unmatched:
            self._new(detections[i], t)

        for tid in ids:
            if tid not in used_t:
                tr = self.tracks[tid]
                tr.missed += 1
                if tr.missed > self.max_missed:
                    del self.tracks[tid]

        return [tr for tr in self.tracks.values() if tr.missed == 0]

    def _new(self, det, t):
        box, cls, score = det
        tid = self._next_id
        self._next_id += 1
        self.tracks[tid] = Track(tid, box, cls, score, t)

    def _match(self, tid, det, t):
        box, cls, score = det
        tr = self.tracks[tid]
        c = _centroid(box)
        dt = t - tr.last_time
        if dt > 0:
            px = _dist(tr.centroid, c)
            inst_kmh = (px * self.meters_per_pixel / dt) * 3.6
            inst_kmh = min(inst_kmh, 400.0)
            tr.speed_kmh = (tr.speed_kmh * (1 - self.smoothing) + inst_kmh * self.smoothing
                            if tr.speed_kmh else inst_kmh)
            tr.max_speed = max(tr.max_speed, tr.speed_kmh)
        tr.centroid = c
        tr.box = box
        tr.cls = cls
        tr.score = score
        tr.last_time = t
        tr.missed = 0
        tr.hits += 1

    def reset(self):
        self.tracks.clear()
