import type {
  ToolDef,
  Recipe,
  ToolInstance,
  ParamValues,
} from './types';

/* The eight hue bands, generated rather than typed out: 24 sliders written by
 * hand is 24 chances to mistype a param id that the engine then silently
 * ignores. Centres match engine/hsl.py — they are uneven on purpose, crowded
 * through red/orange/yellow because skin lives there. */
const HUE_BANDS: [string, string][] = [
  ['red', 'אדום'],
  ['orange', 'כתום'],
  ['yellow', 'צהוב'],
  ['green', 'ירוק'],
  ['aqua', 'טורקיז'],
  ['blue', 'כחול'],
  ['purple', 'סגול'],
  ['magenta', "מג'נטה"],
];

const HSL_TOOL: ToolDef[] = [
  {
    id: 'hsl',
    label: 'צבע לפי גוון',
    kind: 'global',
    category: 'artistic',
    order: 41,
    batchPolicy: 'absolute',
    params: HUE_BANDS.flatMap(([id, he]) => [
      { id: `${id}Hue`, label: `${he} · גוון`, min: -100, max: 100, step: 1, default: 0 },
      { id: `${id}Sat`, label: `${he} · רוויה`, min: -100, max: 100, step: 1, default: 0 },
      { id: `${id}Lum`, label: `${he} · בהירות`, min: -100, max: 100, step: 1, default: 0 },
    ]),
  },
];

// THE registry. Adding a tool (global or AI) = one entry here. Nothing else
// in the app needs to special-case it — the UI and pipeline are built from this.
export const TOOLS: ToolDef[] = [
  {
    id: 'face-retouch',
    label: 'ריטוש פנים (AI)',
    kind: 'ai',
    category: 'local-ai',
    order: 8, // the learned model runs first, on neutral data
    batchPolicy: 'absolute',
    params: [{ id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 70 }],
  },
  {
    // Engine-side this is `cleanup.py` — spot detection and healing. It is off
    // in the default recipes (see engine/presets.py) pending rework, so it is
    // marked experimental: the lab can drive it, the gallery editor cannot.
    id: 'skin-cleanup',
    label: 'ניקוי כתמים',
    kind: 'ai',
    category: 'local-ai',
    order: 10,
    batchPolicy: 'absolute',
    experimental: true,
    params: [{ id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 60 }],
  },
  {
    id: 'skin',
    label: 'החלקת עור',
    kind: 'ai',
    category: 'local-ai',
    order: 20, // AI retouch runs on neutral data, before the creative grade
    batchPolicy: 'absolute',
    params: [{ id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 60 }],
  },
  // Colour work on the retouched face. These three are the same operation —
  // a mask plus a push in Lab — and none of them reconstructs pixels, so they
  // sit safely after smoothing and before the global grade.
  {
    id: 'blush',
    label: 'סומק ורודם',
    kind: 'ai',
    category: 'local-ai',
    order: 22,
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 45 },
      { id: 'size', label: 'גודל', min: 0, max: 100, step: 1, default: 50 },
      { id: 'warmth', label: 'חמימות', min: 0, max: 100, step: 1, default: 35 },
    ],
  },
  {
    id: 'eye-sparkle',
    label: 'ברק בעיניים',
    kind: 'ai',
    category: 'local-ai',
    order: 23,
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 50 },
      { id: 'whites', label: 'לובן העין', min: 0, max: 100, step: 1, default: 40 },
      { id: 'sparkle', label: 'חדות הקשתית', min: 0, max: 100, step: 1, default: 45 },
    ],
  },
  {
    id: 'hair-tones',
    label: 'גוונים בשיער',
    kind: 'ai',
    category: 'local-ai',
    order: 24,
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 45 },
      { id: 'warmth', label: 'חמימות', min: -100, max: 100, step: 1, default: 40 },
      { id: 'shine', label: 'ברק', min: 0, max: 100, step: 1, default: 35 },
      { id: 'richness', label: 'עומק', min: 0, max: 100, step: 1, default: 40 },
    ],
  },
  {
    id: 'background-blur',
    label: 'טשטוש רקע',
    kind: 'ai',
    category: 'scene',
    order: 25, // runs in the engine stage, after skin, before the global grade
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 60 },
      { id: 'bokeh', label: 'אופי בוקה', min: 0, max: 100, step: 1, default: 50 },
      { id: 'feather', label: 'ריכוך קצוות', min: 0, max: 100, step: 1, default: 40 },
    ],
  },
  {
    id: 'tone-color',
    label: 'טון וצבע',
    kind: 'global',
    category: 'tone-color',
    order: 30,
    batchPolicy: 'absolute',
    params: [
      { id: 'exposure', label: 'חשיפה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'contrast', label: 'ניגודיות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'highlights', label: 'היילייטים', min: -100, max: 100, step: 1, default: 0 },
      { id: 'whites', label: 'לבנים (שרוף)', min: -100, max: 100, step: 1, default: 0 },
      { id: 'shadows', label: 'צלליות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'blacks', label: 'שחורים', min: -100, max: 100, step: 1, default: 0 },
      { id: 'temperature', label: 'חום', min: -100, max: 100, step: 1, default: 0 },
      { id: 'tint', label: 'גוון', min: -100, max: 100, step: 1, default: 0 },
      { id: 'saturation', label: 'רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'vibrance', label: 'חיוניות', min: -100, max: 100, step: 1, default: 0 },
    ],
  },
  {
    id: 'dimension',
    label: 'תלת מימדיות',
    kind: 'global',
    category: 'tone-color',
    order: 35,
    batchPolicy: 'absolute',
    params: [
      { id: 'clarity', label: 'ניגודיות מקומית', min: -100, max: 100, step: 1, default: 0 },
      { id: 'vignette', label: 'וינייטה', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  {
    id: 'color-grade',
    label: 'צבעוניות',
    kind: 'global',
    category: 'artistic',
    order: 40,
    batchPolicy: 'absolute',
    params: [
      { id: 'shadowsWarm', label: 'חום בצללים', min: -100, max: 100, step: 1, default: 0 },
      { id: 'highlightsWarm', label: 'חום בהיילייטים', min: -100, max: 100, step: 1, default: 0 },
      { id: 'fade', label: 'דהייה (מאט)', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  // Per-hue colour. Eight bands, three independent knobs each, because one
  // saturation slider can only travel one road: this set exists so a recipe can
  // crush the green of a field while leaving skin and blonde hair alone.
  ...HSL_TOOL,
  {
    id: 'grade-zones',
    label: 'גריידינג לפי טונים',
    kind: 'global',
    category: 'artistic',
    order: 42,
    batchPolicy: 'absolute',
    params: [
      { id: 'shadowsHue', label: 'צלליות · גוון', min: 0, max: 360, step: 1, default: 0 },
      { id: 'shadowsSat', label: 'צלליות · רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'shadowsLum', label: 'צלליות · בהירות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'midtonesHue', label: 'אמצעיים · גוון', min: 0, max: 360, step: 1, default: 0 },
      { id: 'midtonesSat', label: 'אמצעיים · רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'midtonesLum', label: 'אמצעיים · בהירות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'highlightsHue', label: 'היילייטים · גוון', min: 0, max: 360, step: 1, default: 0 },
      { id: 'highlightsSat', label: 'היילייטים · רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'highlightsLum', label: 'היילייטים · בהירות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'balance', label: 'איזון בין הטווחים', min: -100, max: 100, step: 1, default: 0 },
    ],
  },
  {
    id: 'light-point',
    label: 'נקודת אור טבעית',
    kind: 'global',
    category: 'scene',
    order: 45,
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      { id: 'x', label: 'מיקום אופקי', min: 0, max: 100, step: 1, default: 50 },
      { id: 'y', label: 'מיקום אנכי', min: 0, max: 100, step: 1, default: 30 },
      { id: 'size', label: 'גודל', min: 5, max: 100, step: 1, default: 50 },
      { id: 'warmth', label: 'חמימות', min: 0, max: 100, step: 1, default: 60 },
    ],
  },
  {
    id: 'glow',
    label: 'גלואו',
    kind: 'global',
    category: 'artistic',
    order: 55,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      { id: 'radius', label: 'רכות', min: 0, max: 100, step: 1, default: 40 },
    ],
  },
  {
    id: 'oil-paint',
    label: 'אפקט ציור שמן',
    kind: 'global',
    category: 'artistic',
    order: 58,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      { id: 'radius', label: 'גודל מכחול', min: 0, max: 100, step: 1, default: 30 },
    ],
  },
  {
    id: 'sharpen',
    label: 'חידוד',
    kind: 'global',
    category: 'artistic',
    order: 60,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      { id: 'radius', label: 'רדיוס', min: 0, max: 100, step: 1, default: 20 },
    ],
  },
];

export function getTool(id: string): ToolDef {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tool: ${id}`);
  return t;
}

export function defaultParams(def: ToolDef): ParamValues {
  const p: ParamValues = {};
  for (const spec of def.params) p[spec.id] = spec.default;
  return p;
}

// A fresh recipe: every tool present, global tools enabled, AI tools off until used.
export function defaultRecipe(): Recipe {
  return {
    tools: TOOLS.map<ToolInstance>((def) => ({
      toolId: def.id,
      params: defaultParams(def),
      enabled: def.kind === 'global',
    })),
  };
}

export function getInstance(recipe: Recipe, toolId: string): ToolInstance {
  const inst = recipe.tools.find((t) => t.toolId === toolId);
  if (!inst) throw new Error(`tool not in recipe: ${toolId}`);
  return inst;
}

export function isToolAtDefault(inst: ToolInstance): boolean {
  const def = getTool(inst.toolId);
  return def.params.every((s) => inst.params[s.id] === s.default);
}

// Tools that actually change the image, in pipeline order.
export function activeTools(recipe: Recipe): ToolInstance[] {
  return [...recipe.tools]
    .filter((inst) => {
      const def = getTool(inst.toolId);
      return def.kind === 'ai' ? inst.enabled : inst.enabled && !isToolAtDefault(inst);
    })
    .sort((a, b) => getTool(a.toolId).order - getTool(b.toolId).order);
}

export function isRecipeActive(recipe: Recipe): boolean {
  return activeTools(recipe).length > 0;
}

/** All tool instances in pipeline order (for UI rendering). */
export function orderedInstances(recipe: Recipe): ToolInstance[] {
  return [...recipe.tools].sort(
    (a, b) => getTool(a.toolId).order - getTool(b.toolId).order,
  );
}

// Immutable updates
export function updateToolParams(
  recipe: Recipe,
  toolId: string,
  patch: ParamValues,
): Recipe {
  return {
    tools: recipe.tools.map((t) =>
      t.toolId === toolId ? { ...t, params: { ...t.params, ...patch } } : t,
    ),
  };
}

export function setToolEnabled(recipe: Recipe, toolId: string, enabled: boolean): Recipe {
  return {
    tools: recipe.tools.map((t) => (t.toolId === toolId ? { ...t, enabled } : t)),
  };
}

export function cloneRecipe(recipe: Recipe): Recipe {
  return {
    tools: recipe.tools.map((t) => ({ ...t, params: { ...t.params } })),
  };
}
