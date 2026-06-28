// Dedicated number-plate localizer (classic computer vision, no model weights).
//
// Pipeline, run inside each detected vehicle box:
//   1. crop + downscale the vehicle region
//   2. grayscale
//   3. Sobel vertical-edge magnitude  (plates are dense with vertical strokes)
//   4. binarize edges
//   5. horizontal morphological close  (merge characters into one blob)
//   6. connected-component labelling
//   7. score components by plate-like aspect ratio, size, fill and position
// Returns the best plate rectangle in ORIGINAL frame pixel coords, or null.

function toGray(data, n) {
  const g = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return g;
}

// Sobel vertical-edge response (|Gx|).
function sobelX(gray, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx =
        -gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1] +
        gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1];
      out[i] = Math.abs(gx);
    }
  }
  return out;
}

function binarize(mag, n, k = 0.55) {
  // Threshold at a fraction of the max edge magnitude (robust to lighting).
  let max = 0;
  for (let i = 0; i < n; i++) if (mag[i] > max) max = mag[i];
  const t = max * k;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = mag[i] >= t ? 1 : 0;
  return b;
}

function dilateH(src, W, H, r) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let on = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < W && src[row + xx]) { on = 1; break; }
      }
      out[row + x] = on;
    }
  }
  return out;
}

function erodeH(src, W, H, r) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let all = 1;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= W || !src[row + xx]) { all = 0; break; }
      }
      out[row + x] = all;
    }
  }
  return out;
}

// Connected components (8-connectivity), iterative flood fill.
function components(bin, W, H) {
  const labels = new Int32Array(W * H).fill(0);
  const stack = new Int32Array(W * H);
  const comps = [];
  let next = 0;
  for (let p = 0; p < bin.length; p++) {
    if (!bin[p] || labels[p]) continue;
    next++;
    let sp = 0;
    stack[sp++] = p;
    labels[p] = next;
    let minX = W, maxX = 0, minY = H, maxY = 0, count = 0;
    while (sp > 0) {
      const q = stack[--sp];
      const x = q % W, y = (q / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      count++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const r = ny * W + nx;
          if (bin[r] && !labels[r]) { labels[r] = next; stack[sp++] = r; }
        }
      }
    }
    comps.push({ minX, maxX, minY, maxY, count });
  }
  return comps;
}

/**
 * Locate the best plate rectangle inside a vehicle box.
 * @param {CanvasRenderingContext2D} fctx full-frame canvas context
 * @param {{x,y,w,h}} box vehicle box in frame pixel coords
 * @returns {{x,y,w,h,score}|null}
 */
export function locatePlate(fctx, box) {
  const sx = Math.max(0, Math.round(box.x));
  const sy = Math.max(0, Math.round(box.y));
  const sw = Math.max(8, Math.round(box.w));
  const sh = Math.max(8, Math.round(box.h));

  // Downscale wide boxes for speed; keep a scale factor to map back.
  const target = 320;
  const scale = Math.min(1, target / sw);
  const W = Math.max(8, Math.round(sw * scale));
  const H = Math.max(8, Math.round(sh * scale));

  // Draw the vehicle crop into a temp canvas at working resolution.
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  let img;
  try {
    const src = fctx.getImageData(sx, sy, sw, sh);
    // Put source then read scaled via drawImage path.
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = sw; srcCanvas.height = sh;
    srcCanvas.getContext("2d").putImageData(src, 0, 0);
    tctx.drawImage(srcCanvas, 0, 0, sw, sh, 0, 0, W, H);
    img = tctx.getImageData(0, 0, W, H).data;
  } catch (e) {
    return null;
  }

  const n = W * H;
  const gray = toGray(img, n);
  const mag = sobelX(gray, W, H);
  let bin = binarize(mag, n, 0.5);

  // Horizontal closing: dilate then erode to merge characters into bands.
  const r = Math.max(3, Math.round(W * 0.03));
  bin = erodeH(dilateH(bin, W, H, r), W, H, r);

  const comps = components(bin, W, H);
  if (!comps.length) return null;

  let best = null, bestScore = 0;
  for (const c of comps) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    if (bh < 6 || bw < 14) continue;
    const aspect = bw / bh;
    const fill = c.count / (bw * bh);

    // Plate-like constraints relative to the vehicle crop.
    if (aspect < 1.8 || aspect > 7) continue;
    if (bh < H * 0.06 || bh > H * 0.45) continue;
    if (bw < W * 0.12 || bw > W * 0.97) continue;
    if (fill < 0.25) continue;

    // Scores: aspect near ~3.2 ideal, prefer lower-middle, prefer fuller blobs.
    const aspectScore = Math.exp(-((aspect - 3.2) ** 2) / 6);
    const cy = (c.minY + c.maxY) / 2 / H;
    const posScore = 0.5 + 0.5 * cy; // lower in the box is better
    const sizeScore = Math.min(1, (bw * bh) / (W * H * 0.18));
    const score = aspectScore * posScore * (0.5 + 0.5 * fill) * (0.6 + 0.4 * sizeScore);

    if (score > bestScore) {
      bestScore = score;
      best = { minX: c.minX, maxX: c.maxX, minY: c.minY, maxY: c.maxY };
    }
  }
  if (!best) return null;

  // Map back to original frame coords (+ small padding).
  const padX = (best.maxX - best.minX) * 0.06;
  const padY = (best.maxY - best.minY) * 0.12;
  const x = sx + (best.minX - padX) / scale;
  const y = sy + (best.minY - padY) / scale;
  const w = (best.maxX - best.minX + 2 * padX) / scale;
  const h = (best.maxY - best.minY + 2 * padY) / scale;

  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    w: Math.max(6, w),
    h: Math.max(6, h),
    score: Number(bestScore.toFixed(3)),
  };
}
