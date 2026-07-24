import type {
  ToolDef,
  Recipe,
  ToolInstance,
  ParamValues,
} from './types';

// THE registry. Adding a tool (global or AI) = one entry here. Nothing else
// in the app needs to special-case it — the UI and pipeline are built from this.
export const TOOLS: ToolDef[] = [
  {
    id: 'skin',
    label: 'החלקת עור',
    kind: 'ai',
    category: 'local-ai',
    order: 20, // AI retouch runs on neutral data, before the creative grade
    batchPolicy: 'absolute',
    params: [{ id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 60 }],
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
      { id: 'shadows', label: 'צלליות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'temperature', label: 'חום', min: -100, max: 100, step: 1, default: 0 },
      { id: 'tint', label: 'גוון', min: -100, max: 100, step: 1, default: 0 },
      { id: 'saturation', label: 'רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'vibrance', label: 'חיוניות', min: -100, max: 100, step: 1, default: 0 },
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
