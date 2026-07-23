import type { ToolDef, Recipe } from './types';

// The dynamic tool list. Each tool is a parameterized layer in the recipe.
// Future AI tools (skin, eyes, background) plug into this same shape.
export const TOOLS: ToolDef[] = [
  { id: 'exposure', label: 'חשיפה', min: -100, max: 100, step: 1, default: 0 },
  { id: 'contrast', label: 'ניגודיות', min: -100, max: 100, step: 1, default: 0 },
  { id: 'highlights', label: 'היילייטים', min: -100, max: 100, step: 1, default: 0 },
  { id: 'shadows', label: 'צלליות', min: -100, max: 100, step: 1, default: 0 },
  { id: 'temperature', label: 'חום', min: -100, max: 100, step: 1, default: 0 },
  { id: 'tint', label: 'גוון', min: -100, max: 100, step: 1, default: 0 },
  { id: 'saturation', label: 'רוויה', min: -100, max: 100, step: 1, default: 0 },
  { id: 'vibrance', label: 'חיוניות', min: -100, max: 100, step: 1, default: 0 },
];

export function emptyRecipe(): Recipe {
  return TOOLS.reduce((acc, t) => {
    acc[t.id] = t.default;
    return acc;
  }, {} as Recipe);
}

export function isRecipeEmpty(r: Recipe): boolean {
  return TOOLS.every((t) => r[t.id] === t.default);
}
