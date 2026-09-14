להלן מסמך שאפשר להעביר למתכנת כמעט כמו שהוא. הוא לא מניח שזורקים את מה שכבר קיים: ה־store כבר תומך בשיוך תמונה למקבץ קיים או להסרת שיוך באמצעות `assignFrames`, ובניית מקבץ חדש כבר יכולה לקבל תמונות באותה פעולה. הבעיה העיקרית היא שה־UI הנוכחי חושף רק חלק קטן מהיכולת הזאת.

בנוסף, כיום `Batch` מוגדר אצלכם במפורש כקבוצת תמונות שחולקת **אותו אור** לצורך עריכה, ולא כיחידה סיפורית. לכן אסור לבנות את מנגנון האלבום על אותה ישות בלי הפרדה.

---

# מפרט מלא — מערכת מקבצים ורצפים מקצועית

## 0. מטרת העבודה

לבנות מחדש את אזור המקבצים/רצפים כך שיהיה כלי עבודה מקצועי לניהול מאות ואלפי תמונות.

המערכת צריכה לאפשר לצלם:

* לראות במהירות איך יום הצילום מחולק.
* ליצור רצפים תוך שניות.
* לבחור תמונה אחת, טווח או אוסף לא רציף.
* להעביר תמונות בין קבוצות בלי לפרק את העבודה.
* לפצל קבוצה.
* לאחד קבוצות.
* לשנות סדר.
* לתקן טעויות גם אחרי שסיים את החלוקה.
* לבצע הכול גם עם עכבר וגם במהירות עם מקלדת.
* להבין בכל רגע איפה כל תמונה נמצאת.
* לא לאבד עריכה או metadata כתוצאה מהעברת תמונה.
* להשתמש בהמשך באותה שכבת ארגון עבור בחירה, עריכה ואלבום.

---

# 1. החלטת ארכיטקטורה קריטית

## לא להשתמש באותה ישות גם ל״אור״ וגם ל״סיפור״

היום `Batch` אצלנו הוא:

> קבוצת תמונות ששייכת לאותו מצב תאורה/עריכת צבע.

זה נכון לעריכה.

אבל מבחינת אלבום וסיפור, הצלם עובד לפי:

* הכנות
* שמלה
* מפגש
* משפחה
* צילומי חוץ
* קבלת פנים
* חופה
* ריקוד ראשון
* ריקודים
* סיום

אלו לא בהכרח אותם גבולות.

לכן מעכשיו יש שני מושגים שונים.

### Edit Batch

בעברית בממשק:

**קבוצת עריכה**

משמעות:

תמונות שמקבלות בסיס עריכה/צבע משותף.

שיוך:

תמונה יכולה להשתייך לכל היותר לקבוצת עריכה אחת.

### Story Moment

בעברית בממשק:

**רצף**

משמעות:

קטע סיפורי/אירוע בתוך יום הצילום.

שיוך:

בגרסה הראשונה, תמונה יכולה להשתייך לכל היותר לרצף ראשי אחד.

בעתיד אפשר להוסיף tags נוספים, אבל לא עכשיו.

---

# 2. לא להעתיק את כל המערכת פעמיים

לא לבנות:

`BatchesScreen`

ואחר כך:

`MomentsScreen`

עם שני קודי UI נפרדים.

לבנות מנגנון UI משותף:

```ts
GroupWorkspace
```

עם adapter.

לדוגמה:

```ts
type GroupMode = 'story' | 'edit';
```

אותו UI יודע:

* להציג קבוצות.
* לבחור תמונות.
* להעביר.
* לפצל.
* למזג.
* לשנות סדר.
* לבחור cover.
* להציג timeline.

אבל הנתונים נשמרים בנפרד.

---

# 3. מבנה נתונים מומלץ

ה־`Batch` הקיים יכול להישאר.

להוסיף ישות חדשה, למשל:

```ts
interface StoryMoment {
  id: string;
  name: string;
  order: number;
  cover?: string;
  createdAt: string;
}
```

וב־Project state:

```ts
interface ProjectState {
  batches: Batch[];
  assign: Record<string, string>;

  moments: StoryMoment[];
  momentAssign: Record<string, string>;
}
```

`assign` הקיים ממשיך להיות קבוצות עריכה.

`momentAssign` הוא רצפים.

---

# 4. למה לשמור assignment ולא arrays בתוך הקבוצה

לא:

```ts
moment.frames = [...]
```

אלא:

```ts
momentAssign[frameName] = momentId
```

אותו עיקרון שכבר קיים אצלכם ב־Batch.

יתרונות:

* תמונה לא יכולה בטעות להשתייך פעמיים.
* העברה היא assignment אחד.
* אין צורך לעדכן שתי רשימות.
* קל למצוא unassigned.
* קל לבצע bulk operations.
* קל לשמור ל־project.json.

---

# 5. מזהה תמונה

להמשיך להשתמש בזהות היציבה שכבר קיימת אצלכם ולא בנתיב מוחלט.

כיום הקוד משתמש בשם קובץ כזהות כי הפרויקט יכול לעבור בין כוננים.

אם בעתיד יהיו שני קבצים עם אותו basename בתיקיות שונות, צריך לעבור ל־stable frame ID.

לא לעשות refactor כזה כחלק מה־UI אם אין כרגע collision אמיתי.

---

# 6. שינוי שם של שלב הפרויקט

אם מדובר ב־Story Moments:

השלב לא ייקרא:

**מקבצים**

אלא:

**רצפים**

או:

**ארגון**

ההמלצה שלי:

**רצפים**

Subheading:

`חלק את יום הצילום לרגעים שאפשר לבחור, לערוך ולעצב מהם.`

---

# 7. קבוצות עריכה לא חייבות להיות שלב עצמאי מוקדם

קבוצות עריכה יכולות להופיע בשלב העריכה.

שם השפה היא:

**קבוצות עריכה**

ולא:

**רצפים**

כך הצלם לא צריך להבין שמושג אחד עושה שתי עבודות.

---

# 8. המסך הראשי של רצפים

המבנה החדש:

```text
┌───────────────────────────────────────────────┐
│ Header                                        │
├───────────────────────────────────────────────┤
│ Group strip / Timeline                        │
├───────────────────────────────────────────────┤
│ Toolbar                                      │
├───────────────────────────────────────────────┤
│                                               │
│            Contact Sheet                      │
│                                               │
│                                               │
└───────────────────────────────────────────────┘
```

אין cards ענקיים שנפתחים לתוך עצמם.

אין accordion.

אין מצב שבו תמונות של מקבץ נערמות בתוך עמודה צרה.

---

# 9. Header

כותרת:

**רצפים**

שורה משנית:

`428 תמונות · 7 רצפים · 23 ללא שיוך`

בצד השני:

* Undo
* Redo
* חיפוש
* תפריט `⋯`

---

# 10. מה לא צריך להיות ב־Header

לא:

* „צור מקבץ” תמיד.
* „בחר הכול”.
* „פרק”.
* „פתח”.
* „סגור”.
* הוראות Shift קבועות.

פעולות מופיעות כשהן רלוונטיות.

---

# 11. רצועת הרצפים העליונה

זהו רכיב ניווט קבוע.

גובה:

בערך `120–150px`.

Scroll אופקי.

כל רצף הוא tile קומפקטי.

---

# 12. Tile של רצף

רוחב:

בערך `180–220px`.

גובה:

`100–125px`.

הוא אינו card dashboard.

רוב השטח הוא תמונה.

מבנה:

```text
┌────────────────────┐
│                    │
│     cover image    │
│                    │
├────────────────────┤
│ חופה          74   │
│ 18:42–19:17        │
└────────────────────┘
```

---

# 13. שטח התמונה ב־tile

לפחות 60–70% מה־tile.

לא thumbnail צר בצד.

התמונה מזהה את הרצף לפני שהטקסט נקרא.

---

# 14. טווח זמן

תמיד כרונולוגי:

`17:41–17:45`

לא:

`17:45–17:41`

לעטוף ב:

```html
<bdi dir="ltr">
```

או equivalent.

---

# 15. רצף פעיל

כאשר selected:

* border ברור ועדין.
* indicator קטן.
* אין scale דרמטי.
* אין shadow ענק.

הוא יכול להיות מסומן ב־brand/copper.

---

# 16. ללא שיוך

Tile ראשון קבוע:

**ללא שיוך**

עם count.

למשל:

`23 תמונות`

לא לנסות לתת לו cover אקראי אם זה נראה מבלבל.

אפשר mosaic עדין של 3–4 thumbnails.

---

# 17. לחיצה על רצף

Single click:

הופך אותו ל־active.

ה־Contact Sheet מתחת מציג את התמונות שלו.

לא צריך:

`פתח`

לא צריך:

`סגור`

---

# 18. קליק על הרצף הפעיל

לא סוגר אותו.

הוא נשאר active.

אם צריך „כל התמונות” יש tile נפרד.

---

# 19. Tile „הכול”

אפשר להוסיף:

**כל התמונות**

כדי לסקור את הפרויקט.

אבל זה view בלבד.

הוא אינו קבוצה אמיתית.

---

# 20. סדר הרצפים

הרצועה מוצגת לפי `order`.

לא לפי זמן אוטומטית אחרי שהצלם שינה סדר.

ברירת מחדל בעת יצירה:

לפי capture time.

אחרי שינוי ידני:

הסדר הידני הוא האמת.

---

# 21. Reorder

ניתן לגרור tile שמאלה/ימינה.

בזמן drag:

* placeholder.
* שאר tiles זזים.
* auto-scroll בקצוות.

Drop:

מעדכן `order`.

Undo זמין.

---

# 22. לא לשנות membership בשינוי סדר

Reorder משנה רק `order`.

לא את התמונות.

לא את timestamps.

---

# 23. תפריט `⋯` של רצף

מופיע ב־hover או focus.

בתוכו:

* שינוי שם
* קבע תמונת שער
* פצל רצף
* מזג עם…
* בחר את כל התמונות
* מחק רצף

---

# 24. „מחק רצף”

לא למחוק את התמונות.

הן עוברות ל־„ללא שיוך”.

---

# 25. מחיקת קבוצת עריכה שונה ממחיקת רצף

חשוב.

כיום `removeBatch()` מוחק גם את recipe של `perBatch`.

לכן בקבוצת עריכה:

Dialog:

**למחוק את קבוצת העריכה?**

טקסט:

`43 התמונות יחזרו ללא שיוך. עריכת הצבע הייחודית לקבוצה הזו תימחק.`

Primary destructive:

`מחק קבוצה`

Secondary:

`ביטול`

---

# 26. ברצף סיפורי

אין recipe למחוק.

Dialog פשוט יותר:

`43 התמונות יחזרו לללא שיוך.`

---

# 27. Contact Sheet

זה האזור המרכזי.

הוא חייב להרגיש כמו כלי לצלם.

לא cards.

לא file browser רגיל.

תמונות בצפיפות גבוהה.

---

# 28. גודל thumbnails

ברירת מחדל:

כ־`170–210px`.

Toolbar מאפשר:

`קטן / בינוני / גדול`

או slider discreet.

---

# 29. צפיפות

Small:

בערך 10–12 תמונות בשורה במסך 1920.

Medium:

7–9.

Large:

5–6.

---

# 30. aspect ratio

לא חייב לחתוך את כל התמונות ל־3:2.

עדיף contact sheet ששומר ratio באופן סביר.

שתי אפשרויות:

### שלב ראשון

fixed cell + `object-fit: cover`

פשוט ומהיר.

### שלב מתקדם

justified rows לפי aspect ratios.

עדיף לצלם כי הוא רואה קומפוזיציה אמיתית.

---

# 31. filenames

לא להציג מתחת לכל תמונה כברירת מחדל.

זה מייצר רעש.

Hover tooltip:

`IMG_4821.CR3 · 17:42:16`

---

# 32. מידע קבוע על תמונה

רק מידע שימושי מאוד:

* rating אם קיים.
* selected.
* warning אם קיים.
* status אם באמת נחוץ.

לא timestamp גדול על כל frame.

---

# 33. Selection — חוק עליון

Shift/Ctrl הם קיצורי דרך.

הם לא interface.

---

# 34. Checkbox

ב־hover על thumbnail:

checkbox בפינה.

לחיצה עליו:

בוחרת את התמונה ולא פותחת preview.

---

# 35. כניסה ל־Selection Mode

אחרי שתמונה אחת selected:

כל התמונות מציגות checkbox עדין.

מופיע Selection Toolbar.

---

# 36. לחיצה רגילה על תמונה

כאשר אין Selection Mode:

Single click:

פותח Preview/Focus או בוחר focus בלבד — לפי שפת המוצר.

המלצה:

Single click = focus.

Double-click = preview גדול.

Checkbox = selection.

כך אין ambiguity.

---

# 37. כאשר Selection Mode פעיל

Click על thumbnail:

toggle selection.

אין צורך לפגוע checkbox דווקא.

---

# 38. Shift

Shift-click:

בוחר range מה־anchor האחרון.

---

# 39. Ctrl/Cmd

Ctrl/Cmd-click:

toggle תמונה אחת בלי לאבד את selection.

---

# 40. Select Range גלוי

כאשר selected image אחת:

Context action:

`בחר עד כאן`

אפשר גם:

בחירת תמונה A → תמונה B עם Shift.

אבל פעולה גלויה חשובה למשתמש שלא מכיר Shift.

---

# 41. Drag selection rectangle

בשטח ריק:

drag rectangle.

כל thumbnails שבתוכו selected.

---

# 42. Auto-scroll בזמן rectangle select

אם העכבר מתקרב לקצה העליון/תחתון:

הגריד גולל.

---

# 43. Selection Toolbar

כאשר `selectedCount > 0`.

Sticky.

מומלץ בתחתית המסך או מתחת לרצועת הרצפים.

דוגמה:

```text
18 נבחרו   [העבר אל ▾] [רצף חדש] [הוצא]           [×]
```

---

# 44. פעולות Selection Toolbar

ברצפים:

* העבר אל
* צור רצף חדש
* הוצא מהרצף
* קבע שער, אם אחת נבחרה
* עוד `⋯`

---

# 45. „העבר אל”

Dropdown searchable.

האפשרויות:

* ללא שיוך
* הכנות
* משפחה
* חוץ
* חופה
* ריקודים

---

# 46. לא להציג יעד נוכחי

אם כל 18 התמונות כבר ב„חופה”:

`חופה` disabled עם indicator:

`נוכחי`

---

# 47. selection מעורב

אם התמונות מגיעות מכמה רצפים:

עדיין אפשר „העבר אל”.

הפעולה מעבירה את כולן ליעד.

---

# 48. Transfer atomic

Bulk move צריך להיות פעולה אחת ל־Undo.

לא 18 operations.

---

# 49. אחרי העברה

ברירת מחדל:

selection מתנקה.

Toast קטן:

`18 תמונות הועברו לחופה`

Undo inline:

`בטל`

---

# 50. אם המשתמש מעביר מתוך active group

התמונות נעלמות מיד מה־Contact Sheet.

לא reload מלא.

לא spinner.

---

# 51. „צור רצף חדש”

אם selection קיים:

פותח popover קטן.

שדה:

`שם הרצף`

ברירת מחדל אפשרית:

לפי שעה:

`17:41`

או הצעה אוטומטית בעתיד.

כפתור:

`צור והעבר`

---

# 52. Enter

בשדה השם:

Enter יוצר.

---

# 53. Escape

סוגר בלי לשנות.

---

# 54. רצף חדש נכנס למיקום הגיוני

לא תמיד בסוף.

אם התמונות נמצאות בין „חוץ” ל„משפחה” בזמן:

להכניס אותו ביניהם לפי capture time.

אם הסדר כבר נערך ידנית:

אפשר להכניס אחרי active group.

---

# 55. Create empty group

לא צריך להיות action ראשי.

אפשר דרך `+ רצף`.

אבל בדרך כלל רצף נוצר מתוך תמונות.

---

# 56. `+ רצף`

כפתור קטן בסוף strip.

יוצר קבוצה ריקה.

שימושי למי שיודע מראש מה הוא רוצה.

---

# 57. „הוצא מהרצף”

מעביר ל־Unassigned.

לא מוחק.

---

# 58. Undo

לא confirmation.

---

# 59. Drag & Drop — תמונה אחת

אפשר לגרור thumbnail אל tile של רצף אחר.

Tile תחת pointer מקבל highlight.

Drop:

מעביר.

---

# 60. Drag של selection

אם גוררים תמונה selected:

גוררים את כל selection.

Ghost:

`18 תמונות`

לא stack של 18 images.

---

# 61. Drag של תמונה לא selected בזמן שיש selection

צריך rule ברור.

המלצה:

אם מתחילים drag על תמונה שלא selected:

selection מתחלף אליה ורק היא נגררת.

---

# 62. Drop על Unassigned

מסיר שיוך.

---

# 63. Drop על `+ רצף`

פותח create flow עם selection.

---

# 64. Drag בתוך אותו רצף

לא משנה כלום כרגע.

לא לעשות reorder של תמונות בתוך רצף בשלב הראשון, אלא אם יש צורך מוכח.

סדר התמונות נגזר מ־capture time.

---

# 65. אם רוצים סדר ידני בתוך רצף בעתיד

לשמור override נפרד.

לא לשנות capture time.

---

# 66. פיצול רצף

יש שתי דרכים.

### פיצול לפי selection

בחר תמונות → `צור רצף חדש`.

### פיצול בנקודה

בתצוגה כרונולוגית:

hover בין שתי תמונות מציג divider.

Click:

`פצל כאן`

---

# 67. „פצל כאן”

כל התמונות מנקודה זו והלאה עוברות לרצף חדש.

Dialog/Popover:

שם הרצף החדש.

---

# 68. אין confirmation נוסף

Preview מספיק.

Undo קיים.

---

# 69. מיזוג רצפים

תפריט רצף:

`מזג עם…`

נפתח chooser.

---

# 70. ברירת יעד במיזוג

להציע קודם:

* הרצף הקודם.
* הרצף הבא.

כי זה המקרה הנפוץ.

---

# 71. מיזוג — מה נשמר

* התמונות משני הרצפים.
* הסדר הכרונולוגי.
* שם הרצף שממנו יזם המשתמש, אלא אם בחר אחרת.
* cover של היעד.

---

# 72. מיזוג קבוצות עריכה

זה שונה.

אם לשתי הקבוצות יש recipes שונים:

אסור למזג בשקט.

Dialog:

**לשתי הקבוצות יש עריכות שונות. איזו עריכה לשמור?**

* עריכת קבוצה A.
* עריכת קבוצה B.
* בלי עריכה ייחודית.

---

# 73. מיזוג Story Moments

אין בעיית recipe.

מיזוג מיידי.

---

# 74. שינוי שם

Inline edit על שם הרצף.

Double-click על title או דרך `⋯`.

Enter save.

Escape cancel.

---

# 75. שם ריק

לא לשמור string ריק.

Fallback:

`רצף ללא שם`

אבל עדיף לאפשר ולסמן שצריך שם.

---

# 76. Duplicate names

מותר.

לדוגמה:

`משפחה`

יכול להופיע פעמיים.

לא צריך לכפות unique.

ה־ID הוא הזהות.

---

# 77. Cover

ברירת מחדל:

תמונה ראשונה כרונולוגית.

אבל אפשר לבחור ידנית.

---

# 78. בחירת Cover

כאשר תמונה אחת selected:

`קבע כתמונת שער`

---

# 79. אם cover הועבר לרצף אחר

הקבוצה בוחרת fallback אוטומטי.

לא להשאיר broken reference.

---

# 80. Timeline

מעל/מתחת ל־Contact Sheet אפשר להוסיף timeline דק.

לא חובה ל־v1, אבל מומלץ.

הוא מציג את יום הצילום:

```text
17:00 ─── 18:00 ─── 19:00 ─── 20:00
```

והרצפים כ־segments.

---

# 81. Segment width

יחסי למשך הזמן.

לא לכמות התמונות בלבד.

---

# 82. למה timeline שימושי

צילום אירוע הוא כרונולוגי.

הצלם רואה מיד:

* חור.
* רצף עצום מדי.
* שני רצפים שחופפים רעיונית.
* קפיצה של שעה.

---

# 83. Jump לפי זמן

לחיצה ב־timeline:

scroll ב־Contact Sheet לתמונה הקרובה.

---

# 84. Gap markers

אם יש הפסקה משמעותית בצילום:

למשל 25 דקות בלי תמונות.

להציג notch קטן.

---

# 85. הצעות אוטומטיות

בעתיד, engine יכול להחזיר candidate boundaries.

אבל ה־UI צריך להיות מוכן לזה עכשיו.

---

# 86. Suggested boundary

בין thumbnails:

קו dotted.

Label:

`הצעה`

---

# 87. Accept suggestion

Click:

יוצר cut.

---

# 88. Reject suggestion

X קטן או context action.

המערכת זוכרת rejection כדי לא להציע שוב באותו analysis.

---

# 89. מה מנוע ההצעות יכול להשתמש

* capture time gap.
* שינוי embeddings.
* שינוי אנשים מרכזיים.
* שינוי רקע.
* שינוי exposure/color.
* camera/lens change.
* GPS אם יש.
* burst boundaries.

לא חייבים לבנות את המנוע עכשיו.

---

# 90. Auto-group

Action:

`הצע רצפים`

לא:

`חלק אוטומטית`

המערכת מציעה.

הצלם מאשר.

---

# 91. Preview proposals

אם יש 11 הצעות:

`11 גבולות מוצעים`

Actions:

`הצג`

`קבל הכל`

לא לבצע בלי שהמשתמש יודע.

---

# 92. Confidence

לא להציג 0.84 למשתמש.

אפשר:

* חזק
* בינוני

או רק strength ויזואלי של הקו.

---

# 93. Filter bar

ב־Contact Sheet.

אפשר:

* הכול
* נבחרות
* לא נבחרות
* rating
* camera
* שעה

אבל לא להעמיס כברירת מחדל.

---

# 94. Search

חיפוש filename.

גם partial.

---

# 95. Search לא משנה membership

רק מסנן view.

---

# 96. בזמן filter

Selection operations פועלים רק על התמונות הנראות/שנבחרו.

---

# 97. „בחר הכל”

צריך להיות מדויק.

אם יש filter:

`בחר את כל 42 המוצגות`

לא את כל 600.

---

# 98. Clear selection

Esc.

וגם X ב־Selection Toolbar.

---

# 99. Selection count

תמיד:

`18 נבחרו`

אם חלק מוסתרים בגלל filter:

`18 נבחרו · 5 מוסתרות`

---

# 100. Preview תמונה

Double-click:

פותח overlay גדול.

---

# 101. Preview overlay

תמונה גדולה.

פרטי metadata מינימליים.

Previous/Next.

---

# 102. Preview שומר context

סגירה מחזירה:

* לאותו scroll.
* לאותה selection.
* לאותו active group.

---

# 103. Preview עם selection mode

אפשר Space לבחור/לבטל.

---

# 104. Compare

אם 2–4 תמונות selected:

Action:

`השווה`

---

# 105. Compare view

2–4 תמונות side-by-side.

שימושי להחליט:

* duplicate.
* חדות.
* expression.
* לאיזה רצף משתייכת.

---

# 106. Compare לא חובה לסבב הראשון

אבל architecture selection צריך לאפשר אותו.

---

# 107. Duplicate families

אם מערכת duplicate detection כבר יודעת לזהות near-duplicates:

להציג stack indicator.

למשל:

`+4 דומות`

---

# 108. פתיחת stack

Popover/overlay.

לא לערום חמש תמונות כמעט זהות ב־Contact Sheet אם אפשר לעזור.

---

# 109. Duplicate לא אומר למחוק

רק grouping visual.

---

# 110. Pick best

בעתיד אפשר:

`שמור את הטובה`

אבל לא כחלק הכרחי ממסך הרצפים.

---

# 111. מצב אחרי שסיימתי חלוקה

לא להציג:

`כל התמונות שויכו, אפשר להמשיך`

ולסגור את כלי העבודה.

המסך נשאר שימושי גם אחרי 100% שיוך.

---

# 112. למה

כי החלוקה אינה חד־פעמית.

הצלם תמיד עשוי:

* להזיז תמונה.
* לפצל.
* למזג.
* לתקן.

---

# 113. Unassigned = 0

Tile נשאר.

Count:

`0`

אפשר dim.

לא להעלים אותו.

---

# 114. Empty active group

אם רצף ריק:

מרכז workspace:

**הרצף ריק**

`גרור לכאן תמונות או בחר תמונות מרצף אחר.`

---

# 115. לא למחוק רצף ריק אוטומטית

הצלם אולי הכין אותו מראש.

---

# 116. Context menu על thumbnail

Right-click:

* פתח
* העבר אל…
* רצף חדש מהתמונה
* הוצא מהרצף
* קבע שער
* הצג בתיקייה
* מידע

---

# 117. Context menu על selection

אם right-click על selected frame:

פעולות על כל selection.

---

# 118. Context menu על group tile

* שינוי שם
* קבע שער
* בחר הכל
* פצל
* מזג
* מחק

---

# 119. Keyboard

חובה למשתמש מתקדם.

---

# 120. חצים

`← / →`

עוברים thumbnail.

ב־RTL צריך לבדוק ידנית orientation, אבל לא לשנות semantic order של timeline.

---

# 121. Space

toggle selection של focused frame.

---

# 122. Shift + arrows

מרחיב selection.

---

# 123. Ctrl/Cmd + A

אם focus ב־Contact Sheet:

select all visible frames.

לא global app.

---

# 124. Escape priority

Esc סוגר לפי stack:

1. context menu.
2. popover.
3. preview.
4. clears selection.

---

# 125. M

אפשר לפתוח Move To.

רק אם אין input בפוקוס.

---

# 126. N

New sequence from selection.

---

# 127. Enter

Preview focused frame.

---

# 128. Delete

לא למחוק קובץ.

אפשר:

`הוצא מהרצף`

רק אם זה חד־משמעי.

המלצה:

לא להשתמש Delete לפעולה הזו בתחילה.

---

# 129. Undo/Redo

חובה.

---

# 130. פעולות Undoable

* יצירת רצף.
* שינוי שם.
* העברת תמונה.
* bulk move.
* פיצול.
* מיזוג.
* reorder.
* cover change.
* פירוק.
* deletion של רצף.

---

# 131. History granularity

Bulk action = entry אחד.

Drag reorder = entry אחד.

Typing rename = entry אחד אחרי blur/Enter.

לא כל keystroke.

---

# 132. Persistence

שמירה אוטומטית.

לא כפתור Save.

---

# 133. Save indicator

רק אם חשוב:

`שומר…`

`נשמר`

Error ברור במקרה failure.

---

# 134. Optimistic UI

כל שינוי מתרחש מיד בזיכרון.

Persistence מאחור.

כמו שכבר עושים ב־store.

---

# 135. Write failure

אם project.json לא נשמר:

לא להעמיד פנים שהכול תקין.

Banner:

`השינויים מוצגים במסך אך לא נשמרו לדיסק.`

כפתור:

`נסה שוב`

---

# 136. Remove Batch / recipe safety

כיום `removeBatch` מסיר גם `recipe.perBatch[id]`.

לפני redesign:

לכתוב tests.

חייבים לוודא:

* Move frame לא מוחק recipe.
* Unassign frame לא מוחק recipe של group.
* רק מחיקת group מוחקת recipe.
* Undo של מחיקת group מחזיר גם recipe.

---

# 137. שינוי membership של קבוצת עריכה

אם מעבירים frame מקבוצה A ל־B:

ה־per-frame override שלו נשאר.

ה־perBatch הפעיל עליו משתנה מ־A ל־B.

זו ההתנהגות הנכונה.

---

# 138. רצפים לא משפיעים על color recipe

שינוי Story Moment:

אסור שישנה pixel אחד.

---

# 139. זו הפרדה חשובה

Story organization = metadata.

Edit batch = processing context.

---

# 140. סדר צילום

ברירת המחדל ב־Contact Sheet:

capture time ascending.

---

# 141. Frames ללא timestamp

בסוף.

Badge קטן:

`ללא זמן`

---

# 142. timestamps זהים

tie-break:

filename או import order יציב.

---

# 143. Sort

אפשר בעתיד:

* זמן צילום
* שם קובץ
* rating

אבל רצפים עצמם תמיד נחשבים כרונולוגיים כברירת מחדל.

---

# 144. RTL

UI עברי.

אבל נתונים כרונולוגיים חייבים להיות directionally isolated.

---

# 145. שעות

`dir="ltr"`.

---

# 146. filenames

`dir="ltr"`.

---

# 147. ranges

`<bdi dir="ltr">17:41–17:45</bdi>`

---

# 148. numbers

Tabular/mono where useful.

---

# 149. Loading

לא להציג screen blank.

---

# 150. Loading frames

Skeleton contact sheet.

---

# 151. Loading previews

thumbnail skeleton באותו ratio.

לא layout shift.

---

# 152. preview processing

אם image preview engine עובד:

תמונה יכולה להראות placeholder רגעית.

לא טקסט „המראה נטען…” על עשרות thumbnails אם אפשר להימנע.

---

# 153. Virtualization

חשוב מאוד.

אם יש 2,000 thumbnails, לא לרנדר 2,000 DOM images בו־זמנית.

---

# 154. להשתמש virtualization

לדוגמה:

* react-window
* react-virtualized
* TanStack Virtual

או implementation מתאים ל־grid.

---

# 155. Lazy image loading לא מספיק

גם DOM של אלפי figures יקר.

צריך virtualized grid.

---

# 156. thumbnail sizes

לבקש מה־preview engine image בגודל המתאים.

לא לטעון 4K thumbnail.

---

# 157. Prefetch

כשהמשתמש גולל:

prefetch 1–2 viewport קדימה.

---

# 158. switching groups

כשעוברים group:

לא למחוק cache של thumbnails.

---

# 159. search/filter performance

לעשות memoization.

לא recompute expensive metadata בכל render.

---

# 160. Selection state

Set של stable IDs/names.

לא array.

כמו שכבר נעשה ב־`Batches.tsx`.

---

# 161. selection anchor

לשמור stable frame id.

לא index בלבד.

כי filtering/sorting יכול לשנות index.

היום הקוד שומר `anchor` כאינדקס של pool. זה מספיק למסך הפשוט הנוכחי, אבל פחות robust למסך עם filters/reorder.

---

# 162. Range select

לחשב לפי current visible ordered list.

---

# 163. שינוי filter בזמן selection

Selection נשארת.

לא נזרקת.

---

# 164. שינוי active group

המלצה:

selection מתנקה כברירת מחדל.

כי אחרת המשתמש עלול להעביר בטעות frames מקבוצה קודמת.

---

# 165. exception

אם שינוי active group הוא חלק מ־Move workflow:

הפעולה מסיימת selection.

---

# 166. Visual selection

לא overlay כהה.

כיום העיקרון בקוד טוב: outline והחלשת לא־נבחרים במקום לצבוע את התמונה.

להשאיר את העיקרון.

---

# 167. לא־נבחרים

לא הייתי מוריד ל־55% opacity כמו היום במצב עם הרבה תמונות.

זה אגרסיבי מדי.

להשתמש:

`0.72–0.82`

או border ברור יותר לנבחרים.

---

# 168. selected thumbnail

* 2–3px brand outline.
* checkbox filled.
* אולי elevation מינימלי.

---

# 169. selected count

ברור מאוד.

לא צריך accent בכל ה־toolbar.

---

# 170. Group tile selected

אינו אותו state כמו selected photo.

צריך visual language שונה.

---

# 171. Focus vs Selected

שלושה states:

* focused.
* selected.
* active group.

לא להשתמש באותה מסגרת לכולם.

---

# 172. Focus

1px neutral/light highlight.

---

# 173. Selected

2px brand.

---

# 174. Active group

bottom indicator או background.

---

# 175. Responsive desktop

הכלי מיועד desktop.

---

# 176. 1920px

Full strip + 8–10 thumbnails.

---

# 177. 1440px

6–8 thumbnails.

---

# 178. 1280px

5–7.

---

# 179. מתחת 1000px

Group strip עדיין horizontal.

Toolbar יכול wrap.

---

# 180. אין צורך mobile authoring כרגע

לא להשקיע בזה.

---

# 181. Scroll ownership

המסך:

* group strip scroll אופקי.
* contact sheet scroll אנכי.
* אין page scroll נוסף אם אפשר.

---

# 182. Sticky strip

רצועת הקבוצות נשארת למעלה בזמן scroll.

---

# 183. Sticky selection toolbar

גם נשארת נגישה.

---

# 184. Scroll restoration

כשעוברים מ־A ל־B וחוזרים ל־A:

אפשר לשמור scroll position לכל group.

מאוד נוח.

---

# 185. Full project chronological view

אם בוחרים „הכול”:

אפשר להציג separators בין רצפים.

---

# 186. separator

פס דק עם:

`חופה · 74`

לא card.

---

# 187. Drag ב־All view

אפשר לגרור frame ל־group tile.

---

# 188. Boundary editing ב־All view

זה המקום הכי טבעי ל־split by boundary.

---

# 189. Mode: Organize

אפשר להוסיף toggle:

`ארגון`

כאשר active:

ה־All view מציג רצפים כרצועות כרונולוגיות.

זה יכול להפוך בעתיד ל־workflow הראשי.

---

# 190. Group suggestions

אם engine כבר מחזיר clusters:

לא ליצור אותם אוטומטית לתוך project state.

להחזיק:

```ts
suggestedMoments
```

בנפרד.

---

# 191. Accept

הופך suggestion ל־StoryMoment אמיתי.

---

# 192. Reject

נשאר כ־decision metadata.

---

# 193. naming suggestions

אפשר בעתיד עם vision:

* חופה
* משפחה
* ריקודים

אבל לא תלוי בזה.

---

# 194. לא לבנות AI לפני interaction

המסך חייב להיות מעולה גם כשהאוטומציה טועה.

---

# 195. Progressive automation

שלב 1:

ידני מהיר.

שלב 2:

time-gap suggestions.

שלב 3:

visual similarity.

שלב 4:

semantic scene recognition.

---

# 196. Album integration

Story Moments יהיו input חשוב לאלבום.

---

# 197. אבל לא equality קשיחה

Moment ≠ spread.

רצף יכול להפוך:

* לכפולה אחת.
* לשלוש כפולות.
* לא להיכנס בכלל.

---

# 198. Album engine reads moments

למשל:

```ts
momentId
momentOrder
momentFrameIds
cover
```

ואז מחליט pagination.

---

# 199. Lock between album and moments

שינוי Story Moment לא צריך לשבור album spreads שכבר נעולים.

---

# 200. future album behavior

אם האלבום עדיין auto/unlocked:

אפשר להציע regenerate affected spreads.

לא לעשות עכשיו.

---

# 201. Client selection integration

אם לקוח בחר תמונות:

אפשר filter:

`בחירת הלקוח`

בתוך כל Story Moment.

---

# 202. useful counts

על tile:

`74`

אפשר sub-count:

`18 נבחרו`

רק אם selection stage כבר רלוונטי.

---

# 203. לא להעמיס tile

ברירת מחדל:

שם + count + time.

כל היתר on demand.

---

# 204. status indicators

אם group has edit recipe:

בקבוצת עריכה אפשר dot קטן.

לא text „נערך”.

---

# 205. Story Moment לא צריך status עריכה

---

# 206. Rename keyboard

F2 אופציונלי.

---

# 207. Bulk rename לא נחוץ

---

# 208. Move confirmation

לא צריך.

Undo מספיק.

---

# 209. Merge confirmation

Story moments:

לא צריך אם Undo קיים.

Edit batches עם different recipe:

כן.

---

# 210. Delete confirmation

כן לקבוצה.

---

# 211. Split confirmation

לא.

---

# 212. Reset all organization

פעולה מסוכנת תחת settings/debug בלבד.

---

# 213. Import existing batch assignments

Migration:

ה־Batch הקיים נשאר Edit Batch.

לא להמיר אותו אוטומטית ל־Story Moment.

---

# 214. Story Moments initial migration

Projects קיימים:

`moments = []`

`momentAssign = {}`

בלי לשקר שיש organization.

---

# 215. Optional bootstrap

כפתור:

`העתק קבוצות עריכה כרצפים`

רק אם המשתמש מבקש.

זה יכול להיות starting point.

---

# 216. לא automatic migration

כי semantics שונים.

---

# 217. Component architecture

מומלץ:

```text
GroupWorkspace
  GroupHeader
  GroupStrip
    GroupTile
  GroupToolbar
  ContactSheet
    PhotoCell
  SelectionToolbar
  MoveMenu
  NewGroupPopover
  GroupContextMenu
  PhotoPreview
  GroupTimeline
```

---

# 218. Data adapter

```ts
interface GroupAdapter {
  groups: Group[];
  assignment: Record<string, string>;
  createGroup(...): void;
  moveFrames(...): void;
  deleteGroup(...): void;
  renameGroup(...): void;
  reorderGroups(...): void;
  setCover(...): void;
}
```

---

# 219. Story adapter

כותב ל־moments.

---

# 220. Edit adapter

כותב ל־batches.

---

# 221. לא לתת ל־UI להכיר recipe internals

GroupWorkspace לא צריך לדעת ש־Edit Batch מחזיק perBatch recipe.

ה־adapter מטפל בזה.

---

# 222. Store APIs חדשים

להוסיף:

```ts
reorderBatches(projectId, orderedIds)
```

כיום יש `order` במודל, אבל לא מצאתי API קיים לשינוי הסדר.

---

# 223. Moments APIs

```ts
useMoments(projectId)
momentsOf(projectId)
framesInMoment(projectId, momentId)
unassignedMomentFrames(projectId)
addMoment(projectId, name, frames)
assignFramesToMoment(projectId, frames, momentId | null)
renameMoment(projectId, id, name)
removeMoment(projectId, id)
reorderMoments(projectId, orderedIds)
setMomentCover(projectId, id, frame)
```

---

# 224. Bulk API

לא לקרוא:

```ts
assignFrame()
```

בלולאה מה־UI.

API אחד מקבל array.

---

# 225. transaction

רצוי store mutation אחת.

---

# 226. History

אם store לא כולל history:

לבנות command history scoped ל־group organization.

---

# 227. Command model אפשרי

```ts
{
  type: 'move-frames',
  frameIds: [...],
  before: {...},
  after: {...}
}
```

---

# 228. לא לשמור full project snapshot לכל click אם project גדול

אפשר diff-based history.

אבל אם state קטן, snapshot acceptable.

---

# 229. tests — Store

חובה test ל:

`assignFrames`.

כבר קיימת פונקציה מרכזית לכך.

---

# 230. test: move single

Frame A:

Batch 1 → Batch 2.

---

# 231. test: bulk move

20 frames:

mixed origins → Batch 3.

---

# 232. test: unassign

Batch → null.

---

# 233. test: group delete

All member frames → null.

---

# 234. test: Edit Batch delete

Recipe removed only for deleted group.

---

# 235. test: StoryMoment delete

No edit recipes touched.

---

# 236. test: reorder

Membership unchanged.

---

# 237. test: rename

Membership unchanged.

---

# 238. test: cover moved

Fallback chosen.

---

# 239. tests — UI

Range select.

---

# 240. Shift

A → Shift D = A,B,C,D selected.

---

# 241. Ctrl toggle

Removes/returns one.

---

# 242. filter + range

Only visible order.

---

# 243. move

selected images leave current workspace.

---

# 244. Undo move

return to same groups.

---

# 245. drag selection

moves entire selected set.

---

# 246. drag unselected

only dragged frame.

---

# 247. switch group

selection reset.

---

# 248. merge

source disappears.

---

# 249. undo merge

source restored with correct name/order/members.

---

# 250. split

new group inserted correctly.

---

# 251. accessibility

Checkboxes real inputs/buttons.

---

# 252. Group tile

`button` or semantic interactive element.

---

# 253. Drag not exclusive

כל drag action חייב להיות אפשרי גם דרך toolbar.

---

# 254. keyboard focus

visible.

---

# 255. aria labels

`העבר 18 תמונות לחופה`

לא generic „העבר”.

---

# 256. performance acceptance

1,500 photos.

Scrolling smooth.

---

# 257. Group switching

לא freeze של שנייה.

---

# 258. bulk move 300 frames

UI updates under ~100ms perception אם possible.

Disk save יכול להיות async.

---

# 259. no full engine rerender

שינוי StoryMoment לא מפעיל image processing.

---

# 260. Edit Batch move

יכול לשנות previews בגלל recipe.

לא לחסום assignment עד preview recompute.

---

# 261. preview stale state

אם transferred frame עדיין מציג old grade לרגע:

אפשר small loading indicator.

לא freeze.

---

# 262. CSS — למחוק behavior הנוכחי

היום `.bat-row.on` מתרחב, בעוד `.bat-bar` נשאר constrained, וגריד התמונות מוכנס לתוך אותו row. זה בדיוק המבנה שצריך להפסיק להשתמש בו.

---

# 263. לא להשאיר `open: string | null`

ה־state החדש:

```ts
activeGroupId: string | 'unassigned' | 'all'
```

---

# 264. אין open/closed

Group strip תמיד קיים.

Workspace תמיד קיים.

---

# 265. למחוק buttons

`פתח`

`סגור`

---

# 266. „פרק”

להחליף ב:

`מחק קבוצה`

בתוך `⋯`.

---

# 267. „החזר לבריכה”

להחליף בשפה עקבית:

`הוצא מהרצף`

או:

`ללא שיוך`

---

# 268. „בריכה”

המושג יכול להישאר בקוד.

לא בממשק.

בממשק:

**ללא שיוך**

---

# 269. „מקבץ”

לשמור רק לקבוצות עריכה אם אפשר.

---

# 270. Story UI terminology

* רצף
* ללא שיוך
* העבר לרצף
* צור רצף
* פצל רצף
* מזג רצפים

---

# 271. Edit UI terminology

* קבוצת עריכה
* ללא קבוצה
* העבר לקבוצה
* צור קבוצת עריכה
* פצל קבוצה
* מזג קבוצות

---

# 272. Microcopy

לא:

`94 תמונות במקבץ הזה.`

כן:

`94 תמונות`

---

# 273. helper text

לא להשאיר פסקת הוראות Shift תמידית.

---

# 274. onboarding first-use בלבד

אם זו הפעם הראשונה:

small tooltip:

`בחר תמונה. Shift בוחר טווח.`

נעלם אחרי interaction.

---

# 275. Advanced shortcut help

`?`

פותח shortcuts.

---

# 276. Empty first run

אם אין רצפים:

ה־Contact Sheet מציג את כל התמונות.

Header:

**התחל לחלק את יום הצילום**

Sub:

`בחר תמונות וצור מהן רצף, או בקש הצעה אוטומטית.`

---

# 277. Primary first-run action

`הצע רצפים`

רק אם engine זמין.

Secondary:

`בחר ידנית`

---

# 278. ידני

נכנס selection mode.

---

# 279. אחרי הרצף הראשון

אין יותר onboarding.

---

# 280. Completion

לא progress 100%.

אפשר count:

`7 רצפים · 0 ללא שיוך`

זה מספיק.

---

# 281. האם חייבים לשייך הכול?

לא.

כמו שהקוד הקיים כבר מניח, תמונות שלא קיבלו group יכולות להישאר בלי group.

---

# 282. Album behavior with unassigned

Album engine יכול להתחשב בהן בנפרד.

לא לזרוק אותן.

---

# 283. Smart suggestions — architecture

API עתידי:

```ts
suggestMoments(projectId): SuggestedBoundary[]
```

---

# 284. SuggestedBoundary

```ts
interface SuggestedBoundary {
  afterFrameId: string;
  confidence: number;
  reasons: Array<
    'time-gap' |
    'visual-change' |
    'people-change' |
    'lighting-change'
  >;
}
```

---

# 285. UI reason

Tooltip:

`הצעה: פער של 8 דקות ושינוי משמעותי בסצנה`

---

# 286. לא להציג technical embedding score

---

# 287. smart names

API נפרד.

---

# 288. smart name never overwrites manual name

---

# 289. Analytics/telemetry פנימי אם קיים

כדאי למדוד:

* מספר moves.
* splits.
* merges.
* auto suggestions accepted.
* auto suggestions rejected.

בלי לזהות תוכן תמונות.

---

# 290. למה

כך אפשר לשפר engine לפי behavior אמיתי.

---

# 291. Acceptance Criteria — מסך

כשנכנסים:

רואים:

* strip.
* active group.
* contact sheet.

לא cards ענקיים.

---

# 292. אין accordion

פתיחת group לא משנה column widths.

---

# 293. Contact Sheet תמיד מקבל את רוב המסך

---

# 294. Acceptance — selection

משתמש חדש יכול לבחור 12 תמונות בלי לדעת מה זה Shift.

---

# 295. Acceptance — move

12 selected → existing group בשתי פעולות לכל היותר.

---

# 296. Acceptance — new

12 selected → new group → name → done.

---

# 297. Acceptance — split

קבוצה של 80 → בחירת 25 → new sequence בלי להעביר דרך unassigned.

---

# 298. Acceptance — merge

שתי קבוצות → merge בלי להעביר ידנית תמונה־תמונה.

---

# 299. Acceptance — correction

תמונה אחת במקום הלא נכון → move ישיר.

---

# 300. Acceptance — Undo

כל אחת מהפעולות הנ״ל ניתנת לביטול.

---

# 301. Acceptance — scale

עבודה נוחה עם 1,000+ תמונות.

---

# 302. Acceptance — visual

במסך 1920:

לפחות 6 thumbnails בשורה בגודל medium.

---

# 303. Acceptance — active context

בכל רגע ברור:

* איזה רצף פעיל.
* כמה תמונות בו.
* כמה selected.
* לאן הן יכולות לעבור.

---

# 304. Acceptance — data separation

שינוי Story Moment לא משנה Batch.

שינוי Batch לא משנה Story Moment.

---

# 305. סדר פיתוח

### Phase 1 — Data

להוסיף StoryMoment + assignment.

להוסיף reorder APIs.

להוסיף tests.

---

# 306. Phase 2 — New shell

Group strip.

Active group.

Contact Sheet.

ללא expand.

---

# 307. Phase 3 — Selection

Checkbox.

Range.

Ctrl.

Selection Toolbar.

---

# 308. Phase 4 — Movement

Move to existing.

Unassign.

New group.

Drag & Drop.

---

# 309. Phase 5 — Structural operations

Split.

Merge.

Reorder.

Rename.

Cover.

---

# 310. Phase 6 — History

Undo/Redo.

---

# 311. Phase 7 — Performance

Virtualization.

Prefetch.

Caching.

---

# 312. Phase 8 — Smart assistance

Suggested boundaries.

Auto naming.

---

# 313. לא להתחיל מ־AI

קודם לוודא שהצלם יכול לתקן הכול במהירות.

---

# 314. לפני merge ל־main

להריץ תרחיש אמיתי:

800 תמונות.

---

# 315. Scenario A

כל התמונות Unassigned.

Select 1.

Shift 80.

Create `הכנות`.

---

# 316. Scenario B

Select next 60.

Create `משפחה`.

---

# 317. Scenario C

מצא 3 תמונות שגויות ב„הכנות”.

בחר אותן.

Move → `משפחה`.

---

# 318. Scenario D

`חופה` מכילה 110.

בחר 24.

Create → `כניסה לחופה`.

---

# 319. Scenario E

גלה ש„ריקוד ראשון” ו„ריקודים” צריכים להיות יחד.

Merge.

---

# 320. Scenario F

Undo merge.

---

# 321. Scenario G

גרור 5 selected ל„חופה”.

---

# 322. Scenario H

Filter client-selected.

Select all visible.

Move/new sequence.

---

# 323. Scenario I

סגור פרויקט.

פתח מחדש.

כל membership/order/cover נשמר.

---

# 324. Scenario J

העבר project folder לכונן אחר.

הארגון נשמר.

---

# 325. Definition of Done

הסבב לא גמור אם:

* עדיין צריך „החזר לבריכה” כדי לעבור בין קבוצות.
* עדיין צריך Shift כדי לבצע selection בסיסי.
* עדיין יש open/close cards.
* group נפתח בתוך card צר.
* אין Move To.
* אין Create From Selection.
* אין Undo.
* StoryMoment ו־EditBatch הם אותה ישות.
* reorder לא נשמר.
* מחיקת group יכולה למחוק edit recipe בלי אזהרה.
* 1,000 תמונות גורמות למסך לקרטע.

---

# 326. התוצאה הסופית שאנחנו רוצים

הצלם צריך לעבוד כך:

```text
נכנס לרצפים
→ רואה את כל יום הצילום
→ מסמן טווח
→ יוצר רצף
→ מסמן טווח אחר
→ יוצר עוד רצף
→ מגלה טעות
→ מעביר תמונה ישירות
→ מפצל רצף
→ מאחד שניים
→ מסדר אותם
→ ממשיך הלאה
```

בלי לחשוב על „בריכה”.

בלי לפתוח/לסגור cards.

בלי לפרק ואז לבנות מחדש.

בלי לדעת shortcuts כדי לבצע פעולה בסיסית.

והכי חשוב:

**המערכת צריכה להתייחס לחלוקה כאל נתון חי שאפשר לשנות תמיד, לא כאל שלב חד־פעמי שמסיימים ועוברים הלאה.**

זה השינוי העקרוני ביותר לעומת `Batches.tsx` הנוכחי, שנבנה סביב רעיון של pool שמצטמצם בזמן יצירת מקבצים.

אם בונים לפי המסמך הזה, האזור הזה יכול להפוך בהמשך גם לתשתית מסודרת ל־culling, בחירת לקוח, עריכה אוטומטית ומוח האלבום — בלי לערבב ביניהם את המשמעות של הקבוצות.
