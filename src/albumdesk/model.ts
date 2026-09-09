/* שולחן האלבום — המודל.
 *
 * כלי אלבום שלישי, נבנה מאפס. הוא לא חולק קוד עם `src/album/*` בכוונה:
 * שם יש עבודה פתוחה, וכאן המודל הפוך — הצלם מניח, המכונה לא מחליטה.
 *
 * שלוש החלטות שמסבירות את כל מה שלמטה:
 *
 *   1. אלבום שייך לפרויקט. אין "ספריית אלבומים" ואין בחירת תמונות מהעולם:
 *      התמונות היחידות שקיימות כאן הן של הלקוח הזה.
 *
 *   2. המקבץ הוא היחידה. "ליד הרכבת" ו"על רקע ההרים" הם שני רגעים, ומי
 *      שמרכיב כפולה עובד בתוך רגע אחד. לכן המגש מסודר לפי מקבץ ולא לפי
 *      סדר צילום — וכשמחליפים תמונה, המחליפה באה מאותו מקבץ ולכן הכפולה
 *      לא נשברת.
 *
 *   3. תמונה מזוהה בשם הקובץ, לא בנתיב. project.json נוסע עם התיקייה
 *      ואות כונן אינה זהות — אותו כלל שכבר קיים ב-perFrame.
 */

import { type AlbumSpec, DEFAULT_SPEC, normalizeSpec } from './spec';

/** איך התמונה יושבת בתוך המשבצת.
 *
 *  זו הפעולה שנעשית הכי הרבה פעמים באלבום שלם: כל תמונה נוחתת לא נכון —
 *  ראש גבוה מדי, יד נחתכת — ומזיזים אותה בתוך המסגרת. לכן זה נשמר על
 *  ההנחה עצמה ולא נגזר מחדש בכל רינדור.
 *
 *  `fx`/`fy` הם נקודת המיקוד באחוזים (50/50 = מרכז). הזום מתבצע *סביב*
 *  הנקודה הזאת, כך שמה שכיוונת אליו נשאר במקום כשמקרבים. */
export interface Placement {
  /** שם הקובץ — הזהות. */
  frame: string;
  /** הנתיב להצגה עכשיו. נגזר מחדש בכל טעינה, לא סומכים עליו כזהות. */
  path: string;
  /** 1 = ממלא את המשבצת. עד 3. */
  zoom: number;
  fx: number;
  fy: number;
}

/** עמוד אחד. חצי כפולה. */
export interface Page {
  templateId: string;
  /** באורך של מספר המשבצות בתבנית. null = משבצת ריקה. */
  slots: (Placement | null)[];
}

/** כפולה — שני עמודים שנקראים יחד.
 *
 *  בכריכה עברית הספר נפתח מימין, ולכן `first` הוא העמוד הימני והוא הנקרא
 *  ראשון. השמות כאן הם לפי סדר קריאה ולא לפי צד מסך, כדי שהיפוך כיוון
 *  כריכה בעתיד לא ידרוש להחליף שדות. */
export interface Spread {
  id: string;
  first: Page;
  second: Page;
}

export interface AlbumDoc {
  projectId: string;
  /** מה נמכר ללקוח: גודל, חריגה, תחום שקט, חריץ, מספר עמודים.
   *  נקבע לפני שמניחים תמונה — הכפולה על המסך נגזרת ממנו. */
  spec: AlbumSpec;
  spreads: Spread[];
}

export type PageSide = 'first' | 'second';

/** מיקום מדויק של משבצת בתוך המסמך. */
export interface SlotRef {
  spread: number;
  side: PageSide;
  slot: number;
}

export function samePlace(a: SlotRef | null, b: SlotRef | null): boolean {
  if (!a || !b) return false;
  return a.spread === b.spread && a.side === b.side && a.slot === b.slot;
}

/** הנחה חדשה, במרכז ובלי זום — הנקודה שממנה מתחילים לכוונן. */
export function place(frame: string, path: string): Placement {
  return { frame, path, zoom: 1, fx: 50, fy: 50 };
}

export function emptyPage(templateId: string, slots: number): Page {
  return { templateId, slots: Array<Placement | null>(slots).fill(null) };
}

let seq = 0;
export function newSpreadId(): string {
  seq += 1;
  return `sp-${Date.now().toString(36)}-${seq}`;
}

/* --------------------------------------------------------------- persistence
 *
 * מצב הפרויקטים עדיין יושב ב-localStorage בכל המוצר, ולכן גם כאן. המפתח
 * כולל את מזהה הפרויקט: אלבום של לקוח אחד לא ייפתח אצל אחר.
 *
 * קריאה שנכשלת מחזירה null — לא מסמך ריק. ריק ולא-נקרא הם שני דברים,
 * והמסך חייב להבדיל ביניהם. */

const KEY = (projectId: string) => `albumdesk:${projectId}`;

export function loadDoc(projectId: string): AlbumDoc | null {
  try {
    const raw = localStorage.getItem(KEY(projectId));
    if (!raw) return null;
    const doc = JSON.parse(raw) as AlbumDoc;
    if (!doc || !Array.isArray(doc.spreads)) return null;
    /* מסמך שנשמר לפני שהמפרט היה קיים אינו פגום — הוא פשוט ישן.
     * נותנים לו את ברירת המחדל במקום להחזיר null ולמחוק לצלם אלבום. */
    doc.spec = normalizeSpec(doc.spec ?? DEFAULT_SPEC);
    return doc;
  } catch {
    return null;
  }
}

export function saveDoc(doc: AlbumDoc): void {
  try {
    localStorage.setItem(KEY(doc.projectId), JSON.stringify(doc));
  } catch {
    /* מכסת האחסון מלאה. לא מפילים את המסך על זה. */
  }
}

/** כל שמות הקבצים שכבר מונחים איפשהו באלבום.
 *
 *  זה הכאב מספר אחת בהרכבת אלבום: בלי זה שמים את אותה תמונה פעמיים
 *  ומגלים בדפוס. */
export function usedFrames(doc: AlbumDoc): Set<string> {
  const used = new Set<string>();
  for (const sp of doc.spreads) {
    for (const page of [sp.first, sp.second]) {
      for (const s of page.slots) if (s) used.add(s.frame);
    }
  }
  return used;
}

/** באיזו כפולה יושבת תמונה — לצורך "כבר בשימוש, כפולה 5". 1-based. */
export function whereUsed(doc: AlbumDoc, frame: string): number | null {
  for (let i = 0; i < doc.spreads.length; i += 1) {
    const sp = doc.spreads[i];
    for (const page of [sp.first, sp.second]) {
      for (const s of page.slots) if (s && s.frame === frame) return i + 1;
    }
  }
  return null;
}
