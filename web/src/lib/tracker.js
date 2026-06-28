// Lightweight centroid tracker with speed estimation.
//
// Associates detections across frames using nearest-centroid matching with a
// distance gate, assigns stable IDs, and estimates speed from displacement of
// the centroid between timestamps using a pixel->meter calibration.

let NEXT_ID = 1;

function centroid(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class Tracker {
  /**
   * @param {object} opts
   * @param {number} opts.maxDistance  max centroid distance (px) to match
   * @param {number} opts.maxMissed    frames a track survives without a match
   * @param {number} opts.metersPerPixel  calibration: real meters per pixel
   * @param {number} opts.smoothing    EMA factor for speed (0..1)
   */
  constructor(opts = {}) {
    this.maxDistance = opts.maxDistance ?? 120;
    this.maxMissed = opts.maxMissed ?? 12;
    this.metersPerPixel = opts.metersPerPixel ?? 0.05;
    this.smoothing = opts.smoothing ?? 0.4;
    this.tracks = new Map(); // id -> track
  }

  setCalibration(metersPerPixel) {
    this.metersPerPixel = metersPerPixel;
  }

  /**
   * @param {Array<{box,class,score}>} detections
   * @param {number} time timestamp in ms (e.g. performance.now or video.currentTime*1000)
   * @returns {Array} active tracks with id, box, class, score, speedKmh, color
   */
  update(detections, time) {
    const unmatched = new Set(detections.map((_, i) => i));
    const ids = [...this.tracks.keys()];

    // Greedy nearest matching: for each existing track, find closest detection.
    const pairs = [];
    for (const id of ids) {
      const t = this.tracks.get(id);
      let bestI = -1, bestD = Infinity;
      for (const i of unmatched) {
        const d = dist(t.centroid, centroid(detections[i].box));
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI !== -1 && bestD <= this.maxDistance) {
        pairs.push({ id, i: bestI, d: bestD });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    const usedDet = new Set();
    const usedTrack = new Set();
    for (const p of pairs) {
      if (usedDet.has(p.i) || usedTrack.has(p.id)) continue;
      usedDet.add(p.i);
      usedTrack.add(p.id);
      unmatched.delete(p.i);
      this._matchTrack(p.id, detections[p.i], time);
    }

    // New tracks for unmatched detections.
    for (const i of unmatched) {
      this._newTrack(detections[i], time);
    }

    // Age out tracks that were not matched this frame.
    for (const id of ids) {
      if (!usedTrack.has(id)) {
        const t = this.tracks.get(id);
        t.missed += 1;
        if (t.missed > this.maxMissed) this.tracks.delete(id);
      }
    }

    return [...this.tracks.values()]
      .filter((t) => t.missed === 0)
      .map((t) => ({
        id: t.id,
        box: t.box,
        class: t.class,
        score: t.score,
        speedKmh: t.speedKmh,
        color: t.color,
        plate: t.plate,
        plateBox: t.plateBox,
        hits: t.hits,
        thumb: t.thumb,
        plateThumb: t.plateThumb,
      }));
  }

  _newTrack(det, time) {
    const id = NEXT_ID++;
    this.tracks.set(id, {
      id,
      box: det.box,
      class: det.class,
      score: det.score,
      centroid: centroid(det.box),
      lastTime: time,
      speedKmh: 0,
      missed: 0,
      color: null,
      plate: null,
      plateBox: null,
      maxSpeed: 0,
      hits: 1,
    });
  }

  _matchTrack(id, det, time) {
    const t = this.tracks.get(id);
    const c = centroid(det.box);
    const dt = (time - t.lastTime) / 1000; // seconds
    if (dt > 0) {
      const pxMoved = dist(t.centroid, c);
      const metersMoved = pxMoved * this.metersPerPixel;
      const instMs = metersMoved / dt; // m/s
      const instKmh = instMs * 3.6;
      // EMA smoothing; clamp absurd values.
      const clamped = Math.min(instKmh, 400);
      t.speedKmh = t.speedKmh
        ? t.speedKmh * (1 - this.smoothing) + clamped * this.smoothing
        : clamped;
      t.maxSpeed = Math.max(t.maxSpeed, t.speedKmh);
    }
    t.centroid = c;
    t.box = det.box;
    t.class = det.class;
    t.score = det.score;
    t.lastTime = time;
    t.missed = 0;
    t.hits += 1;
  }

  // Attach metadata produced by async stages (color, plate OCR).
  setMeta(id, meta) {
    const t = this.tracks.get(id);
    if (t) Object.assign(t, meta);
  }

  reset() {
    this.tracks.clear();
  }
}
