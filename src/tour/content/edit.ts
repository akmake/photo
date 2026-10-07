import type { Tour } from '../types';

/** שלב 5 · עריכה — the gallery editor: sessions, slides, canvas, tools, and
 *  the way one photograph's edit reaches the rest of its session. */
export const EDIT: Tour = {
  id: 'gallery-edit',
  screen: 'gallery-edit',
  title: 'עריכה',
  steps: [
    {
      id: 'idea',
      target: 'edit-canvas',
      title: 'עורכים אחת, מקבלים סשן',
      body:
        'הדרך המהירה: עורכים תמונה אחת עד שהיא נראית בדיוק כמו שצריך, ואז מחילים את העריכה על כל הסשן שלה.\n\n' +
        'כל תמונה עדיין יכולה לקבל תיקון משלה — ריטוש, ניקוי, הסרת עצם — בלי לקלקל את השאר.',
    },
    {
      id: 'sessions',
      target: 'edit-sessions',
      title: 'על מה עובדים',
      body:
        'בוחרים סשן — רק התמונות שלו מוצגות, והעריכה שתחיל תגיע רק אליהן. ✓ ליד סשן — כבר יש לו צבע.\n\n' +
        'אחרי שהלקוח סיים לבחור, מוצגות כאן רק התמונות שבחר.',
      placement: 'bottom',
    },
    {
      id: 'choice',
      target: 'edit-choice-toggle',
      optional: true,
      title: 'רק מה שהלקוח בחר',
      body: 'הלקוח סיים לבחור, אז רואים רק את הבחירה שלו. הכפתור מציג גם את מה שלא נבחר — ולהפך.',
      placement: 'bottom',
    },
    {
      id: 'slides',
      target: 'edit-slides',
      title: 'התמונות',
      body:
        'לחיצה בוחרת תמונה לעריכה. "מותאם" — לתמונה יש עריכה משלה. ✓ — סימנת אותה כגמורה.\n\n' +
        'חיצי המקלדת למעלה ולמטה עוברים בין התמונות.',
      placement: 'side',
    },
    {
      id: 'canvas',
      target: 'edit-zoom',
      title: 'להסתכל מקרוב',
      body:
        'גלגלת העכבר על התמונה מגדילה; כשמוגדל — גוררים כדי לזוז. לחיצה כפולה קופצת בין התאמה למסך להגדלה פי 2.',
      placement: 'top',
    },
    {
      id: 'original',
      target: 'edit-original',
      title: 'לפני ואחרי',
      body: 'לוחצים ומחזיקים (או מקש רווח) — רואים את התמונה המקורית. משחררים — חוזרים לעריכה.',
      placement: 'bottom',
    },
    {
      id: 'comments',
      target: 'edit-comments',
      optional: true,
      title: 'הלקוח ביקש משהו כאן',
      body: 'הערות של הלקוח על התמונה הזו. הנקודות הממוספרות על התמונה מראות בדיוק איפה — מעבר עם העכבר מציג את ההערה.',
      placement: 'bottom',
    },
    {
      id: 'panel',
      target: 'edit-panel-tabs',
      title: 'שני סוגי עריכה',
      body:
        '"כלים ראשוניים" — כל הכלים, ביד: אור, צבע, ריטוש, סגנון.\n' +
        '"ColorMatch" — מלמדים את התוכנה את הצבע שלך מתמונה אחת שערכת במקום אחר, והיא מחילה אותו על השאר.',
      placement: 'side',
    },
    {
      id: 'tool-tabs',
      target: 'edit-tool-tabs',
      optional: true,
      title: 'הכלים, לפי סדר העבודה',
      body:
        'ריטוש · אור וצבע · סצנה · סגנון — באותו סדר שבו התוכנה מפעילה אותם. מספר על לשונית — כמה כלים פועלים בה עכשיו.',
      placement: 'side',
    },
    {
      id: 'tools',
      target: 'edit-tools',
      optional: true,
      title: 'כל כלי',
      body:
        'לחיצה על שם הכלי פותחת אותו, ושם כתוב מה הוא עושה ומתי משתמשים בו. מעבר עם העכבר על שם של מחוון מסביר אותו.\n\n' +
        'המתג מדליק ומכבה; ↺ מחזיר לברירת המחדל; נקודה — הכלי שונה בתמונה הזו. לחיצה כפולה על מחוון מאפסת אותו.\n\n' +
        '"על מה זה חל" — מגביל כלי לאנשים, לרקע, לעור, לשיער, לבגדים, או לאזור שתצבע ביד.',
      placement: 'side',
    },
    {
      id: 'apply',
      target: 'edit-apply-set',
      optional: true,
      title: 'מחילים על כל הסשן',
      body:
        'העריכה של התמונה הזו עוברת לכל התמונות שבכפתור — הסשן, או כל הפרויקט.\n\n' +
        'מה שצבעת ביד נשאר רק על התמונה הזו: ציור יד לא מתאים לתמונה אחרת.',
      placement: 'top',
    },
    {
      id: 'reset',
      target: 'edit-reset',
      optional: true,
      title: 'התחלה מחדש',
      body: 'מוחק את העריכה הפרטית של התמונה הזו. היא חוזרת לעריכה של הסשן שלה.',
      placement: 'top',
    },
    {
      id: 'object',
      target: 'edit-object',
      optional: true,
      title: 'הסרת עצם',
      body:
        'לוחצים על עצם בתמונה, או גוררים מלבן סביבו — המלבן תופס את כולו גם כשהוא צמוד למשהו אחר. בודקים את הבחירה, ו"הסר אובייקט".',
      placement: 'bottom',
    },
    {
      id: 'done',
      target: 'edit-done',
      optional: true,
      title: 'סיימתי',
      body:
        'מסמן את התמונה כגמורה, שומר אותה לאלבום, ועובר לבאה שלא הסתיימה (Ctrl+Enter).\n\n' +
        'אם יש ללקוח גלריה — הגרסה הערוכה נשלחת אליו, והערות שלו על התמונה נסגרות.',
      placement: 'bottom',
    },
    {
      id: 'save',
      target: 'edit-save',
      title: 'נשמר לבד',
      body: 'כל שינוי נשמר בתיקיית הפרויקט ברגע שהוא נעשה. אם שמירה נכשלת — זה כתוב כאן, עם כפתור לנסות שוב.',
      placement: 'bottom',
    },
    {
      id: 'review',
      target: 'edit-review',
      title: 'הסט הערוך',
      body: 'כל התמונות כמו שהן יימסרו, אחת אחרי השנייה — לבדוק שהסט כולו גמור ואחיד לפני ששולחים.',
      placement: 'bottom',
    },
    {
      id: 'export',
      target: 'edit-export',
      title: 'ייצוא',
      body: 'כותב את התמונות הערוכות לתיקייה במחשב, בגודל ובפורמט שתבחר. המקורות לא נוגעים.',
      placement: 'bottom',
    },
    {
      id: 'next',
      target: 'edit-next',
      optional: true,
      title: 'לאלבום',
      body: 'התמונות שסימנת "סיימתי" מחכות שם.',
      placement: 'bottom',
    },
  ],
};

/** ColorMatch — learning a colour from a before/after pair. */
export const EDIT_COLORMATCH: Tour = {
  id: 'colormatch',
  screen: 'gallery-edit',
  trigger: 'colormatch-panel',
  title: 'ColorMatch',
  steps: [
    {
      id: 'idea',
      target: 'colormatch-panel',
      title: 'הצבע שלך, על כל הסט',
      body:
        'ערכת תמונה אחת במקום אחר — בלייטרום, בפוטושופ? התוכנה לומדת ממנה את הצבע שלך ומחילה אותו על שאר התמונות.\n\n' +
        'צריך שתיים: אותה תמונה לפני העריכה ואחריה.',
      placement: 'side',
    },
    {
      id: 'looks',
      target: 'cm-looks',
      optional: true,
      title: 'צבעים שמורים',
      body: 'צבעים שלימדת בעבר. "החל" — על התמונות שכאן, בכל פרויקט. ✕ — מוחק את הצבע; תמונות שכבר קיבלו אותו לא משתנות.',
      placement: 'side',
    },
    {
      id: 'before',
      target: 'cm-before',
      title: '1 · לפני',
      body: 'התמונה כמו שיצאה מהמצלמה — זו שפתוחה עכשיו. ערכת אחרת? "בחר תמונה אחרת".',
      placement: 'side',
    },
    {
      id: 'after',
      target: 'cm-after',
      title: '2 · אחרי',
      body: 'גוררים לכאן את הקובץ הערוך (JPG או PNG), או לוחצים ובוחרים מהמחשב.',
      placement: 'side',
    },
    {
      id: 'learn',
      target: 'cm-actions',
      title: 'לומדים, בודקים, מחילים',
      body:
        '"למד את הצבע" — התוכנה לומדת ומראה מה יצא, על התמונה הזו בלבד. רק אחרי שראית — "החל על כל התמונות".',
      placement: 'top',
    },
    {
      id: 'result',
      target: 'cm-result',
      optional: true,
      title: 'כמה זה קרוב',
      body:
        'שתי תמונות זו לצד זו: מה שהתוכנה עשתה, ומה שביקשת. האחוז אומר כמה מהדרך לצבע שלך היא עשתה — 70% ומעלה זו התאמה טובה.\n\n' +
        '"שמור את הצבע הזה" — והוא זמין בכל פרויקט.',
      placement: 'side',
    },
  ],
};

/** הסט הערוך — the whole set as it will be delivered. */
export const EDIT_REVIEW: Tour = {
  id: 'edit-review',
  screen: 'gallery-edit',
  trigger: 'edit-review-view',
  title: 'הסט הערוך',
  steps: [
    {
      id: 'count',
      target: 'review-count',
      title: 'כמה גמור',
      body: 'כמה תמונות סימנת כגמורות מתוך כל הסט.',
      placement: 'bottom',
    },
    {
      id: 'filters',
      target: 'review-filters',
      title: 'מה רואים',
      body: 'הכול · עוד לא הסתיימו · הסתיימו. "רשת" (G) מציג את כל הסט בבת אחת — הדרך לראות שהוא אחיד.',
      placement: 'bottom',
    },
    {
      id: 'actions',
      target: 'review-actions',
      optional: true,
      title: 'ההחלטות',
      body:
        '"לפני" (רווח) — התמונה בלי העריכה. "ערוך את התמונה" (E) — חוזר לעורך עליה. "סיימתי" (Enter) — מסמן כגמורה.',
      placement: 'bottom',
    },
    {
      id: 'strip',
      target: 'review-strip',
      optional: true,
      title: 'כל הסט',
      body: 'הפס למטה — כל התמונות. חצים — הבאה והקודמת. Esc — חזרה לעריכה.',
      placement: 'top',
    },
  ],
};

/** ייצוא תמונות. */
export const EDIT_EXPORT: Tour = {
  id: 'edit-export',
  screen: 'gallery-edit',
  trigger: 'edit-export-view',
  title: 'ייצוא',
  steps: [
    {
      id: 'size',
      target: 'export-size',
      title: 'גודל',
      body:
        'גודל מלא — לדפוס. איכות גבוהה — לאלבומים. רשת — לאתר ולגלריה. מהיר — לשליחה. גודל קטן גם יוצא מהר יותר.',
    },
    {
      id: 'format',
      target: 'export-format',
      title: 'פורמט',
      body: 'JPEG — הרגיל, ואיכות 88% מספיקה לרשת, 97% לדפוס. PNG ו-TIFF — בלי אובדן איכות, קבצים גדולים.',
    },
    {
      id: 'where',
      target: 'export-where',
      title: 'לאן',
      body: 'בוחרים תיקייה. התוכנה לא תיתן לייצא לתוך תיקיית המקורות — זה היה דורס אותם.',
    },
  ],
};
