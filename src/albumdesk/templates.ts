/* התבניות של העמוד.
 *
 * תבנית היא רשימת מלבנים ביחידות 0..1 של העמוד. זהו. אין כאן מנוע ואין
 * החלטה אוטומטית — הצלם בוחר, וזה מה שהוא ביקש.
 *
 * שלושה דברים שמפרידים תבניות של אלבום מרשת תמונות:
 *
 *   • יש תבנית שנוגעת בקצה (bleed). התמונה נחתכת בפועל בדפוס, וזה מכוון.
 *   • יש תבניות עם הרבה אוויר. שטח ריק הוא מה שהופך תמונה לחשובה; תבנית
 *     שממלאת כל שטח פנוי מייצרת דף מגע.
 *   • יש עמוד ריק לגמרי. בספר מודפס זו בחירה, לא טעות.
 *
 * גדלים יחסיים נושאים משמעות: תמונה גדולה אומרת "זו העיקרית", ושתי תמונות
 * באותו גודל אומרות "אלה שוות". לכן יש כאן תבניות גיבור, ולא רק רשתות.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageTemplate {
  id: string;
  label: string;
  slots: Rect[];
  /** נוגעת בקצה החיצוני — נחתכת בדפוס במכוון. */
  bleed?: boolean;
}

/* מרווח סטנדרטי. לא קטן: זה ההבדל בין אלבום לדף מגע. */
const M = 0.1;
const G = 0.035; // מרווח בין תמונות

export const TEMPLATES: PageTemplate[] = [
  /* --- ריק ------------------------------------------------------------- */
  { id: 'blank', label: 'עמוד ריק', slots: [] },

  /* --- אחת ------------------------------------------------------------- */
  { id: 'full', label: 'מלא עד הקצה', slots: [{ x: 0, y: 0, w: 1, h: 1 }], bleed: true },
  { id: 'one', label: 'אחת', slots: [{ x: M, y: M, w: 1 - 2 * M, h: 1 - 2 * M }] },
  {
    id: 'one-air',
    label: 'אחת עם אוויר',
    slots: [{ x: 0.16, y: 0.13, w: 0.68, h: 0.6 }],
  },
  {
    id: 'one-band',
    label: 'רצועה רחבה',
    slots: [{ x: 0, y: 0.26, w: 1, h: 0.48 }],
    bleed: true,
  },

  /* --- שתיים ----------------------------------------------------------- */
  {
    id: 'two-side',
    label: 'שתיים זו לצד זו',
    slots: [
      { x: M, y: M, w: (1 - 2 * M - G) / 2, h: 1 - 2 * M },
      { x: M + (1 - 2 * M - G) / 2 + G, y: M, w: (1 - 2 * M - G) / 2, h: 1 - 2 * M },
    ],
  },
  {
    id: 'two-stack',
    label: 'שתיים זו על זו',
    slots: [
      { x: M, y: M, w: 1 - 2 * M, h: (1 - 2 * M - G) / 2 },
      { x: M, y: M + (1 - 2 * M - G) / 2 + G, w: 1 - 2 * M, h: (1 - 2 * M - G) / 2 },
    ],
  },
  {
    id: 'two-bleed',
    label: 'שתיים עד הקצה',
    slots: [
      { x: 0, y: 0, w: 1, h: 0.5 - G / 2 },
      { x: 0, y: 0.5 + G / 2, w: 1, h: 0.5 - G / 2 },
    ],
    bleed: true,
  },

  /* --- שלוש ------------------------------------------------------------ */
  {
    id: 'three-row',
    label: 'שלוש בשורה',
    slots: [
      { x: M, y: 0.28, w: (1 - 2 * M - 2 * G) / 3, h: 0.44 },
      { x: M + (1 - 2 * M - 2 * G) / 3 + G, y: 0.28, w: (1 - 2 * M - 2 * G) / 3, h: 0.44 },
      {
        x: M + 2 * ((1 - 2 * M - 2 * G) / 3 + G),
        y: 0.28,
        w: (1 - 2 * M - 2 * G) / 3,
        h: 0.44,
      },
    ],
  },
  {
    id: 'three-hero',
    label: 'גיבור ושתיים',
    slots: [
      { x: M, y: M, w: 0.52, h: 1 - 2 * M },
      { x: M + 0.52 + G, y: M, w: 1 - 2 * M - 0.52 - G, h: (1 - 2 * M - G) / 2 },
      {
        x: M + 0.52 + G,
        y: M + (1 - 2 * M - G) / 2 + G,
        w: 1 - 2 * M - 0.52 - G,
        h: (1 - 2 * M - G) / 2,
      },
    ],
  },
  {
    id: 'three-hero-flip',
    label: 'שתיים וגיבור',
    slots: [
      { x: M, y: M, w: 1 - 2 * M - 0.52 - G, h: (1 - 2 * M - G) / 2 },
      {
        x: M,
        y: M + (1 - 2 * M - G) / 2 + G,
        w: 1 - 2 * M - 0.52 - G,
        h: (1 - 2 * M - G) / 2,
      },
      { x: 1 - M - 0.52, y: M, w: 0.52, h: 1 - 2 * M },
    ],
  },

  /* --- ארבע ------------------------------------------------------------ */
  {
    id: 'four-grid',
    label: 'ארבע ברשת',
    slots: [
      { x: M, y: M, w: (1 - 2 * M - G) / 2, h: (1 - 2 * M - G) / 2 },
      { x: M + (1 - 2 * M - G) / 2 + G, y: M, w: (1 - 2 * M - G) / 2, h: (1 - 2 * M - G) / 2 },
      {
        x: M,
        y: M + (1 - 2 * M - G) / 2 + G,
        w: (1 - 2 * M - G) / 2,
        h: (1 - 2 * M - G) / 2,
      },
      {
        x: M + (1 - 2 * M - G) / 2 + G,
        y: M + (1 - 2 * M - G) / 2 + G,
        w: (1 - 2 * M - G) / 2,
        h: (1 - 2 * M - G) / 2,
      },
    ],
  },
  {
    id: 'four-strip',
    label: 'ארבע ברצועה',
    slots: [
      { x: M, y: 0.33, w: (1 - 2 * M - 3 * G) / 4, h: 0.34 },
      { x: M + ((1 - 2 * M - 3 * G) / 4 + G), y: 0.33, w: (1 - 2 * M - 3 * G) / 4, h: 0.34 },
      {
        x: M + 2 * ((1 - 2 * M - 3 * G) / 4 + G),
        y: 0.33,
        w: (1 - 2 * M - 3 * G) / 4,
        h: 0.34,
      },
      {
        x: M + 3 * ((1 - 2 * M - 3 * G) / 4 + G),
        y: 0.33,
        w: (1 - 2 * M - 3 * G) / 4,
        h: 0.34,
      },
    ],
  },
];

export const DEFAULT_TEMPLATE = 'one';

export function templateById(id: string): PageTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE)!;
}

/** תבניות מקובצות לפי מספר תמונות — כך הצלם מחפש אותן בפועל:
 *  "יש לי שלוש תמונות לכפולה הזאת". */
export function templatesByCount(): { count: number; items: PageTemplate[] }[] {
  const by = new Map<number, PageTemplate[]>();
  for (const t of TEMPLATES) {
    const arr = by.get(t.slots.length) ?? [];
    arr.push(t);
    by.set(t.slots.length, arr);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([count, items]) => ({ count, items }));
}
