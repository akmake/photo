import type { PrintProductProfile } from './model';

/* THE LAB CARD — what a printer has published, in writing, about the files it
 * prints. Research and sources: docs/RESEARCH-album-print-export.md.
 *
 * There is no industry standard. One lab wants 3mm of picture outside the
 * finished size and cuts it away; another wants the file at EXACTLY the
 * finished size and cuts 3–5mm off the inside anyway. A design made for one
 * arrives at the other the wrong size, or with a face trimmed. So the lab is
 * chosen first and the album is checked against ITS rules — never against a
 * generic idea of "print".
 *
 * Every number here is one the lab printed on its own site, on the date in
 * `checkedOn`. What a lab did not publish is NOT filled in with a guess: it
 * goes in `gaps`, which the screen shows, so the photographer knows exactly
 * what to confirm on the phone. */

export type LabCoverMode =
  /** Leather, linen, wood… chosen by model number — no file is sent. */
  | 'material'
  /** One flat sheet the size of a spread, front and back, no spine. */
  | 'flat'
  /** Back, spine and front wrapped around boards. */
  | 'wrap';

export interface LabSpineStep {
  /** Leaves (sheets) — a leaf carries two pages. */
  leaves: number;
  spineMm: number;
}

export interface LabSpec {
  id: string;
  labName: string;
  productName: string;
  productType: PrintProductProfile['productType'];
  sourceUrl: string;
  checkedOn: string;
  /** Sizes the lab offers, as it writes them: height × OPEN width, in cm.
   *  Empty when the lab did not publish a list. */
  sizesCm: Array<{ heightCm: number; openWidthCm: number }>;
  /** Picture carried OUTSIDE the finished size, cut away by the lab. */
  bleedMm: number;
  /** What the lab cuts off the INSIDE of a file sent at finished size. */
  trimInsideMm: number;
  /** Faces and text stay this far inside the finished edge. */
  safeMarginMm: number;
  /** Faces and text stay this far from the fold, on each side. */
  foldBandMm: number;
  targetPpi: number;
  minPpi: number;
  /** The lab wrote only "RGB": sRGB is sent, and the screen says so. */
  colorAssumed: boolean;
  /** `{index}` is the spread's number, three digits, from `firstIndex`. */
  namingPattern: string;
  firstIndex: number;
  coverModes: LabCoverMode[];
  coverFileName: string;
  startsWith: 'spread' | 'page';
  endsWith: 'spread' | 'page';
  maxPages?: number;
  pageThicknessMm?: number;
  spineSteps?: LabSpineStep[];
  paper: 'luster' | 'gloss' | 'matte' | 'fine-art';
  gaps: string[];
}

const PHOTOROOM_SIZES_LAYFLAT = [
  { heightCm: 30, openWidthCm: 80 }, { heightCm: 21, openWidthCm: 56 },
  { heightCm: 30.5, openWidthCm: 76.2 }, { heightCm: 22.7, openWidthCm: 56 },
  { heightCm: 30.5, openWidthCm: 61 }, { heightCm: 22, openWidthCm: 44 },
];

const PHOTOROOM_SIZES_PROFESSIONAL = [
  { heightCm: 30.5, openWidthCm: 76.2 }, { heightCm: 28, openWidthCm: 71.4 },
  { heightCm: 24, openWidthCm: 64 }, { heightCm: 22.7, openWidthCm: 56 },
  { heightCm: 20.2, openWidthCm: 50.6 }, { heightCm: 14, openWidthCm: 35.6 },
  { heightCm: 30, openWidthCm: 80 }, { heightCm: 26.7, openWidthCm: 71.4 },
  { heightCm: 24, openWidthCm: 60 }, { heightCm: 21, openWidthCm: 56 },
  { heightCm: 13.3, openWidthCm: 35.6 }, { heightCm: 30.5, openWidthCm: 61 },
  { heightCm: 28, openWidthCm: 56 }, { heightCm: 22, openWidthCm: 44 },
  { heightCm: 12, openWidthCm: 24 },
];

/* The fold band is the one number here that is ours, not a lab's: none of
 * them states one in millimetres. A lay-flat sheet is folded, not bound, so
 * the band is the crease and a little either side; a bound book swallows
 * about ¾" per page (Red Tree, Queensberry). */
const FOLD_LAYFLAT_MM = 10;
const FOLD_BOUND_MM = 19;

export const LAB_SPECS: LabSpec[] = [
  {
    id: 'photoroom-layflat',
    labName: 'חדר צילום (Photoroom)',
    productName: 'LayFlat',
    productType: 'layflat',
    sourceUrl: 'https://photoroom.co.il/layflatalbums/',
    checkedOn: '16.10.2026',
    sizesCm: PHOTOROOM_SIZES_LAYFLAT,
    bleedMm: 3,
    trimInsideMm: 0,
    safeMarginMm: 10,
    foldBandMm: FOLD_LAYFLAT_MM,
    targetPpi: 300,
    minPpi: 200,
    colorAssumed: true,
    namingPattern: '{index}.jpg',
    firstIndex: 1,
    coverModes: ['material', 'wrap'],
    coverFileName: 'cover.jpg',
    startsWith: 'spread',
    endsWith: 'spread',
    maxPages: 80,
    pageThicknessMm: 1,
    paper: 'luster',
    gaps: [
      'המעבדה כתבה "RGB" בלי לציין איזה — נשלח sRGB, המקובל במעבדות צילום.',
      'אזור בטוח לא פורסם — נקבע 10 מ"מ.',
      'מידות כריכה מודפסת ושדרה לא פורסמו — כריכה מודפסת דורשת תבנית מהמעבדה.',
    ],
  },
  {
    id: 'photoroom-professional',
    labName: 'חדר צילום (Photoroom)',
    productName: 'Professional',
    productType: 'photo-book',
    sourceUrl: 'https://photoroom.co.il/albums/',
    checkedOn: '16.10.2026',
    sizesCm: PHOTOROOM_SIZES_PROFESSIONAL,
    bleedMm: 1,
    trimInsideMm: 0,
    safeMarginMm: 10,
    foldBandMm: 12,
    targetPpi: 300,
    minPpi: 200,
    colorAssumed: true,
    namingPattern: '{index}.jpg',
    firstIndex: 1,
    coverModes: ['material', 'wrap'],
    coverFileName: 'cover.jpg',
    startsWith: 'page',
    endsWith: 'page',
    maxPages: 300,
    pageThicknessMm: 0.6,
    paper: 'luster',
    gaps: [
      'המעבדה כתבה "RGB" בלי לציין איזה — נשלח sRGB, המקובל במעבדות צילום.',
      'האלבום נפתח "כמעט שטוח" — כמה נבלע בקפל לא פורסם; נקבע 12 מ"מ מכל צד.',
      'לא פורסם אם העמוד הבודד בפתיחה ובסיום נשלח כחצי כפולה ריקה או כקובץ עמוד — נשלח כפולה מלאה, עם החצי המודבק ריק.',
      'מידות כריכה מודפסת ושדרה לא פורסמו — כריכה מודפסת דורשת תבנית מהמעבדה.',
    ],
  },
  {
    id: 'mishely-block',
    labName: 'משלי',
    productName: 'אלבום בלוק',
    productType: 'layflat',
    sourceUrl: 'https://www.mishely-art.com/PAGE43.asp',
    checkedOn: '16.10.2026',
    sizesCm: [],
    bleedMm: 0,
    trimInsideMm: 3,
    safeMarginMm: 12,
    foldBandMm: FOLD_LAYFLAT_MM,
    targetPpi: 300,
    minPpi: 200,
    colorAssumed: true,
    namingPattern: '{index}.jpg',
    firstIndex: 2,
    coverModes: ['flat'],
    coverFileName: '001Cover.jpg',
    startsWith: 'spread',
    endsWith: 'spread',
    paper: 'luster',
    gaps: [
      'המעבדה כתבה "RGB" בלי לציין איזה — נשלח sRGB, המקובל במעבדות צילום.',
      'רשימת גדלים מלאה לא פורסמה (20×20 עד 40×40 ס"מ) — לוודא שהגודל קיים.',
    ],
  },
  {
    id: 'mishely-hardcover',
    labName: 'משלי',
    productName: 'כריכה קשה מודפסת',
    productType: 'layflat',
    sourceUrl: 'https://www.mishely-art.com/PAGE43.asp',
    checkedOn: '16.10.2026',
    sizesCm: [],
    bleedMm: 0,
    trimInsideMm: 3,
    safeMarginMm: 12,
    foldBandMm: FOLD_LAYFLAT_MM,
    targetPpi: 300,
    minPpi: 200,
    colorAssumed: true,
    namingPattern: '{index}.jpg',
    firstIndex: 1,
    coverModes: ['wrap', 'material'],
    coverFileName: '00Cover.jpg',
    startsWith: 'spread',
    endsWith: 'spread',
    spineSteps: [
      { leaves: 15, spineMm: 20 },
      { leaves: 25, spineMm: 35 },
      { leaves: 35, spineMm: 40 },
    ],
    paper: 'luster',
    gaps: [
      'המעבדה כתבה "RGB" בלי לציין איזה — נשלח sRGB, המקובל במעבדות צילום.',
      'השדרה מחושבת מהטבלה שהמעבדה פרסמה (משוער, "כ-").',
      'שרטוט הכריכה הקשה (קיפול סביב הלוחות) לא נקרא — כריכה מודפסת דורשת אישור המידות מול המעבדה.',
    ],
  },
  {
    id: 'roth',
    labName: 'רוט אלבומים',
    productName: 'אלבום דיגיטלי',
    productType: 'layflat',
    sourceUrl: 'https://www.roth-albums.com/files',
    checkedOn: '16.10.2026',
    sizesCm: [],
    bleedMm: 0,
    trimInsideMm: 5,
    safeMarginMm: 12,
    foldBandMm: FOLD_LAYFLAT_MM,
    targetPpi: 300,
    minPpi: 200,
    colorAssumed: true,
    namingPattern: '{index}.jpg',
    firstIndex: 1,
    coverModes: ['material', 'wrap'],
    coverFileName: 'cover.jpg',
    startsWith: 'spread',
    endsWith: 'spread',
    paper: 'luster',
    gaps: [
      'המעבדה כתבה "RGB" בלי לציין איזה — נשלח sRGB, המקובל במעבדות צילום.',
      'רשימת גדלים ומידות כריכה נמצאות בעמוד נפרד שלא נקרא — לוודא מול המעבדה.',
    ],
  },
];

export { FOLD_BOUND_MM };

export function labSpecOf(profile: PrintProductProfile): LabSpec | undefined {
  return LAB_SPECS.find((spec) => spec.id === profile.labSpecId);
}

/** Does the lab sell this album's size? `undefined` when it never said. */
export function labOffersSize(spec: LabSpec, profile: PrintProductProfile): boolean | undefined {
  if (!spec.sizesCm.length) return undefined;
  return spec.sizesCm.some((size) => (
    Math.abs(size.heightCm * 10 - profile.spreadHeightMm) <= 2
    && Math.abs(size.openWidthCm * 10 - profile.spreadWidthMm) <= 2
  ));
}

/** The profile, with every rule the lab published laid over it. Size stays
 *  the album's: the lab card says how a size is printed, not which size. It
 *  is marked verified because each number came from the lab in writing —
 *  except the printed cover, whose measurements only the lab's template has. */
export function applyLabSpec(profile: PrintProductProfile, spec: LabSpec): PrintProductProfile {
  const coverMode = spec.coverModes[0];
  return {
    ...profile,
    labSpecId: spec.id,
    labName: `${spec.labName} · ${spec.productName}`,
    productType: spec.productType,
    bleedMm: spec.bleedMm,
    trimInsideMm: spec.trimInsideMm,
    safeMarginMm: spec.safeMarginMm,
    gutterRiskMm: spec.foldBandMm,
    targetPpi: spec.targetPpi,
    minPpi: spec.minPpi,
    outputFormat: 'jpeg',
    colorProfile: 'sRGB',
    namingPattern: spec.namingPattern,
    firstIndex: spec.firstIndex,
    coverFileName: spec.coverFileName,
    coverMode,
    startsWith: spec.startsWith,
    endsWith: spec.endsWith,
    paper: spec.paper,
    exportMode: 'spreads',
    verified: true,
    profileVersion: `לפי אתר המעבדה · נבדק ${spec.checkedOn}`,
    coverSpec: {
      ...profile.coverSpec,
      bleedMm: coverMode === 'flat' ? spec.bleedMm : profile.coverSpec.bleedMm,
      /* A flat block cover is a spread-sized sheet the lab described in
       * full, and a material cover has no file at all; a wrap needs the
       * lab's template, which none published. */
      verified: coverMode !== 'wrap',
    },
  };
}

/** Leaves in the book: each spread is one folded sheet. */
export function albumLeaves(spreadCount: number): number {
  return Math.max(1, spreadCount);
}

/** The spine this album needs, from the lab's own table or page thickness.
 *  `undefined` when the lab gave neither — then the typed value stands. */
export function spineFor(spec: LabSpec | undefined, spreadCount: number): number | undefined {
  if (!spec) return undefined;
  const leaves = albumLeaves(spreadCount);
  const steps = spec.spineSteps;
  if (steps?.length) {
    if (leaves <= steps[0].leaves) return steps[0].spineMm;
    for (let index = 1; index < steps.length; index += 1) {
      const low = steps[index - 1];
      const high = steps[index];
      if (leaves <= high.leaves) {
        const t = (leaves - low.leaves) / (high.leaves - low.leaves);
        return Math.round((low.spineMm + t * (high.spineMm - low.spineMm)) * 2) / 2;
      }
    }
    return steps[steps.length - 1].spineMm;
  }
  return undefined;
}

/** The profile as THIS album needs it: the spine follows the number of
 *  spreads, and the cover's width follows the spine. */
export function profileForAlbum(
  profile: PrintProductProfile,
  spreadCount: number,
): PrintProductProfile {
  if (profile.coverMode === 'flat') {
    return {
      ...profile,
      coverSpec: {
        ...profile.coverSpec,
        spineWidthMm: 0,
        totalWidthMm: profile.closedWidthMm * 2,
        totalHeightMm: profile.closedHeightMm,
      },
    };
  }
  const spine = spineFor(labSpecOf(profile), spreadCount);
  if (spine === undefined) return profile;
  return {
    ...profile,
    coverSpec: {
      ...profile.coverSpec,
      spineWidthMm: spine,
      totalWidthMm: profile.closedWidthMm * 2 + spine,
      totalHeightMm: profile.closedHeightMm,
    },
  };
}
