import type { Tour } from '../types';

/** The quick editor (PhotoEditor) — opened with "ערוך" from the viewer in
 *  סינון. Laid out like the Windows Photos editor; every change it makes is
 *  the same edit the editing stage shows. Only the open tab's panel is on
 *  screen, so each tab's step is a situation. */
export const PHOTO_EDITOR: Tour = {
  id: 'photo-editor',
  screen: 'work',
  trigger: 'photo-editor',
  title: 'עריכה מהירה',
  steps: [
    {
      id: 'tabs',
      target: 'pe-tabs',
      title: 'שבעה כלים, כמו בעורך של Windows',
      body:
        'חיתוך · התאמה · סנן · סימון · מחק · הסרת אובייקט · רקע. מקשי 1 עד 7 עוברים ביניהם.\n\n' +
        'זו אותה עריכה כמו בשלב העריכה — מה שתעשה כאן יופיע גם שם, ובייצוא.',
      placement: 'bottom',
    },
    {
      id: 'crop',
      target: 'pe-crop',
      optional: true,
      title: 'חיתוך',
      body:
        'גוררים את המסגרת על התמונה. הגלגל — יישור האופק (לחיצה כפולה מאפסת). החצים המעוגלים מסובבים ברבעים, והכפתורים בצד הופכים.\n\n' +
        'היחס — חופשי, מקורי, ריבוע, 4:5, 2:3 ועוד — נועל את צורת המסגרת.',
      placement: 'top',
    },
    {
      id: 'adjust',
      target: 'pe-panel-adjust',
      optional: true,
      title: 'התאמה',
      body:
        'בהירות, חשיפה, ניגודיות, בהירים, צללים, וינייטה — וצבע: רוויה, חום, גוון, חדות. לחיצה כפולה על מחוון מאפסת אותו.\n\n' +
        '"לפני" על התמונה — לוחצים ומחזיקים כדי להשוות.',
      placement: 'side',
    },
    {
      id: 'filter',
      target: 'pe-panel-filter',
      optional: true,
      title: 'סנן',
      body:
        '"שיפור אוטומטי" — התוכנה מתקנת אור וצבע בעצמה. מתחתיו — סננים מוכנים, כל אחד מוצג על התמונה שלך. אחרי שבחרת סנן, "עוצמת הסנן" קובע כמה ממנו.',
      placement: 'side',
    },
    {
      id: 'markup',
      target: 'pe-panel-markup',
      optional: true,
      title: 'סימון',
      body: 'ציור על התמונה: עט, מדגש, או מחק לסימון. צבע ועובי. "בטל אחרון" ו"נקה הכל".',
      placement: 'side',
    },
    {
      id: 'erase',
      target: 'pe-panel-erase',
      optional: true,
      title: 'מחק',
      body:
        'צובעים על מה שצריך לצאת — כתם, חוט, אדם ברקע — והתוכנה בונה מחדש את מה שמתחת. "הסרת סימון" — לחיצה על סימון מבטלת אותו.',
      placement: 'side',
    },
    {
      id: 'object',
      target: 'pe-panel-object',
      optional: true,
      title: 'הסרת אובייקט',
      body:
        '"מברשת הסרה" — מורחים על העצם ומסירים. "בחירה בלחיצה" — לוחצים עליו, ומתקנים את הבחירה ב"הוסף למסכה" / "החסר מהמסכה", ואז "הסר".\n\n' +
        'כל הסרה נשמרת מיד ומופיעה ברשימה; × מחזיר אותה.',
      placement: 'side',
    },
    {
      id: 'background',
      target: 'pe-panel-background',
      optional: true,
      title: 'רקע',
      body:
        'טשטוש — הרקע רך והאנשים חדים. הסר — הרקע הופך ללבן. החלף — רקע בצבע שתבחר.\n\n' +
        'התוכנה טעתה בגבול? "כלי מברשת רקע": "הוסף לנושא" מחזיר חלק לאנשים, "העבר לרקע" מוציא.',
      placement: 'side',
    },
    {
      id: 'actions',
      target: 'pe-actions',
      title: 'שומרים',
      body:
        '"שמור" — העריכה נשמרת על התמונה. "ביטול" — יוצא בלי לשמור. "איפוס" — חוזר למצב שבו פתחת.\n\n' +
        '"החל על כל הסשן" — שומר, ונותן את העריכה לכל הסשן. חיתוך, סימון, מחיקה והסרת עצם נשארים רק על התמונה הזו.',
      placement: 'bottom',
    },
  ],
};
