import type { ParamValues } from './types';

// Fast-preview implementations of the global (non-AI) tools.
// NOTE (declared decision, see docs/ARCHITECTURE.md §8): these run in JS so
// slider feedback is instant. The Python engine will mirror them for batch
// export, guarded by a parity test — they are NOT silently divergent.

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function cloneImage(img: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

/** Separable box blur (approximates gaussian). O(w*h) per pass. */
function boxBlur(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
): Uint8ClampedArray {
  if (r < 1) return new Uint8ClampedArray(src);
  const a = new Uint8ClampedArray(src.length);
  const b = new Uint8ClampedArray(src.length);
  const n = 2 * r + 1;

  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) {
        const xx = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
        sum += src[row + xx * 4 + c];
      }
      for (let x = 0; x < w; x++) {
        a[row + x * 4 + c] = sum / n;
        const xOut = x - r < 0 ? 0 : x - r;
        const xIn = x + r + 1 > w - 1 ? w - 1 : x + r + 1;
        sum += src[row + xIn * 4 + c] - src[row + xOut * 4 + c];
      }
    }
    for (let x = 0; x < w; x++) a[row + x * 4 + 3] = src[row + x * 4 + 3];
  }

  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) {
        const yy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
        sum += a[yy * w * 4 + x * 4 + c];
      }
      for (let y = 0; y < h; y++) {
        b[y * w * 4 + x * 4 + c] = sum / n;
        const yOut = y - r < 0 ? 0 : y - r;
        const yIn = y + r + 1 > h - 1 ? h - 1 : y + r + 1;
        sum += a[yIn * w * 4 + x * 4 + c] - a[yOut * w * 4 + x * 4 + c];
      }
    }
    for (let y = 0; y < h; y++) b[y * w * 4 + x * 4 + 3] = a[y * w * 4 + x * 4 + 3];
  }
  return b;
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/* ---------------- tone-color: exposure / contrast / tonal zones / color ---------------- */
function toneColor(img: ImageData, p: ParamValues): ImageData {
  const out = cloneImage(img);
  const d = out.data;
  const exposure = (p.exposure ?? 0) / 100;
  const contrast = (p.contrast ?? 0) / 100;
  const highlights = (p.highlights ?? 0) / 100;
  const shadows = (p.shadows ?? 0) / 100;
  const whites = (p.whites ?? 0) / 100;
  const blacks = (p.blacks ?? 0) / 100;
  const temp = (p.temperature ?? 0) / 100;
  const tint = (p.tint ?? 0) / 100;
  const sat = (p.saturation ?? 0) / 100;
  const vib = (p.vibrance ?? 0) / 100;

  const expFactor = Math.pow(2, exposure);
  const contrastFactor = 1 + contrast;

  for (let i = 0; i < d.length; i += 4) {
    let r = (d[i] / 255) * expFactor;
    let g = (d[i + 1] / 255) * expFactor;
    let b = (d[i + 2] / 255) * expFactor;

    r += temp * 0.15 + tint * 0.05;
    b += -temp * 0.15 + tint * 0.05;
    g += -tint * 0.1;

    r = (r - 0.5) * contrastFactor + 0.5;
    g = (g - 0.5) * contrastFactor + 0.5;
    b = (b - 0.5) * contrastFactor + 0.5;

    const L = lum(r, g, b);
    // broad tonal zones
    if (highlights !== 0) {
      const f = 1 + highlights * Math.max(0, L - 0.5) * 2 * 0.5;
      r *= f; g *= f; b *= f;
    }
    if (shadows !== 0) {
      const f = 1 + shadows * Math.max(0, 0.5 - L) * 2 * 0.5;
      r *= f; g *= f; b *= f;
    }
    // extreme ends — "whites" recovers burnt areas, "blacks" opens the darkest
    if (whites !== 0) {
      const f = 1 + whites * Math.min(1, Math.max(0, (L - 0.7) / 0.3)) * 0.4;
      r *= f; g *= f; b *= f;
    }
    if (blacks !== 0) {
      const m = Math.min(1, Math.max(0, (0.3 - L) / 0.3));
      const lift = blacks * m * 0.25;
      r += lift; g += lift; b += lift;
    }

    const L2 = lum(r, g, b);
    const pixelSat = Math.max(r, g, b) - Math.min(r, g, b);
    const totalSat = 1 + sat + vib * (1 - pixelSat);
    r = L2 + (r - L2) * totalSat;
    g = L2 + (g - L2) * totalSat;
    b = L2 + (b - L2) * totalSat;

    d[i] = clamp255(r * 255);
    d[i + 1] = clamp255(g * 255);
    d[i + 2] = clamp255(b * 255);
  }
  return out;
}

/* ---------------- dimension: local contrast (clarity) + vignette ---------------- */
function dimension(img: ImageData, p: ParamValues): ImageData {
  const { width: w, height: h } = img;
  const out = cloneImage(img);
  const d = out.data;
  const clarity = (p.clarity ?? 0) / 100;
  const vignette = (p.vignette ?? 0) / 100;

  if (clarity !== 0) {
    const r = Math.max(2, Math.round(Math.max(w, h) * 0.02));
    const blur = boxBlur(img.data, w, h, r);
    for (let i = 0; i < d.length; i += 4) {
      // midtone-weighted so we don't halo the extremes
      const L = lum(d[i], d[i + 1], d[i + 2]) / 255;
      const mid = 1 - Math.abs(L - 0.5) * 2;
      const k = clarity * 1.2 * mid;
      d[i] = clamp255(d[i] + (d[i] - blur[i]) * k);
      d[i + 1] = clamp255(d[i + 1] + (d[i + 1] - blur[i + 1]) * k);
      d[i + 2] = clamp255(d[i + 2] + (d[i + 2] - blur[i + 2]) * k);
    }
  }

  if (vignette !== 0) {
    const cx = w / 2;
    const cy = h / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const t = Math.sqrt(dx * dx + dy * dy) / maxD;
        const f = 1 - vignette * t * t;
        d[i] = clamp255(d[i] * f);
        d[i + 1] = clamp255(d[i + 1] * f);
        d[i + 2] = clamp255(d[i + 2] * f);
      }
    }
  }
  return out;
}

/* ---------------- color-grade: split toning + matte fade (the "look" tool) ---------------- */
function colorGrade(img: ImageData, p: ParamValues): ImageData {
  const out = cloneImage(img);
  const d = out.data;
  const shadowsWarm = (p.shadowsWarm ?? 0) / 100;
  const highlightsWarm = (p.highlightsWarm ?? 0) / 100;
  const fade = (p.fade ?? 0) / 100;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    const L = lum(r, g, b) / 255;

    if (shadowsWarm !== 0) {
      const m = 1 - L;
      r += shadowsWarm * m * 26;
      b -= shadowsWarm * m * 26;
    }
    if (highlightsWarm !== 0) {
      const m = L;
      r += highlightsWarm * m * 26;
      b -= highlightsWarm * m * 26;
    }
    if (fade !== 0) {
      // lift the blacks toward a matte film base
      r = r * (1 - fade * 0.22) + fade * 0.22 * 62;
      g = g * (1 - fade * 0.22) + fade * 0.22 * 60;
      b = b * (1 - fade * 0.22) + fade * 0.22 * 66;
    }

    d[i] = clamp255(r);
    d[i + 1] = clamp255(g);
    d[i + 2] = clamp255(b);
  }
  return out;
}

/* ---------------- light-point: an added natural light source ---------------- */
function lightPoint(img: ImageData, p: ParamValues): ImageData {
  const strength = (p.strength ?? 0) / 100;
  if (strength === 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const out = cloneImage(img);
  const d = out.data;
  const cx = ((p.x ?? 50) / 100) * w;
  const cy = ((p.y ?? 30) / 100) * h;
  const radius = Math.max(w, h) * ((p.size ?? 50) / 100);
  const warmth = (p.warmth ?? 60) / 100;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const t = Math.sqrt(dx * dx + dy * dy) / radius;
      if (t >= 1) continue;
      const fall = (1 - t) * (1 - t) * strength * 110;
      d[i] = clamp255(d[i] + fall * (0.7 + warmth * 0.3));
      d[i + 1] = clamp255(d[i + 1] + fall * (0.65 + warmth * 0.15));
      d[i + 2] = clamp255(d[i + 2] + fall * (0.6 - warmth * 0.25));
    }
  }
  return out;
}

/* ---------------- glow: soft bloom on the highlights ---------------- */
function glow(img: ImageData, p: ParamValues): ImageData {
  const amount = (p.amount ?? 0) / 100;
  if (amount === 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const r = Math.max(2, Math.round(4 + ((p.radius ?? 40) / 100) * 50));
  const blur = boxBlur(img.data, w, h, r);
  const out = cloneImage(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const base = d[i + c];
      const screen = 255 - ((255 - base) * (255 - blur[i + c])) / 255;
      d[i + c] = clamp255(base + (screen - base) * amount);
    }
  }
  return out;
}

/* ---------------- oil-paint: painterly / fine-art stylization ---------------- */
function oilPaint(img: ImageData, p: ParamValues): ImageData {
  const amount = (p.amount ?? 0) / 100;
  if (amount === 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const r = Math.max(1, Math.round(1 + ((p.radius ?? 30) / 100) * 7));
  const blur = boxBlur(img.data, w, h, r);
  const levels = Math.max(4, Math.round(24 - amount * 16)); // more amount → chunkier
  const step = 255 / levels;
  const out = cloneImage(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const posterized = Math.round(blur[i + c] / step) * step;
      d[i + c] = clamp255(d[i + c] + (posterized - d[i + c]) * amount);
    }
  }
  return out;
}

/* ---------------- sharpen: unsharp mask (output sharpening) ---------------- */
function sharpen(img: ImageData, p: ParamValues): ImageData {
  const amount = (p.amount ?? 0) / 100;
  if (amount === 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const r = Math.max(1, Math.round(1 + ((p.radius ?? 20) / 100) * 5));
  const blur = boxBlur(img.data, w, h, r);
  const out = cloneImage(img);
  const d = out.data;
  const k = amount * 1.6;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp255(d[i] + (d[i] - blur[i]) * k);
    d[i + 1] = clamp255(d[i + 1] + (d[i + 1] - blur[i + 1]) * k);
    d[i + 2] = clamp255(d[i + 2] + (d[i + 2] - blur[i + 2]) * k);
  }
  return out;
}

/* ---------------- dispatch ---------------- */
const IMPL: Record<string, (img: ImageData, p: ParamValues) => ImageData> = {
  'tone-color': toneColor,
  dimension,
  'color-grade': colorGrade,
  'light-point': lightPoint,
  glow,
  'oil-paint': oilPaint,
  sharpen,
};

/** Apply one global tool. Returns a new ImageData. */
export function applyGlobalTool(
  toolId: string,
  img: ImageData,
  params: ParamValues,
): ImageData {
  const fn = IMPL[toolId];
  if (!fn) return img; // AI tools are handled by the engine, not here
  return fn(img, params);
}
