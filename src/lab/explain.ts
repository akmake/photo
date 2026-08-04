/* Turns the engine's per-step meta into something a human can act on.
 *
 * The point of the lab is not "here is the result" — it is "here is what the
 * tool DID, and if it did nothing, why". A tool that silently returns the frame
 * unchanged is the single most expensive failure mode in this pipeline: it
 * looks like a weak effect, so you push the slider, and the slider was never
 * the problem. Every engine module signals that case in its meta (faceTooSmall,
 * noFace, spotsRemoved: 0 …); this file makes those signals visible.
 *
 * Meta is NOT flat. cleanup.py nests a whole colorHarmonization report with a
 * per-component array inside it, so anything here has to survive objects and
 * arrays rather than assuming numbers.
 */

import type { RenderStep } from '../api';
import { getTool } from '../toolRegistry';

export type Verdict = 'ok' | 'idle' | 'warn';

export interface StepReport {
  toolId: string;
  label: string;
  ms: number;
  verdict: Verdict;
  headline: string;
  facts: string[];
  raw: string;
}

type MetaValue = unknown;
type Meta = Record<string, MetaValue>;

const num = (v: MetaValue) => Number(v);
const pct = (v: MetaValue) => `${(num(v) * 100).toFixed(2)}%`;
const int = (v: MetaValue) => num(v).toLocaleString('he-IL');
const px = (v: MetaValue) => `${Math.round(num(v))}px`;

/* A tool reported a condition that stopped it. These win over everything else:
 * the value is the reason the frame came back untouched.
 *
 * They get the WHOLE meta, not just their own value, because "stopped" is not
 * always all-or-nothing. In a group photo the engine skips the faces under its
 * size floor and works on the rest — on 321A5078 that is three of five — and
 * the old wording ("did not touch a single pixel") was then simply false while
 * five spots had in fact been healed. A blocker that overstates itself teaches
 * the same distrust as a tool that says nothing. */
const BLOCKERS: Record<string, (v: MetaValue, meta: Meta) => string> = {
  faceTooSmall: (v, meta) => {
    const skipped = num(v);
    const total = num(meta.faces);
    return total > skipped && skipped > 0
      ? `${int(skipped)} מתוך ${int(total)} הפנים בפריים קטנות מדי — הכלי דילג עליהן ועבד על השאר`
      : 'הפנים קטנות מדי בפריים — הכלי דילג ולא נגע בפיקסל אחד';
  },
  // Not a failure: someone set the dial to zero. Worth a headline anyway,
  // because "no marks were removed" and "you asked for none to be" look
  // identical in the result and are opposite in what to do next.
  spotsOff: (v, meta) => {
    const off = num(v);
    const total = num(meta.faces);
    return total > off && off > 0
      ? `ניקוי נקודתי כבוי (0) על ${int(off)} מתוך ${int(total)} הפנים — תיקון הצבע והברק פעלו כרגיל`
      : 'ניקוי נקודתי כבוי (0) — תיקון הצבע והברק פעלו כרגיל';
  },
  irisTooSmall: (v) => `הקשתית קטנה מדי (${v} עיניים) — הכלי דילג`,
  noFace: () => 'לא זוהו פנים — הכלי דילג',
  noHair: () => 'לא זוהה שיער — הכלי דילג',
  error: (v) => `שגיאה: ${v}`,
};

/** Any of these means the frame came back untouched because of resolution.
 *  The lab turns this into "switch to full resolution", which is the fix. */
export const SCALE_BLOCKERS = ['faceTooSmall', 'irisTooSmall'];

export function isScaleBlocked(r: StepReport): boolean {
  return SCALE_BLOCKERS.some((k) => r.raw.includes(`"${k}"`));
}

/* Keys whose value being 0 means "ran, changed nothing". */
const EFFECT_KEYS = [
  'skinCoverage',
  'hairCoverage',
  'subjectCoverage',
  'spotsRemoved',
  'correctedPx',
  'pigmentPx',
  'blushApplied',
  'eyes',
  'applied',
];

const FACTS: Record<string, (v: MetaValue) => string> = {
  // coverage / geometry
  skinCoverage: (v) => `כיסוי עור בפריים: ${pct(v)}`,
  bodyCoverage: (v) => `עור גוף (צוואר/ידיים): ${pct(v)}`,
  hairCoverage: (v) => `כיסוי שיער בפריים: ${pct(v)}`,
  subjectCoverage: (v) => `כיסוי נושא בפריים: ${pct(v)}`,
  fabricCoverage: (v) => `כיסוי בגדים בפריים: ${pct(v)}`,
  radiusPx: (v) => `רדיוס הזוהר: ${px(v)}`,
  general: (v) => `זוהר כללי בעוצמה ${num(v).toFixed(2)}`,
  lightOnSkin: (v) => `מהאור שנוסף נחת על עור: ${pct(v)}`,
  lightOnFabric: (v) => `מהאור שנוסף נחת על בגדים: ${pct(v)}`,
  lightOnRest: (v) => `מהאור שנוסף נחת על השאר: ${pct(v)}`,
  subjectPlane: (v) => `מישור הנושא: ${num(v).toFixed(3)}`,
  faceDiameter: (v) => `קוטר פנים: ${px(v)}`,
  regionPx: (v) => `אזור הפעולה: ${int(v)} פיקסלים`,
  irisRadiusPx: (v) =>
    `רדיוס קשתית: ${(v as number[]).map((x) => x.toFixed(1)).join(' / ')}px`,

  // counts
  spotsRemoved: (v) => `כתמים שהוסרו: ${int(v)}`,
  correctedPx: (v) => `פיקסלים שתוקנו: ${int(v)}`,
  candidates: (v) => `מועמדים שנבדקו: ${int(v)}`,
  components: (v) => `רכיבים שנמצאו: ${int(v)}`,
  faces: (v) => `פנים שזוהו: ${int(v)}`,
  eyes: (v) => `עיניים שטופלו: ${int(v)}`,
  zonesUsed: (v) => `טווחי טון שנצבעו: ${int(v)}`,
  dodgedPx: (v) => `פיקסלים שהוארו: ${int(v)}`,
  burnedPx: (v) => `פיקסלים שהוכהו: ${int(v)}`,
  meanAbsL: (v) => `דחיפת L* ממוצעת: ${num(v).toFixed(2)}`,
  lightFollow: (v) => `מהדחיפה האנטומית שרד את אור הסצנה: ${Math.round(num(v) * 100)}%`,
  pushOnFabric: (v) => `מהמבנה נחת על בגדים: ${pct(v)}`,
  pushOnSkin: (v) => `מהמבנה נחת על עור: ${pct(v)}`,
  pushOnRest: (v) => `מהמבנה נחת על הרקע: ${pct(v)}`,
  mask: (v) => `הוחל דרך מסכה: ${v === 'painted' ? 'מכחול ידני' : v}`,
  maskCoverage: (v) => `כיסוי המסכה: ${pct(v)}`,
  matte: (v) => (num(v) ? `מאט: ${Math.round(num(v) * 100)}%` : 'ללא מאט'),

  // flags / values
  blushApplied: (v) => (num(v) ? 'סומק הוחל' : 'סומק לא הוחל'),
  applied: (v) => (num(v) ? 'הופעל' : 'לא הופעל'),
  lineVetoed: (v) => `קטעי קו שדולגו (שערה/קמט): ${int(v)}`,
  shadingVetoed: (v) => `אזורי הצללה שדולגו: ${int(v)}`,
  wetTrails: (v) => `נוזלים שזוהו בשער המבנה: ${int(v)}`,
  fluidTrails: (v) => `שבילי נוזל (ריר/דמעה/נזלת): ${int(v)}`,
  // Regions, not ticked boxes: two marks that touch are rebuilt as one area, so
  // this can read lower than the number of marks and that is not a discrepancy.
  selected: (v) => `לפי סימון ידני — אזורים שנבנו מחדש: ${int(v)} (מוקדים נוגעים מתמזגים)`,

  // pigment evening (cleanup.py stage A). `pigmentPx` vs `correctedPx` is the
  // distinction that matters when reading a result: the first is colour that was
  // corrected in place, the second is pixels that were rebuilt. A face where the
  // second is large is a face where patches are possible.
  pigmentPx: (v) => `פיקסלים שתוקנו בצבע (בלי שחזור): ${int(v)}`,
  protectedSpotPx: (v) => `שומות שהוגנו מפני תיקון: ${int(v)} פיקסלים`,
  blobGatePx: (v) => `כתמים כהים שזוהו לפי צורה: ${int(v)} פיקסלים`,
  aMaxShift: (v) => `הסטת אדמומיות מקסימלית: ${num(v).toFixed(1)} יחידות Lab`,
  aKnee: (v) => `סף האדמומיות של העור הזה: ${num(v).toFixed(2)}`,
  lMaxLift: (v) => `הבהרה מקסימלית של כתם: ${num(v).toFixed(1)} יחידות L*`,
  lKnee: (v) => `סף הכהות של העור הזה: ${num(v).toFixed(2)}`,
  model: (v) => `מודל: ${v}`,
  strength: (v) => `עוצמה בפועל: ${num(v).toFixed(2)}`,
  warmth: (v) => `חמימות בפועל: ${num(v).toFixed(2)}`,
  deltaA: (v) => `שינוי ערוץ a*: ${num(v).toFixed(2)}`,
  skinA: (v) => `a* של העור: ${num(v).toFixed(1)}`,
  hairA: (v) => `a* של השיער: ${num(v).toFixed(1)}`,
  hairB: (v) => `b* של השיער: ${num(v).toFixed(1)}`,
};

/* Nested reports get one summary line each — the full tree stays in the raw
 * block underneath, which is where you go when the summary is not enough. */
const NESTED: Record<string, (v: Record<string, unknown>) => string> = {
  colorHarmonization: (v) =>
    v.enabled
      ? `התאמת גוון: ${v.componentsMatched} רכיבים הותאמו, ${v.componentsRejected} נדחו` +
        (typeof v.meanBoundaryErrorBefore === 'number' &&
        typeof v.meanBoundaryErrorAfter === 'number'
          ? ` · שגיאת גבול ${(v.meanBoundaryErrorBefore as number).toFixed(2)} → ${(
              v.meanBoundaryErrorAfter as number
            ).toFixed(2)}`
          : '')
      : 'התאמת גוון: כבויה',
};

function describe(key: string, value: MetaValue): string | null {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    if (key in FACTS) return FACTS[key](value);
    return `${key}: ${value.length} פריטים`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (key in NESTED) return NESTED[key](obj);
    return `${key}: ${Object.keys(obj).length} שדות (ראה פירוט)`;
  }
  return key in FACTS ? FACTS[key](value) : `${key}: ${value}`;
}

function labelOf(toolId: string): string {
  try {
    return getTool(toolId).label;
  } catch {
    return toolId; // engine-only tool with no front-end entry
  }
}

function isSet(v: MetaValue): boolean {
  return v !== undefined && v !== null && v !== 0 && v !== '' && v !== false;
}

/* ------------------------------------------------------------------ marks */

/* What ONE detected candidate is, in words. The engine deliberately returns a
 * machine verdict plus the measurements behind it and no prose — the same split
 * as everything above, so a threshold can move without a Hebrew string having
 * to move with it. */

const KIND_LABEL: Record<string, string> = {
  spot: 'כתם',
  debris: 'פירור בהיר',
  fluid: 'נוזל (ריר/דמעה)',
};

export function markLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Why the engine reached its verdict — and, for a refusal, what it is risking
 *  if you overrule it. A refusal with no stated reason is indistinguishable
 *  from a tool that found nothing, which is the whole problem this view fixes. */
export function markReason(verdict: string, facts: Record<string, number>): string {
  const area = facts.areaPx ? `${int(facts.areaPx)}px` : '';
  switch (verdict) {
    case 'heal':
      return `יתוקן · ${area}${
        facts.parts > 1 ? ` · ${facts.parts} מוקדים שהתמזגו` : ''
      }`;
    case 'line':
      return (
        'נדחה: קטע מתוך קו ארוך יותר — שערה, קו אייליינר או קמט. ' +
        `הקו נמשך ${int(facts.ridgeOutside ?? 0)}px מעבר לכתם, ותיקון של קטע ` +
        'באמצע קוטע אותו ונראה כמו נזק'
      );
    case 'shading':
      return (
        'נדחה: החריגה לא נגמרת — הטבעת סביב הכתם חריגה בעצמה ' +
        `(${(facts.ringNovelty ?? 0).toFixed(2)} מול סף ${(facts.ringBar ?? 0).toFixed(2)}). ` +
        'זו הצללה, סומק או אור, ולא לכלוך'
      );
    case 'size':
      return (
        `נדחה: רחב מדי לכתם — ${area}, עובי ${Math.round(facts.thicknessPx ?? 0)}px ` +
        `(${((facts.faceFraction ?? 0) * 100).toFixed(1)}% מרוחב הפנים). ` +
        'שחזור של שטח כזה עלול להיראות כטלאי'
      );
    default:
      return verdict;
  }
}

export function explainStep(
  step: RenderStep,
  paramNote: string,
  /** every slider still on its default — for a global tool that is an exact
   *  identity transform, which must not be reported as "applied" */
  atDefault = false,
): StepReport {
  const meta = (step.meta ?? {}) as Meta;
  const label = labelOf(step.tool);
  const raw = JSON.stringify(meta, null, 1);

  const facts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (k in BLOCKERS) continue; // reported as the headline instead
    const line = describe(k, v);
    if (line) facts.push(line);
  }
  if (paramNote) facts.unshift(paramNote);

  const base = { toolId: step.tool, label, ms: step.ms, facts, raw };

  // 1. an explicit blocker
  for (const [key, tell] of Object.entries(BLOCKERS)) {
    if (isSet(meta[key])) {
      return { ...base, verdict: 'warn', headline: tell(meta[key], meta) };
    }
  }

  // 2. ran, but every effect it measures came back zero
  const measured = EFFECT_KEYS.filter((k) => meta[k] !== undefined);
  if (measured.length > 0 && measured.every((k) => num(meta[k]) === 0)) {
    return { ...base, verdict: 'idle', headline: 'רץ אבל לא שינה כלום' };
  }

  // 3. a global tool with every slider at its default is an identity transform.
  // Reporting that as "applied" is how you end up pushing a slider that was
  // never the problem.
  if (Object.keys(meta).length === 0) {
    return atDefault
      ? { ...base, verdict: 'idle', headline: 'כל הסליידרים על ברירת המחדל — אין שינוי' }
      : { ...base, verdict: 'ok', headline: 'הוחל על כל הפריים' };
  }

  return { ...base, verdict: 'ok', headline: 'בוצע' };
}
