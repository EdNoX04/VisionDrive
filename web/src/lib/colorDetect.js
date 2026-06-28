// Dominant-colour detection for a vehicle bounding box.
//
// Key ideas for accuracy:
//  - Sample the BODY of the vehicle (lower-centre), not the centre, because the
//    centre is mostly glass/windscreen which skews every car toward dark/grey.
//  - Bucket pixels into named colours via HSV, take the MODE (most common label).
//  - Build the swatch from the average of pixels in the winning bucket only,
//    so the colour chip actually matches the reported name.
//  - Clamp the sample region to the canvas so getImageData never throws.

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function classify(h, s, v) {
  // Greyscale axis.
  if (v < 0.20) return "Black";
  if (s < 0.18) {
    if (v > 0.78) return "White";
    if (v > 0.45) return "Silver/Gray";
    return "Dark Gray";
  }
  // Base hue.
  let base;
  if (h < 15 || h >= 345) base = "Red";
  else if (h < 40) base = "Orange";
  else if (h < 70) base = "Yellow";
  else if (h < 160) base = "Green";
  else if (h < 200) base = "Cyan";
  else if (h < 255) base = "Blue";
  else if (h < 290) base = "Purple";
  else base = "Magenta";

  // Shade refinement for darker paints (matches richer real-world names).
  if (v < 0.5) {
    if (base === "Red") return "Maroon";
    if (base === "Blue") return "Navy";
    if (base === "Green") return "Dark Green";
    if (base === "Yellow") return "Olive";
    if (base === "Orange") return s > 0.5 ? "Brown" : "Olive";
    if (base === "Purple") return "Indigo";
  }
  return base;
}

/**
 * @param {CanvasRenderingContext2D} ctx full-frame canvas context
 * @param {{x,y,w,h}} box vehicle box in canvas pixel coords
 * @returns {{name:string, hex:string, confidence:number}}
 */
export function detectColor(ctx, box) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;

  // Body region: lower-centre of the box, avoiding glass and edges.
  let rx = Math.round(box.x + box.w * 0.22);
  let ry = Math.round(box.y + box.h * 0.45);
  let rw = Math.round(box.w * 0.56);
  let rh = Math.round(box.h * 0.45);

  // Clamp to canvas bounds.
  rx = Math.max(0, Math.min(rx, cw - 2));
  ry = Math.max(0, Math.min(ry, ch - 2));
  rw = Math.max(1, Math.min(rw, cw - rx));
  rh = Math.max(1, Math.min(rh, ch - ry));

  let data;
  try {
    data = ctx.getImageData(rx, ry, rw, rh).data;
  } catch (e) {
    return { name: "Unknown", hex: "#888888", confidence: 0 };
  }

  const counts = {};
  const sums = {}; // label -> [r,g,b,n]
  let total = 0;
  const step = Math.max(1, Math.floor((rw * rh) / 1500)) * 4;

  for (let i = 0; i < data.length; i += step) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Skip near-pure specular highlights (reflections) unless white dominates.
    const [h, s, v] = rgbToHsv(r, g, b);
    const label = classify(h, s, v);
    counts[label] = (counts[label] || 0) + 1;
    const acc = sums[label] || (sums[label] = [0, 0, 0, 0]);
    acc[0] += r; acc[1] += g; acc[2] += b; acc[3]++;
    total++;
  }
  if (total === 0) return { name: "Unknown", hex: "#888888", confidence: 0 };

  let best = "Unknown", bestC = -1;
  for (const k in counts) if (counts[k] > bestC) { bestC = counts[k]; best = k; }

  const acc = sums[best];
  const hex =
    "#" +
    [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]]
      .map((x) => Math.round(x).toString(16).padStart(2, "0"))
      .join("");

  return { name: best, hex, confidence: Math.round((bestC / total) * 100) };
}
