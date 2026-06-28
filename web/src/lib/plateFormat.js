// Country-specific plate format validation + OCR auto-correction.
//
// OCR routinely confuses letters and digits (O/0, I/1, S/5, B/8…). When we know
// the expected plate structure for a region we can fix these per position: a slot
// that must be a LETTER turns 0->O, 1->I, 5->S, 8->B…, and a slot that must be a
// DIGIT turns O->0, I->1, S->5, B->8…  This both cleans reads and rejects garbage.

// Digit seen where a letter is expected -> letter.
const TO_ALPHA = { "0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B" };
// Letter seen where a digit is expected -> digit.
const TO_DIGIT = { O: "0", Q: "0", D: "0", I: "1", L: "1", J: "1", Z: "2", A: "4", S: "5", G: "6", T: "7", B: "8" };

// Each format is a list of segments; 'A' = letters, 'D' = digits, with a length
// range. Segments are joined with spaces for display.
const FORMATS = {
  none: null,
  india: {
    label: "India",
    segments: [
      { type: "A", min: 2, max: 2 }, // state code
      { type: "D", min: 1, max: 2 }, // RTO district
      { type: "A", min: 1, max: 3 }, // series
      { type: "D", min: 3, max: 4 }, // number
    ],
  },
  uk: {
    label: "UK (current)",
    segments: [
      { type: "A", min: 2, max: 2 },
      { type: "D", min: 2, max: 2 },
      { type: "A", min: 3, max: 3 },
    ],
  },
  generic: {
    label: "Generic (length only)",
    generic: true,
    min: 4,
    max: 9,
  },
};

export function plateFormatOptions() {
  return Object.entries(FORMATS).map(([key, f]) => ({
    key,
    label: f ? f.label : "None / off",
  }));
}

// Expand segment ranges into concrete templates: { chars, groups }.
function expand(segments) {
  let templates = [{ chars: "", groups: [] }];
  for (const seg of segments) {
    const next = [];
    for (let len = seg.min; len <= seg.max; len++) {
      for (const t of templates) {
        next.push({
          chars: t.chars + seg.type.repeat(len),
          groups: [...t.groups, len],
        });
      }
    }
    templates = next;
    if (templates.length > 400) break; // safety cap
  }
  return templates;
}

const TEMPLATE_CACHE = {};
function templatesFor(key) {
  if (!(key in TEMPLATE_CACHE)) {
    const f = FORMATS[key];
    TEMPLATE_CACHE[key] = f && f.segments ? expand(f.segments) : null;
  }
  return TEMPLATE_CACHE[key];
}

function groupWithSpaces(text, groups) {
  let out = [], i = 0;
  for (const g of groups) { out.push(text.slice(i, i + g)); i += g; }
  return out.join(" ");
}

/**
 * Validate and auto-correct a raw OCR plate string for a region.
 * @param {string} raw cleaned, uppercase alphanumerics
 * @param {string} formatKey one of plateFormatOptions() keys
 * @returns {{enabled:boolean, valid:boolean, text:string, display:string, corrections:number}}
 */
export function applyPlateFormat(raw, formatKey) {
  const s = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const f = FORMATS[formatKey];

  if (!f) return { enabled: false, valid: true, text: s, display: s, corrections: 0 };

  if (f.generic) {
    const valid = s.length >= f.min && s.length <= f.max;
    return { enabled: true, valid, text: s, display: s, corrections: 0 };
  }

  const candidates = (templatesFor(formatKey) || []).filter(
    (t) => t.chars.length === s.length
  );
  if (candidates.length === 0) {
    return { enabled: true, valid: false, text: s, display: s, corrections: 0 };
  }

  let best = null;
  for (const tpl of candidates) {
    let out = "", cost = 0, ok = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const expect = tpl.chars[i];
      if (expect === "A") {
        if (ch >= "A" && ch <= "Z") out += ch;
        else if (TO_ALPHA[ch]) { out += TO_ALPHA[ch]; cost++; }
        else { ok = false; break; }
      } else {
        if (ch >= "0" && ch <= "9") out += ch;
        else if (TO_DIGIT[ch]) { out += TO_DIGIT[ch]; cost++; }
        else { ok = false; break; }
      }
    }
    if (ok && (!best || cost < best.cost)) best = { out, cost, groups: tpl.groups };
  }

  if (!best) return { enabled: true, valid: false, text: s, display: s, corrections: 0 };

  // Reject if it took too many corrections to fit (likely a misread, not a plate).
  const valid = best.cost <= Math.ceil(s.length * 0.4);
  return {
    enabled: true,
    valid,
    text: best.out,
    display: groupWithSpaces(best.out, best.groups),
    corrections: best.cost,
  };
}
