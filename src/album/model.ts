import type { PhotoPalette } from '../api';
import type { SpreadTemplateInstance } from './templates/types';

export type PhotoOrientation = 'portrait' | 'landscape' | 'square';
export type FrameRole = 'hero' | 'support' | 'detail';

export interface PrintProductProfile {
  id: string;
  name: string;
  labName: string;
  productType: 'layflat' | 'flush-mount' | 'photo-book';
  closedWidthMm: number;
  closedHeightMm: number;
  spreadWidthMm: number;
  spreadHeightMm: number;
  bleedMm: number;
  safeMarginMm: number;
  gutterRiskMm: number;
  targetPpi: number;
  minPpi: number;
  outputFormat: 'jpeg' | 'tiff' | 'pdf';
  colorProfile: string;
  verified: boolean;
  profileVersion: string;
  namingPattern: string;
  exportMode: 'spreads' | 'pages';
  coverSpec: {
    totalWidthMm: number;
    totalHeightMm: number;
    spineWidthMm: number;
    bleedMm: number;
    safeMarginMm: number;
    verified: boolean;
  };
}

export interface AlbumPhoto {
  id: string;
  name: string;
  url: string;
  orientation: PhotoOrientation;
  widthPx: number;
  heightPx: number;
  focalPoint?: { x: number; y: number };
  analysis?: AlbumPhotoAnalysis;
  storageKey?: string;
  /** The frame's file on disk, when this photo comes from a project. The engine
   *  serves its pixels and reports its real dimensions — so a project album never
   *  copies a photograph and never has to guess a size a PPI check could quote. */
  sourcePath?: string;
  /** The file an EXPORT must draw: the edited version when one exists, the raw
   *  otherwise — the same file the screen is showing. `sourcePath` stays the raw
   *  because that is what the analysis measures; printing from it would hand the
   *  lab the unedited frame. Absent on an imported photo, whose blob IS the
   *  original and is already full size in the browser. */
  exportPath?: string;
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlbumPhotoAnalysis {
  status: 'pending' | 'ready' | 'failed';
  faces: NormalizedBox[];
  subject?: NormalizedBox | null;
  focalPoint: { x: number; y: number };
  sharpnessScore: number;
  qualityScore: number;
  /** The frame's measured colours, used to colour the page it lands on. */
  palette?: PhotoPalette;
  analyzedBy: string;
}

export type PhotoFitMode = 'smart' | 'contain' | 'cover';

export interface PhotoAdjustments {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  warmth?: number;
  tint?: number;
  blur?: number;
  grayscale?: number;
  sepia?: number;
}

export interface PhotoFrameSettings {
  fit: PhotoFitMode;
  positionX: number;
  positionY: number;
  zoom?: number;
  /** Rotation of the photograph inside its frame, not of the frame itself. */
  rotation?: number;
  adjustments?: PhotoAdjustments;
}

export function photoAdjustmentFilter(settings?: PhotoFrameSettings): string {
  const value = settings?.adjustments;
  if (!value) return 'none';
  const brightness = 100 + (value.brightness ?? 0);
  const contrast = 100 + (value.contrast ?? 0);
  const saturation = 100 + (value.saturation ?? 0);
  const warmth = value.warmth ?? 0;
  const tint = value.tint ?? 0;
  return [
    `brightness(${Math.max(0, brightness)}%)`,
    `contrast(${Math.max(0, contrast)}%)`,
    `saturate(${Math.max(0, saturation)}%)`,
    `sepia(${Math.max(0, Math.min(100, (value.sepia ?? 0) + Math.max(0, warmth) * 0.35))}%)`,
    `hue-rotate(${tint - Math.min(0, warmth) * 0.18}deg)`,
    `grayscale(${Math.max(0, Math.min(100, value.grayscale ?? 0))}%)`,
    `blur(${Math.max(0, value.blur ?? 0) / 12}px)`,
  ].join(' ');
}

export interface LayoutSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role: FrameRole;
  preferred: PhotoOrientation[];
  allowCrossGutter?: boolean;
}

export interface AlbumLayoutTemplate {
  id: string;
  name: string;
  family: string;
  density: 'airy' | 'balanced' | 'rich';
  photoCount: number;
  slots: LayoutSlot[];
}

export interface AlbumSpread {
  id: string;
  pageStart: number;
  layoutId: string;
  photoIds: string[];
  frameSettings?: Record<string, PhotoFrameSettings>;
  customSlots?: LayoutSlot[];
  background: string;
  locked: boolean;
  status: 'draft' | 'review' | 'approved';
  /** The visual chapter this spread belongs to. A spread is never allowed to
   *  contain photos from two sessions. */
  sessionId?: string;
  /** True on the first spread of a session, so the book can present a chapter
   *  opening instead of an invisible change of scene. */
  sessionStart?: boolean;
  /** A designed page from the template library (הכספת) placed on this spread.
   *  When set, it — not `layoutId` or `customSlots` — decides where the photos
   *  sit, and it carries this spread's own colours and texts. */
  templateInstance?: SpreadTemplateInstance;
}

export interface AlbumSession {
  id: string;
  label: string;
  photoIds: string[];
}

export interface ReviewComment {
  id: string;
  spreadId: string;
  author: string;
  text: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
}

export interface ReviewVersion {
  id: string;
  number: number;
  createdAt: string;
  status: 'sent' | 'changes-requested' | 'approved';
  spreads: AlbumSpread[];
  cover?: AlbumCover;
  comments: ReviewComment[];
  approvedAt?: string;
}

export interface AlbumCover {
  background: string;
  /** THE COVER, as a designed sheet: back, spine and front on one piece of
   *  paper, holding a template instance exactly as a spread does — which is
   *  what lets every tool in the designer work on it. See coverSheet.ts.
   *
   *  The fields below it are what a cover was before it could be designed.
   *  They are read once, to build this sheet, and are kept so an album saved
   *  by an older version still opens with its cover intact. */
  sheet?: AlbumSpread;
  frontPhotoId?: string;
  backPhotoId?: string;
  frontSettings?: PhotoFrameSettings;
  backSettings?: PhotoFrameSettings;
  title: string;
  subtitle: string;
  spineText: string;
}

export interface AlbumProject {
  id: string;
  /** The studio project that owns this album. `null` is reserved for legacy
   *  standalone albums until the photographer explicitly links them. */
  projectId: string | null;
  name: string;
  productProfileId: string;
  styleName: string;
  openingDirection?: 'rtl' | 'ltr';
  coverStyle?: 'photo' | 'linen' | 'minimal';
  spreads: AlbumSpread[];
  /** Undefined means session detection has not run yet. An empty array is a
   *  deliberate album without placed photos. */
  sessions?: AlbumSession[];
  /** The photos chosen for this album — the tray it is built from. Undefined on
   *  albums made before it was kept: those draw from the whole project. */
  photoSelection?: string[];
  activeSpreadId: string;
  reviewVersions?: ReviewVersion[];
  activeReviewVersionId?: string;
  cover?: AlbumCover;
}

/* Profile names follow how studios speak about albums: the open SPREAD,
 * width × height in cm. */
export const FIRST_PRINT_PROFILE: PrintProductProfile = {
  id: 'lab-proof-28-landscape',
  name: 'אלבום 56×21',
  labName: 'פרופיל בדיקה — דורש אימות מול בית הדפוס',
  productType: 'layflat',
  closedWidthMm: 280,
  closedHeightMm: 210,
  spreadWidthMm: 560,
  spreadHeightMm: 210,
  bleedMm: 3,
  safeMarginMm: 8,
  gutterRiskMm: 4,
  targetPpi: 300,
  minPpi: 220,
  outputFormat: 'jpeg',
  colorProfile: 'ייקבע מול בית הדפוס',
  verified: false,
  profileVersion: 'טיוטה',
  namingPattern: '{index}-spread.jpg',
  exportMode: 'spreads',
  coverSpec: {
    totalWidthMm: 580,
    totalHeightMm: 210,
    spineWidthMm: 20,
    bleedMm: 3,
    safeMarginMm: 10,
    verified: false,
  },
};

const square = (id: string, sideMm: number): PrintProductProfile => ({
  ...FIRST_PRINT_PROFILE,
  id,
  name: `אלבום ${(sideMm * 2) / 10}×${sideMm / 10}`,
  closedWidthMm: sideMm,
  closedHeightMm: sideMm,
  spreadWidthMm: sideMm * 2,
  spreadHeightMm: sideMm,
  coverSpec: { ...FIRST_PRINT_PROFILE.coverSpec, totalWidthMm: sideMm * 2 + 20, totalHeightMm: sideMm },
});

/** The standard albums, offered when an album is created. Any other size is
 *  typed in as a custom size. */
export const STANDARD_PRINT_PROFILES: PrintProductProfile[] = [
  FIRST_PRINT_PROFILE,
  square('lab-proof-25-square', 250),
  square('lab-proof-30-square', 300),
];

/** Sizes offered before the standard three. Never offered for a new album, but
 *  kept so an album already made in one of them keeps its size. */
export const LEGACY_PRINT_PROFILE_IDS = new Set(['lab-proof-30-landscape', 'lab-proof-30-portrait']);

export const PRINT_PROFILES: PrintProductProfile[] = [
  ...STANDARD_PRINT_PROFILES,
  {
    ...FIRST_PRINT_PROFILE,
    id: 'lab-proof-30-landscape',
    name: 'אלבום 60×20',
    closedWidthMm: 300,
    closedHeightMm: 200,
    spreadWidthMm: 600,
    spreadHeightMm: 200,
    coverSpec: { ...FIRST_PRINT_PROFILE.coverSpec, totalWidthMm: 620, totalHeightMm: 200 },
  },
  {
    ...FIRST_PRINT_PROFILE,
    id: 'lab-proof-30-portrait',
    name: 'אלבום 40×30',
    closedWidthMm: 200,
    closedHeightMm: 300,
    spreadWidthMm: 400,
    spreadHeightMm: 300,
    coverSpec: { ...FIRST_PRINT_PROFILE.coverSpec, totalWidthMm: 420, totalHeightMm: 300 },
  },
];
