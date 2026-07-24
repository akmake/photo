import type { ParamValues } from './types';

// The 'tone-color' global tool — CPU/canvas implementation for the fast preview.
// Applies to raw RGBA pixel data in place, in normalized 0..1 space per channel.
// (The Python engine holds the authoritative version used for final render.)
export function applyToneColor(data: Uint8ClampedArray, p: ParamValues): void {
  const exposure = (p.exposure ?? 0) / 100;
  const contrast = (p.contrast ?? 0) / 100;
  const highlights = (p.highlights ?? 0) / 100;
  const shadows = (p.shadows ?? 0) / 100;
  const temp = (p.temperature ?? 0) / 100;
  const tint = (p.tint ?? 0) / 100;
  const sat = (p.saturation ?? 0) / 100;
  const vib = (p.vibrance ?? 0) / 100;

  const expFactor = Math.pow(2, exposure);
  const contrastFactor = 1 + contrast;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;

    r *= expFactor;
    g *= expFactor;
    b *= expFactor;

    r += temp * 0.15 + tint * 0.05;
    b += -temp * 0.15 + tint * 0.05;
    g += -tint * 0.1;

    r = (r - 0.5) * contrastFactor + 0.5;
    g = (g - 0.5) * contrastFactor + 0.5;
    b = (b - 0.5) * contrastFactor + 0.5;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (highlights !== 0) {
      const mask = Math.max(0, lum - 0.5) * 2;
      const f = 1 + highlights * mask * 0.5;
      r *= f;
      g *= f;
      b *= f;
    }
    if (shadows !== 0) {
      const mask = Math.max(0, 0.5 - lum) * 2;
      const f = 1 + shadows * mask * 0.5;
      r *= f;
      g *= f;
      b *= f;
    }

    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const pixelSat = Math.max(r, g, b) - Math.min(r, g, b);
    const totalSat = 1 + sat + vib * (1 - pixelSat);
    r = L + (r - L) * totalSat;
    g = L + (g - L) * totalSat;
    b = L + (b - L) * totalSat;

    data[i] = clamp255(r * 255);
    data[i + 1] = clamp255(g * 255);
    data[i + 2] = clamp255(b * 255);
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
