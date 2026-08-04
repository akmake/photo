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

/** One outline a person marked in the lab's detection view.
 *  Points are normalised to the frame (0..1), which is what lets a selection
 *  made on a preview apply to the full-resolution file being delivered. */
export interface SpotOutline {
  id: string;
  points: [number, number][];
}

/** Which of the candidates the engine found should actually be treated.
 *  An EMPTY `polygons` array is a real answer — "I looked, and none of them" —
 *  and is deliberately different from the field being absent, which means
 *  "decide for me". Per-photo state, like a painted mask: it can never travel
 *  into a style, because the marks belong to one face in one frame. */
export interface SpotSelection {
  polygons: SpotOutline[];
}

/** A colour look fitted from one before/after pair, as anchors and deltas in
 *  Lab rather than slider values. It is a MODEL, not parameters: nothing here
 *  is a number a person turned, and no set of sliders can express it — which is
 *  why a step carries it in its own field instead of in `params`. */
export interface LearnedColorModel {
  version: number;
  base: Record<string, number>;
  anchors: number[][];
  deltas: number[][];
  confidences: number[];
  supports: number[];
  strength: number;
  // Per-anchor strength, one entry per row of `anchors` -- each learned
  // colour is calibrated against only the pixels closest to it, instead of
  // every anchor sharing one photo-wide knob. `strength` above is kept as
  // their mean, for older engine code/UI that only knows the scalar.
  // Absent on models fit before this existed; the engine broadcasts
  // `strength` uniformly in that case.
  strengths?: number[];
  sigma: number;
  subjectProtection: number;
  lumaCurve: number[];
  lumaStrength: number;
  // Present only when the pair had enough real face/body-skin pixels to
  // trust a second anchor set learned from the skin itself (see
  // engine/pixel_color.py SKIN_MODEL_ENABLED). Absent on older models.
  skinAnchors?: number[][];
  skinDeltas?: number[][];
  skinConfidences?: number[];
  skinSupports?: number[];
  skinStrength?: number;
  skinStrengths?: number[];
  skinSigma?: number;
  skinProtection?: number;
}

export interface ToolInstance {
  toolId: string;
  params: ParamValues;
  enabled: boolean;
  mask?: ToolMask;
  selection?: SpotSelection;
  /** A fitted model this step applies instead of sliders — `pixel-color` only.
   *  Kept out of `params` because params are numbers by contract, and the
   *  engine dispatches on this field (engine/render.py::render). */
  model?: LearnedColorModel;
}

// The recipe: an ordered, non-destructive stack of tools. This is the heart.
export interface Recipe {
  tools: ToolInstance[];
}

/** A stretch of the shoot that shares one LIGHT.
 *
 *  Not a folder and not a physical thing: a batch is an assignment carried
 *  on each frame, so re-assigning a photograph is a click rather than a file
 *  move — and no path stored in a recipe, a status or a painted mask is
 *  invalidated by changing your mind.
 *
 *  It exists because a single grade over a whole wedding is a lie. Outside at
 *  16:00 and the dance floor at 23:00 are two different light sources, and the
 *  colour learned from one has no business on the other. */
export interface Batch {
  id: string;
  name: string;
  /** the order the photographer put them in, not the order they were made */
  order: number;
}

/** WHAT HAS BEEN DONE TO A PROJECT'S SET.
 *
 *  Three layers, and which layer a tool belongs on is not a matter of taste:
 *
 *    base          the whole project — tools driven by CONTENT. Cleanup, skin,
 *                  noise, sharpening. The same face wants the same treatment
 *                  outdoors and indoors.
 *    perBatch  tools driven by LIGHT. The learned colour, white balance,
 *                  exposure, grading. Keyed by Batch.id.
 *    perFrame      the one photograph that breaks the rule. Keyed by frame
 *                  NAME, because project.json travels with the folder and a
 *                  drive letter is not identity.
 *
 *  Merge rule: a toolId present in a narrower layer REPLACES the wider one for
 *  that frame; tools that exist only in a narrower layer run too.
 *
 *  Brush strokes and marked outlines may exist ONLY in `perFrame`: they belong
 *  to one face in one frame and cannot mean anything on the next (see ToolMask
 *  and SpotSelection above). */
export interface ProjectRecipe {
  version: number;
  base: ToolInstance[];
  perBatch: Record<string, ToolInstance[]>;
  perFrame: Record<string, ToolInstance[]>;
}

export interface Photo {
  id: string;
  name: string;
  url: string; // object URL to the local file
  recipe: Recipe;
}
