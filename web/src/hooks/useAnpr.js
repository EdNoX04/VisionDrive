// Orchestrates the full ANPR pipeline against a <video> element:
// detect -> track -> speed -> colour -> plate (YOLO/CV) -> OCR, drawing an overlay.
//
// Performance notes (these prevent the page from "freezing" over time):
//  - The processing loop is capped to a target FPS instead of flooding rAF.
//  - React state (tracks/fps) is updated at most a few times per second.
//  - Colour is recomputed per track only every ~350ms (cached on the track).
//  - Only stable or plated tracks are logged, and the log map is pruned.
//  - The frame is snapshotted before async OCR so results match their box.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadDetector, detectVehicles } from "../lib/detector.js";
import { Tracker } from "../lib/tracker.js";
import { detectColor } from "../lib/colorDetect.js";
import { readPlateRegion, lowerPlateRegion } from "../lib/ocr.js";
import { locatePlate } from "../lib/plateLocator.js";
import { isPlateModelLoaded, detectPlatesInRegion } from "../lib/plateModel.js";
import { applyPlateFormat } from "../lib/plateFormat.js";

const CLASS_COLORS = {
  car: "#3b82f6",
  truck: "#f59e0b",
  bus: "#a855f7",
  motorcycle: "#10b981",
  bicycle: "#10b981",
};

// Crop a region of a canvas into a small JPEG data URL (evidence thumbnail).
function cropThumb(srcCanvas, box, maxW) {
  const w = Math.max(1, box.w), h = Math.max(1, box.h);
  const scale = Math.min(1, maxW / w);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext("2d").drawImage(srcCanvas, box.x, box.y, w, h, 0, 0, c.width, c.height);
  try { return c.toDataURL("image/jpeg", 0.6); } catch (e) { return null; }
}

const COLOR_INTERVAL = 350; // ms per-track colour refresh
const STATE_INTERVAL = 150; // ms min between React state pushes
const RECORD_CAP = 200; // max rows kept in the detection log
const MIN_HITS = 3; // frames a track must persist before logging

export function useAnpr({ videoRef, overlayRef, settings }) {
  const modelRef = useRef(null);
  const trackerRef = useRef(null);
  const frameCanvasRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const settingsRef = useRef(settings);
  const ocrBusyRef = useRef(false);
  const lastOcrRef = useRef(new Map());
  const lastColorRef = useRef(new Map());
  const recordsRef = useRef(new Map());
  const lastProcessRef = useRef(0);
  const lastStatePushRef = useRef(0);
  const lastFpsPushRef = useRef(0);

  const [modelReady, setModelReady] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [running, setRunning] = useState(false);
  const [tracks, setTracks] = useState([]);
  const [records, setRecords] = useState([]);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    settingsRef.current = settings;
    if (trackerRef.current) trackerRef.current.setCalibration(settings.metersPerPixel);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("Loading model…");
      const model = await loadDetector(setStatus);
      if (cancelled) return;
      modelRef.current = model;
      trackerRef.current = new Tracker({ metersPerPixel: settingsRef.current.metersPerPixel });
      frameCanvasRef.current = document.createElement("canvas");
      setModelReady(true);
      setStatus("Model ready");
    })();
    return () => {
      cancelled = true;
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const draw = useCallback((list, vw, vh) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, vw, vh);
    const limit = settingsRef.current.speedLimit;
    ctx.lineWidth = Math.max(2, vw / 480);
    ctx.font = `${Math.max(13, Math.round(vw / 55))}px ui-sans-serif, system-ui`;
    ctx.textBaseline = "top";

    for (const t of list) {
      const over = limit > 0 && t.speedKmh > limit;
      const color = over ? "#ef4444" : CLASS_COLORS[t.class] || "#3b82f6";
      const { x, y, w, h } = t.box;
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w, h);

      if (t.plateBox) {
        const pb = t.plateBox;
        ctx.save();
        ctx.strokeStyle = t.plateBox.fromModel ? "#22c55e" : "#22d3ee";
        ctx.lineWidth = Math.max(1.5, vw / 640);
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(pb.x, pb.y, pb.w, pb.h);
        ctx.restore();
      }

      const lines = [`#${t.id} ${t.class} ${Math.round(t.speedKmh)} km/h`];
      if (t.plate) lines.push(t.plate);
      if (t.color) lines.push(t.color.name);

      const pad = 4;
      const lh = parseInt(ctx.font, 10) + 4;
      const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
      const boxH = lines.length * lh + pad;
      const ly = y - boxH < 0 ? y + 2 : y - boxH;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, ly, boxW, boxH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      lines.forEach((l, i) => ctx.fillText(l, x + pad, ly + pad / 2 + i * lh));
    }
  }, [overlayRef]);

  const upsertRecord = useCallback((t) => {
    // Only log tracks that have persisted, or that have a plate read.
    if (t.hits < MIN_HITS && !t.plate) return;
    const key = t.plate || `id-${t.id}`;
    const prev = recordsRef.current.get(key) || {
      key, id: t.id, firstSeen: Date.now(), maxSpeed: 0, hits: 0,
    };
    recordsRef.current.set(key, {
      ...prev,
      id: t.id,
      class: t.class,
      plate: t.plate || prev.plate || null,
      color: t.color?.name || prev.color || null,
      colorHex: t.color?.hex || prev.colorHex || null,
      speedKmh: Math.round(t.speedKmh),
      maxSpeed: Math.max(prev.maxSpeed, Math.round(t.speedKmh)),
      lastSeen: Date.now(),
      hits: t.hits,
      score: Math.round(t.score * 100),
      plateThumb: t.plateThumb || prev.plateThumb || null,
      thumb: t.thumb || prev.thumb || null,
    });

    // Prune oldest if over cap.
    if (recordsRef.current.size > RECORD_CAP) {
      const oldest = [...recordsRef.current.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0];
      if (oldest) recordsRef.current.delete(oldest.key);
    }
  }, []);

  const runPlateOcr = useCallback((target, now, s) => {
    const fc = frameCanvasRef.current;
    const tracker = trackerRef.current;
    const vw = fc.width, vh = fc.height;

    // Snapshot the frame so async work matches the box even as the loop advances.
    const snap = document.createElement("canvas");
    snap.width = vw; snap.height = vh;
    const snapCtx = snap.getContext("2d", { willReadFrequently: true });
    snapCtx.drawImage(fc, 0, 0);

    ocrBusyRef.current = true;
    lastOcrRef.current.set(target.id, now);

    (async () => {
      try {
        let plateBox = null;
        if (s.useYoloPlate && isPlateModelLoaded()) {
          const dets = await detectPlatesInRegion(snap, target.box);
          if (dets.length) plateBox = { ...dets[0], fromModel: true };
        }
        if (!plateBox && s.plateLocate) {
          try { plateBox = locatePlate(snapCtx, target.box); } catch (e) { /* ignore */ }
        }
        const region = plateBox || lowerPlateRegion(target.box);
        // Evidence snapshots: vehicle thumbnail + plate crop.
        const vehImg = cropThumb(snap, target.box, 200);
        tracker.setMeta(target.id, { plateBox, thumb: vehImg });
        const res = await readPlateRegion(snap, region);
        if (res && res.confidence >= s.ocrMinConfidence) {
          // Country-specific validation + O/0, I/1, S/5… auto-correction.
          const fmt = applyPlateFormat(res.text, s.plateFormat);
          const accept = !fmt.enabled || !s.requireValidFormat || fmt.valid;
          if (accept) {
            tracker.setMeta(target.id, {
              plate: fmt.display,
              plateConf: res.confidence,
              plateValid: fmt.enabled ? fmt.valid : null,
              plateThumb: cropThumb(snap, region, 260),
            });
          }
        }
      } catch (e) {
        /* ignore */
      } finally {
        ocrBusyRef.current = false;
      }
    })();
  }, []);

  const processFrame = useCallback(async () => {
    const video = videoRef.current;
    const model = modelRef.current;
    const tracker = trackerRef.current;
    if (!video || !model || !tracker) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    const vw = video.videoWidth, vh = video.videoHeight;
    const fc = frameCanvasRef.current;
    if (fc.width !== vw || fc.height !== vh) { fc.width = vw; fc.height = vh; }
    const fctx = fc.getContext("2d", { willReadFrequently: true });
    fctx.drawImage(video, 0, 0, vw, vh);

    const s = settingsRef.current;
    const dets = await detectVehicles(model, video, s.minScore);
    const now = video.currentTime ? video.currentTime * 1000 : performance.now();
    const active = tracker.update(dets, now);

    // Colour: throttled per track, cached on the track via tracker meta.
    if (s.colorEnabled) {
      for (const t of active) {
        const last = lastColorRef.current.get(t.id) || 0;
        if (now - last > COLOR_INTERVAL || !t.color) {
          const col = detectColor(fctx, t.box);
          tracker.setMeta(t.id, { color: col });
          lastColorRef.current.set(t.id, now);
          t.color = col;
        }
      }
    }

    // Plate localisation + OCR (throttled, single-flight).
    if (s.ocrEnabled && !ocrBusyRef.current) {
      const target = active
        .filter((t) => now - (lastOcrRef.current.get(t.id) || 0) > s.ocrIntervalMs)
        .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
      if (target) runPlateOcr(target, now, s);
    }

    active.forEach(upsertRecord);
    draw(active, vw, vh);

    const wall = performance.now();
    if (wall - lastStatePushRef.current > STATE_INTERVAL) {
      lastStatePushRef.current = wall;
      setTracks(active.map((t) => ({ ...t })));
    }
  }, [videoRef, draw, upsertRecord, runPlateOcr]);

  const tick = useCallback(async () => {
    if (!runningRef.current) return;
    const now = performance.now();
    const minInterval = 1000 / (settingsRef.current.targetFps || 15);
    if (now - lastProcessRef.current >= minInterval) {
      lastProcessRef.current = now;
      try { await processFrame(); } catch (e) { /* keep loop alive */ }
      const dt = performance.now() - now;
      if (now - lastFpsPushRef.current > 500) {
        lastFpsPushRef.current = now;
        setFps(Math.min(settingsRef.current.targetFps || 15, Math.round(1000 / Math.max(dt, 1))));
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [processFrame]);

  const start = useCallback(() => {
    if (!modelRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setStatus("Processing…");
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setStatus("Paused");
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // Push the records table and prune stale throttle maps periodically.
  useEffect(() => {
    const id = setInterval(() => {
      setRecords([...recordsRef.current.values()].sort((a, b) => b.lastSeen - a.lastSeen));
      const cutoff = performance.now() - 30000;
      for (const m of [lastOcrRef.current, lastColorRef.current]) {
        for (const [k, v] of m) if (v < cutoff) m.delete(k);
      }
    }, 700);
    return () => clearInterval(id);
  }, []);

  const resetRecords = useCallback(() => {
    recordsRef.current.clear();
    lastOcrRef.current.clear();
    lastColorRef.current.clear();
    trackerRef.current?.reset();
    setRecords([]);
    setTracks([]);
    const canvas = overlayRef.current;
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }, [overlayRef]);

  return { modelReady, status, running, tracks, records, fps, start, stop, resetRecords };
}
