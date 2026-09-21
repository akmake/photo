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

/** One colour a photograph actually covers area with, in Lab: lightness,
 *  chroma and hue — the axes the album's colour rule reasons on. */
export interface PaletteColor {
  hex: string;
  /** Share of the frame, 0..1. */
  weight: number;
  l: number;
  c: number;
  h: number;
}

/** A frame's measured colours, away from the skin on it, and the skin tone
 *  itself — kept apart because a page has to lean towards the one and stay
 *  away from the other. Measured by the engine (engine/album_palette.py). */
export interface PhotoPalette {
  colors: PaletteColor[];
  /** How many of those colours carry a usable hue rather than being grey. */
  chromaticCount: number;
  skin: Omit<PaletteColor, 'weight'> | null;
  meanL: number;
  meanC: number;
  measuredBy: string;
}

export interface AlbumAnalysisResponse {
  widthPx: number;
  heightPx: number;
  faces: Array<{ x: number; y: number; width: number; height: number }>;
  subject?: { x: number; y: number; width: number; height: number } | null;
  focalPoint: { x: number; y: number };
  sharpnessScore: number;
  qualityScore: number;
  /** Absent from an older engine; the album then leaves pages their designed
   *  colours rather than colouring them from a guess. */
  palette?: PhotoPalette;
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

/** Analyse a frame the project already points at, BY PATH.
 *
 * The album needs the original pixel dimensions — they decide the print
 * resolution of every crop. Sending a preview instead would report the
 * preview's size, and every ppi warning downstream would be a lie. The engine
 * opens the file itself, so nothing crosses the wire but the answer. */
export async function analyzeAlbumFrame(path: string): Promise<AlbumAnalysisResponse> {
  const response = await fetch(`${ENGINE}/album/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(parsed?.error ?? `engine ${response.status}`);
  return parsed;
}

/** A rendered sheet in, the file the lab prints out.
 *
 *  The sheet goes over as a PNG and comes back a JPEG, so it is compressed
 *  exactly once: sending it as a JPEG and re-encoding it in the engine puts
 *  every printed page through two compressions, and the second one shows in
 *  skin and in a hairline. Bytes both ways, no base64 — a 56cm spread at
 *  300dpi is 17 megapixels, and JSON would carry it as a 90MB string. */
export async function finalizeAlbumSheet(sheet: Blob, ppi: number): Promise<{
  blob: Blob;
  widthPx: number;
  heightPx: number;
}> {
  const response = await fetch(`${ENGINE}/album/finalize-sheet?ppi=${Math.round(ppi)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: sheet,
  });
  if (!response.ok) throw new Error('מנוע הייצוא המקומי אינו זמין');
  return {
    blob: await response.blob(),
    widthPx: Number(response.headers.get('X-Sheet-Width') ?? 0),
    heightPx: Number(response.headers.get('X-Sheet-Height') ?? 0),
  };
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

/* The learned model moved to types.ts: it is domain, not transport — a project
 * recipe holds one, and types.ts is where the recipe lives. Re-exported so
 * every existing importer keeps working. */
export type { LearnedColorModel } from './types';
import type { LearnedColorModel, ToolInstance } from './types';

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
  verdict: 'heal' | 'line' | 'shading' | 'size' | 'hair' | 'anatomy';
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

/** Visual fingerprints for a set — the album's קליטה stage.
 *
 * One 384-d DINOv2 vector per frame, computed and cached by the engine off the
 * files on disk. Called with a CHUNK of paths at a time so the screen can count
 * in items and cancel between chunks; cached frames return instantly. A 503
 * means the model was never fetched (run setup_models.py) — surfaced, not
 * swallowed, so "not installed" never reads as "no photos". */
export interface AlbumEmbedResult {
  results: { path: string; ok: boolean; cached?: boolean; error?: string }[];
  embedded: number;
  cached: number;
  dim: number;
}

export async function embedAlbum(paths: string[]): Promise<AlbumEmbedResult> {
  const r = await fetch(`${ENGINE}/album/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/** Near-duplicate groups over a set's cached vectors — the album's דה-דופ stage.
 *
 * Reads only what קליטה already cached, so it is instant and cheap to re-run at a
 * new threshold. `groups` holds only real duplicate clusters (2+ frames); frames
 * with no vector yet come back in `missing`, apart from "has no duplicate". */
export interface AlbumDedupResult {
  groups: string[][];
  missing: string[];
  embedded: number;
  duplicateFrames: number;
  threshold: number;
}

export async function dedupAlbum(paths: string[], threshold?: number): Promise<AlbumDedupResult> {
  const r = await fetch(`${ENGINE}/album/dedup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(threshold == null ? { paths } : { paths, threshold }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/* סינון — the album's culling judge, and the geometry pass in the same call.
 *
 * `verdict` is a LABEL, never an action: nothing is moved or deleted, and every
 * rejection carries the reasons and the numbers that produced it so the screen
 * can show the photographer what was measured and let them overrule it.
 *
 * The geometry (dimensions, faces, focal point) rides along because finding the
 * face landmarks is the expensive part of both answers — asking twice would
 * double the slowest stage of the album. */
export interface CullReason {
  code: string;
  label: string;
  value: number | null;
  /** A hard reason rejects the frame; a soft one only annotates it. */
  hard: boolean;
}

export interface CullFaceDetail {
  box: { x: number; y: number; width: number; height: number };
  faceWidthPx: number;
  gaze: number | null;
  /** null means "the face was too small to read" — not "the eyes were open". */
  eyeOpenness: number | null;
  eyesShut: boolean | null;
  eyesNarrow: boolean | null;
  yaw: number | null;
  turnedAway: boolean | null;
  profile: boolean | null;
  faceSharpness: number | null;
  faceSoft: boolean | null;
  blownFraction: number | null;
  crushedFraction: number | null;
}

export interface CullResult {
  widthPx: number;
  heightPx: number;
  /** Capture time, epoch seconds — EXIF first, file mtime as the honest fallback. */
  shotTime: number;
  /** What the frame IS, not just whether it is good. Paces the book. */
  shotScale: 'closeup' | 'medium' | 'wide' | 'detail';
  shotScaleValue: number;
  /** -1 the subject faces frame-left … +1 frame-right. null when unreadable. */
  gaze: number | null;
  negativeSpace: 'left' | 'right' | 'centre';
  faces: Array<{ x: number; y: number; width: number; height: number }>;
  faceDetail: CullFaceDetail[];
  subject?: { x: number; y: number; width: number; height: number } | null;
  focalPoint: { x: number; y: number };
  frameSharpness: number | null;
  sharpnessScore: number;
  qualityScore: number;
  exposure: number;
  blownFraction: number;
  crushedFraction: number;
  verdict: 'keep' | 'reject';
  reasons: CullReason[];
  analyzedBy: string;
}

export interface AlbumCullResponse {
  results: { path: string; ok: boolean; data?: CullResult; error?: string }[];
}

export async function cullAlbum(paths: string[]): Promise<AlbumCullResponse> {
  const r = await fetch(`${ENGINE}/album/cull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/* יצוא לדפוס — the engine composites the spreads from the ORIGINAL files.
 *
 * Not the browser: `src/album/exportEngine.ts` renders from `/thumb`, which is a
 * q82 JPEG capped at the requested width — right for a proof, wrong for print.
 * Here the source pixels are resampled once and encoded once, at 300 PPI with an
 * embedded sRGB profile and no chroma subsampling.
 *
 * Sent a CHUNK of spreads at a time so a forty-spread album has a counter in
 * items. The manifest is written on the final call only, so an interrupted run
 * leaves no manifest and can never be mistaken for a finished package. */
export interface RenderFrameMeta {
  path: string;
  slotPx: [number, number];
  usedSourcePx: [number, number];
  effectivePpi: number;
  upscaled: boolean;
}

export interface RenderFileMeta {
  name: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
  sha256: string;
  frames: RenderFrameMeta[];
}

export interface AlbumRenderManifest {
  spreads: number;
  ppi: number;
  quality: number;
  subsampling: string;
  colorProfile: string;
  files: RenderFileMeta[];
  softFrames: number;
  upscaledFrames: number;
}

export interface RenderSpreadPayload {
  frames: Array<{
    path: string;
    slot: { x: number; y: number; width: number; height: number };
    focalPoint: { x: number; y: number };
  }>;
}

export async function renderAlbum(
  spec: Record<string, number>,
  spreads: RenderSpreadPayload[],
  outDir: string,
  options: {
    startIndex?: number;
    manifestFiles?: RenderFileMeta[];
    writeManifest?: boolean;
    background?: string;
    naming?: string;
  } = {},
): Promise<AlbumRenderManifest> {
  const r = await fetch(`${ENGINE}/album/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, spreads, outDir, ...options }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/* זהות — who the album is about.
 *
 * No face-recognition model is downloaded: ArcFace/InsightFace weights are
 * licensed for non-commercial research only, the same objection that kept
 * DINOv3 out of this stack. The clustering runs on DINOv2 over face+shoulders
 * crops, which is far stronger than it sounds within ONE event — same day, same
 * clothes, a handful of people, and the question is "who recurs", not "who is
 * this person". Nobody is named; the answer is "person 1 is in 143 frames". */
export interface AlbumIdentity {
  id: string;
  /** The frames this person appears in. */
  frames: string[];
  faces: number;
  /** Only on principals: their share of the set. */
  share?: number;
}

export interface AlbumIdentitiesResult {
  identities: AlbumIdentity[];
  /** The protagonists — capped, and empty when nobody carries the event. */
  principals: AlbumIdentity[];
  readableFaces: number;
  /** Faces too small to read. NOT the same as "not a principal". */
  unreadableFaces: number;
  threshold: number;
}

export async function albumIdentities(
  frames: Array<{ path: string; faces: Array<{ x: number; y: number; width: number; height: number }> }>,
): Promise<AlbumIdentitiesResult> {
  const r = await fetch(`${ENGINE}/album/identities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, totalFrames: frames.length }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/* רגעים — the set split into the scenes it was shot in.
 *
 * The DINOv2 vectors finally answering something bigger than "is this the same
 * shot twice". A moment is a CONTIGUOUS run in capture order, because an album
 * is a story told in the order it happened; free clustering would put the last
 * dance beside the first one and reorder the evening. */
export interface AlbumMomentsResult {
  moments: string[][];
  missing: string[];
  embedded: number;
  threshold: number;
  timeGap: number;
  /** False when too few frames carried a usable timestamp — the split was visual only. */
  usedTime: boolean;
}

export async function albumMoments(
  paths: string[],
  times?: number[],
): Promise<AlbumMomentsResult> {
  const r = await fetch(`${ENGINE}/album/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(times ? { paths, times } : { paths }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/* PDF לצפייה — the whole album as one browsable document.
 *
 * Not a substitute for the JPEG package: no trim marks, no separate bleed box,
 * no PDF/X intent. It exists to be flipped through — shown to a client, checked
 * for flow, mailed as a proof — and it opens at the album's true physical size. */
export interface AlbumPdfReport {
  path: string;
  pages: number;
  ppi: number;
  pagePx: [number, number];
  bytes: number;
  softFrames: number;
  upscaledFrames: number;
}

export async function renderAlbumPdf(
  spec: Record<string, number>,
  spreads: RenderSpreadPayload[],
  outDir: string,
  options: { name?: string; ppi?: number; background?: string } = {},
): Promise<AlbumPdfReport> {
  const r = await fetch(`${ENGINE}/album/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, spreads, outDir, ...options }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
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

/** The same scan, on a file the engine already has.
 *
 *  The lab hands over a data URL because it holds the picture in the browser.
 *  The workbench holds a PATH, and round-tripping a 20MP frame through base64
 *  just to ask what is on it is a wait for nothing. `width` caps the frame the
 *  detector runs on, exactly as a render does; the outlines come back
 *  normalised to the frame, so a mark made here is valid on the full file. */
export async function detectSpotsAtPath(
  path: string,
  params: Record<string, number>,
  recipe: { toolId: string; params: Record<string, number>; enabled: boolean }[] = [],
  width?: number,
): Promise<SpotDetection> {
  const r = await fetch(`${ENGINE}/cleanup/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, params, recipe, w: width }),
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
 * engine has disk access, so the engine serves the pixels.
 *
 * `version` (a frame's `version`) makes each replacement of the file a new
 * address. The engine ignores it; the browser is what needs it, because /thumb
 * may be kept for a day and an edit rewrites the file under the same path. */
export function thumbUrl(path: string, width = 320, version?: string): string {
  const v = version ? `&v=${encodeURIComponent(version)}` : '';
  return `${ENGINE}/thumb?path=${encodeURIComponent(path)}&w=${width}${v}`;
}

/** The pixels an album EXPORT draws with: the real file, decoded properly and
 *  resized once, by the engine, to the size the place on the page takes.
 *
 *  Not `thumbUrl`. A thumbnail is quality 82 and, on a raw frame, the camera's
 *  own embedded preview — which on a 56cm spread is the difference between a
 *  print and an excuse. `longEdge` is a cap: a file smaller than its place
 *  comes back at its own size, never enlarged. */
export function albumSourceUrl(path: string, longEdge: number): string {
  const cap = Math.max(0, Math.round(longEdge));
  return `${ENGINE}/album/source?path=${encodeURIComponent(path)}&w=${cap}`;
}

/* ------------------------------------------------------- the project's recipe
 *
 * A set is never rendered to disk while it is being worked on: what the
 * photographer sees IS the recipe, applied on the way to the screen. Two calls
 * make that affordable — the recipe is registered once and addressed by key
 * afterwards, so a preview stays a plain GET and `<img loading="lazy">` keeps
 * doing the work of not rendering the 1,900 frames nobody scrolled to.
 */

/** Tell the engine what a recipe is; get back the key its previews live under.
 *  The same recipe always produces the same key, so this is cheap to repeat. */
export async function registerRecipe(recipe: ToolInstance[]): Promise<string> {
  const r = await fetch(`${ENGINE}/recipe-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j.key as string;
}

/** A frame as the recipe leaves it. An empty key is the raw file — same picture
 *  /thumb serves, so a project with no recipe yet costs nothing extra.
 *
 *  `fast` asks the engine to answer immediately: if the graded frame is not
 *  rendered yet it returns the RAW one, marked, and queues the real render.
 *  Callers that pass it MUST show that the frame is not the edit yet — see
 *  useSetPreview, which is the only place that decides. */
export function previewUrl(path: string, width = 320, key = '', fast = false): string {
  if (!key) return thumbUrl(path, width);
  const base = `${ENGINE}/preview?path=${encodeURIComponent(path)}&w=${width}&key=${key}`;
  return fast ? `${base}&fast=1` : base;
}

/** Which of these frames are already rendered.
 *
 *  Asked for a screenful at a time: a browser cannot read a response header off
 *  an `<img>`, so readiness has to be a separate question, and asking it per
 *  element would be one request per thumbnail. */
export async function previewReady(
  key: string,
  paths: string[],
  width?: number,
): Promise<{ ready: Record<string, boolean>; pending: number }> {
  const r = await fetch(`${ENGINE}/preview/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, paths, w: width }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/** Render these frames before anyone asks for them. Fire and forget: the queue
 *  is the engine's problem, and a failure here must never block a screen. */
export async function warmPreviews(key: string, paths: string[]): Promise<void> {
  try {
    await fetch(`${ENGINE}/preview/warm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, paths }),
    });
  } catch {
    /* warming is an optimisation, never a requirement */
  }
}

/** Render a recipe over a file ON DISK. The browser cannot read the path, and
 *  turning a 20MP frame into a data URL just to send it back is a round trip
 *  the engine does not need — it already has the file. */
export async function renderRecipeAtPath(
  path: string,
  tools: ToolInstance[],
  /** Cap the long edge before the pipeline runs. A tool being tuned re-renders
   *  on every slider move; full resolution for an 1100px panel is the
   *  difference between a control that answers and one that does not. */
  width?: number,
  deliver = false,
  /** A screen's lane. A newer render in the same lane makes this one stale:
   *  the engine refuses it unstarted or stops it between tools, and this
   *  rejects with `Superseded` — which a caller ignores, because the render
   *  that replaced it is already on its way. */
  lane?: string,
): Promise<RenderResult> {
  const r = await fetch(`${ENGINE}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, recipe: tools, deliver, w: width, lane }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 409 && j?.superseded) throw new Superseded();
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/** A render replaced by a newer one in its lane. Not a failure. */
export class Superseded extends Error {
  constructor() {
    super('superseded');
    this.name = 'Superseded';
  }
}

/** The edit screen's render width. One constant, because the background
 *  preparer computes masks for exactly this working frame — a render at any
 *  other width would miss every one of them. */
export const EDIT_WIDTH = 1400;

/** Ask the engine to get frames ready BEFORE they are opened.
 *
 *  `paths` go to the background preparer (a low-priority process): thumbnails
 *  at `thumbs` widths, and every mask `recipe` reads at the panel width `w`.
 *  `ahead` are rendered in full by the engine itself whenever nobody is
 *  waiting on it, so stepping to one of them shows a finished frame. Most
 *  important first in both lists. Fire and forget. */
/* ------------------------------------------------------------ the work stage
 *
 * engine/triage.py: which frames the tool would remove, and why — always
 * against a twin (the same pose shot again), never a frame judged alone. The
 * engine answers from what it has measured so far; `pending` names the rest,
 * and `run` asks it to measure them in the background.
 */

export interface TriageReason {
  code: 'eyes-shut' | 'soft' | 'duplicate' | 'blown' | 'dark' | 'unread';
  label: string;
  /** The twin that is better — the frame the suggestion is made against. */
  ref?: string;
  /** Which face in `faces` the reason is about. */
  face?: number;
}

export interface TriageFrame {
  file: string;
  moment: number;
  /** Twin group id, or null when the frame has no near-identical twin. */
  twins: number | null;
  /** The recommended frame of its twin group. */
  star: boolean;
  suggestion: 'remove' | 'duplicate' | 'unread' | null;
  reasons: TriageReason[];
  faces: { box: { x: number; y: number; width: number; height: number }; blink?: number }[];
}

export interface TriageResult {
  frames: TriageFrame[];
  pending: string[];
  moments: number;
  queued?: boolean;
}

export async function triageSet(paths: string[], run = false): Promise<TriageResult> {
  return post('/triage', { paths, run });
}

export async function prepareFrames(req: {
  paths: string[];
  w: number;
  thumbs?: number[];
  recipe?: ToolInstance[];
  ahead?: { path: string; recipe: ToolInstance[] }[];
}): Promise<void> {
  try {
    await fetch(`${ENGINE}/prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    /* preparing is an optimisation, never a requirement */
  }
}

/** Write files: the one moment a recipe becomes pixels on disk.
 *
 * `perFile` carries the frames that differ from the rest of the set — the
 * engine applies it per path and falls back to `recipe` for everything else,
 * which is exactly how base/perFrame is shaped (types.ts::ProjectRecipe). */
export async function exportFiles(
  files: string[],
  recipe: ToolInstance[],
  dest: string,
  perFile?: Record<string, ToolInstance[]>,
  quality?: number,
): Promise<{ written: string[]; errors: { file: string; error: string }[]; count: number }> {
  const r = await fetch(`${ENGINE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, recipe, perFile, dest, format: 'jpeg', quality }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j;
}

/* ------------------------------------------------------ the project's folder
 *
 * A project is a folder on disk (engine/workspace.py), and the browser can
 * neither create one, copy into it, nor read a JSON out of it. Every call here
 * is that boundary — the engine is a local process with disk access, so it does
 * the filesystem work and reports back.
 */

/** One frame of the set, as the disk has it. */
export interface Frame {
  /** the RAW file — the truth, never written to after import */
  path: string;
  name: string;
  /** capture time, epoch seconds; EXIF where readable, mtime otherwise */
  shot: number;
  /** true once a rendered version exists in תמונות */
  edited: boolean;
  /** the file to SHOW: the edited copy when there is one, else the raw */
  shown: string;
  /** Changes whenever `shown` is replaced. Pass it to `thumbUrl`: an edit
   *  rewrites the same path, and without this the browser keeps showing the
   *  previous version for a day. Absent from an engine older than this field. */
  version?: string;
}

export interface ProjectPaths {
  home: string;
  raw: string;
  edited: string;
  state?: string;
}

export type CloudProvider = 'google' | 'dropbox';

export interface CloudProviderStatus {
  configured: boolean;
  connected: boolean;
}

export interface CloudEntry {
  id: string;
  name: string;
  kind: 'folder' | 'image';
  size: number | null;
  modified?: string | null;
}

export async function cloudStatus(): Promise<Record<CloudProvider, CloudProviderStatus>> {
  const result = await post<{ providers: Record<CloudProvider, CloudProviderStatus> }>('/cloud/status', {});
  return result.providers;
}

export async function connectCloud(provider: CloudProvider): Promise<string> {
  const result = await post<{ authorizationUrl: string }>('/cloud/connect', { provider });
  return result.authorizationUrl;
}

export async function disconnectCloud(provider: CloudProvider): Promise<void> {
  await post('/cloud/disconnect', { provider });
}

export async function cloudFolder(
  provider: CloudProvider,
  folder?: string,
): Promise<{ folder: string; entries: CloudEntry[] }> {
  return post('/cloud/list', { provider, folder });
}

export async function importCloudFrame(
  provider: CloudProvider,
  entry: CloudEntry,
  rawDir: string,
): Promise<{ file: string; skipped: boolean }> {
  return post('/project/import-cloud', {
    provider,
    id: entry.id,
    name: entry.name,
    size: entry.size,
    rawDir,
  });
}

/** Everything project.json remembers — the project's MEMORY. Keyed by frame
 *  NAME, not absolute path: the folder is meant to travel, and a drive letter
 *  is not identity. */
export interface ProjectMemory {
  version: number;
  batches: { id: string; name: string; order: number }[];
  assign: Record<string, string>;
  statuses: Record<string, string>;
  recipe: {
    version: number;
    base: ToolInstance[];
    perBatch: Record<string, ToolInstance[]>;
    perFrame: Record<string, ToolInstance[]>;
  };
  /** The client gallery this folder was published to. Null until there is one.
   *  Lives here rather than on the business record so the saved selection and
   *  the note saying it was imported cannot part company. */
  gallery: GalleryLink | null;
  /** רצפים — the story of the day. Independent of `batches`: a batch is a light
   *  and carries a recipe, a moment is a chapter and carries only membership.
   *  Optional on the wire because project.json files written before this
   *  existed do not have them; the store normalises on load. */
  moments?: StoryMoment[];
  momentAssign?: Record<string, string>;
  /** Suggested cuts turned down, keyed by the frame name the cut would follow. */
  rejectedBoundaries?: string[];
  /** שלב העבודה — the PHOTOGRAPHER'S decision per frame name. Kept apart from
   *  the engine's suggestion on purpose: re-analysing a set can change what is
   *  suggested, and must never change what he decided. Absent = undecided. */
  cull?: Record<string, 'keep' | 'maybe' | 'reject'>;
}

export interface StoryMoment {
  id: string;
  name: string;
  order: number;
  cover?: string;
  createdAt: string;
}

/** What the studio remembers about a published gallery. The gallery itself
 *  lives on the server; this is the thread back to it. */
export interface GalleryLink {
  galleryId: string;
  slug: string;
  username: string;
  /** Kept on the photographer's own project so both credentials can be copied
   * after creation. The server stores only the hash. Optional for galleries
   * created before this field existed. */
  password?: string;
  createdAt: number;
  /** how many frames were published, so the screen can say so without asking */
  published: number;
  /** File names that did NOT reach the gallery — the client cannot see them.
   *  Kept on the link so the screen still says so after the upload ends, and
   *  so they can be sent again on their own. */
  unpublished?: string[];
  /** Set once the locked choice has been brought back into the project. Its
   *  presence stops a second import on the next poll. The choice is a filter
   *  over the original batches — it must never replace their membership. */
  importedAt?: number;
  /** File names selected by the client. Kept separately from batch membership
   *  so the editor can show the choice inside the original shoot groups. */
  selectedFrames?: string[];
  /** Original editing group for each selected frame at publish time. This also
   *  lets projects imported by an older build recover their original split. */
  selectionGroups?: Record<string, { id: string | null; name: string | null }>;
  /** Legacy field from builds that turned the choice into one synthetic batch. */
  batchId?: string;
  /** Frames the client chose that are NOT in this folder any more — renamed,
   *  moved, deleted. NEVER swallowed: handing the photographer forty photographs
   *  when the couple chose forty-three, silently, is the failure the whole
   *  frameId rule exists to prevent. */
  missing?: string[];
  /** Which frames belong to which album. Does not affect editing — a frame is
   *  edited once however many albums it is in — and travels on to the album
   *  machine. */
  albums?: Record<string, { name: string; quota: number; frames: string[] }>;
}

export interface GalleryComment {
  id: string;
  itemId: string;
  frameId: string;
  versionN: number;
  x: number;
  y: number;
  text: string;
  createdAt: number;
  resolvedAt: number | null;
}

export interface GalleryState {
  gallery: {
    id: string;
    slug: string;
    name: string;
    username: string;
    status: 'active' | 'frozen' | 'archived';
    lockedAt: number | null;
    frozenAt: number | null;
    /** Epoch seconds after which a frozen gallery is removed by the sweep.
     *  Surfaced so the photographer is never deleted on without warning. */
    keptUntil: number | null;
    albums: { id: string; name: string; quota: number; nameSetByClient: boolean }[];
  };
  counts: Record<string, number>;
  selection: {
    frameId: string;
    itemId: string;
    albumIds: string[];
    clientDone: boolean;
    versions: number;
    groupId?: string | null;
    groupName?: string | null;
  }[];
  comments: GalleryComment[];
  serverTime: number;
}

export interface ImportPlan {
  name: string;
  lockedAt: number | null;
  matched: string[];
  missing: string[];
  albums: Record<string, { name: string; quota: number; frames: string[] }>;
  groups?: Record<string, { id: string | null; name: string | null }>;
  openComments: number;
}

/* ── the client gallery, photographer's side ───────────────────────────────
 *
 * The gallery API is mounted on the engine while everything runs on one
 * machine, and answers on the same origin as everything else here. When it
 * moves to a server this is the one file that changes.
 */

export async function createGallery(
  projectId: string,
  name: string,
  albums: { name: string; quota: number }[],
): Promise<{ id: string; slug: string; username: string; password: string }> {
  return post('/api/gallery/create', { projectId, name, albums });
}

/** Derive and publish frames from disk. One unreadable file is named and the
 *  rest still land — a 600-frame publish must not die on one bad JPEG. */
export async function publishFrames(
  galleryId: string,
  frames: {
    path: string;
    frameId: string;
    name: string;
    groupId?: string;
    groupName?: string;
  }[],
): Promise<{
  published: { id: string; frameId: string }[];
  failed: { name: string; error: string }[];
}> {
  return post('/api/gallery/publish', { galleryId, frames });
}

export const galleryState = (galleryId: string): Promise<GalleryState> =>
  post('/api/gallery/state', { galleryId });

export const galleryImportPlan = (
  galleryId: string,
  frames: string[],
): Promise<ImportPlan> => post('/api/gallery/import-plan', { galleryId, frames });

export const galleryResolve = (galleryId: string, commentId: string) =>
  post<{ ok: boolean }>('/api/gallery/resolve', { galleryId, commentId });

/** Publish a corrected frame as the next version. The client sees "updated". */
export const galleryPublishVersion = (
  galleryId: string,
  itemId: string,
  path: string,
) => post<{ n: number }>('/api/gallery/publish-version', { galleryId, itemId, path });

export interface Brand {
  logo: string;
  aspect: number;
  updatedAt?: number;
}

/** The photographer's mark, shown on every gallery they publish. Read live by
 *  the manifest rather than copied onto a gallery when it is made, so a new
 *  logo reaches the galleries already out in the world. */
/** Object URLs come back relative when the store is a local disk: they are
 *  served by the ENGINE, not by whatever origin this page is on. In dev those
 *  are different ports, and an <img> would resolve against Vite and 404. */
const absoluteObject = (u: string | null) =>
  u && u.startsWith('/') ? ENGINE + u : u;

export const getBrand = async (): Promise<{ logo: string | null; aspect?: number }> => {
  const out = await post<{ logo: string | null; aspect?: number }>(
    '/api/gallery/brand', {},
  );
  return { ...out, logo: absoluteObject(out.logo) };
};

/** `logo` is a data URL or bare base64 — the photographer picks the file in
 *  their own browser, so this works the same whether the API is on this
 *  machine or on a server. */
export const setBrand = async (logo: string, filename: string): Promise<Brand> => {
  const out = await post<Brand>('/api/gallery/brand-set', { logo, filename });
  return { ...out, logo: absoluteObject(out.logo) as string };
};

export const clearBrand = () => post<{ ok: boolean }>('/api/gallery/brand-clear', {});

export const galleryCredentials = (galleryId: string) =>
  post<{ username: string; password: string }>('/api/gallery/credentials', {
    galleryId,
  });

export const gallerySetStatus = (
  galleryId: string,
  status: 'active' | 'frozen' | 'archived',
) => post<{ status: string }>('/api/gallery/status', { galleryId, status });

export const galleryUnlock = (galleryId: string) =>
  post<{ ok: boolean }>('/api/gallery/unlock', { galleryId });

export const galleryDelete = (galleryId: string) =>
  post<{ ok: boolean }>('/api/gallery/delete', { galleryId });

async function post<T>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${ENGINE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error('לא ניתן להתחבר למנוע המקומי של TEZA');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j as T;
}

/** Where projects live. Asked once for the installation, then remembered —
 *  no folder argument reads it, passing one sets it. */
export async function workspaceRoot(folder?: string): Promise<string | null> {
  const j = await post<{ root: string | null }>('/workspace', folder ? { folder } : {});
  return j.root;
}

/** Create or adopt `<root>/<name>/`. Safe to call on every open: adopting an
 *  existing project must not be a different path through the code. */
export async function initProject(name: string, root?: string): Promise<ProjectPaths> {
  return post<ProjectPaths>('/project/init', { name, root });
}

/** Copy ONE frame into the project. One per call so the screen can count in
 *  items — a card of 300 RAW frames is minutes, and a bar that moves is the
 *  difference between waiting and force-quitting. */
export async function importFrame(
  src: string,
  rawDir: string,
): Promise<{ file: string; skipped: boolean }> {
  return post('/project/import', { src, rawDir });
}

/** The set as the disk has it, in capture order. Read fresh every time: the
 *  disk is the authority on what exists. */
export async function projectFrames(home: string): Promise<{
  frames: Frame[];
  raw: string;
  edited: string;
}> {
  return post('/project/frames', { home });
}

/** Read (no `state`) or write project.json. Always returns what is now on
 *  disk, so a save and a reload cannot disagree. */
export async function projectState(home: string, state?: ProjectMemory): Promise<ProjectMemory> {
  return post('/project/state', state ? { home, state } : { home });
}

/** Render one frame from the RAW through the whole recipe and REPLACE its file
 *  in תמונות. Never renders on top of the previous output — that is what keeps
 *  a fifth tool from being the fifth JPEG generation. */
export async function applyToFrame(
  src: string,
  editedDir: string,
  recipe: ToolInstance[],
  quality?: number,
): Promise<{ file: string }> {
  return post('/project/apply', { src, editedDir, recipe, quality });
}

/** Open the operating system's own folder dialog and return what was chosen.
 *
 * The browser cannot produce an absolute path — that is a deliberate boundary
 * and no UI work gets around it. The engine is a local process on the same
 * machine, so it raises the native dialog instead. `null` means the dialog was
 * cancelled, which is an answer and not a failure. */
export async function pickFolder(): Promise<string | null> {
  const r = await fetch(`${ENGINE}/pick-folder`, { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j.cancelled ? null : (j.folder as string);
}

/* ------------------------------------------------------------ album desk export
 *
 * הדפדפן מחזיק תמונונות בלבד, ולכן ייצוא מהמסך היה כותב אלבום מפרוקסים —
 * נכון על מסך, הרוס ב-30 ס"מ. המקורות אצל המנוע, ולכן הייצוא אצל המנוע.
 *
 * הגיאומטריה נשלחת כמלבנים בשברים של הכפולה כולה: התבניות נשארות במסך
 * והמנוע לא יודע עליהן דבר.
 */

export interface AlbumDeskExportSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  path: string;
  zoom: number;
  fx: number;
  fy: number;
}

export interface AlbumDeskExportResult {
  ok: boolean;
  folder: string;
  files: string[];
  dpi: number;
  size: [number, number];
  /** בעיות שדווחו ולא הופלו בשקט — למשל מקור קטן מהשטח המודפס. */
  notes: string[];
}

export async function albumDeskExport(payload: {
  out: string;
  dpi: number;
  spec: { wcm: number; hcm: number; bleedMm: number };
  spreads: { slots: AlbumDeskExportSlot[] }[];
}): Promise<AlbumDeskExportResult> {
  const r = await fetch(`${ENGINE}/albumdesk/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `engine ${r.status}`);
  return j as AlbumDeskExportResult;
}
