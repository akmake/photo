/* מפרט האלבום — הדבר שהצלם קובע לפני שהוא מניח תמונה אחת.
 *
 * זה לא נתון טכני שנוח לדחות לסוף. הצלם כבר מכר ללקוח אלבום מסוים —
 * "30×30, ארבעים עמודים" — וכל השאר תלוי בזה: יחס הכפולה על המסך, מה
 * נחתך בדפוס, ומתי הספר נגמר.
 *
 * מה שאין כאן בכוונה: רשימת מעבדות. אני לא יודע אצל מי הצלם מדפיס, ורשימה
 * מומצאת של מעבדות היא בדיוק סוג השקר שהמוצר הזה אוסר. הגדלים למטה הם
 * גדלים תעשייתיים מקובלים — כמו A4, לא כמו "הלקוחות שלך".
 */

export interface AlbumSpec {
  /** מידות עמוד יחיד, בסנטימטרים. הכפולה היא פי שניים ברוחב. */
  wcm: number;
  hcm: number;
  /** חריגה מעבר לקו החיתוך. מה שנוגע בקצה חייב לחרוג לתוכה. */
  bleedMm: number;
  /** תחום שקט מקו החיתוך פנימה. פרט קריטי מחוץ לו — נחתך. */
  safeMm: number;
  /** כמה מהעמוד נבלע בכריכה ליד החריץ. תפור בולע יותר מ-lay-flat. */
  gutterMm: number;
  /** כמה עמודים נמכרו. עמוד = חצי כפולה, ולכן תמיד זוגי. */
  targetPages: number;
}

/* ברירות מחדל פיזיות מקובלות בדפוס אלבומים. */
export const DEFAULT_SPEC: AlbumSpec = {
  wcm: 30,
  hcm: 30,
  bleedMm: 3,
  safeMm: 5,
  gutterMm: 8,
  targetPages: 40,
};

export interface SizePreset {
  label: string;
  wcm: number;
  hcm: number;
}

/** גדלי אלבום תעשייתיים מקובלים. לא רשימה של מעבדה מסוימת. */
export const SIZE_PRESETS: { group: string; items: SizePreset[] }[] = [
  {
    group: 'ריבוע',
    items: [
      { label: '20×20', wcm: 20, hcm: 20 },
      { label: '25×25', wcm: 25, hcm: 25 },
      { label: '30×30', wcm: 30, hcm: 30 },
      { label: '35×35', wcm: 35, hcm: 35 },
    ],
  },
  {
    group: 'לרוחב',
    items: [
      { label: '25×20', wcm: 25, hcm: 20 },
      { label: '30×20', wcm: 30, hcm: 20 },
      { label: '30×25', wcm: 30, hcm: 25 },
      { label: '40×30', wcm: 40, hcm: 30 },
    ],
  },
  {
    group: 'לגובה',
    items: [
      { label: '20×25', wcm: 20, hcm: 25 },
      { label: '20×30', wcm: 20, hcm: 30 },
      { label: '25×30', wcm: 25, hcm: 30 },
    ],
  },
];

/** יחס העמוד היחיד (רוחב/גובה). הכפולה היא פי שניים. */
export function pageRatio(s: AlbumSpec): number {
  return s.hcm > 0 ? s.wcm / s.hcm : 1;
}

/** מ"מ כשבר מרוחב העמוד — כך נמדדים הקווים המנחים על הקנבס. */
export function mmOfPageWidth(s: AlbumSpec, mm: number): number {
  const wmm = s.wcm * 10;
  return wmm > 0 ? mm / wmm : 0;
}

/** מ"מ כשבר מגובה העמוד. */
export function mmOfPageHeight(s: AlbumSpec, mm: number): number {
  const hmm = s.hcm * 10;
  return hmm > 0 ? mm / hmm : 0;
}

/** ספר כרוך מורכב מכפולות, ולכן מספר העמודים תמיד זוגי. */
export function pagesOfSpreads(spreads: number): number {
  return spreads * 2;
}

export type PageCountState = 'match' | 'short' | 'over';

export function pageCountState(spreads: number, target: number): PageCountState {
  const pages = pagesOfSpreads(spreads);
  if (pages === target) return 'match';
  return pages < target ? 'short' : 'over';
}

export function normalizeSpec(raw: unknown): AlbumSpec {
  const s = (raw ?? {}) as Partial<AlbumSpec>;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.max(min, Math.min(max, n));
  };
  return {
    wcm: num(s.wcm, DEFAULT_SPEC.wcm, 5, 100),
    hcm: num(s.hcm, DEFAULT_SPEC.hcm, 5, 100),
    bleedMm: num(s.bleedMm, DEFAULT_SPEC.bleedMm, 0, 20),
    safeMm: num(s.safeMm, DEFAULT_SPEC.safeMm, 0, 40),
    gutterMm: num(s.gutterMm, DEFAULT_SPEC.gutterMm, 0, 40),
    /* עמודים תמיד זוגיים — זו עובדה פיזית של ספר כרוך, לא העדפה. */
    targetPages: Math.max(2, Math.round(num(s.targetPages, DEFAULT_SPEC.targetPages, 2, 400) / 2) * 2),
  };
}
