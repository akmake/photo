import type { Tour } from '../types';

/** The project's own front page — and the place the whole process is told,
 *  because it is the one screen that shows the process. */
export const PROJECT: Tour = {
  id: 'client-status',
  screen: 'client-status',
  title: 'הפרויקט',
  steps: [
    {
      id: 'process',
      target: 'project-progress',
      title: 'התהליך, מהצילום למסירה',
      body:
        '1. העלאת גלריה — מכניסים את הצילום מהמחשב או מכרטיס הזיכרון.\n' +
        '2. סשנים — מחלקים לחלקים שצולמו באותו אור.\n' +
        '3. סינון — מוציאים את מה שלא נכנס.\n' +
        '4. שליחה ללקוח — הוא בוחר בגלריה אישית.\n' +
        '5. עריכה — רק את מה שנבחר.\n' +
        '6. אלבום — מהתמונות הערוכות.\n\n' +
        'העיגול אומר כמה מהדרך עברת, וכל שלב נצבע לפי מה שבאמת נעשה. לחיצה על שלב פותחת אותו.',
      placement: 'bottom',
    },
    {
      id: 'tabs',
      target: 'project-stages',
      title: 'השלבים תמיד למעלה',
      body: 'מכל מקום בפרויקט — לחיצה על שלב עוברת אליו.',
      placement: 'bottom',
    },
    {
      id: 'client',
      target: 'project-client',
      title: 'הלקוח',
      body: 'הפרטים שהוזנו בפתיחת הפרויקט: טלפון, מייל, תאריך וסוג הצילום.',
    },
    {
      id: 'summary',
      target: 'project-summary',
      title: 'התמונות במספרים',
      body:
        'כמה הועלו, כמה נשארו אחרי הסינון, כמה בחר הלקוח, כמה בעבודה וכמה גמורות. הכפתור למטה — לגלריה של הלקוח.',
    },
    {
      id: 'activity',
      target: 'project-activity',
      title: 'מה קרה בפרויקט',
      body: 'השלבים שכבר עברו, ומה עכשיו בעבודה.',
    },
    {
      id: 'message',
      target: 'project-message',
      title: 'הודעה ללקוח',
      body: 'כותבים כאן, וההודעה נפתחת בוואטסאפ אל הטלפון של הלקוח. בלי טלפון בפרויקט — אין לאן לשלוח, וזה כתוב.',
      placement: 'top',
    },
    {
      id: 'link',
      target: 'project-link',
      title: 'הקישור לגלריה',
      body: 'אחרי שנוצרה גלריה ללקוח — הקישור כאן, עם כפתור להעתקה (כולל שם המשתמש והסיסמה).',
      placement: 'top',
    },
  ],
};

/** ייבוא תמונות, beyond what the first launch already showed. */
export const IMPORT: Tour = {
  id: 'gallery-upload',
  screen: 'gallery-upload',
  title: 'ייבוא תמונות',
  steps: [
    {
      id: 'actions',
      target: 'import-actions',
      title: 'מאיפה מייבאים',
      body:
        'מהמחשב או מכרטיס זיכרון — בוחרים תיקייה. מ-Google Drive או מ-Dropbox — מתחברים פעם אחת, ומייבאים בכל פרויקט.\n\n' +
        'התמונות מועתקות לתיקיית הפרויקט; הקבצים במקור לא זזים ולא משתנים. תמונה שכבר יובאה — מדלגים עליה, אז אפשר לייבא שוב בלי כפילויות.',
      placement: 'bottom',
    },
    {
      id: 'destination',
      target: 'import-destination',
      title: 'איפה זה נשמר',
      body: 'התיקייה של הפרויקט במחשב שלך. לפני הייבוא הראשון אפשר לבחור תיקייה אחרת.',
      placement: 'bottom',
    },
    {
      id: 'progress',
      target: 'import-progress',
      optional: true,
      title: 'מייבא',
      body: 'כמה הועתקו מתוך כמה, ואחוז.',
      placement: 'bottom',
    },
    {
      id: 'failed',
      target: 'import-failed',
      optional: true,
      title: 'תמונות שלא הועתקו',
      body: 'כל אחת כתובה בשמה, עם הסיבה. המקור לא נפגע. "נסה שוב" מעתיק רק אותן.',
      placement: 'bottom',
    },
    {
      id: 'results',
      target: 'import-results',
      optional: true,
      title: 'מה בפרויקט',
      body:
        'כל התמונות שיובאו. מעבר עם העכבר על תמונה — סימון מצב: חומר גלם, בטיפול, מוכן.\n\n' +
        'מיד אחרי הייבוא התוכנה מתחילה להכין את התמונות ברקע, כדי שהעריכה תהיה מהירה כשתגיע אליה.',
      placement: 'bottom',
    },
  ],
};

/** The cloud import dialog. */
export const IMPORT_CLOUD: Tour = {
  id: 'import-cloud',
  screen: 'gallery-upload',
  trigger: 'import-cloud',
  title: 'ייבוא מהענן',
  steps: [
    {
      id: 'cloud',
      target: 'import-cloud',
      title: 'מחברים פעם אחת',
      body:
        'התוכנה מבקשת הרשאת קריאה בלבד — שום קובץ בענן לא יימחק ולא ישתנה. אחרי החיבור עוברים בין התיקיות, מסמנים, ומייבאים.\n\n' +
        '"נתק חשבון" — מבטל את החיבור.',
    },
  ],
};

/** היום — the dashboard. The first launch is the welcome tour; this is what
 *  "?" plays on it afterwards. */
export const TODAY: Tour = {
  id: 'today',
  screen: 'today',
  title: 'היום',
  steps: [
    {
      id: 'new',
      target: 'projects-new',
      title: 'פרויקט חדש',
      body: 'כל עבודה מתחילה כאן — מכל מסך, בשורה העליונה.',
      placement: 'bottom',
    },
    {
      id: 'continue',
      target: 'today-continue',
      optional: true,
      title: 'המשך מאיפה שעצרת',
      body: 'הפרויקט והשלב שבהם עבדת לאחרונה. "המשך" או Enter מחזירים אותך בדיוק לשם.',
      placement: 'bottom',
    },
    {
      id: 'queue',
      target: 'today-queue',
      title: 'תור עבודה',
      body: 'מה מחכה לך, לפי דחיפות: לקוח שאתה ממתין לתשובתו, צילום בשבוע הקרוב, יתרה פתוחה אחרי מסירה, ועבודה פתוחה. הכפתור בכל שורה לוקח למקום הנכון בפרויקט.',
    },
    {
      id: 'agenda',
      target: 'today-agenda',
      optional: true,
      title: 'השבועיים הקרובים',
      body: 'הצילומים ב־14 הימים הבאים, לפי יום. לחיצה פותחת את הפרויקט. הפאנל נפתח ונסגר בכפתור שבשורה העליונה.',
      placement: 'side',
    },
    {
      id: 'business',
      target: 'today-business',
      optional: true,
      title: 'מצב עסקי',
      body: 'פרויקטים פעילים, ממתינים ללקוח, יתרה פתוחה ונמסרו — מחושבים מהפרויקטים עצמם.',
      placement: 'side',
    },
    {
      id: 'help',
      target: 'help-button',
      title: 'שוב את ההיכרות?',
      body: 'בכל מסך, הכפתור הזה מסביר את המסך. את ההיכרות הראשונה אפשר להפעיל שוב מ"הגדרות".',
      placement: 'bottom',
    },
  ],
};

export const PROJECTS: Tour = {
  id: 'projects',
  screen: 'projects',
  title: 'פרויקטים',
  steps: [
    {
      id: 'queue',
      target: 'projects-queue',
      optional: true,
      title: 'דורש טיפול',
      body: 'לקוח שאתה ממתין לו, צילום בשבוע הקרוב, ויתרה שנשארה פתוחה אחרי מסירה. הכפתור בכל שורה לוקח ישר למקום הנכון.',
      placement: 'bottom',
    },
    {
      id: 'find',
      target: 'frame-search',
      title: 'למצוא פרויקט',
      body: 'חיפוש לפי שם לקוח, אירוע או מקום — מכל מסך. גם Ctrl K פותח אותו.',
      placement: 'bottom',
    },
    {
      id: 'filters',
      target: 'projects-filters',
      title: 'לפי מצב',
      body: 'בעבודה · ממתין ללקוח · לפני צילום · נמסר. ליד כל מצב — כמה פרויקטים יש בו.',
      placement: 'bottom',
    },
    {
      id: 'card',
      target: 'projects-card',
      optional: true,
      title: 'כרטיס פרויקט',
      body: 'תמונת שער, סוג האירוע, התאריך והמצב. לחיצה מציגה את הפרטים בפאנל שבצד; לחיצה כפולה או Enter פותחת את הפרויקט.',
    },
    {
      id: 'delete',
      target: 'projects-delete',
      optional: true,
      title: 'מחיקה',
      body:
        'מוחקת את הפרויקט מהתוכנה: פרטים, סשנים, עריכות וקישור לגלריה — בלי ביטול, ולכן התוכנה שואלת קודם.\n\n' +
        'התמונות עצמן נשארות בתיקייה שלהן, על הדיסק.',
    },
    {
      id: 'new',
      target: 'projects-new',
      title: 'פרויקט חדש',
      body: 'פותח עבודה חדשה.',
      placement: 'bottom',
    },
  ],
};

export const CLIENTS: Tour = {
  id: 'clients',
  screen: 'clients',
  title: 'לקוחות',
  steps: [
    {
      id: 'what',
      target: 'clients-figures',
      title: 'ספר הלקוחות',
      body:
        'אין כאן מה להקליד: כל לקוח נוצר מהפרויקטים שלו. היקף כולל — כמה עבודה הביאו כולם. פתוח לגבייה — כמה עוד חייבים.',
      placement: 'bottom',
    },
    {
      id: 'search',
      target: 'clients-search',
      title: 'חיפוש',
      body: 'לפי שם, טלפון או מייל.',
      placement: 'bottom',
    },
    {
      id: 'list',
      target: 'clients-list',
      optional: true,
      title: 'כל לקוח',
      body:
        'מסודרים לפי מי שחייב יותר. "לקוח חוזר" — צילמת אותו יותר מפעם אחת. חסר טלפון או מייל — זה מסומן.\n\n' +
        'לחיצה פותחת את הפרויקט האחרון שלו.',
    },
  ],
};

export const CALENDAR: Tour = {
  id: 'calendar',
  screen: 'calendar',
  title: 'יומן',
  steps: [
    {
      id: 'what',
      target: 'calendar-figures',
      title: 'יומן מתוך הפרויקטים',
      body:
        'כל צילום ביומן הוא פרויקט, לפי התאריך שנרשם בו. אין רשימה נפרדת לתחזק — תאריך משנים בפרויקט.',
      placement: 'bottom',
    },
    {
      id: 'month',
      target: 'calendar-month',
      title: 'החודש',
      body: 'ימי צילום מסומנים. לחיצה על יום מציגה את הצילומים בו.',
    },
    {
      id: 'upcoming',
      target: 'calendar-upcoming',
      optional: true,
      title: 'הצילומים הבאים',
      body: 'לפי הסדר. לחיצה פותחת את הפרויקט.',
      placement: 'side',
    },
    {
      id: 'undated',
      target: 'calendar-undated',
      optional: true,
      title: 'בלי תאריך',
      body: 'פרויקטים שלא נרשם בהם תאריך צילום — ולכן אינם ביומן. כדאי להשלים.',
      placement: 'side',
    },
  ],
};

export const SETTINGS: Tour = {
  id: 'settings',
  screen: 'settings',
  title: 'הגדרות',
  steps: [
    {
      id: 'folder',
      target: 'settings-folder',
      title: 'תיקיית העבודה',
      body: 'כאן נפתחת תיקייה לכל פרויקט חדש. החלפה לא מזיזה פרויקטים שכבר קיימים.',
    },
    {
      id: 'engine',
      target: 'settings-engine',
      title: 'המנוע',
      body:
        'החלק של התוכנה שקורא את התמונות ועורך אותן, על המחשב שלך בלבד. "לא זמין" — שום כלי לא יעבוד; הכפתור בודק שוב.',
    },
    {
      id: 'data',
      target: 'settings-data',
      title: 'קובץ הנתונים',
      body: 'כל מה שהתוכנה יודעת על העבודה שלך — בקובץ אחד. העתק שלו הוא גיבוי.',
    },
    {
      id: 'tours',
      target: 'settings-tours',
      title: 'הדרכה',
      body: '"ההיכרות הראשונה, שוב" — מתחילה מחדש את הסיור של ההפעלה הראשונה. "הצג שוב את כל ההדרכות" — כל מסך יסביר את עצמו שוב בכניסה הבאה.',
    },
  ],
};
