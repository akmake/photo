/* מפרט הדפוס — the physical album, as numbers the photographer types in.
 *
 * Every layout decision downstream is geometry, and geometry needs a real page:
 * a spread of 60×30cm gets different templates from a square one, and a face
 * that sits fine on a layflat is swallowed by the fold of a bound book. So the
 * spec is INPUT, never a guess — the fields start empty and the build is locked
 * until they are filled (CLAUDE.md §3: a made-up number that renders perfectly
 * on screen and fails at the lab is the worst kind of lie).
 *
 * Units are millimetres, the language every print house writes its spec sheet
 * in. Pixels appear only at the very end, in the PPI check.
 */

const MM_PER_INCH = 25.4;

/** One closed page, plus the safety geometry around it. All in mm, except PPI. */
export interface PrintSpec {
  /** A single closed page. The open spread is twice this wide. */
  pageWidthMm: number;
  pageHeightMm: number;
  /** Trimmed away by the guillotine — art must run into it, nothing important. */
  bleedMm: number;
  /** Inside the trim, but too close to the edge to hold a face or a word. */
  safeMarginMm: number;
  /** Swallowed by the fold, each side of it. Near zero on layflat. */
  gutterMm: number;
  /** What the lab asks for, and the floor under which a frame is too soft. */
  targetPpi: number;
  minPpi: number;
}

/** The form's raw state: strings, because a half-typed number is not a number. */
export type SpecDraft = Record<keyof PrintSpec, string>;

export const EMPTY_DRAFT: SpecDraft = {
  pageWidthMm: '',
  pageHeightMm: '',
  bleedMm: '',
  safeMarginMm: '',
  gutterMm: '',
  targetPpi: '',
  minPpi: '',
};

export interface SpecField {
  key: keyof PrintSpec;
  label: string;
  hint: string;
  unit: string;
  /** A gutter of 0 is a real answer (layflat); a page of 0 is not. */
  allowZero?: boolean;
}

export const SPEC_FIELDS: SpecField[] = [
  { key: 'pageWidthMm', label: 'רוחב עמוד', hint: 'עמוד אחד סגור. הכפולה הפתוחה כפולה מזה.', unit: 'מ״מ' },
  { key: 'pageHeightMm', label: 'גובה עמוד', hint: 'גובה הספר.', unit: 'מ״מ' },
  { key: 'bleedMm', label: 'בליד', hint: 'נחתך בסכין. התמונה נכנסת לשם, שום דבר חשוב לא.', unit: 'מ״מ', allowZero: true },
  { key: 'safeMarginMm', label: 'שוליים בטוחים', hint: 'פנים או כיתוב לא ייכנסו לרצועה הזאת.', unit: 'מ״מ', allowZero: true },
  { key: 'gutterMm', label: 'ציר', hint: 'נבלע בקיפול, מכל צד. ב-layflat כמעט אפס.', unit: 'מ״מ', allowZero: true },
  { key: 'targetPpi', label: 'PPI יעד', hint: 'הרזולוציה שבית הדפוס מבקש.', unit: 'PPI' },
  { key: 'minPpi', label: 'PPI מינימלי', hint: 'מתחת לזה הפריים רך מדי ותקבל אזהרה.', unit: 'PPI' },
];

/** A draft becomes a spec only when every field is a real, positive number. */
export function parseSpec(draft: SpecDraft): PrintSpec | null {
  const out = {} as PrintSpec;
  for (const field of SPEC_FIELDS) {
    const value = Number(draft[field.key].trim());
    if (!Number.isFinite(value)) return null;
    if (value < 0) return null;
    if (value === 0 && !field.allowZero) return null;
    out[field.key] = value;
  }
  if (out.minPpi > out.targetPpi) return null;
  return out;
}

/** What is still missing or wrong, in the photographer's words. */
export function specProblems(draft: SpecDraft): string[] {
  const problems: string[] = [];
  for (const field of SPEC_FIELDS) {
    const raw = draft[field.key].trim();
    if (!raw) {
      problems.push(`${field.label} — חסר`);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) problems.push(`${field.label} — לא מספר תקין`);
    else if (value === 0 && !field.allowZero) problems.push(`${field.label} — לא יכול להיות אפס`);
  }
  const min = Number(draft.minPpi);
  const target = Number(draft.targetPpi);
  if (Number.isFinite(min) && Number.isFinite(target) && min > target) {
    problems.push('PPI מינימלי גדול מה-PPI היעד');
  }
  return problems;
}

/** The open spread, at trim and with bleed. This is the page the layout sits on. */
export function spreadSize(spec: PrintSpec) {
  const trimWidthMm = spec.pageWidthMm * 2;
  const trimHeightMm = spec.pageHeightMm;
  return {
    trimWidthMm,
    trimHeightMm,
    bleedWidthMm: trimWidthMm + spec.bleedMm * 2,
    bleedHeightMm: trimHeightMm + spec.bleedMm * 2,
    /** What layoutEngine calls pageAspect: one page, width over height. */
    pageAspect: spec.pageWidthMm / spec.pageHeightMm,
    /** For the CSS aspect-ratio of the on-screen spread. */
    spreadAspect: trimWidthMm / trimHeightMm,
  };
}

export interface FrameResolution {
  /** What the frame actually resolves to once cropped into this slot. */
  ppi: number;
  /** Long edge of the printed frame, for the read-out. */
  widthMm: number;
  heightMm: number;
  ok: boolean;
  belowTarget: boolean;
}

/* The honest resolution of one photo in one slot.
 *
 * `object-fit: cover` is not a detail here — it decides which axis is thrown
 * away. A 3:2 frame in a square slot loses its sides, so the pixels that
 * survive along the width are fewer than the file's width, and quoting the
 * file's width would overstate the print by a third. */
export function frameResolution(
  photoWidthPx: number,
  photoHeightPx: number,
  slotWidthFraction: number,
  slotHeightFraction: number,
  spec: PrintSpec,
): FrameResolution {
  const { trimWidthMm, trimHeightMm } = spreadSize(spec);
  const widthMm = slotWidthFraction * trimWidthMm;
  const heightMm = slotHeightFraction * trimHeightMm;

  if (!photoWidthPx || !photoHeightPx || widthMm <= 0 || heightMm <= 0) {
    return { ppi: 0, widthMm, heightMm, ok: false, belowTarget: true };
  }

  const slotAspect = widthMm / heightMm;
  const photoAspect = photoWidthPx / photoHeightPx;
  // Cover: the wider-than-slot photo keeps its full height and loses its sides.
  const usedWidthPx = photoAspect > slotAspect
    ? photoHeightPx * slotAspect
    : photoWidthPx;

  const ppi = usedWidthPx / (widthMm / MM_PER_INCH);
  return {
    ppi: Math.round(ppi),
    widthMm: Math.round(widthMm * 10) / 10,
    heightMm: Math.round(heightMm * 10) / 10,
    ok: ppi >= spec.minPpi,
    belowTarget: ppi < spec.targetPpi,
  };
}

/** The fold's risk band, as a fraction of the spread — for the guide overlay. */
export function gutterFraction(spec: PrintSpec): number {
  const { trimWidthMm } = spreadSize(spec);
  return trimWidthMm > 0 ? spec.gutterMm / trimWidthMm : 0;
}

/** True when a slot's own area overlaps the fold's risk band. */
export function crossesGutter(
  slotX: number,
  slotWidth: number,
  spec: PrintSpec,
): boolean {
  const band = gutterFraction(spec);
  if (band <= 0) return false;
  return slotX < 0.5 + band && slotX + slotWidth > 0.5 - band;
}
