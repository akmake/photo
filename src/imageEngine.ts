import type { ParamValues } from './types';
import { getTool } from './toolRegistry';

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

/* ---------------- gaussian blur, OpenCV's (helper) ----------------
 *
 * Not "a gaussian" — cv2.GaussianBlur's, because the engine's local contrast is
 * built on that exact blur and a preview built on a different one shows a
 * different picture. So: the sigma OpenCV derives from an odd ksize, its fixed
 * small-kernel tables, and BORDER_REFLECT_101 at the edges. */

const SMALL_GAUSSIAN: number[][] = [
  [1],
  [0.25, 0.5, 0.25],
  [0.0625, 0.25, 0.375, 0.25, 0.0625],
  [0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125],
];

function gaussianKernel(ksize: number): Float64Array {
  if (ksize % 2 === 1 && ksize <= 7) return Float64Array.from(SMALL_GAUSSIAN[ksize >> 1]);
  const sigma = 0.3 * ((ksize - 1) * 0.5 - 1) + 0.8;
  const scale = -0.5 / (sigma * sigma);
  const k = new Float64Array(ksize);
  const mid = (ksize - 1) * 0.5;
  let sum = 0;
  for (let i = 0; i < ksize; i++) {
    const x = i - mid;
    k[i] = Math.exp(scale * x * x);
    sum += k[i];
  }
  for (let i = 0; i < ksize; i++) k[i] /= sum;
  return k;
}

/** gfedcb|abcdefgh|gfedcba — OpenCV's default border. */
function reflect101(i: number, n: number): number {
  if (n === 1) return 0;
  while (i < 0 || i >= n) {
    if (i < 0) i = -i;
    if (i >= n) i = 2 * (n - 1) - i;
  }
  return i;
}

/** Separable gaussian over one float plane. */
function gaussianBlurPlane(
  src: Float32Array,
  w: number,
  h: number,
  ksize: number,
): Float32Array {
  const k = gaussianKernel(ksize);
  const half = (ksize - 1) >> 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  // Each pass runs the edges and the interior separately. Only the edges need
  // the reflection, and calling it per tap over the whole frame — which is what
  // a single loop does — costs more than the convolution itself.
  const loX = Math.min(half, w);
  const hiX = Math.max(loX, w - half);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < loX; x++) {
      let acc = 0;
      for (let t = 0; t < ksize; t++) acc += k[t] * src[row + reflect101(x + t - half, w)];
      tmp[row + x] = acc;
    }
    for (let x = loX; x < hiX; x++) {
      let acc = 0;
      const base = row + x - half;
      for (let t = 0; t < ksize; t++) acc += k[t] * src[base + t];
      tmp[row + x] = acc;
    }
    for (let x = hiX; x < w; x++) {
      let acc = 0;
      for (let t = 0; t < ksize; t++) acc += k[t] * src[row + reflect101(x + t - half, w)];
      tmp[row + x] = acc;
    }
  }

  const loY = Math.min(half, h);
  const hiY = Math.max(loY, h - half);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    if (y >= loY && y < hiY) {
      const base = row - half * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let t = 0; t < ksize; t++) acc += k[t] * tmp[base + t * w + x];
        out[row + x] = acc;
      }
    } else {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let t = 0; t < ksize; t++) {
          acc += k[t] * tmp[reflect101(y + t - half, h) * w + x];
        }
        out[row + x] = acc;
      }
    }
  }
  return out;
}

/** Box blur over one float plane, replicate borders, running sums — O(1) per
 *  pixel at any radius. Mirrors cv2.blur(..., BORDER_REPLICATE). */
function boxBlurPlane(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const n = 2 * r + 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + (x < 0 ? 0 : x > w - 1 ? w - 1 : x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      const gone = x - r < 0 ? 0 : x - r;
      const next = x + r + 1 > w - 1 ? w - 1 : x + r + 1;
      sum += src[row + next] - src[row + gone];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[(y < 0 ? 0 : y > h - 1 ? h - 1 : y) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      const gone = y - r < 0 ? 0 : y - r;
      const next = y + r + 1 > h - 1 ? h - 1 : y + r + 1;
      sum += tmp[next * w + x] - tmp[gone * w + x];
    }
  }
  return out;
}

/** Neighbourhood brightness — three box passes, a gaussian for a third of the
 *  cost. Mirrors globals_py._local_luma. */
const LOCAL_RADIUS = 0.03;
/** Texture's band and edge knee — mirrors globals_py. */
const TEXTURE_RADIUS = 0.005;
const TEXTURE_KNEE = 10.0;

function localLuma(lum: Float32Array, w: number, h: number): Float32Array {
  const r = Math.max(1, Math.trunc(Math.max(w, h) * LOCAL_RADIUS));
  let out = lum;
  for (let i = 0; i < 3; i++) out = boxBlurPlane(out, w, h, r);
  return out;
}

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
  const recovery = (p.recovery ?? 0) / 100;

  const expGain = Math.pow(2, exposure * 2);
  // white balance = channel gains in LINEAR light (that's what a WB actually is)
  const rGain = expGain * (1 + temp * 0.28 + tint * 0.05);
  const gGain = expGain * (1 - tint * 0.1);
  const bGain = expGain * (1 - temp * 0.28 + tint * 0.05);

  const touchLinear = exposure !== 0 || temp !== 0 || tint !== 0;

  // Adaptive recovery needs the whole frame's brightness before it can decide
  // which zone a pixel belongs to, so it costs a pre-pass. At 0 — every recipe
  // that predates it — nothing here runs and the loop below is the old one.
  const stage1 = (v: number, gain: number): number => {
    let x = touchLinear ? lin2s(shoulder(S2L[v] * gain)) : v / 255;
    if (contrast !== 0) x = applyContrast(x, contrast);
    return x;
  };
  const adaptive = recovery > 0 && (highlights !== 0 || shadows !== 0);
  let lref: Float32Array | null = null;
  let pre: Float32Array | null = null;
  if (adaptive) {
    const { width: w, height: h } = img;
    pre = new Float32Array(w * h * 3);
    const lum = new Float32Array(w * h);
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      const R = stage1(d[i], rGain);
      const G = stage1(d[i + 1], gGain);
      const B = stage1(d[i + 2], bGain);
      pre[j * 3] = R;
      pre[j * 3 + 1] = G;
      pre[j * 3 + 2] = B;
      lum[j] = LUM_R * R + LUM_G * G + LUM_B * B;
    }
    const local = localLuma(lum, w, h);
    lref = new Float32Array(lum.length);
    for (let j = 0; j < lum.length; j++) {
      lref[j] = lum[j] + (local[j] - lum[j]) * recovery;
    }
  }

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let R: number;
    let G: number;
    let B: number;

    if (pre) {
      R = pre[j * 3];
      G = pre[j * 3 + 1];
      B = pre[j * 3 + 2];
    } else if (touchLinear) {
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
    if (contrast !== 0 && !pre) {
      R = applyContrast(R, contrast);
      G = applyContrast(G, contrast);
      B = applyContrast(B, contrast);
    }

    const L = LUM_R * R + LUM_G * G + LUM_B * B;
    // highlights and shadows follow the AREA when recovery is on; whites and
    // blacks are endpoints of the range and always follow the pixel
    const Lz = lref ? lref[j] : L;

    if (highlights !== 0) {
      const m = smoothstep(0.4, 0.95, Lz) * highlights * 0.35;
      R += m;
      G += m;
      B += m;
    }
    if (shadows !== 0) {
      const m = (1 - smoothstep(0.05, 0.6, Lz)) * shadows * 0.35;
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
  const texture = (p.texture ?? 0) / 100;
  const vignette = (p.vignette ?? 0) / 100;

  if (clarity !== 0 || texture !== 0) {
    // The engine blurs RGB and takes the luma of it; blur and luma are both
    // linear, so blurring the luma plane alone is the same answer for a third
    // of the work.
    const lum = new Float32Array(w * h);
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      lum[j] = LUM_R * d[i] + LUM_G * d[i + 1] + LUM_B * d[i + 2];
    }
    // `| 1` makes these odd: they are KERNEL SIZES, the same numbers globals_py
    // hands to cv2.GaussianBlur. Clarity's was read as a radius here once,
    // which made the preview's blur three times as wide as the export's.
    let broad: Float32Array | null = null;
    let fineBlur: Float32Array | null = null;
    if (clarity !== 0) {
      broad = gaussianBlurPlane(lum, w, h, Math.max(2, Math.trunc(Math.max(w, h) * 0.015)) | 1);
    }
    if (texture !== 0) {
      fineBlur = gaussianBlurPlane(
        lum, w, h, Math.max(2, Math.trunc(Math.max(w, h) * TEXTURE_RADIUS)) | 1,
      );
    }

    // luminance-only, with each delta limited so edges don't grow halos
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      const l0 = lum[j];
      let delta = 0;
      if (broad) {
        const mid = 1 - Math.abs(l0 / 255 - 0.5) * 2;
        let c = (l0 - broad[j]) * clarity * 1.1 * mid;
        if (c > 26) c = 26;
        else if (c < -26) c = -26;
        delta += c;
      }
      if (fineBlur) {
        const fine = l0 - fineBlur[j];
        // guard: full push below the knee, nothing on a real edge
        const g = 1 / (1 + (fine / TEXTURE_KNEE) * (fine / TEXTURE_KNEE));
        let t = fine * texture * g;
        if (t > 20) t = 20;
        else if (t < -20) t = -20;
        delta += t;
      }
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

/* ---------------- color-grade: RETIRED, kept for old recipes ----------------
 *
 * Superseded by grade-zones below, which says everything this said and more.
 * It is out of the registry's tool list, so nothing new can pick it up — but a
 * style saved before the merge still carries it, and must still render exactly
 * as it did the day it was saved. Do not "improve" this function. */

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

/* ---------------- grade-zones: colour per tonal zone + matte ----------------
 *
 * The mirror of engine/grade_zones.py, and the reason color-grade above is
 * retired: two warm/cool axes are a subset of three zones with a free hue.
 *
 * Lab stays in floating point, with OpenCV's constants and its 0..255 L / +128
 * ab convention but none of its byte rounding — in deep shadows a whole Lab
 * level is worth up to seven sRGB levels, so quantising here would band the
 * picture exactly where a grade is used most. engine/grade_zones.py does the
 * same, off the same sRGB tables, which is what keeps the two within a level. */

const LAB_XN = 0.950456;
const LAB_ZN = 1.088754;

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function labFInv(t: number): number {
  const c = t * t * t;
  return c > 0.008856 ? c : (t - 16 / 116) / 7.787;
}

/** sRGB 0..255 -> Lab, L on 0..255 and a/b offset by 128. */
function rgb2lab(r: number, g: number, b: number, o: Float32Array): void {
  const R = S2L[r];
  const G = S2L[g];
  const B = S2L[b];
  const x = labF((0.412453 * R + 0.35758 * G + 0.180423 * B) / LAB_XN);
  const y = labF(0.212671 * R + 0.71516 * G + 0.072169 * B);
  const z = labF((0.019334 * R + 0.119193 * G + 0.950227 * B) / LAB_ZN);
  o[0] = (116 * y - 16) * 2.55;
  o[1] = 500 * (x - y) + 128;
  o[2] = 200 * (y - z) + 128;
}

/** Lab (same convention) -> sRGB 0..255, unrounded; the caller clamps. */
function lab2rgb(L: number, A: number, B: number, o: Float32Array): void {
  const fy = (L / 2.55 + 16) / 116;
  const fx = fy + (A - 128) / 500;
  const fz = fy - (B - 128) / 200;
  const X = labFInv(fx) * LAB_XN;
  const Y = labFInv(fy);
  const Z = labFInv(fz) * LAB_ZN;
  o[0] = lin2s(3.240479 * X - 1.53715 * Y - 0.498535 * Z) * 255;
  o[1] = lin2s(-0.969256 * X + 1.875992 * Y + 0.041556 * Z) * 255;
  o[2] = lin2s(0.055648 * X - 0.204043 * Y + 1.057311 * Z) * 255;
}

const MATTE_BASE = [62, 60, 66];
const MATTE_MAX = 0.22;
const MATTE_WARM = 14;
const GZ_MAX_AB = 34;
const GZ_MAX_LUM = 22;
const GZ_ZONES = ['shadows', 'midtones', 'highlights'] as const;

function gradeZones(img: ImageData, p: ParamValues): ImageData {
  const out = cloneImage(img);
  const d = out.data;

  const spec = GZ_ZONES.map((z) => ({
    rad: (((p[`${z}Hue`] ?? 0) * Math.PI) / 180),
    sat: (p[`${z}Sat`] ?? 0) / 100,
    lum: (p[`${z}Lum`] ?? 0) / 100,
  }));
  const fade = (p.fade ?? 0) / 100;
  const zoned = spec.some((s) => Math.abs(s.sat) > 1e-4 || Math.abs(s.lum) > 1e-4);
  if (!zoned && fade <= 1e-4) return out;

  const lab = new Float32Array(3);
  const rgb = new Float32Array(3);

  // balance slides the whole split up or down the tone range
  const bal = Math.max(-1, Math.min(1, (p.balance ?? 0) / 100)) * 0.25;
  const push = spec.map((s) => ({
    a: s.sat * GZ_MAX_AB * Math.cos(s.rad),
    b: s.sat * GZ_MAX_AB * Math.sin(s.rad),
    l: s.lum * GZ_MAX_LUM,
    on: Math.abs(s.sat) > 1e-4 || Math.abs(s.lum) > 1e-4,
  }));
  const warmth = (p.fadeWarmth ?? 0) / 100;
  const rolloff = (p.fadeRolloff ?? 0) / 100;
  const base = [
    MATTE_BASE[0] + warmth * MATTE_WARM,
    MATTE_BASE[1],
    MATTE_BASE[2] - warmth * MATTE_WARM,
  ];

  // grade and matte in ONE pass: writing the graded pixel back to bytes before
  // the matte reads it would round twice, and the engine rounds once
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    if (zoned) {
      rgb2lab(r, g, b, lab);
      const ln = lab[0] / 255;
      const lo = smoothstep(0 + bal, 0.5 + bal, ln);
      const hi = smoothstep(0.5 + bal, 1 + bal, ln);
      // lo ramps over the lower half and hi over the upper, so lo >= hi always
      // and these three add to exactly one — no normalising needed
      const m = [1 - lo, lo - hi, hi];

      let L = lab[0];
      let A = lab[1];
      let Bv = lab[2];
      for (let z = 0; z < 3; z++) {
        if (!push[z].on) continue;
        A += m[z] * push[z].a;
        Bv += m[z] * push[z].b;
        L += m[z] * push[z].l;
      }
      lab2rgb(L, A, Bv, rgb);
      r = rgb[0];
      g = rgb[1];
      b = rgb[2];
    }

    if (fade > 1e-4) {
      let k = fade * MATTE_MAX;
      if (rolloff > 1e-4) {
        const ln = (LUM_R * r + LUM_G * g + LUM_B * b) / 255;
        k *= 1 - rolloff * smoothstep(0, 1, ln);
      }
      r = r * (1 - k) + k * base[0];
      g = g * (1 - k) + k * base[1];
      b = b * (1 - k) + k * base[2];
    }

    d[i] = clamp255(r);
    d[i + 1] = clamp255(g);
    d[i + 2] = clamp255(b);
  }

  return out;
}

/* ---------------- hsl: eight hue bands ----------------
 *
 * Mirror of engine/hsl.py. Same overlapping cosine bands, same normalisation,
 * same grey gate — and OpenCV's float HSV, formula for formula including the
 * FLT_EPSILON guards, because those guards are what decides the hue of a
 * near-grey pixel and the engine's answer is the one that ships. */

const HSL_BANDS: [string, number][] = [
  ['red', 0],
  ['orange', 30],
  ['yellow', 60],
  ['green', 120],
  ['aqua', 180],
  ['blue', 225],
  ['purple', 280],
  ['magenta', 320],
];
const HSL_REACH = 70;
const HSL_MAX_HUE_ROT = 30;
const HSL_MAX_LUM = 0.35;
const HSL_LUT_N = 3600; // 0.1 degree steps
const FLT_EPSILON = 1.1920929e-7;
const HSV_SECTOR = [
  [1, 3, 0],
  [1, 0, 2],
  [3, 0, 1],
  [0, 2, 1],
  [0, 1, 3],
  [2, 1, 0],
];

/** OpenCV's float HSV -> RGB, sector table and all. Writes r,g,b in 0..1. */
function hsv2rgb(H: number, S: number, V: number, o: Float32Array): void {
  if (S === 0) {
    o[0] = V;
    o[1] = V;
    o[2] = V;
    return;
  }
  let h = H / 60;
  if (h < 0) {
    do h += 6;
    while (h < 0);
  } else if (h >= 6) {
    do h -= 6;
    while (h >= 6);
  }
  let sector = Math.floor(h);
  h -= sector;
  if (sector < 0 || sector >= 6) {
    sector = 0;
    h = 0;
  }
  const tab = [V, V * (1 - S), V * (1 - S * h), V * (1 - S * (1 - h))];
  const sd = HSV_SECTOR[sector];
  o[2] = tab[sd[0]];
  o[1] = tab[sd[1]];
  o[0] = tab[sd[2]];
}

function hsl(img: ImageData, p: ParamValues): ImageData {
  const out = cloneImage(img);
  const d = out.data;
  const knobs = HSL_BANDS.map(([name]) => ({
    h: (p[`${name}Hue`] ?? 0) / 100,
    s: (p[`${name}Sat`] ?? 0) / 100,
    l: (p[`${name}Lum`] ?? 0) / 100,
  }));
  const live = knobs.map(
    (k) => Math.abs(k.h) > 1e-4 || Math.abs(k.s) > 1e-4 || Math.abs(k.l) > 1e-4,
  );
  if (!live.some(Boolean)) return out;

  // The band weights depend on hue and nothing else, so the whole eight-band
  // mix collapses into three curves of hue. Sampling them every 0.1 degree and
  // interpolating turns eight cosines per pixel into one table read; the curves
  // are smooth, so the interpolation error is far below a single output level.
  const lutH = new Float32Array(HSL_LUT_N + 1);
  const lutS = new Float32Array(HSL_LUT_N + 1);
  const lutL = new Float32Array(HSL_LUT_N + 1);
  const w = new Float64Array(HSL_BANDS.length);
  for (let i = 0; i <= HSL_LUT_N; i++) {
    const hue = (i * 360) / HSL_LUT_N;
    let sum = 0;
    for (let b = 0; b < HSL_BANDS.length; b++) {
      let dist = Math.abs(hue - HSL_BANDS[b][1]);
      dist = Math.min(dist, 360 - dist); // hue is circular
      const t = clamp01(dist / HSL_REACH);
      w[b] = 0.5 * (1 + Math.cos(Math.PI * t));
      sum += w[b];
    }
    sum = Math.max(sum, 1e-6);
    let hAcc = 0;
    let sAcc = 0;
    let lAcc = 0;
    for (let b = 0; b < HSL_BANDS.length; b++) {
      if (!live[b]) continue;
      const wi = w[b] / sum;
      hAcc += wi * knobs[b].h * HSL_MAX_HUE_ROT;
      sAcc += wi * knobs[b].s;
      lAcc += wi * knobs[b].l * HSL_MAX_LUM;
    }
    lutH[i] = hAcc;
    lutS[i] = sAcc;
    lutL[i] = lAcc;
  }

  const rgb = new Float32Array(3);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;

    let v = r > g ? r : g;
    if (b > v) v = b;
    let vmin = r < g ? r : g;
    if (b < vmin) vmin = b;
    const diff = v - vmin;
    const s = diff / (Math.abs(v) + FLT_EPSILON);
    const scale = 60 / (diff + FLT_EPSILON);
    let h = v === r ? (g - b) * scale : v === g ? (b - r) * scale + 120 : (r - g) * scale + 240;
    if (h < 0) h += 360;

    // a grey pixel has no meaningful hue and must not be recoloured by
    // whichever band its noise happens to land in
    const gate = clamp01((s - 0.04) / 0.12);
    const x = (h / 360) * HSL_LUT_N;
    const i0 = x | 0;
    const f = x - i0;
    const hueRot = gate * (lutH[i0] + (lutH[i0 + 1] - lutH[i0]) * f);
    const satMul = gate * (lutS[i0] + (lutS[i0 + 1] - lutS[i0]) * f);
    const lumAdd = gate * (lutL[i0] + (lutL[i0 + 1] - lutL[i0]) * f);

    let H = (h + hueRot) % 360;
    if (H < 0) H += 360;
    hsv2rgb(H, clamp01(s * (1 + satMul)), clamp01(v + lumAdd), rgb);

    d[i] = clamp255(rgb[0] * 255);
    d[i + 1] = clamp255(rgb[1] * 255);
    d[i + 2] = clamp255(rgb[2] * 255);
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

/* ---------------- noise reduction ---------------- */

// Windows are FIXED, not frame-relative: noise is a sensor phenomenon and
// lives at pixel scale on any resolution. Structure mirrors globals_py._noise:
// edge-aware luminance pass (bilateral 7x7), plain blur on chroma diffs
// (luma-neutral by construction — the diffs sum to zero under the luma
// weights and blurring is linear).
function noiseReduction(img: ImageData, p: ParamValues): ImageData {
  const lumAmt = (p.luminance ?? 0) / 100;
  const colAmt = (p.color ?? 0) / 100;
  const detail = (p.detail ?? 50) / 100;
  if (lumAmt === 0 && colAmt === 0) return cloneImage(img);

  const { width: w, height: h } = img;
  const src = img.data;
  const n = w * h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    L[i] = LUM_R * src[j] + LUM_G * src[j + 1] + LUM_B * src[j + 2];
  }

  const out = cloneImage(img);
  const d = out.data;
  const Lout = new Float32Array(L);

  if (lumAmt > 0) {
    // bilateral 7x7 on luminance; range weights via a lookup table
    const sigmaR = 30;
    const range = new Float32Array(256);
    for (let v = 0; v < 256; v++) range[v] = Math.exp(-(v * v) / (2 * sigmaR * sigmaR));
    const spatial: number[] = [];
    const offs: number[] = [];
    const sigmaS = 2;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS)));
        offs.push(dy * w + dx);
      }
    for (let y = 3; y < h - 3; y++) {
      for (let x = 3; x < w - 3; x++) {
        const i = y * w + x;
        const c0 = L[i];
        let acc = 0;
        let wsum = 0;
        for (let k = 0; k < offs.length; k++) {
          const lv = L[i + offs[k]];
          const wgt = spatial[k] * range[Math.min(255, Math.abs(lv - c0) | 0)];
          acc += lv * wgt;
          wsum += wgt;
        }
        const smooth = acc / wsum;
        const target = smooth + (c0 - smooth) * detail;
        Lout[i] = c0 + (target - c0) * lumAmt;
      }
    }
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const dl = Lout[i] - L[i];
      d[j] = clamp255(d[j] + dl);
      d[j + 1] = clamp255(d[j + 1] + dl);
      d[j + 2] = clamp255(d[j + 2] + dl);
    }
  }

  if (colAmt > 0) {
    // chroma diffs against (possibly denoised) luma, blurred and blended
    const diffs = new Uint8ClampedArray(d.length);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      diffs[j] = clamp255(d[j] - Lout[i] + 128);
      diffs[j + 1] = clamp255(d[j + 1] - Lout[i] + 128);
      diffs[j + 2] = clamp255(d[j + 2] - Lout[i] + 128);
      diffs[j + 3] = 255;
    }
    const blurred = boxBlur(diffs, w, h, 4);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      for (let c = 0; c < 3; c++) {
        const cd = d[j + c] - Lout[i];
        const bd = blurred[j + c] - 128;
        d[j + c] = clamp255(Lout[i] + cd + (bd - cd) * colAmt);
      }
    }
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
  'noise-reduction': noiseReduction,
  'tone-color': toneColor,
  curves,
  dimension,
  'color-grade': colorGrade, // retired; still dispatched for pre-merge styles
  'grade-zones': gradeZones,
  hsl,
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
  if (!fn) {
    // AI tools legitimately land here — the engine renders those. A GLOBAL tool
    // landing here does not: it means the tool is in the registry with no
    // mirror, so the preview silently ignores every one of its sliders while
    // the export applies them. hsl and grade-zones both shipped that way. Fail
    // loudly instead of drawing a picture that is quietly wrong.
    if (getTool(toolId).kind === 'global') {
      throw new Error(`global tool "${toolId}" has no JS mirror in imageEngine`);
    }
    return img;
  }
  return fn(img, params);
}
