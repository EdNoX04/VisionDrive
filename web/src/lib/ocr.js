// Number-plate OCR using Tesseract.js.
//
// Runs on an EXACT plate crop (from plateLocator) — or any region box passed in.
// The crop is upscaled, grayscaled and Otsu-thresholded for legibility, then
// OCR is restricted to plate-like characters.

import { createWorker } from "tesseract.js";

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        tessedit_pageseg_mode: "7", // single text line
      });
      return worker;
    })();
  }
  return workerPromise;
}

function clean(text) {
  return (text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Otsu's method on a 256-bin histogram -> optimal threshold.
function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}

// A plausible plate: 4-12 chars and a mix of letters & digits (or fully numeric).
function quality(s) {
  if (s.length < 4 || s.length > 12) return 0;
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[A-Z]/g) || []).length;
  let q = 0.5;
  if (digits >= 2 && letters >= 1) q = 1;
  else if (digits >= 3) q = 0.8;
  return q;
}

/**
 * OCR a specific region (ideally a located plate) of the frame.
 * @param {HTMLCanvasElement|HTMLVideoElement} source full frame
 * @param {{x,y,w,h}} region crop box in source pixel coords
 * @returns {Promise<{text,confidence,quality}|null>}
 */
export async function readPlateRegion(source, region) {
  const worker = await getWorker();

  const rw = Math.max(8, region.w);
  const rh = Math.max(8, region.h);
  // Upscale so the plate is ~120px tall for OCR (helps on low-res web video).
  const scale = Math.min(8, Math.max(3, 120 / rh));
  const c = document.createElement("canvas");
  c.width = Math.round(rw * scale);
  c.height = Math.round(rh * scale);
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.imageSmoothingEnabled = true;
  cx.drawImage(source, region.x, region.y, rw, rh, 0, 0, c.width, c.height);

  const img = cx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  const grayBuf = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    grayBuf[j] = g;
    hist[g]++;
  }
  const t = otsu(hist, grayBuf.length);
  // Decide polarity: plates are usually dark text on light bg.
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = grayBuf[j] > t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  cx.putImageData(img, 0, 0);

  try {
    const { data } = await worker.recognize(c);
    const text = clean(data.text);
    const q = quality(text);
    if (q === 0) return null;
    return { text, confidence: Math.round(data.confidence), quality: q };
  } catch (e) {
    return null;
  }
}

// Fallback region when no plate is localized: lower-centre of the vehicle box.
export function lowerPlateRegion(box) {
  return {
    x: box.x + box.w * 0.1,
    y: box.y + box.h * 0.55,
    w: box.w * 0.8,
    h: box.h * 0.4,
  };
}

export async function terminateOcr() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
