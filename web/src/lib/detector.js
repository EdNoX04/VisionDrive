// Vehicle detector wrapping the COCO-SSD model (TensorFlow.js).
//
// COCO-SSD detects 80 classes; we keep only vehicle classes. The backend is
// WebGL for GPU acceleration where available.

import "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

export const VEHICLE_CLASSES = new Set([
  "car",
  "truck",
  "bus",
  "motorcycle",
  "bicycle",
]);

let modelPromise = null;

export async function loadDetector(onProgress) {
  if (!modelPromise) {
    onProgress?.("Loading vehicle detection model…");
    // mobilenet_v2 base is markedly more accurate than lite_mobilenet_v2,
    // especially for trucks/buses — worth the slightly larger download.
    modelPromise = cocoSsd.load({ base: "mobilenet_v2" });
  }
  return modelPromise;
}

/**
 * @param {object} model coco-ssd model
 * @param {HTMLVideoElement|HTMLCanvasElement} input
 * @param {number} minScore minimum confidence
 * @returns {Promise<Array<{box:{x,y,w,h}, class:string, score:number}>>}
 */
export async function detectVehicles(model, input, minScore = 0.35) {
  const preds = await model.detect(input, 20);
  return preds
    .filter((p) => VEHICLE_CLASSES.has(p.class) && p.score >= minScore)
    .map((p) => ({
      box: { x: p.bbox[0], y: p.bbox[1], w: p.bbox[2], h: p.bbox[3] },
      class: p.class,
      score: p.score,
    }));
}
