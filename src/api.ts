// Talks to the local Python engine (sidecar) over localhost.
// Images never leave the machine. In the browser dev harness images travel as
// data URLs; in the packaged Electron app they'll travel as local file paths.
const ENGINE = 'http://127.0.0.1:8756';

export async function checkEngine(): Promise<boolean> {
  try {
    const r = await fetch(`${ENGINE}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function urlToDataURL(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export interface AiToolResult {
  image: string; // data URL of the processed image
  meta?: Record<string, number>;
}

export interface AlbumAnalysisResponse {
  widthPx: number;
  heightPx: number;
  faces: Array<{ x: number; y: number; width: number; height: number }>;
  subject?: { x: number; y: number; width: number; height: number } | null;
  focalPoint: { x: number; y: number };
  sharpnessScore: number;
  qualityScore: number;
  analyzedBy: string;
}

export async function analyzeAlbumPhoto(imageUrlOrData: string): Promise<AlbumAnalysisResponse> {
  const image = imageUrlOrData.startsWith('data:')
    ? imageUrlOrData
    : await urlToDataURL(imageUrlOrData);
  const response = await fetch(`${ENGINE}/album/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image }),
  });
  if (!response.ok) throw new Error(`engine ${response.status}`);
  return response.json();
}

export async function finalizeAlbumJpeg(
  imageDataUrl: string,
  ppi: number,
): Promise<{
  image: string;
  meta: {
    widthPx: number;
    heightPx: number;
    ppi: number;
    quality: number;
    subsampling: string;
    icc: string;
  };
}> {
  const response = await fetch(`${ENGINE}/album/finalize-jpeg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl, ppi }),
  });
  if (!response.ok) throw new Error('מנוע הייצוא המקומי אינו זמין');
  return response.json();
}

/** What one tool reported about its own run. Values are whatever the tool
 *  module chose to return — see engine/*.py, each `return rgb, {...}`. */
export interface RenderStep {
  tool: string;
  ms: number;
  meta: Record<string, number | string>;
}

export interface RenderResult {
  image: string;
  meta: { steps: RenderStep[] };
}

export interface CompareRegion {
  bbox: [number, number, number, number];
  centroid: [number, number];
  areaPx: number;
  areaPct: number;
  meanDeltaE: number;
  maxDeltaE: number;
  structureRatio: number;
  standoutRatio: number;
  contentCorr: number;
  confidence: number;
  strong: boolean;
  kind: 'added' | 'removed' | 'changed';
  zone: string | null;
}

export interface CompareResponse {
  overlay: string;
  report: {
    geometry: {
      method: string;
      rotationDeg: number;
      scale: number;
      sameSize: boolean;
      inlierRatio?: number;
    };
    global: {
      exposureStops: number;
      contrastSlope: number;
      shadowsShift: number;
      highlightsShift: number;
      warmthShift: number;
      tintShift: number;
      saturationRatio: number;
      significant: boolean;
    };
    summary: {
      regions: number;
      strongRegions: number;
      added: number;
      removed: number;
      changed: number;
      localAreaPct: number;
      deltaEThreshold: number;
    };
    regions: CompareRegion[];
  };
}

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

export interface LearnColorResponse {
  model: LearnedColorModel;
  preview: string;
  report: {
    fitSeconds: number;
    fitSize: [number, number];
    samples: number;
    validationSamples: number;
    clusters: number;
    meanAnchorConfidence: number;
    validationGapClosed: number;
    lookBaseline: number;
    lookError: number;
    gapClosed: number;
    selectedStrength: number;
    minStrength: number;
    maxStrength: number;
    selectedSigma: number;
    selectedLumaStrength: number;
    skinModel: boolean;
    skinSamples: number;
    meanSkinAnchorConfidence: number | null;
    safe: boolean;
    base: Record<string, number>;
  };
}

/** One thing skin-cleanup found, and what it decided about it.
 *
 *  `contours` are the EXACT boundary of the region that would be rebuilt —
 *  normalised to the frame, so they draw over a preview and apply to the
 *  full-resolution file unchanged. `verdict` is the engine's decision:
 *  'heal' means it treats this on its own; anything else is a refusal the
 *  photographer is entitled to overrule. */
export interface SpotCandidate {
  id: string;
  face: number;
  kind: 'spot' | 'debris' | 'fluid';
  verdict: 'heal' | 'line' | 'shading' | 'size';
  contours: [number, number][][];
  /** x0, y0, x1, y1 — normalised to the frame */
  bbox: [number, number, number, number];
  facts: Record<string, number>;
}

export interface SpotDetection {
  width: number;
  height: number;
  faces: number;
  items: SpotCandidate[];
  /** counts the engine reached along the way (lineVetoed, faceTooSmall, …) */
  notes: Record<string, number>;
}

/** Ask what the cleanup tool would find, without healing anything.
 *
 *  `recipe` matters and is not decoration: with face-retouch also enabled the
 *  candidates must be measured on the frame cleanup will actually receive, so
 *  the engine renders the earlier tools first. Passing the recipe the lab is
 *  showing keeps the outlines honest. */
export async function detectSpots(
  imageDataUrl: string,
  params: Record<string, number>,
  recipe: { toolId: string; params: Record<string, number>; enabled: boolean }[] = [],
): Promise<SpotDetection> {
  const r = await fetch(`${ENGINE}/cleanup/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl, params, recipe }),
  });
  if (!r.ok) {
    let detail = `engine ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) detail = j.error;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(detail);
  }
  return r.json();
}

/** Read an edit: what changed between two versions of the same frame. */
export async function compareImages(
  beforeDataUrl: string,
  afterDataUrl: string,
): Promise<CompareResponse> {
  const r = await fetch(`${ENGINE}/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ before: beforeDataUrl, after: afterDataUrl }),
  });
  if (!r.ok) {
    let detail = `engine ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) detail = j.error;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(detail);
  }
  return r.json();
}

/** Learn a compact, validated colour model from a before/after pair. */
export async function learnColorModel(
  /** A path when the frame comes from the project, a data URL when it does not. */
  before: { path: string } | { data: string },
  after: { path: string } | { data: string },
): Promise<LearnColorResponse> {
  const r = await fetch(`${ENGINE}/learn-color`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...('path' in before ? { beforePath: before.path } : { before: before.data }),
      ...('path' in after ? { afterPath: after.path } : { after: after.data }),
    }),
  });
  if (!r.ok) {
    let detail = `engine ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) detail = j.error;
    } catch {
      /* keep status */
    }
    throw new Error(detail);
  }
  return r.json();
}

/** Apply a colour model learned by learnColorModel(). */
export async function applyColorModel(
  imageDataUrl: string,
  model: LearnedColorModel,
  deliver = false,
): Promise<{ image: string; meta: Record<string, number> }> {
  const r = await fetch(`${ENGINE}/apply-color`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl, model, deliver }),
  });
  if (!r.ok) {
    let detail = `engine ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) detail = j.error;
    } catch {
      /* keep status */
    }
    throw new Error(detail);
  }
  return r.json();
}

/** Run a whole recipe in ONE engine call. Unlike chaining applyAiTool(), this
 *  computes masks once and returns a per-step report — which is the only way
 *  to see WHY a tool did nothing. */
export async function renderRecipe(
  imageDataUrl: string,
  tools: {
    toolId: string;
    params: Record<string, number>;
    enabled: boolean;
    /** optional region blend — semantic ({region:'subject'|…}) or hand-painted
     *  ({region:'painted', paint: dataURL}); engine/render.py::_region_mask */
    mask?: import('./types').ToolMask;
    /** which detected candidates to treat (skin-cleanup); see detectSpots */
    selection?: import('./types').SpotSelection;
  }[],
  /** true for a file being saved: q97 with no chroma subsampling instead of
   *  the q90 4:2:0 preview. */
  deliver = false,
): Promise<RenderResult> {
  const r = await fetch(`${ENGINE}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl, recipe: tools, deliver }),
  });
  if (!r.ok) {
    let detail = `engine ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) detail = j.error;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(detail);
  }
  return r.json();
}

// Uniform call for any AI tool: POST /tools/{id}/apply.
export async function applyAiTool(
  toolId: string,
  imageUrlOrData: string,
  params: Record<string, number>,
): Promise<AiToolResult> {
  const image = imageUrlOrData.startsWith('data:')
    ? imageUrlOrData
    : await urlToDataURL(imageUrlOrData);
  const r = await fetch(`${ENGINE}/tools/${toolId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, params }),
  });
  if (!r.ok) throw new Error(`engine ${r.status}`);
  return r.json();
}

/** List the image files in a folder on disk.
 *
 * The browser cannot enumerate a directory, and a batch screen needs the real
 * paths: with them the work can be handed to the engine one file at a time,
 * which is what makes progress reportable in ITEMS ("24 מתוך 96") instead of a
 * spinner that says nothing about scale. */
export async function listImages(folder: string): Promise<{
  folder: string;
  files: string[];
  count: number;
}> {
  const r = await fetch(`${ENGINE}/list-images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/** Apply a learned colour model to files ON DISK and write the results.
 *
 * Called with ONE file at a time on purpose: the endpoint loops happily over
 * hundreds, but then the screen can only say "working". Per-file calls give a
 * real counter, a cancel that means something, and a failure list that names
 * the frames that failed instead of aborting the run. */
export async function exportColorFiles(
  files: string[],
  model: LearnedColorModel,
  dest: string,
  quality?: number,
): Promise<{ written: string[]; errors: { file: string; error: string }[]; count: number }> {
  const r = await fetch(`${ENGINE}/export-color`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, model, dest, format: 'jpeg', quality }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/** A thumbnail served by the engine, straight from the file on disk.
 *
 * The renderer cannot read `D:\Shoots\...` — and it must not have to: the whole
 * product rests on the files staying where the photographer put them. The
 * engine has disk access, so the engine serves the pixels. */
export function thumbUrl(path: string, width = 320): string {
  return `${ENGINE}/thumb?path=${encodeURIComponent(path)}&w=${width}`;
}
