import type { Tour } from '../types';

/** שלב 3 · סינון — what stays and what goes, before the client sees anything. */
export const WORK: Tour = {
  id: 'work',
  screen: 'work',
  title: 'סינון',
  steps: [
    {
      id: 'what',
      target: 'work-title',
      title: 'מה נשאר ומה יוצא',
      body:
        'כאן עוברים על כל הצילום ומחליטים על כל תמונה: שמור, מתלבט או הסר.\n\n' +
        '"הסר" לא מוחק שום קובץ — הוא רק מוציא את התמונה מהסט, ואפשר להחזיר אותה בכל רגע. מה שלא הוסר ממשיך לשלב הבא: שליחה ללקוח.',
      placement: 'bottom',
    },
    {
      id: 'feed',
      target: 'work-feed',
      title: 'מחליטים על תמונה',
      body:
        'מעבר עם העכבר על תמונה מציג למטה שלושה כפתורים: ✓ שמור, ? מתלבט, ✕ הסר.\n\n' +
        'מהר יותר עם המקלדת: חצים לתמונה הבאה, K שמור, M מתלבט, X הסר, U מבטל החלטה. Ctrl+Z מבטל את הפעולה האחרונה.',
    },
    {
      id: 'many',
      target: 'work-feed',
      title: 'כמה תמונות בבת אחת',
      body:
        'Ctrl + לחיצה מוסיף תמונה לבחירה, Shift + לחיצה בוחר את כל מה שבין שתיים. החלטה אחת חלה אז על כולן.',
    },
    {
      id: 'flag',
      target: 'work-flag',
      optional: true,
      title: 'הצעה של התוכנה',
      body:
        'התוכנה מציעה להסיר תמונה רק כשיש לה תאומה — אותה תנוחה, שצולמה שוב וטובה יותר: עיניים עצומות, פחות חדה, שרופה או חשוכה.\n\n' +
        '! — מוצע להסיר. ≈ — כמעט זהה לאחרת. לחיצה על הסימן מביאה אותך לתאומה.\n\n' +
        'זו רק הצעה. ההחלטה שלך, וניתוח חדש לעולם לא ידרוס אותה.',
    },
    {
      id: 'stack',
      target: 'work-stack',
      optional: true,
      title: 'רצף',
      body:
        'כמה תמונות כמעט זהות מאותו רגע, מקובצות לערימה אחת כדי שהגלריה לא תתמלא באותה תמונה. לחיצה פותחת את הרצף להשוואה ובחירה.',
    },
    {
      id: 'star',
      target: 'work-star',
      optional: true,
      title: 'המומלצת',
      body: 'הכוכב מסמן את התמונה שהתוכנה ממליצה עליה מתוך הרצף שלה.',
    },
    {
      id: 'analyzing',
      target: 'work-analyzing',
      optional: true,
      title: 'התוכנה בודקת ברקע',
      body:
        'התמונות עוברות בדיקה (עיניים, חדות, חשיפה, תאומות). אפשר לעבוד בינתיים — ההצעות מופיעות תוך כדי.',
    },
    {
      id: 'fault',
      target: 'work-fault',
      optional: true,
      title: 'אין הצעות כרגע',
      body:
        'המנוע לא ענה, אז אין הצעות. הסינון עצמו עובד כרגיל — מחליטים ידנית, והתוכנה תנסה שוב לבד.',
    },
    {
      id: 'filters',
      target: 'work-filters',
      title: 'מה רואים',
      body:
        'הכל · לא הוחלט · נשמרו · מתלבט · הוסרו — המספר ליד כל אחד מתעדכן תוך כדי.\n\n' +
        '"לא הוחלט" הוא הדרך הכי מהירה לסיים: כשהוא מגיע לאפס, עברת על הכול. "הצעות המערכת" מופיע כשיש הצעות — ושם אפשר להסיר את כולן בלחיצה.',
      placement: 'bottom',
    },
    {
      id: 'bulk',
      target: 'work-bulk',
      optional: true,
      title: 'כל ההצעות בבת אחת',
      body: '"הסר את כולן" מקבל את כל ההצעות שבתצוגה. גם את זה אפשר לבטל.',
    },
    {
      id: 'sessions',
      target: 'work-sessions',
      optional: true,
      title: 'סשן אחד בכל פעם',
      body: 'הסשנים מהשלב הקודם. בוחרים סשן כדי לסנן רק אותו — קל יותר להשוות תמונות מאותו רגע.',
      placement: 'bottom',
    },
    {
      id: 'compare',
      target: 'work-compare',
      title: 'השוואה',
      body:
        'לוחצים על "השוואה", בוחרים 2 עד 4 תמונות, ו"השווה" — הן מוצגות זו לצד זו, ומחליטים על כל אחת.',
      placement: 'bottom',
    },
    {
      id: 'stacking',
      target: 'work-stacking',
      title: 'רצפים: מקובצים או פרושים',
      body: 'מקובצים — כל רצף הוא ערימה אחת. פרושים — כל התמונות בשורה.',
      placement: 'bottom',
    },
    {
      id: 'size',
      target: 'work-size',
      title: 'גודל התמונות',
      body: 'הפס משנה את הגודל. גם Ctrl + גלגלת העכבר על הגלריה עושה את זה.',
      placement: 'bottom',
    },
    {
      id: 'next',
      target: 'work-next',
      title: 'כשסיימת',
      body:
        'המספר על הכפתור הוא כמה תמונות ממשיכות — כל מה שלא הוסר. משם שולחים ללקוח לבחירה.',
      placement: 'bottom',
    },
    {
      id: 'open',
      target: 'work-feed',
      waitFor: 'work-viewer',
      optional: true,
      title: 'תצוגה גדולה',
      body: 'כדי לבדוק עיניים וחדות, פותחים תמונה בגדול.',
      doText: 'לחיצה כפולה על תמונה (או Enter)',
    },
  ],
};

/** The full-size viewer of סינון. */
export const WORK_VIEWER: Tour = {
  id: 'work-viewer',
  screen: 'work',
  trigger: 'work-viewer',
  title: 'תצוגה גדולה',
  steps: [
    {
      id: 'nav',
      target: 'viewer-next',
      title: 'קדימה ואחורה',
      body: 'החצים בצדדים, או חצי המקלדת, עוברים לתמונה הבאה והקודמת. המספר למעלה אומר איפה אתה בסט.',
      placement: 'side',
    },
    {
      id: 'decide',
      target: 'viewer-decide',
      title: 'מחליטים מכאן',
      body: 'שמור · מתלבט · הסר — או K / M / X. ההחלטה נשמרת מיד, ואפשר להמשיך לתמונה הבאה.',
      placement: 'top',
    },
    {
      id: 'zoom',
      target: 'viewer-zoom',
      title: 'הגדלה',
      body:
        'גלגלת העכבר מגדילה במקום שהעכבר עליו; כשמוגדל — גוררים כדי לזוז.\n\n' +
        '"התאם" — כל התמונה. "100%" — גודל אמיתי, לבדוק חדות. לחיצה כפולה על התמונה קופצת בין השניים.',
      placement: 'top',
    },
    {
      id: 'faces',
      target: 'viewer-faces',
      optional: true,
      title: 'כל הפנים בבת אחת',
      body:
        'פותח בצד את כל הפנים שבתמונה, מוגדלות — לבדוק שכולם בעיניים פתוחות בלי לזום לכל אחד. לחיצה על פנים מגדילה אליהן. F מסתיר.',
      placement: 'top',
    },
    {
      id: 'edit',
      target: 'viewer-edit',
      title: 'עריכה מהירה',
      body: 'פותח את העורך על התמונה הזו (E), בלי לצאת מהסינון.',
      placement: 'bottom',
    },
    {
      id: 'close',
      target: 'viewer-close',
      title: 'חזרה לגלריה',
      body: '✕ או Esc. הגלריה מחכה בדיוק בתמונה שבה עצרת.',
      placement: 'bottom',
    },
  ],
};

/** A burst — near-identical frames of one moment — opened for choosing. */
export const WORK_BURST: Tour = {
  id: 'work-burst',
  screen: 'work',
  trigger: 'work-burst',
  title: 'רצף',
  steps: [
    {
      id: 'what',
      target: 'work-burst',
      title: 'בוחרים את הטובה מהרצף',
      body:
        'כל התמונות כאן צולמו באותו רגע וכמעט זהות. בדרך כלל צריך רק אחת — המטרה למצוא אותה מהר.\n\n' +
        '★ מסמן את מה שהתוכנה ממליצה. "עיניים עצומות" מסומן על כל תמונה שזוהה בה.',
    },
    {
      id: 'modes',
      target: 'burst-modes',
      optional: true,
      title: 'שלוש דרכים להשוות',
      body:
        'כולן יחד — כל התמונות על המסך; תמונה שמסירים יוצאת, והשאר גדלות.\n' +
        'דו-קרב — המובילה מול הבאה בתור; הטובה נשארת, השנייה יוצאת.\n' +
        'שתיים זו מול זו — שתיים לבחירתך, החלטה על כל אחת.',
      placement: 'bottom',
    },
    {
      id: 'win',
      target: 'burst-win',
      optional: true,
      title: 'דו-קרב',
      body:
        '"זו עדיפה" — התמונה הזו ממשיכה, השנייה יוצאת. "שמור גם את זו" — שתיהן נשארות. כשהתור נגמר — "שמור את המובילה", ולרצף הבא.',
    },
    {
      id: 'zoom',
      target: 'burst-zoom',
      title: 'זום משותף',
      body:
        'הזום משותף לכל התמונות: מגדילים פעם אחת ורואים את אותו מקום בכולן — עיניים מול עיניים, חדות מול חדות.',
      placement: 'top',
    },
    {
      id: 'nav',
      target: 'burst-nav',
      title: 'לרצף הבא',
      body: 'עוברים מרצף לרצף בלי לחזור לגלריה. Ctrl+Z מבטל את ההחלטה האחרונה.',
      placement: 'bottom',
    },
  ],
};

/** The side-by-side comparison of 2–4 chosen frames. */
export const WORK_COMPARE: Tour = {
  id: 'work-compare-view',
  screen: 'work',
  trigger: 'work-compare-view',
  title: 'השוואה',
  steps: [
    {
      id: 'row',
      target: 'compare-row',
      title: 'זו לצד זו',
      body:
        'לחיצה על תמונה (או חצים) מסמנת אותה, ומתחתיה מחליטים: ✓ שמור, ? מתלבט, ✕ הסר — או K / M / X.\n\n' +
        'Esc חוזר לגלריה.',
    },
  ],
};
