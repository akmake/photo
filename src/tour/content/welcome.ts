import type { Tour } from '../types';

/** The first launch: from an empty studio to the import button of a project
 *  the photographer opened himself. */
export const WELCOME: Tour = {
  id: 'welcome',
  screen: 'today',
  title: 'היכרות ראשונה',
  steps: [
    {
      id: 'hello',
      title: 'ברוך הבא ל-FrameOps',
      body:
        'כל העבודה שלך במקום אחד: מהצילום, דרך הבחירה של הלקוח, ועד התמונות הערוכות והאלבום.\n\n' +
        'בוא נפתח יחד פרויקט ראשון ונכניס אליו תמונות. זה לוקח שתי דקות.',
    },
    {
      id: 'nav',
      target: 'nav-business',
      title: 'התפריט הראשי',
      body:
        'היום — מה מחכה לך עכשיו.\n' +
        'פרויקטים — כל העבודות, הפתוחות והסגורות.\n' +
        'לקוחות — כל מי שצילמת, עם כל הצילומים שלו.\n' +
        'יומן — הצילומים הקרובים.\n' +
        'כלים — ניקוי חכם, מעבדה וכלים בניסיון.',
      placement: 'bottom',
    },
    {
      id: 'new-project',
      target: 'today-new-project',
      waitFor: 'new-project',
      title: 'כל עבודה היא פרויקט',
      body:
        'צילום אחד ללקוח אחד הוא פרויקט אחד. בתוכו נמצא הכול: התמונות, הבחירה של הלקוח, העריכה והאלבום.',
      doText: 'לחץ על "פרויקט חדש"',
    },
    {
      id: 'form',
      target: 'new-project',
      waitFor: 'new-project-deliverables',
      title: 'רק השם חובה',
      body:
        'שם הלקוח מספיק כדי להתחיל. טלפון, סוג הצילום ותאריך — אם יש לך אותם, הם יעזרו לך אחר כך ביומן ובקשר עם הלקוח.\n\n' +
        'לקוח שכבר צילמת בעבר יושלם לבד, עם הטלפון והמייל שלו.',
      doText: 'הקלד שם ולחץ "המשך לפרטי המסירה"',
      placement: 'side',
    },
    {
      id: 'deliverables',
      target: 'new-project-deliverables',
      title: 'מה מוסרים ללקוח',
      body:
        'גלריה לבחירה — הלקוח מקבל קישור אישי, רואה את התמונות ובוחר.\n' +
        'אלבום מודפס — מוסיף לפרויקט שלב של עיצוב אלבום.\n\n' +
        'מחיר ומקדמה: התוכנה מחשבת לבד כמה נשאר לגבות. אפשר לשנות הכול גם אחר כך.',
      placement: 'side',
    },
    {
      id: 'create',
      target: 'new-project-submit',
      waitFor: 'project-status',
      title: 'פותחים את הפרויקט',
      body: 'זהו — הפרויקט קיים. התיקייה שלו במחשב תיפתח ברגע שתכניס אליו תמונות.',
      doText: 'לחץ על "יצירת הפרויקט"',
    },
    {
      id: 'stages',
      target: 'project-stages',
      title: 'הדרך של כל פרויקט',
      body:
        'כל פרויקט עובר את אותם שלבים, לפי הסדר: ייבוא התמונות, חלוקה לסשנים, סינון, שליחה ללקוח לבחירה, עריכה, ואלבום.\n\n' +
        'אפשר לקפוץ לכל שלב בכל רגע — הסדר הוא המלצה, לא חובה.',
      placement: 'bottom',
    },
    {
      id: 'progress',
      target: 'project-progress',
      title: 'איפה הפרויקט עומד',
      body:
        'המסלול מתעדכן לבד לפי מה שבאמת נעשה: כמה תמונות יובאו, אם הלקוח כבר בחר, כמה נערכו.\n\n' +
        'לחיצה על שלב במסלול פותחת אותו.',
      placement: 'bottom',
    },
    {
      id: 'to-import',
      target: 'stage-gallery-upload',
      waitFor: 'import-from-disk',
      title: 'מתחילים מהתמונות',
      body: 'בלי תמונות אין עבודה. נכניס עכשיו את הצילום לפרויקט.',
      doText: 'לחץ על "ייבוא תמונות"',
      placement: 'bottom',
    },
    {
      id: 'import',
      target: 'import-from-disk',
      title: 'מכניסים את הצילום',
      body:
        'בחר את תיקיית הצילום במחשב, או את כרטיס הזיכרון. התמונות מועתקות לתיקיית הפרויקט — הקבצים המקוריים לא זזים ולא משתנים.\n\n' +
        'התמונות שמורות ב-Google Drive או ב-Dropbox? הכפתורים שליד מייבאים משם.',
      placement: 'bottom',
    },
    {
      id: 'destination',
      target: 'import-destination',
      title: 'איפה זה נשמר',
      body:
        'לכל פרויקט תיקייה משלו במחשב שלך. התמונות המקוריות לא עולות לאינטרנט אף פעם — ללקוח עולות רק תמונות תצוגה.',
      placement: 'bottom',
    },
    {
      id: 'help',
      target: 'help-button',
      title: 'ההדרכה תמיד כאן',
      body:
        'בכל מסך, הכפתור הזה מסביר את המסך שאתה נמצא בו.\n\n' +
        'עכשיו ייבא את הצילום — ומשם ממשיכים לשלב הבא.',
      placement: 'side',
    },
  ],
};
