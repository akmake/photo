import type { Tour } from '../types';

/** שלב 6 · אלבום — the library of a project's albums, and an open album seen
 *  whole. Both phases live on the same screen, so each one's steps are
 *  situations of the other. */
export const ALBUM: Tour = {
  id: 'album',
  screen: 'album-design',
  title: 'אלבום',
  steps: [
    /* ---- no album open: the library ---- */
    {
      id: 'new',
      target: 'album-new',
      optional: true,
      title: 'אלבום חדש',
      body:
        'נותנים שם, בוחרים גודל, ובוחרים מאיפה התמונות: הבחירה של הלקוח לכל אלבום שמכרת, כל תמונות הפרויקט, או בחירה ידנית.\n\n' +
        'האלבום נבנה מיד ונפתח כספר.',
      placement: 'bottom',
    },
    {
      id: 'cards',
      target: 'album-card',
      optional: true,
      title: 'האלבומים של הפרויקט',
      body: 'לחיצה פותחת אלבום. ••• — שינוי שם, שכפול, מחיקה. מחיקת אלבום לא נוגעת בתמונות של הפרויקט.',
    },

    /* ---- an album open, seen whole ---- */
    {
      id: 'overview',
      target: 'album-overview',
      optional: true,
      title: 'הספר כולו',
      body:
        'כל הכפולות של האלבום לפי הסדר, והכריכה ראשונה. כך רואים את כל הסיפור ומזיזים אותו, לפני שנכנסים לכפולה אחת.',
    },
    {
      id: 'cover',
      target: 'album-cover',
      optional: true,
      title: 'הכריכה',
      body:
        'גוררים תמונה מהפס אל הכריכה — לחזית או לגב. "עריכה" פותח את מעצב הכריכה.',
    },
    {
      id: 'spread',
      target: 'album-spread',
      optional: true,
      title: 'כפולה',
      body:
        '"עריכה" פותח אותה לעיצוב. ⋮⋮ — גוררים כדי לשנות סדר. ••• — פריסה אחרת, או מחיקה (התמונות חוזרות למאגר).\n\n' +
        'אם יש בכפולה בעיה לדפוס — היא כתובה בראש הכרטיס, ולחיצה פותחת אותה.',
    },
    {
      id: 'add',
      target: 'album-add-spread',
      optional: true,
      title: 'עוד כפולה',
      body: 'מוסיף כפולה ריקה בסוף. ממלאים אותה מהפס.',
    },
    {
      id: 'timeline',
      target: 'album-timeline',
      optional: true,
      title: 'רצף התמונות',
      body:
        'כל תמונות האלבום לפי הסדר; גרירה משנה סדר, ולחיצה על תמונה מביאה לכפולה שלה.\n\n' +
        'בין שתי תמונות — לחיצה מתחילה שם כפולה חדשה, או מאחדת שתי כפולות. גבול בין סשנים קבוע.\n\n' +
        '"+ תמונות" מוסיף. "לא שובצו" — תמונות באלבום שעוד אין להן מקום.',
      placement: 'side',
    },
    {
      id: 'autobuild',
      target: 'album-autobuild',
      optional: true,
      title: 'בנייה אוטומטית',
      body:
        'מסדר את כל התמונות על עמודי "הכספת" בבת אחת — במקום הכפולות שבנית. התוכנה שואלת לפני, ואפשר לבטל אחרי.',
      placement: 'bottom',
    },
    {
      id: 'resize',
      target: 'album-resize',
      optional: true,
      title: 'שינוי גודל',
      body:
        'אותו אלבום, גדול או קטן יותר — העיצוב כולו נשאר במקום.\n\n' +
        'לשנות צורה (מרובע, אופקי, אנכי) — יש לזה כפתור נפרד בפנים, שמראה קודם איך הכפולה שלך תיראה.',
      placement: 'bottom',
    },
    {
      id: 'undo',
      target: 'album-undo',
      optional: true,
      title: 'ביטול',
      body: 'כל פעולה באלבום אפשר לבטל (Ctrl+Z) ולהחזיר (Ctrl+Shift+Z).',
      placement: 'bottom',
    },
    {
      id: 'preflight',
      target: 'album-preflight',
      optional: true,
      title: 'בעיות לפני דפוס',
      body:
        'התוכנה בודקת את האלבום כל הזמן, כמו בית דפוס. מספר אדום — יש בעיות שמונעות ייצוא לדפוס. לחיצה פותחת את הרשימה, וכל בעיה מובילה למקום שלה.',
      placement: 'bottom',
    },
    {
      id: 'preview',
      target: 'album-preview',
      optional: true,
      title: 'תצוגה',
      body: 'מדפדפים בספר כמו שהלקוח יראה אותו.',
      placement: 'bottom',
    },
    {
      id: 'more',
      target: 'album-more',
      optional: true,
      title: 'עוד',
      body:
        'אזורי דפוס (G) — מסמן איפה הדף ייחתך. הגדרות אלבום — מידות ובית הדפוס. עיצוב הכריכה. בדיקת דפוס מלאה.',
      placement: 'bottom',
    },
    {
      id: 'share',
      target: 'album-share',
      optional: true,
      title: 'הגהה ומסירה',
      body: 'תצוגה מלאה, סבב אישור עם הלקוח, PDF להגהה, וחבילת דפוס.',
      placement: 'bottom',
    },
    {
      id: 'open',
      target: 'album-spread',
      waitFor: 'album-canvas',
      optional: true,
      title: 'נכנסים לכפולה',
      body: 'כדי לעצב כפולה אחת — פותחים אותה.',
      doText: 'לחץ "עריכה" על אחת הכפולות',
    },
  ],
};

/** One spread, open for design. Plays the first time a spread is opened. */
export const ALBUM_DESIGN: Tour = {
  id: 'album-design',
  screen: 'album-design',
  trigger: 'album-canvas',
  title: 'עיצוב כפולה',
  steps: [
    {
      id: 'canvas',
      target: 'album-canvas',
      title: 'הכפולה',
      body:
        'לחיצה על תמונה בוחרת אותה, ולמעלה מופיעים הכלים שלה. גרירה מזיזה מסגרת, והפינות משנות את הגודל. קווי עזר מופיעים כשמשהו מתיישר עם משהו אחר.\n\n' +
        'לחיצה כפולה על תמונה — קובעים איזה חלק ממנה נראה במסגרת. לחיצה על הרקע מבטלת את הבחירה.',
    },
    {
      id: 'panel',
      target: 'album-panel',
      title: 'הפאנל בצד',
      body:
        'עיצוב — תבניות ופריסות. אלמנטים — צורות וקישוטים. טקסט. רקע — צבע הכפולה. מותג — צבעים וגופנים. העלאות — התמונות והקבצים שלך. ציור. עמודים. כלים חכמים.\n\n' +
        'לחיצה על לשונית פותחת אותה; לחיצה נוספת סוגרת, והכפולה מקבלת את כל המסך.',
      placement: 'side',
    },
    {
      id: 'nav',
      target: 'album-designer-nav',
      optional: true,
      title: 'בין הכפולות',
      body: 'הכפולה הקודמת והבאה, בלי לצאת מהעיצוב.',
      placement: 'bottom',
    },
    {
      id: 'strip',
      target: 'album-page-strip',
      title: 'כל העמודים',
      body: 'הפס למטה — כל הכפולות. לחיצה עוברת לכפולה, ו-＋ מוסיף כפולה.',
      placement: 'top',
    },
  ],
};

/** The bar that appears when a photograph is selected on a spread. */
export const ALBUM_PHOTO: Tour = {
  id: 'album-photo',
  screen: 'album-design',
  trigger: 'album-toolbar-photo',
  title: 'תמונה בכפולה',
  steps: [
    {
      id: 'bar',
      target: 'album-toolbar-photo',
      title: 'הכלים של התמונה',
      body:
        'התאמה למקום — חכם, מילוי (התמונה ממלאת את המסגרת) או מלא (כל התמונה נראית). זום — מגדיל בתוך המסגרת; אפשר גם פשוט לגרור את התמונה בתוכה.\n\n' +
        'עריכת תמונה — פילטרים, התאמות, ו"סטודיו קסם": מחיקה, הסרת רקע ושיפור. מיקום בתוך המסגרת · מיקום וגודל · מעבר ושקיפות (נמוג לרקע או מתמזג לתמונה הסמוכה) · סיבוב והיפוך · פינות, מסגרת וצל · סדר (קדימה ואחורה).\n\n' +
        'בקצה: הוצאת התמונה מהמקום, שכפול המקום, ומחיקתו.',
      placement: 'bottom',
    },
  ],
};

/** The bar that appears when a text is selected. */
export const ALBUM_TEXT: Tour = {
  id: 'album-text',
  screen: 'album-design',
  trigger: 'album-toolbar-text',
  title: 'טקסט',
  steps: [
    {
      id: 'bar',
      target: 'album-toolbar-text',
      title: 'הכלים של הטקסט',
      body:
        'גופן וגודל, מודגש, נטוי, קו תחתון וקו חוצה, שינוי אותיות. בתפריטים: ריווח, אפקטים, צבע, שקיפות וסיבוב.\n\n' +
        'לחיצה כפולה על הטקסט בכפולה — עורכים את המילים עצמן.',
      placement: 'bottom',
    },
  ],
};

/** The bar that appears when a shape or decoration is selected. */
export const ALBUM_ELEMENT: Tour = {
  id: 'album-element',
  screen: 'album-design',
  trigger: 'album-toolbar-element',
  title: 'אלמנט',
  steps: [
    {
      id: 'bar',
      target: 'album-toolbar-element',
      title: 'הכלים של האלמנט',
      body: 'צבע, קו ומילוי, שקיפות, סיבוב. בקצה — שכפול ומחיקה. קישוט ששייך לעיצוב אפשר להחזיר לצבע של העיצוב.',
      placement: 'bottom',
    },
  ],
};

/** Placing a photograph inside its frame. */
export const ALBUM_CROP: Tour = {
  id: 'album-crop',
  screen: 'album-design',
  trigger: 'album-crop',
  title: 'חיתוך בתוך המסגרת',
  steps: [
    {
      id: 'crop',
      target: 'album-crop',
      title: 'איזה חלק מהתמונה נראה',
      body:
        'חיתוך — התמונה ממלאת את המסגרת. הרחב — רואים את כולה. חיתוך חכם — התוכנה מציעה חיתוך בעצמה.\n\n' +
        'זום, וגרירה של התמונה בתוך המסגרת. "איפוס" חוזר להתחלה, "סיום" סוגר.',
      placement: 'side',
    },
  ],
};

/** אלבום חדש — the create dialog. */
export const ALBUM_CREATE: Tour = {
  id: 'album-create',
  screen: 'album-design',
  trigger: 'album-create',
  title: 'אלבום חדש',
  steps: [
    {
      id: 'source',
      target: 'album-create-source',
      title: 'מאיפה התמונות',
      body:
        'אם הלקוח כבר בחר בגלריה — כל אלבום שמכרת מופיע כאן עם התמונות שבחר אליו. אחרת: כל תמונות הפרויקט, או "אבחר בעצמי".',
      placement: 'side',
    },
  ],
};

/** הגהה ומסירה. */
export const ALBUM_DELIVERY: Tour = {
  id: 'album-delivery',
  screen: 'album-design',
  trigger: 'album-delivery',
  title: 'הגהה ומסירה',
  steps: [
    {
      id: 'cards',
      target: 'album-delivery',
      title: 'מה עושים עם אלבום גמור',
      body:
        'בדיקת דפוס — רשימת כל מה שצריך לתקן לפני הדפסה.\n' +
        'תצוגה מלאה — דפדוף בספר כמו הלקוח.\n' +
        'שליחה לאישור — סבב הערות ואישור, לפי גרסאות.\n' +
        'הגהה ללקוח — קובץ PDF אחד: הכריכה וכל הכפולות.\n' +
        'חבילת דפוס — קבצים מלאים לבית הדפוס. נפתחת רק כשאין בעיות שחוסמות, ואחרי שאימתת את הנתונים מול בית הדפוס.',
    },
  ],
};

/** בדיקת דפוס מלאה. */
export const ALBUM_PREFLIGHT: Tour = {
  id: 'album-preflight-view',
  screen: 'album-design',
  trigger: 'album-preflight-view',
  title: 'בדיקת דפוס',
  steps: [
    {
      id: 'list',
      target: 'album-preflight-view',
      title: 'לפני שהאלבום יוצא לדפוס',
      body:
        'חוסמות יצוא — חייבים לתקן לפני חבילת דפוס. דורשות בדיקה — כדאי להסתכל. מידע — לידיעה.\n\n' +
        'לחיצה על שורה לוקחת ישר למקום הבעיה. "חזרה לעורך" — חוזרים לעבוד.',
    },
  ],
};

/** אישור אלבום — review rounds by version. */
export const ALBUM_REVIEW: Tour = {
  id: 'album-review-view',
  screen: 'album-design',
  trigger: 'album-review',
  title: 'אישור אלבום',
  steps: [
    {
      id: 'rounds',
      target: 'album-review',
      title: 'סבבי אישור',
      body:
        'כל סבב הוא גרסה של העיצוב. לכל כפולה (וגם לכריכה) רושמים הערות, ואישור אפשרי רק כשאין הערות פתוחות. "גרסה חדשה מהעיצוב הנוכחי" — פותח סבב אחרי תיקונים.\n\n' +
        'כרגע הסבבים נשמרים אצלך במחשב; קישור לאישור אצל הלקוח עוד לא פעיל.',
    },
  ],
};
