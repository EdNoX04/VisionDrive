// Optional YOLO licence-plate detector running in-browser via TensorFlow.js.
//
// Load a model you trained with Ultralytics YOLOv5/YOLOv8 and exported to the
// TF.js format (a folder with model.json + *.bin). Point loadPlateModel() at the
// model.json URL. Inference is letterboxed to a square input, decoded for both
// YOLOv5 (with objectness) and YOLOv8 (no objectness) layouts, and filtered with
// non-max suppression. All tensors are disposed to avoid the WebGL memory growth
// that can otherwise freeze the page.
//
// See /training for how to train and convert a model.

import * as tf from "@tensorflow/tfjs";

let model = null;
let cfg = {
  inputSize: 640,
  scoreThreshold: 0.35,
  iouThreshold: 0.45,
  format: "auto", // "auto" | "v5" | "v8"
};
let status = "not-loaded";

export function getPlateModelStatus() {
  return status;
}
export function isPlateModelLoaded() {
  return !!model;
}

export async function loadPlateModel(url, options = {}) {
  cfg = { ...cfg, ...options };
  status = "loading";
  try {
    unloadPlateModel();
    // Ultralytics tfjs exports are graph models.
    try {
      model = await tf.loadGraphModel(url);
    } catch (e) {
      model = await tf.loadLayersModel(url);
    }
    // Infer expected input size from the model when possible.
    const inShape =
      model.inputs?.[0]?.shape || model.inputs?.[0]?.shape || null;
    if (inShape) {
      const dim = inShape[1] && inShape[1] > 0 ? inShape[1] : inShape[2];
      if (dim && dim > 0) cfg.inputSize = dim;
    }
    // Warm up.
    tf.tidy(() => {
      const warm = tf.zeros([1, cfg.inputSize, cfg.inputSize, 3]);
      const out = model.execute(warm);
      if (Array.isArray(out)) out.forEach((t) => t.dispose());
      else out.dispose();
    });
    status = "ready";
    return true;
  } catch (e) {
    status = "error: " + (e?.message || e);
    model = null;
    return false;
  }
}

export function unloadPlateModel() {
  if (model) {
    try { model.dispose(); } catch (e) { /* ignore */ }
  }
  model = null;
  status = "not-loaded";
}

// Letterbox a region of the source into a square inputSize canvas.
function letterbox(source, region, size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#727272";
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / region.w, size / region.h);
  const dw = region.w * scale;
  const dh = region.h * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  ctx.drawImage(source, region.x, region.y, region.w, region.h, dx, dy, dw, dh);
  return { canvas: c, scale, dx, dy };
}

// Normalise raw model output to a [N, C] tensor (C = box(4) + scores...).
function toNxC(output) {
  let t = Array.isArray(output)
    ? output.reduce((a, b) => (b.shape.length === 3 ? b : a), output[0])
    : output;
  // Squeeze batch -> [A, B].
  let s = t.shape;
  if (s.length === 3) t = t.squeeze([0]);
  s = t.shape; // [A, B]
  // Channels are the small dim; boxes are the large dim.
  if (s[0] < s[1]) {
    // [C, N] -> [N, C]
    t = t.transpose([1, 0]);
  }
  return t; // [N, C]
}

/**
 * Detect plate boxes within a region of the frame.
 * @param {HTMLCanvasElement|HTMLVideoElement} source
 * @param {{x,y,w,h}} region
 * @returns {Promise<Array<{x,y,w,h,score}>>} boxes in source coords
 */
export async function detectPlatesInRegion(source, region) {
  if (!model) return [];
  const size = cfg.inputSize;
  const { canvas, scale, dx, dy } = letterbox(source, region, size);

  const result = tf.tidy(() => {
    const img = tf.browser
      .fromPixels(canvas)
      .toFloat()
      .div(255)
      .expandDims(0); // [1,H,W,3]
    const out = model.execute(img);
    const nc = toNxC(out); // [N, C]
    const C = nc.shape[1];

    const boxes = nc.slice([0, 0], [-1, 4]); // cx,cy,w,h
    let scores;
    const extra = C - 4;
    let format = cfg.format;
    if (format === "auto") format = extra >= 2 ? "v5" : "v8";

    if (format === "v5") {
      // [obj, cls0..] -> score = obj * max(cls)
      const obj = nc.slice([0, 4], [-1, 1]);
      if (extra > 1) {
        const cls = nc.slice([0, 5], [-1, extra - 1]);
        scores = obj.mul(cls.max(1, true));
      } else {
        scores = obj;
      }
    } else {
      // v8: [cls0..] -> score = max(cls)
      const cls = nc.slice([0, 4], [-1, extra]);
      scores = cls.max(1, true);
    }
    scores = scores.squeeze([1]); // [N]

    // Convert cx,cy,w,h -> x1,y1,x2,y2 (still in letterboxed pixel space).
    const cx = boxes.slice([0, 0], [-1, 1]);
    const cy = boxes.slice([0, 1], [-1, 1]);
    const w = boxes.slice([0, 2], [-1, 1]);
    const h = boxes.slice([0, 3], [-1, 1]);
    // Some exports give normalised coords (0..1); scale up if so.
    const maxv = boxes.max();
    const norm = maxv.dataSync()[0] <= 1.5;
    const k = norm ? size : 1;
    const x1 = cx.sub(w.div(2)).mul(k);
    const y1 = cy.sub(h.div(2)).mul(k);
    const x2 = cx.add(w.div(2)).mul(k);
    const y2 = cy.add(h.div(2)).mul(k);
    const boxesYX = tf.concat([y1, x1, y2, x2], 1); // [N,4] for NMS

    return { boxesYX, scores, x1, y1, x2, y2 };
  });

  let keep;
  try {
    keep = await tf.image.nonMaxSuppressionAsync(
      result.boxesYX,
      result.scores,
      20,
      cfg.iouThreshold,
      cfg.scoreThreshold
    );
  } catch (e) {
    tf.dispose(result);
    return [];
  }

  const idx = await keep.data();
  const x1a = await result.x1.data();
  const y1a = await result.y1.data();
  const x2a = await result.x2.data();
  const y2a = await result.y2.data();
  const sc = await result.scores.data();

  const out = [];
  for (const i of idx) {
    // Undo letterbox: subtract pad, divide scale, add region offset.
    const bx = (x1a[i] - dx) / scale + region.x;
    const by = (y1a[i] - dy) / scale + region.y;
    const bw = (x2a[i] - x1a[i]) / scale;
    const bh = (y2a[i] - y1a[i]) / scale;
    out.push({
      x: Math.max(0, bx),
      y: Math.max(0, by),
      w: Math.max(4, bw),
      h: Math.max(4, bh),
      score: Number(sc[i].toFixed(3)),
    });
  }

  tf.dispose([result.boxesYX, result.scores, result.x1, result.y1, result.x2, result.y2, keep]);
  out.sort((a, b) => b.score - a.score);
  return out;
}
