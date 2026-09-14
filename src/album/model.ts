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
  analyzedBy: string;
}

export type PhotoFitMode = 'smart' | 'contain' | 'cover';

export interface PhotoFrameSettings {
  fit: PhotoFitMode;
  positionX: number;
  positionY: number;
  zoom?: number;
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
  activeSpreadId: string;
  reviewVersions?: ReviewVersion[];
  activeReviewVersionId?: string;
  cover?: AlbumCover;
}

export const FIRST_PRINT_PROFILE: PrintProductProfile = {
  id: 'lab-proof-30-square',
  name: 'אלבום בת מצווה 30×30',
  labName: 'פרופיל בדיקה — דורש אימות מול בית הדפוס',
  productType: 'layflat',
  closedWidthMm: 300,
  closedHeightMm: 300,
  spreadWidthMm: 600,
  spreadHeightMm: 300,
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
    totalWidthMm: 620,
    totalHeightMm: 300,
    spineWidthMm: 20,
    bleedMm: 3,
    safeMarginMm: 10,
    verified: false,
  },
};

export const PRINT_PROFILES: PrintProductProfile[] = [
  FIRST_PRINT_PROFILE,
  {
    ...FIRST_PRINT_PROFILE,
    id: 'lab-proof-30-landscape',
    name: 'אלבום רוחב 30×20',
    closedWidthMm: 300,
    closedHeightMm: 200,
    spreadWidthMm: 600,
    spreadHeightMm: 200,
    coverSpec: {
      ...FIRST_PRINT_PROFILE.coverSpec,
      totalWidthMm: 620,
      totalHeightMm: 200,
    },
  },
  {
    ...FIRST_PRINT_PROFILE,
    id: 'lab-proof-30-portrait',
    name: 'אלבום אורך 20×30',
    closedWidthMm: 200,
    closedHeightMm: 300,
    spreadWidthMm: 400,
    spreadHeightMm: 300,
    coverSpec: {
      ...FIRST_PRINT_PROFILE.coverSpec,
      totalWidthMm: 420,
      totalHeightMm: 300,
    },
  },
];
