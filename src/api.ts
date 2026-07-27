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
    selectedSigma: number;
    selectedLumaStrength: number;
    skinModel: boolean;
    skinSamples: number;
    meanSkinAnchorConfidence: number | null;
    safe: boolean;
    base: Record<string, number>;
  };
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
  beforeDataUrl: string,
  afterDataUrl: string,
): Promise<LearnColorResponse> {
  const r = await fetch(`${ENGINE}/learn-color`, {
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
  tools: { toolId: string; params: Record<string, number>; enabled: boolean }[],
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
