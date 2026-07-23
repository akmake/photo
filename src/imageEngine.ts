import type { Recipe } from './types';

// Applies a recipe to raw RGBA pixel data, in place.
// Works in normalized 0..1 space per channel, then writes back to 0..255.
// This is the CPU/canvas engine for the preview. RAW + heavy AI tools will
// later run in the Python sidecar, but the tool contract stays identical.
export function applyRecipe(data: Uint8ClampedArray, recipe: Recipe): void {
  const exposure = recipe.exposure / 100; // -1..1
  const contrast = recipe.contrast / 100; // -1..1
  const highlights = recipe.highlights / 100;
  const shadows = recipe.shadows / 100;
  const temp = recipe.temperature / 100;
  const tint = recipe.tint / 100;
  const sat = recipe.saturation / 100;
  const vib = recipe.vibrance / 100;

  const expFactor = Math.pow(2, exposure); // 0.5..2
  const contrastFactor = 1 + contrast; // 0..2

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;

    // Exposure
    r *= expFactor;
    g *= expFactor;
    b *= expFactor;

    // Temperature (warm: +R -B) and Tint (magenta: +R +B -G)
    r += temp * 0.15 + tint * 0.05;
    b += -temp * 0.15 + tint * 0.05;
    g += -tint * 0.1;

    // Contrast around mid-grey
    r = (r - 0.5) * contrastFactor + 0.5;
    g = (g - 0.5) * contrastFactor + 0.5;
    b = (b - 0.5) * contrastFactor + 0.5;

    // Highlights / shadows, masked by luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (highlights !== 0) {
      const mask = Math.max(0, lum - 0.5) * 2; // strong in highlights
      const f = 1 + highlights * mask * 0.5;
      r *= f;
      g *= f;
      b *= f;
    }
    if (shadows !== 0) {
      const mask = Math.max(0, 0.5 - lum) * 2; // strong in shadows
      const f = 1 + shadows * mask * 0.5;
      r *= f;
      g *= f;
      b *= f;
    }

    // Saturation + Vibrance (vibrance weighted toward less-saturated pixels)
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const pixelSat = Math.max(r, g, b) - Math.min(r, g, b);
    const vibFactor = vib * (1 - pixelSat);
    const totalSat = 1 + sat + vibFactor;
    r = L + (r - L) * totalSat;
    g = L + (g - L) * totalSat;
    b = L + (b - L) * totalSat;

    data[i] = clamp255(r * 255);
    data[i + 1] = clamp255(g * 255);
    data[i + 2] = clamp255(b * 255);
    // alpha (i+3) untouched
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
