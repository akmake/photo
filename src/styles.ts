import type { Recipe } from './types';
import { cloneRecipe } from './toolRegistry';

// A named, reusable look. This is the photographer's #1 ask: build the look
// once ("לוק ים"), then apply it to every future session of that type.
export interface Style {
  id: string;
  name: string;
  recipe: Recipe;
  createdAt: number;
}

const KEY = 'signet.styles';

export function listStyles(): Style[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Style[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(styles: Style[]): void {
  localStorage.setItem(KEY, JSON.stringify(styles));
}

export function saveStyle(name: string, recipe: Recipe): Style[] {
  const styles = listStyles();
  const trimmed = name.trim();
  const existing = styles.find((s) => s.name === trimmed);
  if (existing) {
    existing.recipe = cloneRecipe(recipe);
    existing.createdAt = Date.now();
  } else {
    styles.push({
      id: `s${Date.now()}`,
      name: trimmed,
      recipe: cloneRecipe(recipe),
      createdAt: Date.now(),
    });
  }
  persist(styles);
  return listStyles();
}

export function deleteStyle(id: string): Style[] {
  const styles = listStyles().filter((s) => s.id !== id);
  persist(styles);
  return styles;
}
