import type { Tour } from '../types';

/** שלב 4 · שלח ללקוח — the client's own gallery: publish, share, watch, take
 *  the choice back. Before the gallery exists and after it, in one tour: the
 *  steps of the phase that is not on screen are situations, and skip. */
export const SEND: Tour = {
  id: 'send-to-client',
  screen: 'send-to-client',
  title: 'שליחה ללקוח',
  steps: [
    {
      id: 'flow',
      target: 'send-header',
      title: 'הלקוח בוחר, אתה עורך את מה שנבחר',
      body:
        'כאן יוצרים ללקוח גלריה אישית באינטרנט. הוא נכנס מהנייד או מהמחשב, מסמן תמונות לכל אלבום ומשאיר הערות על תמונות.\n\n' +
        'כשהוא מסיים, הבחירה חוזרת לכאן לבד — ובעריכה אפשר לראות רק את מה שנבחר. לגלריה עולות רק תמונות תצוגה; הקבצים המקוריים נשארים אצלך.',
      placement: 'bottom',
    },

    /* ---- before the gallery exists ---- */
    {
      id: 'source',
      target: 'send-source',
      optional: true,
      title: 'אילו תמונות עולות',
      body: 'כל הפרויקט, או סשן אחד. תמונות שהוצאו בסינון לא עולות אף פעם.',
    },
    {
      id: 'title',
      target: 'send-title',
      optional: true,
      title: 'השם שהלקוח רואה',
      body: 'מופיע ללקוח בכניסה לגלריה ובקישור.',
    },
    {
      id: 'presets',
      target: 'send-presets',
      optional: true,
      title: 'חבילות מוכנות',
      body:
        'חתונה, בר/בת מצווה, ברית, משפחה — לחיצה ממלאת את האלבומים והמכסות הנפוצים. אחר כך משנים כל שורה כרצונך.',
    },
    {
      id: 'albums',
      target: 'send-albums',
      optional: true,
      title: 'אלבומים ומכסות',
      body:
        'שורה לכל אלבום שמכרת: שם, וכמה תמונות הלקוח בוחר אליו. ‎-5 / +5 משנים מהר.\n\n' +
        'הלקוח בוחר לכל אלבום בנפרד, והגלריה לא תיתן לו לעבור את המכסה. אפשר לשנות מכסות גם אחרי שהגלריה באוויר.',
    },
    {
      id: 'publish',
      target: 'send-publish',
      optional: true,
      title: 'יוצרים ומפרסמים',
      body:
        'התמונות מוקטנות לתצוגה ועולות לגלריה. בסוף מקבלים קישור, שם משתמש וסיסמה בשביל הלקוח.',
    },
    {
      id: 'progress',
      target: 'send-progress',
      optional: true,
      title: 'עולה עכשיו',
      body: 'רואים כמה תמונות כבר עלו. תמונה שלא עלתה תסומן, ואפשר לשלוח רק אותה שוב.',
    },

    /* ---- the gallery is live ---- */
    {
      id: 'status',
      target: 'send-status',
      optional: true,
      title: 'איפה הגלריה עומדת',
      body:
        'באוויר וממתינה ללקוח ← הלקוח סיים לבחור (נעול) ← הבחירה יובאה לפרויקט.\n\n' +
        'כל עוד הפרויקט פתוח, התוכנה בודקת לבד פעם בדקה בערך אם הלקוח התקדם.',
      placement: 'bottom',
    },
    {
      id: 'link',
      target: 'send-link',
      optional: true,
      title: 'הקישור',
      body:
        '"העתק קישור" מעתיק הודעה מוכנה: הקישור ופרטי הכניסה. "ראה כלקוח" פותח את הגלריה בדיוק כמו שהלקוח רואה אותה.',
    },
    {
      id: 'whatsapp',
      target: 'send-whatsapp',
      optional: true,
      title: 'שולחים בוואטסאפ',
      body:
        'שלוש הודעות מוכנות: הזמנה ראשונה, תזכורת (עם כמה נבחרו עד עכשיו), ועדכון אחרי תיקונים.\n\n' +
        'הכפתור הירוק פותח וואטסאפ עם ההודעה כתובה — נשאר רק לשלוח.',
    },
    {
      id: 'creds',
      target: 'send-creds',
      optional: true,
      title: 'פרטי הכניסה של הלקוח',
      body: 'שם משתמש וסיסמה. "הנפק פרטים מחדש" יוצר זוג חדש.',
    },
    {
      id: 'meters',
      target: 'send-meters',
      optional: true,
      title: 'מה הלקוח כבר בחר',
      body:
        'לכל אלבום: כמה נבחרו מתוך המכסה, מתעדכן לבד. הלקוח קנה אלבום נוסף או ביקש עוד תמונות? "ערוך אלבומים ומכסות".',
    },
    {
      id: 'comments',
      target: 'send-comments',
      optional: true,
      title: 'הערות הלקוח',
      body:
        'הלקוח מסמן נקודה על תמונה וכותב מה לתקן. כאן רואים את הנקודה על התמונה.\n\n' +
        '"ערוך בסטודיו" פותח את התמונה בעריכה. "סמן שטופל" סוגר את ההערה.',
    },
    {
      id: 'imported',
      target: 'send-imported',
      optional: true,
      title: 'הבחירה בפנים',
      body:
        'הבחירה של הלקוח נכנסה לפרויקט, מסודרת לפי הסשנים. מכאן — לעריכת התמונות שנבחרו, או ישר לאלבום.',
    },
    {
      id: 'tools',
      target: 'send-quick-tools',
      optional: true,
      title: 'כלים מהירים',
      body:
        '"העתק שמות ללייטרום" — רשימת הקבצים שנבחרו, לחיפוש בלייטרום.\n' +
        '"דוח בחירות" — קובץ מסודר לפי אלבום, עם ההערות.\n' +
        '"פנה תמונות שלא נבחרו" — מוריד מהגלריה באינטרנט את מה שלא נבחר, כדי לפנות מקום. הקבצים אצלך לא נפגעים.',
    },
    {
      id: 'unpublished',
      target: 'send-unpublished',
      optional: true,
      title: 'תמונות שלא עלו',
      body: 'הלקוח לא רואה אותן. "שלח שוב" מעלה רק אותן.',
    },
    {
      id: 'control',
      target: 'send-live-actions',
      optional: true,
      title: 'שליטה בגלריה',
      body:
        '"הקפא גישה" — הקישור מפסיק לעבוד עד שתחזיר אותו.\n' +
        '"נעל בחירה" — סוגר את הבחירה, והיא נכנסת לפרויקט. "פתח בחירה מחדש" — מחזיר ללקוח את האפשרות לשנות.\n' +
        '"מחק גלריה" — הקישור מפסיק לעבוד והתמונות יורדות מהאינטרנט. בפרויקט שלך שום דבר לא נמחק.',
      placement: 'bottom',
    },

    /* ---- both phases ---- */
    {
      id: 'brand',
      target: 'send-brand',
      optional: true,
      title: 'הלוגו שלך',
      body:
        'הלוגו מופיע ללקוח בכניסה ובראש הגלריה. מומלץ PNG עם רקע שקוף — רואים כאן איך הוא ייראה על רקע בהיר ועל כהה.',
      placement: 'side',
    },
    {
      id: 'storage',
      target: 'send-storage',
      title: 'האחסון',
      body:
        'כל הגלריות שלך במקום אחד: כמה מקום כל אחת תופסת, איזו פעילה, ומה אפשר לפנות.',
      placement: 'bottom',
    },
    {
      id: 'next',
      target: 'send-next',
      title: 'לעריכה',
      body: 'לא חייבים לחכות ללקוח — אפשר להתחיל לערוך כבר עכשיו.',
      placement: 'bottom',
    },
  ],
};

/** The storage manager, opened from שלח ללקוח. */
export const SEND_STORAGE: Tour = {
  id: 'send-storage',
  screen: 'send-to-client',
  trigger: 'send-storage-modal',
  title: 'אחסון וגלריות',
  steps: [
    {
      id: 'what',
      target: 'send-storage-modal',
      title: 'כל הגלריות שלך',
      body:
        'למעלה — כמה מקום תפוס מתוך המכסה. בטבלה — כל גלריה: כמה תמונות, כמה נבחרו, כמה מקום היא תופסת ומה מצבה.\n\n' +
        'בכל שורה: פינוי התמונות שלא נבחרו, הקפאה או החזרה של הגישה, ומחיקת הגלריה. הקבצים במחשב שלך לא נפגעים מאף אחת מהן.',
    },
  ],
};
