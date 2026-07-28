import type { ParamValues } from './types';

// Fast-preview implementations of the global (non-AI) tools.
//
// NOTE (declared decision, see docs/ARCHITECTURE.md §8): these run in JS so
// slider feedback is instant. The Python engine will mirror them for batch
// export, guarded by a parity test — they are NOT silently divergent.
//
// Professional-correctness rules applied here:
//   * exposure and white balance are applied in LINEAR light, not on sRGB
//     values (multiplying sRGB is physically wrong and shifts hue).
//   * highlights get a soft shoulder so they compress instead of clipping.
//   * sharpening and local contrast act on LUMINANCE only, so edges don't
//     grow colour fringes.
//   * the painterly filter is a real Kuwahara (edge-preserving), not a blur.

/* ---------------- colour-space plumbing ---------------- */

const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const L2S_N = 4096;
const L2S = new Float32Array(L2S_N);
for (let i = 0; i < L2S_N; i++) {
  const c = i / (L2S_N - 1);
  L2S[i] = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** linear 0..1 -> sRGB 0..1 */
function lin2s(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return L2S[(x * (L2S_N - 1)) | 0];
}

/** Soft highlight shoulder: everything above SHOULDER asymptotes to 1 instead
 *  of clipping flat — this is what keeps a bright dress from going to paper. */
const SHOULDER = 0.72;
function shoulder(x: number): number {
  if (x <= SHOULDER) return x;
  const t = (x - SHOULDER) / (1 - SHOULDER);
  return SHOULDER + (1 - SHOULDER) * (1 - Math.exp(-t));
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function cloneImage(img: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

const LUM_R = 0.2126;
const LUM_G = 0.7152;
const LUM_B = 0.0722;

/* ---------------- separable box blur (helper) ---------------- */

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

/* ---------------- tone-color ---------------- */

function toneColor(img: ImageData, p: ParamValues): ImageData {
  const out = cloneImage(img);
  const d = out.data;

  const exposure = (p.exposure ?? 0) / 100; // -1..1  =>  -2..+2 stops
  const contrast = (p.contrast ?? 0) / 100;
  const highlights = (p.highlights ?? 0) / 100;
  const shadows = (p.shadows ?? 0) / 100;
  const whites = (p.whites ?? 0) / 100;
  const blacks = (p.blacks ?? 0) / 100;
  const temp = (p.temperature ?? 0) / 100;
  const tint = (p.tint ?? 0) / 100;
  const sat = (p.saturation ?? 0) / 100;
  const vib = (p.vibrance ?? 0) / 100;

  const expGain = Math.pow(2, exposure * 2);
  // white balance = channel gains in LINEAR light (that's what a WB actually is)
  const rGain = expGain * (1 + temp * 0.28 + tint * 0.05);
  const gGain = expGain * (1 - tint * 0.1);
  const bGain = expGain * (1 - temp * 0.28 + tint * 0.05);

  const touchLinear = exposure !== 0 || temp !== 0 || tint !== 0;

  for (let i = 0; i < d.length; i += 4) {
    let R: number;
    let G: number;
    let B: number;

    if (touchLinear) {
      // ---- linear light: exposure + white balance + soft shoulder ----
      R = lin2s(shoulder(S2L[d[i]] * rGain));
      G = lin2s(shoulder(S2L[d[i + 1]] * gGain));
      B = lin2s(shoulder(S2L[d[i + 2]] * bGain));
    } else {
      R = d[i] / 255;
      G = d[i + 1] / 255;
      B = d[i + 2] / 255;
    }

    // ---- perceptual (display-space) adjustments ----
    if (contrast !== 0) {
      R = applyContrast(R, contrast);
      G = applyContrast(G, contrast);
      B = applyContrast(B, contrast);
    }

    const L = LUM_R * R + LUM_G * G + LUM_B * B;

    if (highlights !== 0) {
      const m = smoothstep(0.4, 0.95, L) * highlights * 0.35;
      R += m;
      G += m;
      B += m;
    }
    if (shadows !== 0) {
      const m = (1 - smoothstep(0.05, 0.6, L)) * shadows * 0.35;
      R += m;
      G += m;
      B += m;
    }
    if (whites !== 0) {
      const m = smoothstep(0.7, 1.0, L) * whites * 0.3;
      R += m;
      G += m;
      B += m;
    }
    if (blacks !== 0) {
      const m = (1 - smoothstep(0.0, 0.3, L)) * blacks * 0.3;
      R += m;
      G += m;
      B += m;
    }

    if (sat !== 0 || vib !== 0) {
      const L2 = LUM_R * R + LUM_G * G + LUM_B * B;
      const mx = Math.max(R, G, B);
      const mn = Math.min(R, G, B);
      const c = mx - mn;
      let vibPx = vib;
      if (vib !== 0) {
        // vibrance protects skin — kept byte-identical to globals_py._tone_color
        const sc = Math.max(c, 1e-6);
        let h;
        if (mx === R) h = ((((G - B) / sc) % 6) + 6) % 6;
        else if (mx === G) h = (B - R) / sc + 2;
        else h = (R - G) / sc + 4;
        h *= 60;
        const wBand =
          smoothstep(8, 14, h) * (1 - smoothstep(42, 50, h)) * (1 - smoothstep(0.38, 0.55, c));
        const hd = Math.min(h, 360 - h);
        const wRed = (1 - smoothstep(6, 14, hd)) * (1 - smoothstep(0.18, 0.3, c));
        let w = Math.max(wBand, wRed);
        w *= clamp01((c - 0.015) / 0.035);
        vibPx = vib * (1 - 0.8 * w);
      }
      const k = 1 + sat + vibPx * (1 - clamp01(c));
      R = L2 + (R - L2) * k;
      G = L2 + (G - L2) * k;
      B = L2 + (B - L2) * k;
    }

    d[i] = clamp255(R * 255);
    d[i + 1] = clamp255(G * 255);
    d[i + 2] = clamp255(B * 255);
  }
  return out;
}

/** Smooth S-curve contrast — never clips the way a linear scale does. */
function applyContrast(x: number, c: number): number {
  if (c > 0) {
    const s = x * x * (3 - 2 * x);
    return x + (s - x) * c;
  }
  return x + (0.5 - x) * -c * 0.5;
}

/* ---------------- dimension: local contrast + vignette ---------------- */

function dimension(img: ImageData, p: ParamValues): ImageData {
  const { width: w, height: h } = img;
  const out = cloneImage(img);
  const d = out.data;
  const clarity = (p.clarity ?? 0) / 100;
  const vignette = (p.vignette ?? 0) / 100;

  if (clarity !== 0) {
    const r = Math.max(2, Math.round(Math.max(w, h) * 0.015));
    const blur = boxBlur(img.data, w, h, r);
    // luminance-only, with the delta limited so edges don't grow halos
    const limit = 26;
    for (let i = 0; i < d.length; i += 4) {
      const l0 = LUM_R * d[i] + LUM_G * d[i + 1] + LUM_B * d[i + 2];
      const l1 = LUM_R * blur[i] + LUM_G * blur[i + 1] + LUM_B * blur[i + 2];
      const mid = 1 - Math.abs(l0 / 255 - 0.5) * 2;
      let delta = (l0 - l1) * clarity * 1.1 * mid;
      if (delta > limit) delta = limit;
      else if (delta < -limit) delta = -limit;
      d[i] = clamp255(d[i] + delta);
      d[i + 1] = clamp255(d[i + 1] + delta);
      d[i + 2] = clamp255(d[i + 2] + delta);
    }
  }

  if (vignette !== 0) {
    const cx = w / 2;
    const cy = h / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy);
    // midpoint 50 reproduces the historical 0.35 start; floor at 0.25 keeps
    // corners from going to black — kept identical to globals_py._dimension
    const midpoint = (p.midpoint ?? 50) / 100;
    const start = 0.35 + (midpoint - 0.5) * 0.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const t = Math.sqrt(dx * dx + dy * dy) / maxD;
        // smooth falloff instead of a hard parabola
        let f = 1 - vignette * smoothstep(start, 1.0, t);
        if (f < 0.25) f = 0.25;
        d[i] = clamp255(d[i] * f);
        d[i + 1] = clamp255(d[i + 1] * f);
        d[i + 2] = clamp255(d[i + 2] * f);
      }
    }
  }
  return out;
}

/* ---------------- color-grade: split toning + matte fade ---------------- */

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
    const L = (LUM_R * r + LUM_G * g + LUM_B * b) / 255;

    if (shadowsWarm !== 0) {
      const m = 1 - smoothstep(0.0, 0.7, L);
      r += shadowsWarm * m * 24;
      b -= shadowsWarm * m * 24;
    }
    if (highlightsWarm !== 0) {
      const m = smoothstep(0.3, 1.0, L);
      r += highlightsWarm * m * 24;
      b -= highlightsWarm * m * 24;
    }
    if (fade !== 0) {
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

/* ---------------- light-point ---------------- */

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
      const fall = (1 - smoothstep(0, 1, t)) * strength;
      // screen blend — light adds without flattening what's already bright
      for (let c = 0; c < 3; c++) {
        const tintC = c === 0 ? 1.0 : c === 1 ? 0.93 - warmth * 0.05 : 0.82 - warmth * 0.22;
        const src = d[i + c];
        const lightC = 255 * fall * tintC;
        d[i + c] = clamp255(255 - ((255 - src) * (255 - lightC)) / 255);
      }
    }
  }
  return out;
}

/* ---------------- glow ---------------- */

function glow(img: ImageData, p: ParamValues): ImageData {
  const amount = (p.amount ?? 0) / 100;
  if (amount === 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const r = Math.max(2, Math.round(4 + ((p.radius ?? 40) / 100) * 50));

  // bloom only from what's actually bright, otherwise it's just haze
  const bright = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const L = (LUM_R * img.data[i] + LUM_G * img.data[i + 1] + LUM_B * img.data[i + 2]) / 255;
    const k = smoothstep(0.55, 1.0, L);
    bright[i] = img.data[i] * k;
    bright[i + 1] = img.data[i + 1] * k;
    bright[i + 2] = img.data[i + 2] * k;
    bright[i + 3] = 255;
  }
  const blur = boxBlur(bright, w, h, r);

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

/* ---------------- oil-paint: real Kuwahara, O(n) via integral images ------- */

function oilPaint(img: ImageData, p: ParamValues): ImageData {
  const amount = (p.amount ?? 0) / 100;
  if (amount === 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const src = img.data;
  const r = Math.max(1, Math.round(1 + ((p.radius ?? 30) / 100) * 9));

  const iw = w + 1;
  const ih = h + 1;
  const sR = new Float64Array(iw * ih);
  const sG = new Float64Array(iw * ih);
  const sB = new Float64Array(iw * ih);
  const sL = new Float64Array(iw * ih);
  const sL2 = new Float64Array(iw * ih);

  for (let y = 0; y < h; y++) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    let rowL = 0;
    let rowL2 = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const R = src[i];
      const G = src[i + 1];
      const B = src[i + 2];
      const L = LUM_R * R + LUM_G * G + LUM_B * B;
      rowR += R;
      rowG += G;
      rowB += B;
      rowL += L;
      rowL2 += L * L;
      const o = (y + 1) * iw + (x + 1);
      const up = y * iw + (x + 1);
      sR[o] = sR[up] + rowR;
      sG[o] = sG[up] + rowG;
      sB[o] = sB[up] + rowB;
      sL[o] = sL[up] + rowL;
      sL2[o] = sL2[up] + rowL2;
    }
  }

  const rect = (s: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    s[y1 * iw + x1] - s[y0 * iw + x1] - s[y1 * iw + x0] + s[y0 * iw + x0];

  const out = cloneImage(img);
  const d = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(w, x + 1);
      const xc = Math.min(w, x + r + 1);
      const ya = Math.max(0, y - r);
      const yb = Math.min(h, y + 1);
      const yc = Math.min(h, y + r + 1);

      let bestVar = Infinity;
      let bR = 0;
      let bG = 0;
      let bB = 0;

      for (let q = 0; q < 4; q++) {
        const x0 = q === 0 || q === 2 ? xa : x;
        const x1 = q === 0 || q === 2 ? xb : xc;
        const y0 = q < 2 ? ya : y;
        const y1 = q < 2 ? yb : yc;
        const n = (x1 - x0) * (y1 - y0);
        if (n <= 0) continue;
        const sumL = rect(sL, x0, y0, x1, y1);
        const sumL2 = rect(sL2, x0, y0, x1, y1);
        const mean = sumL / n;
        const variance = sumL2 / n - mean * mean;
        if (variance < bestVar) {
          bestVar = variance;
          bR = rect(sR, x0, y0, x1, y1) / n;
          bG = rect(sG, x0, y0, x1, y1) / n;
          bB = rect(sB, x0, y0, x1, y1) / n;
        }
      }

      const i = (y * w + x) * 4;
      d[i] = clamp255(src[i] + (bR - src[i]) * amount);
      d[i + 1] = clamp255(src[i + 1] + (bG - src[i + 1]) * amount);
      d[i + 2] = clamp255(src[i + 2] + (bB - src[i + 2]) * amount);
    }
  }
  return out;
}

/* ---------------- sharpen: luminance-only unsharp mask ---------------- */

function sharpen(img: ImageData, p: ParamValues): ImageData {
  const amount = (p.amount ?? 0) / 100;
  if (amount === 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const r = Math.max(1, Math.round(1 + ((p.radius ?? 20) / 100) * 4));
  const masking = (p.masking ?? 0) / 100;
  const blur = boxBlur(img.data, w, h, r);
  const out = cloneImage(img);
  const d = out.data;
  const k = amount * 1.5;
  const limit = 40; // stop haloes on high-contrast edges

  // ACR-style masking: local energy of the same high-pass the sharpen uses —
  // kept structurally identical to globals_py._sharpen
  let energy: Uint8ClampedArray | null = null;
  let eScale = 1;
  if (masking > 0) {
    const hp = new Uint8ClampedArray(img.data.length);
    for (let i = 0; i < d.length; i += 4) {
      const l0 = LUM_R * d[i] + LUM_G * d[i + 1] + LUM_B * d[i + 2];
      const l1 = LUM_R * blur[i] + LUM_G * blur[i + 1] + LUM_B * blur[i + 2];
      const a = Math.abs(l0 - l1);
      hp[i] = a;
      hp[i + 1] = a;
      hp[i + 2] = a;
      hp[i + 3] = 255;
    }
    energy = boxBlur(hp, w, h, r * 2 + 1);
    // P95 of edge energy — the frame's own "strong edge" reference, so the
    // threshold transfers across images and resolutions (see globals_py)
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < energy.length; i += 4) {
      hist[energy[i]]++;
      n++;
    }
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= n * 0.99) {
        eScale = Math.max(v, 1e-3);
        break;
      }
    }
  }
  const t = masking * masking;

  for (let i = 0; i < d.length; i += 4) {
    const l0 = LUM_R * d[i] + LUM_G * d[i + 1] + LUM_B * d[i + 2];
    const l1 = LUM_R * blur[i] + LUM_G * blur[i + 1] + LUM_B * blur[i + 2];
    let delta = (l0 - l1) * k;
    if (delta > limit) delta = limit;
    else if (delta < -limit) delta = -limit;
    if (energy) delta *= smoothstep(t * 0.6, t * 1.4 + 1e-6, energy[i] / eScale);
    // add to all channels equally => sharpens detail, never shifts colour
    d[i] = clamp255(d[i] + delta);
    d[i + 1] = clamp255(d[i + 1] + delta);
    d[i + 2] = clamp255(d[i + 2] + delta);
  }
  return out;
}

/* ---------------- curves ---------------- */

// Parametric curves: five fixed-x control points per channel, outputs are the
// sliders. Monotone cubic (Fritsch-Carlson) — kept identical to
// globals_py._curve_lut / _curves.
const CURVE_XS = [0, 64, 128, 192, 255];
const CURVE_POINTS = ['Blacks', 'Shadows', 'Mids', 'Highlights', 'Whites'];

function curveLut(offsets: number[]): Float32Array {
  const ys = new Float32Array(5);
  for (let i = 0; i < 5; i++) {
    const y = Math.min(255, Math.max(0, CURVE_XS[i] + offsets[i] * 64));
    ys[i] = i > 0 && y < ys[i - 1] ? ys[i - 1] : y; // never fold back
  }
  const h = [64, 64, 64, 63];
  const d = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) d[i] = (ys[i + 1] - ys[i]) / h[i];
  const m = [d[0], 0, 0, 0, d[3]];
  for (let i = 1; i < 4; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < 4; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }
  const lut = new Float32Array(256);
  for (let x = 0; x < 256; x++) {
    let i = 3;
    if (x < CURVE_XS[1]) i = 0;
    else if (x < CURVE_XS[2]) i = 1;
    else if (x < CURVE_XS[3]) i = 2;
    const t = (x - CURVE_XS[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    const v =
      ys[i] * (2 * t3 - 3 * t2 + 1) +
      h[i] * m[i] * (t3 - 2 * t2 + t) +
      ys[i + 1] * (-2 * t3 + 3 * t2) +
      h[i] * m[i + 1] * (t3 - t2);
    lut[x] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return lut;
}

function curves(img: ImageData, p: ParamValues): ImageData {
  const offs = (ch: string) => CURVE_POINTS.map((pt) => (p[`${ch}${pt}`] ?? 0) / 100);
  const luma = offs('luma');
  const per: (Float32Array | null)[] = ['red', 'green', 'blue'].map((ch) => {
    const o = offs(ch);
    return o.some((v) => v !== 0) ? curveLut(o) : null;
  });
  const hasLuma = luma.some((v) => v !== 0);
  if (!hasLuma && per.every((l) => l === null)) return cloneImage(img);

  const lumaLut = hasLuma ? curveLut(luma) : null;
  const out = cloneImage(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    // channel curves first (colour moves), then the luma curve shapes tone on
    // the result without shifting that colour — same order as the engine
    let R = per[0] ? per[0][d[i]] : d[i];
    let G = per[1] ? per[1][d[i + 1]] : d[i + 1];
    let B = per[2] ? per[2][d[i + 2]] : d[i + 2];
    if (lumaLut) {
      const l = LUM_R * R + LUM_G * G + LUM_B * B;
      const idx = Math.round(l < 0 ? 0 : l > 255 ? 255 : l);
      const delta = lumaLut[idx] - idx;
      R += delta;
      G += delta;
      B += delta;
    }
    d[i] = clamp255(R);
    d[i + 1] = clamp255(G);
    d[i + 2] = clamp255(B);
  }
  return out;
}

/* ---------------- dispatch ---------------- */

const IMPL: Record<string, (img: ImageData, p: ParamValues) => ImageData> = {
  'tone-color': toneColor,
  curves,
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
