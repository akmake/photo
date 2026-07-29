// Core domain model. Every tool — global or AI — is the same citizen here.

export type ToolKind = 'global' | 'ai';
export type BatchPolicy = 'absolute' | 'adaptive';
export type ToolCategory = 'raw' | 'local-ai' | 'tone-color' | 'scene' | 'artistic';

export interface ToolParamSpec {
  id: string;
  label: string; // Hebrew
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface ToolDef {
  id: string;
  label: string; // Hebrew
  kind: ToolKind;
  category: ToolCategory;
  order: number; // pipeline order (lower runs first)
  batchPolicy: BatchPolicy;
  params: ToolParamSpec[];
  /** Reachable in the lab, kept out of the gallery editor. A tool being here
   *  means it runs but is not trusted on a client's set yet. */
  experimental?: boolean;
  /** Superseded by another tool. It is never added to a new recipe and never
   *  offered in the UI, but recipes saved before it was retired still carry it
   *  and must keep rendering exactly as they did — so it stays dispatchable,
   *  and stays visible while a recipe still has it turned up. */
  legacy?: boolean;
}

export type ParamValues = Record<string, number>;

// A tool placed in a recipe, with the values the photographer chose.
/** A region the tool is blended through instead of the whole frame.
 *  `painted` carries a hand-drawn alpha (data URL) — per-photo state that must
 *  never be saved into a style: a brush stroke cannot transfer to the next
 *  frame. Semantic regions (subject, background, …) transfer fine. */
export interface ToolMask {
  region: string;
  /** data URL of the drawn alpha, white = affected (region "painted" only) */
  paint?: string;
  /** flip the mask: paint becomes "everywhere except here" */
  invert?: boolean;
  /** edge softness, 0..100 of frame scale (engine-side gaussian) */
  feather?: number;
  /** how much of the tool comes through at full mask, 0..100 */
  strength?: number;
}

export interface ToolInstance {
  toolId: string;
  params: ParamValues;
  enabled: boolean;
  mask?: ToolMask;
}

// The recipe: an ordered, non-destructive stack of tools. This is the heart.
export interface Recipe {
  tools: ToolInstance[];
}

export interface Photo {
  id: string;
  name: string;
  url: string; // object URL to the local file
  recipe: Recipe;
}
