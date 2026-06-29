// Two-stage dominant-colour detection for a vehicle crop.
//
// The old single-stage approach assigned a hue to every weakly-saturated pixel,
// so a white/silver car (which reflects blue sky and has a faint cast) could be
// voted "Blue". This version first decides whether the region is ACHROMATIC
// (white / silver / grey / black) from the *median saturation* of the body, and
// only classifies a hue when the region is genuinely colourful. That removes the
// white→blue error while keeping real colours accurate.

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

function median(arr) {
  if (arr.length === 0) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function hueName(h) {
  if (h < 15 || h >= 345) return "Red";
  if (h < 40) return "Orange";
  if (h < 70) return "Yellow";
  if (h < 160) return "Green";
  if (h < 200) return "Cyan";
  if (h < 255) return "Blue";
  if (h < 290) return "Purple";
  return "Magenta";
}

function shade(base, v) {
  if (v < 0.5) {
    if (base === "Red") return "Maroon";
    if (base === "Blue") return "Navy";
    if (base === "Green") return "Dark Green";
    if (base === "Yellow") return "Olive";
    if (base === "Orange") return "Brown";
    if (base === "Purple") return "Indigo";
  }
  return base;
}

function hex(r, g, b) {
  return (
    "#" +
    [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")
  );
}

// Tunables.
const GRAY_S = 0.20;       // below this median saturation -> achromatic
const SAT_GATE = 0.28;     // a pixel must beat this saturation to vote a hue
const MIN_SAT_FRAC = 0.22; // need this fraction of saturated pixels to be chromatic

export function detectColor(ctx, box) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;

  // Body region: lower-centre, avoiding glass and edges.
  let rx = Math.round(box.x + box.w * 0.22);
  let ry = Math.round(box.y + box.h * 0.45);
  let rw = Math.round(box.w * 0.56);
  let rh = Math.round(box.h * 0.45);
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

  const H = [], S = [], V = [], R = [], G = [], B = [];
  const step = Math.max(1, Math.floor((rw * rh) / 2000)) * 4;
  for (let i = 0; i < data.length; i += step) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [h, s, v] = rgbToHsv(r, g, b);
    H.push(h); S.push(s); V.push(v); R.push(r); G.push(g); B.push(b);
  }
  const n = S.length;
  if (n === 0) return { name: "Unknown", hex: "#888888", confidence: 0 };

  const medS = median(S);
  const medV = median(V);

  let satCount = 0;
  for (let i = 0; i < n; i++) if (S[i] > SAT_GATE && V[i] > 0.2) satCount++;
  const satFrac = satCount / n;

  // ---- Stage 1: achromatic (white / silver / grey / black) ----
  if (medS < GRAY_S || satFrac < MIN_SAT_FRAC) {
    let name;
    if (medV < 0.22) name = "Black";
    else if (medV > 0.70) name = "White";
    else if (medV > 0.42) name = "Silver/Gray";
    else name = "Dark Gray";
    let rs = 0, gs = 0, bs = 0;
    for (let i = 0; i < n; i++) { rs += R[i]; gs += G[i]; bs += B[i]; }
    return {
      name,
      hex: hex(rs / n, gs / n, bs / n),
      confidence: Math.round((1 - medS) * 100),
    };
  }

  // ---- Stage 2: chromatic — vote a hue using only saturated pixels ----
  const counts = {};
  const sums = {};
  for (let i = 0; i < n; i++) {
    if (S[i] <= SAT_GATE || V[i] <= 0.2) continue;
    const name = hueName(H[i]);
    counts[name] = (counts[name] || 0) + 1;
    const acc = sums[name] || (sums[name] = [0, 0, 0, 0]);
    acc[0] += R[i]; acc[1] += G[i]; acc[2] += B[i]; acc[3]++;
  }
  let best = "Red", bestC = -1;
  for (const k in counts) if (counts[k] > bestC) { bestC = counts[k]; best = k; }
  const acc = sums[best];
  return {
    name: shade(best, medV),
    hex: hex(acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]),
    confidence: Math.round((bestC / satCount) * 100),
  };
}
