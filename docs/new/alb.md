# מפרט UI/UX מלא למודול האלבומים

## 0. מטרת העבודה

המטרה של הסבב הזה היא לבנות מחדש את חוויית העבודה של מודול האלבומים.

לא נוגעים כרגע באלגוריתם האלבום, בזיהוי התמונות, ב-AI, ב-culling, ב-scoring או בלוגיקה של “המכונה”, אלא אם שינוי קטן נדרש כדי לחבר את ה-UI הקיים.

הבעיה שאנחנו פותרים עכשיו היא:

המערכת כבר יודעת הרבה דברים, אבל היא מציגה לצלם יותר מדי מצבים, יותר מדי כפתורים, יותר מדי החלטות ויותר מדי שכבות בו-זמנית.

היעד:

צלם צריך להיכנס לאלבום ולהרגיש שהוא עובד על **ספר**, לא על מערכת ניהול של תבניות.

המסך צריך להיות שקט.

התמונות והכפולות הן המוצר.

ה-UI הוא כלי שמופיע כשצריך אותו ונעלם כשלא צריך אותו.

---

# 1. עיקרון עליון

## האלבום הוא המרכז. לא הכלים.

אסור שהמסך ייראה כמו:

* Canvas
* Layout panel
* Photo panel
* Navigator
* Toolbar
* Settings
* Inspector
* Export
* Build
* Timeline
* Modes

שכולם מתחרים אחד בשני.

הצלם לא צריך לחשוב:

“אני כרגע ב-Timeline או Organize או Design?”

הוא צריך לחשוב:

“אני עובד על האלבום.”

לכן מבחינת המשתמש קיימים רק שני מצבי עבודה אמיתיים:

### מצב A — האלבום

רואים את הספר כולו.

כל הכפולות.

הקצב.

סדר התמונות.

חלוקת התמונות לכפולות.

זה הבית של האלבום.

### מצב B — עריכת כפולה

נכנסים לכפולה אחת.

היא גדולה במרכז המסך.

עושים תיקונים נקודתיים.

חוזרים לספר.

זה הכול.

אין למשתמש שלושה tabs בשם:

ציר הזמן / האלבום / עריכת כפולה.

למחוק את המודל הזה מה-UI.

---

# 2. מה נשאר מבחינת Routing / State

מבחינה פנימית הקוד יכול להחזיק states שונים, אבל אסור שהם יהיו mental model שהמשתמש צריך להבין.

כל אלבום שייך לפרויקט אחד באופן מפורש. `AlbumProject.projectId` נשמר יחד עם
האלבום, והספרייה בתוך פרויקט מציגה רק אלבומים של אותו `projectId`. אלבום ישן
שנוצר לפני שהשדה היה קיים נשאר נגיש בספרייה הכללית בלבד, עד לפעולת שיוך
מפורשת; אין לנחש שיוך לפי שם לקוח, נתיב או שמות קבצים.

אפשר פנימית להחזיק:

```ts
view = 'library' | 'overview' | 'designer'
```

זה מספיק.

לא:

```ts
'select'
'timeline'
'organize'
'design'
```

כמצבים מקבילים שהמשתמש עובר ביניהם.

אם מסיבות טכניות רוצים לשמור את ה-state הקיים לזמן מה — מותר.

אבל מבחינת UI:

* `timeline` נטמע בתוך Overview.
* `organize` הופך ל-Overview.
* `design` הופך ל-Designer.
* `select` הופך ל-overlay / drawer / picker, לא מסך עבודה בפני עצמו.

---

# 3. הזרימה הראשית החדשה

הזרימה צריכה להיות:

```text
פרויקט
  ↓
אלבומים
  ↓
בחירת אלבום / אלבום חדש
  ↓
המערכת מציגה את האלבום כולו
  ↓
התאמת חלוקת התמונות והכפולות
  ↓
דאבל קליק על כפולה במקרה שצריך תיקון
  ↓
חזרה לאלבום
  ↓
הגהה / אישור / דפוס
```

אין מסכי ביניים מיותרים.

אין שלב “עכשיו אנחנו בונים”.

אין רגע שבו המשתמש ממלא חמישה מסכים ורק בסוף רואה את האלבום.

---

# 4. יצירת אלבום חדש

## למחוק את AlbumCreationWizard מה-flow הראשי

`AlbumCreationWizard.tsx` לא צריך להיות חוויית ברירת המחדל ליצירת אלבום.

כרגע הוא שואל:

1. פורמט ומידות
2. בחירת תמונות
3. כיוון פתיחה
4. סגנון
5. כריכה ושם

זו כמות החלטות גדולה מדי לפני שהצלם ראה אפילו כפולה אחת.

### ההתנהגות החדשה

לחיצה על:

**+ אלבום חדש**

פותחת dialog קטן.

לא מסך מלא.

לא wizard.

לא stepper.

לא חמישה שלבים.

---

# 5. Dialog יצירת אלבום

רוחב מומלץ:

`520–600px`

גובה לפי תוכן.

במרכז החלון.

### תוכן:

כותרת:

**אלבום חדש**

שדה ראשון:

**שם האלבום**

ברירת מחדל אם אפשר:

שם הפרויקט + “אלבום”

למשל:

`משפחת כהן — אלבום`

שדה שני:

**מוצר**

Dropdown אחד.

למשל:

`30×30 Layflat`

אם יש רק מוצר אחד מוגדר — בכלל לא צריך Dropdown.

להציג אותו כטקסט.

שורה שלישית:

**מקור התמונות**

אם קיימת בחירת לקוח:

* “בחירת הלקוח — 86 תמונות”
* “כל התמונות בפרויקט”
* “אבחר בעצמי”

ברירת המחדל צריכה להיות בחירת הלקוח אם קיימת.

אם אין בחירת לקוח:

ברירת מחדל: התמונות המסומנות/נבחרות בפרויקט, ואם אין — כל התמונות הזמינות.

### כפתורים

ימין/primary:

**צור אלבום**

שמאל/secondary:

**ביטול**

זה הכול.

---

# 6. מה לא שואלים בזמן יצירת האלבום

לא שואלים:

* צבע רקע.
* סוג כריכה.
* כיוון פתיחה, אלא אם אין ברירת מחדל ידועה.
* style מפורט.
* bleed.
* PPI.
* בית דפוס.
* פרופיל צבע.
* מספר כפולות.
* מספר תמונות לכפולה.
* תבניות.
* density.
* hero image.
* margins.

כל אלה הם או:

1. ברירת מחדל של המוצר,
2. משהו שהמערכת יכולה לבחור,
3. או הגדרה שניתן לשנות מאוחר יותר.

---

# 7. מה קורה אחרי “צור אלבום”

לא עוברים למסך ריק.

לא עוברים ל-picker ואז למסך ריק.

לא אומרים “בנה אלבום”.

מיד:

1. האלבום נוצר.
2. התמונות נכנסות לפי הסדר הקיים.
3. מופעלת החלוקה הקיימת לכפולות.
4. מופעלות הפריסות הקיימות.
5. נפתח Overview.
6. הצלם רואה אלבום שכבר קיים.

אם התהליך לוקח זמן:

האלבום עדיין נפתח מיד.

להציג skeletons במקום כפולות שלא מוכנות.

למשל:

**בונה טיוטה · 14 מתוך 28 כפולות**

לא modal.

לא blocking spinner.

---

# 8. אין יותר “בנה אלבום”

צריך לחפש את כל המקומות שבהם קיימים ניסוחים כמו:

* בנה אלבום
* בניית אלבום
* עיצוב אלבום
* בחירת תמונות ועיצוב אלבום
* עיצוב אלבום מ-X תמונות

ולבדוק אם הם עדיין נחוצים.

ברוב המקרים — למחוק.

האלבום הוא live.

כשחלוקה משתנה — האלבום משתנה.

אין שלב compile שהצלם צריך להבין.

אם שינוי הוא כבד ודורש חישוב:

המערכת עושה אותו.

לא המשתמש.

---

# 9. מסך Overview — המסך החשוב ביותר במודול

זה המסך הראשון שרואים כשפותחים אלבום.

`OrganizeView.tsx` הוא בסיס יותר טוב מהמסכים האחרים.

אבל צריך לבנות אותו מחדש לכיוון הבא.

---

# 10. מבנה Overview

המסך מחולק לשלושה אזורים בלבד:

```text
┌─────────────────────────────────────────────────────┐
│ Header                                              │
├─────────────────────────────────────────────────────┤
│                                                     │
│              כל הכפולות / הספר                     │
│                                                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│ Timeline / Photo strip                              │
└─────────────────────────────────────────────────────┘
```

אין sidebar ימני.

אין layout panel.

אין navigator נוסף.

אין inspector.

---

# 11. Header של האלבום

גובה:

`52–60px`

רקע:

surface שקט בהתאם ל-design system.

קו תחתון דק.

### צד תחילת הקריאה ב-RTL

כפתור Back:

`‹ הפרויקט`

או אם קיימת ספריית אלבומים:

`‹ האלבומים`

אחריו:

שם האלבום.

למשל:

**משפחת כהן — אלבום**

מתחת/לידו מידע משני קטן:

`28 כפולות · 86 תמונות`

לא progress bar.

לא אחוז “כמה תמונות שובצו”.

---

# 12. מרכז Header

אין mode switch.

למחוק לחלוטין:

* ציר הזמן
* האלבום
* עריכת כפולה

אין צורך.

---

# 13. צד הפעולות ב-Header

מקסימום ארבע פעולות ראשיות גלויות:

### Undo

אייקון בלבד.

Tooltip:

`ביטול · Ctrl+Z`

### Redo

אייקון בלבד.

Tooltip.

### Preview

כפתור:

`תצוגה`

### Primary

`מסירה`

או:

`הגהה ומסירה`

כל שאר הדברים תחת תפריט `⋯`.

---

# 14. תפריט ⋯ של Overview

בתוכו:

* הגדרות אלבום
* כריכה ושדרה
* בדיקת דפוס
* שכפול אלבום
* שינוי שם
* מחיקת אלבום

לא להציג את כל אלה ב-header בו-זמנית.

---

# 15. אזור הספר

הרקע מסביב לכפולות צריך להיות כהה/ניטרלי מספיק כדי לשפוט תמונות.

הוא לא צריך להיות “דשבורד לבן עם cards”.

הכפולות הן המסמך.

מומלץ להשתמש ב:

`--n-08`

או סביבת canvas דומה לזו של מסך העריכה.

---

# 16. איך מציגים את הכפולות

לא grid צפוף של cards קטנים.

לא “כרטיס מוצר”.

רוצים לראות את הקצב של הספר.

אפשר לבחור אחת משתי פריסות:

### מועדף

עמודה אחת מרכזית של כפולות גדולות.

כל כפולה ברוחב בערך:

`min(900px, 72vw)`

עם מרווח אנכי:

`32–48px`

כך הצלם גולל כמו ספר.

### אופציה למסכים רחבים מאוד

שתי כפולות בשורה, רק כאשר הן עדיין גדולות מספיק לקריאה.

ברירת מחדל: אחת בשורה.

---

# 17. מה מופיע סביב כפולה

במצב רגיל:

כמעט כלום.

מעל הכפולה:

`כפולה 08`

ובאותה שורה:

`עמודים 16–17`

טקסט קטן.

לא badge.

לא card footer גדול.

לא “סטטוס: טיוטה” על כל כפולה אם אין צורך.

---

# 18. Hover על כפולה

רק ב-hover אפשר להראות פעולות.

למשל:

* `עריכה`
* `⋯`

לא toolbar של שישה כפתורים.

---

# 19. פתיחת כפולה

פעולות:

### Single click

מסמן את הכפולה.

לא פותח editor מיד.

מטרת הבחירה:

לאפשר פעולות keyboard ושינוי layout.

### Double click

פותח Designer.

### Enter

אם כפולה מסומנת → Designer.

---

# 20. Cycle layout ב-Overview

זה חייב להיות workflow ראשון במעלה.

כאשר כפולה מסומנת:

`↑ / ↓`

עובר בין layout candidates.

אין צורך לפתוח פאנל פריסות.

על שינוי layout:

להחליף מיד.

לא modal.

לא confirmation.

Undo מחזיר.

---

# 21. חיווי layout

אחרי שינוי עם ↑↓:

Toast קטן:

`מובילה מימין · 84% התאמה`

נעלם אחרי כ-1.5 שניות.

לא לפתוח panel.

לא להשאיר טקסט קבוע.

---

# 22. מעבר בין כפולות

כאשר Overview בפוקוס:

`← / →`

מסמן כפולה קודמת/הבאה.

המסך scrolls אליה אם צריך.

---

# 23. Timeline חייב להיות חלק מה-Overview

לא מסך נפרד.

לא mode בשם “ציר הזמן”.

הוא תמיד נגיש בתחתית Overview.

---

# 24. Timeline — מבנה

גובה ברירת מחדל:

`118–140px`

Dock קבוע בתחתית.

ניתן לכווץ.

Header קטן:

**תמונות**

ליד:

`86`

בקצה השני:

כפתור collapse.

---

# 25. Timeline כשהוא מכווץ

גובה:

`34–40px`

להציג:

`86 תמונות · 28 כפולות`

וחץ לפתיחה.

---

# 26. תמונות ב-Timeline

גובה thumbnail:

בערך `72px`.

לא להציג שם קובץ מתחת לכל תמונה כברירת מחדל.

Tooltip ב-hover מציג שם.

תמונה נבחרת:

outline ברור.

---

# 27. גבולות כפולה ב-Timeline

בין קבוצות יש separator ברור.

ה-separator צריך לקרוא חזותית כ:

**כאן הספר מתחלף לכפולה הבאה.**

לא כקו טכני אקראי.

רוחב hit area:

לפחות `12–16px`.

הקו עצמו יכול להיות 2px.

---

# 28. הוספת Cut

Hover ברווח שאינו cut:

מופיע `+` קטן.

Tooltip:

`פצל לכפולה חדשה`

לחיצה:

יוצרת cut.

מייד:

הכפולות מעל מתעדכנות.

אין כפתור “בנה”.

---

# 29. הסרת Cut

Hover על cut:

הקו מקבל active state.

Tooltip:

`אחד את הכפולות`

לחיצה:

מסירה את cut.

מייד רואים כפולה מאוחדת.

---

# 30. גרירת Cut

עדיף לאפשר גם drag של cut.

המשתמש תופס את הקו ומעביר אותו בין תמונות.

אם המימוש כרגע יקר:

שלב ראשון — click split/merge.

שלב שני — drag.

---

# 31. גרירת תמונה ב-Timeline

גרירת תמונה משנה את סדר הסיפור.

בעת drag:

להציג placeholder.

לא להזיז תמונות בצורה קופצנית.

כאשר drop מתבצע:

* order משתנה.
* הקבוצות נשמרות ככל האפשר.
* layout מתעדכן.

---

# 32. קשר בין Timeline לספר

Hover על תמונה ב-Timeline:

הכפולה שלה מקבלת outline עדין.

Hover על כפולה:

התמונות שלה ב-Timeline מקבלות highlight עדין.

כך המשתמש מבין את הקשר בלי הסבר.

---

# 33. בחירת כפולה ב-Overview

כאשר כפולה selected:

outline נחושת עדין.

לא shadow ענק.

לא רקע כחול.

מסביב לכפולה עצמה, לא סביב card.

---

# 34. Drag של כפולות

אפשר להמשיך לאפשר drag לשינוי סדר הכפולות.

Handle צריך להופיע ב-hover.

לא להפוך את כל הכפולה ל-draggable כי זה מתנגש עם לחיצה ודאבל-קליק.

Handle:

`⋮⋮`

או grip icon.

Tooltip:

`גרור לשינוי סדר`

---

# 35. מחיקת כפולה

לא כפתור קבוע מתחת לכל כפולה.

בתפריט `⋯` של הכפולה.

פעולה:

`מחיקת כפולה`

אם יש בה תמונות:

Dialog:

**למחוק את הכפולה?**

טקסט:

`5 התמונות יחזרו למאגר ולא יימחקו מהפרויקט.`

כפתורים:

`מחיקה`
`ביטול`

---

# 36. כפולה ריקה

לא להשאיר rectangle לבן חסר משמעות.

להציג במרכז:

`כפולה ריקה`

ומתחת:

`גרור לכאן תמונות`

או:

`בחר תמונות מהפס`

לא icon ענק.

---

# 37. תמונות שלא שובצו

בתוך Timeline יש section בסוף:

`לא שובצו · 12`

הוא לא צריך להיות filter ב-Designer.

זה פשוט pool קטן של התמונות שנותרו.

אפשר לגרור ממנו לכפולה/קבוצה.

---

# 38. הוספת תמונות לאלבום

כפתור קטן ב-Timeline:

`+ תמונות`

פותח Photo Picker כ-overlay.

לא עובר למסך חדש.

---

# 39. Photo Picker

רוחב:

עדיף fullscreen overlay כמעט מלא או side sheet רחב.

אבל הוא זמני.

Header:

**הוספת תמונות לאלבום**

מידע:

`126 תמונות בפרויקט · 86 כבר באלבום`

---

# 40. Photo Picker — grid

Grid של thumbnails.

מקסימום שימוש בשטח.

אין cards.

אין filename תמידי אלא אם יש צורך.

Selection checkbox בפינה.

---

# 41. Photo Picker — פילטרים

רק פילטרים שבאמת עוזרים:

* הכול
* לא באלבום
* בחירת הלקוח

אם יש ratings בפרויקט:

אפשר rating.

לא להכניס כרגע:

* analyzed
* used
* available
* current spread

אלה מושגים טכניים מדי.

---

# 42. Photo Picker — פעולות

Footer sticky:

`24 נבחרו`

Primary:

`הוסף 24 תמונות`

Secondary:

`ביטול`

לא “המשך”.

לא “בנה”.

---

# 43. אחרי הוספת תמונות

הן מצטרפות ל-Timeline.

המערכת מציבה אותן לפי הסדר/לוגיקה הקיימת.

אם צריך:

toast:

`24 תמונות נוספו`

זה הכול.

---

# 44. Designer — עיקרון

Designer הוא חדר עבודה על כפולה אחת.

המשתמש נכנס אליו במפורש.

לכן מותר שיהיו בו כלים.

אבל הכלים צריכים להיות מוסתרים עד שהם רלוונטיים.

---

# 45. Layout של Designer

```text
┌────────────────────────────────────────────────────┐
│ Header                                             │
├───────────────┬────────────────────────────────────┤
│ Inspector     │                                    │
│ 320–344px     │              Canvas                │
│               │                                    │
│               │                                    │
├───────────────┴────────────────────────────────────┤
│ Photo strip                                        │
└────────────────────────────────────────────────────┘
```

RTL:

Inspector בצד ימין.

Canvas מקבל את כל השאר.

לא Navigator של כפולות בצד השני.

---

# 46. להסיר את Spread Navigator הצדדי

כרגע יש רשימת כפולות נוספת בצד.

למחוק אותה מ-Designer.

היא מיותרת כי יש:

* Overview.
* keyboard navigation.
* previous/next.

היא גונבת מאות פיקסלים מהקנבס.

---

# 47. Header של Designer

צד ראשון:

`‹ האלבום`

אחריו:

`כפולה 8`

`עמודים 16–17`

---

# 48. Designer header — ניווט

שני כפתורי chevron:

קודמת / הבאה.

אפשר גם:

`8 / 28`

לא צריך משפט “מתוך 57 עמודים”.

היחידה שהצלם עובד בה היא כפולה.

---

# 49. Designer header — פעולות

* Undo
* Redo
* Preview אם צריך
* `⋯`

לא:

* הגדרות אלבום
* כריכה
* build album
* delivery
* preflight ככפתור טקסט גדול
* mode switch

---

# 50. הקנבס

הכפולה צריכה להיות הדבר הגדול במסך.

יעד:

ב-1920×1080 הכפולה צריכה לתפוס בערך 70–80% מהשטח הזמין בין inspector ל-photo strip.

לא להקיף אותה ב-card.

לא shadow דקורטיבי חזק.

---

# 51. Guides

Bleed / safe / gutter:

מוסתרים כברירת מחדל במהלך עיצוב רגיל אם אין בעיה.

כפתור קטן בתפריט View:

`הצג אזורי דפוס`

קיצור אפשרי:

`G`

---

# 52. בעיית דפוס

אם משהו מפר safe/gutter/DPI:

רק אז להציג את החיווי על האלמנט הרלוונטי.

למשל warning icon קטן.

Hover:

`הרזולוציה במסגרת הזו היא 184 PPI. יעד: 300.`

לא להציג כל הזמן legend שאומר מה כתום ומה אפור.

---

# 53. בחירת Frame

Single click על תמונה:

frame selected.

State:

outline דק.

Handles בפינות.

לא toolbar ענק.

---

# 54. הזזת Frame

כאשר selected:

drag frame = הזזת המסגרת.

זה כבר קיים.

להשאיר.

---

# 55. Resize frame

ארבע פינות.

Hit target גדול יותר מהנקודה הוויזואלית.

ה-handle יכול להיות 6–8px, אבל hit area לפחות 16px.

---

# 56. עריכת Crop

Double click על התמונה:

נכנסים ל-image positioning.

Cursor משתנה.

מופיע label קטן מעל/מתחת:

`מיקום תמונה · Esc לסיום`

גרירת התמונה מזיזה אותה בתוך frame.

Wheel עושה zoom.

---

# 57. יציאה מ-Crop

* `Esc`
* double-click מחוץ למסגרת
* click במקום ריק

אין צורך בכפתור “סיום”.

---

# 58. Fit modes

לא להציג תמיד שלושה controls גדולים.

כאשר frame selected, Inspector מציג:

**התאמה**

Segmented control:

`חכם`
`מילוי`
`מלא`

מונחים:

* חכם = smart
* מילוי = cover
* מלא = contain

---

# 59. Smart Crop

ברירת המחדל.

אם המשתמש מזיז ידנית:

המערכת יכולה לעבור ל-cover מאחורי הקלעים.

לא צריך להכריח אותו להבין את זה.

---

# 60. החלפת תמונות

גרירת תמונה מ-photo strip על frame:

אם התמונה לא קיימת בכפולה:

מחליפה את התמונה ב-frame.

אם התמונה קיימת במסגרת אחרת באותה כפולה:

swap.

לא duplicate בטעות.

---

# 61. החלפת שתי תמונות בקנבס

גרירת frame/photo על frame אחר:

Swap.

ה-layout נשמר.

לא rebuild layout.

---

# 62. הוספת תמונה חדשה לכפולה

אם גוררים תמונה לאזור ריק של הכפולה:

כאן צריך להחליט behavior אחיד.

מומלץ:

המערכת מוסיפה את התמונה לקבוצה ומייצרת layout candidate חדש.

לא יוצרת frame freeform אוטומטית.

עם `Ctrl` אפשר force drop אם בעתיד נרצה behavior מתקדם.

---

# 63. הסרת תמונה מהכפולה

כאשר frame selected:

`Delete`

מסיר תמונה מהכפולה ומחזיר אותה ל-“לא שובצו”.

לא מוחק אותה מהפרויקט.

Toast:

`התמונה הוחזרה למאגר`

---

# 64. מחיקת Frame לעומת הסרת תמונה

אלה שתי פעולות שונות.

לא לשים אותן אחת ליד השנייה כשני כפתורים אדומים.

ברירת מחדל:

Delete = מסיר את התמונה.

מחיקת frame היא advanced action בתפריט `⋯` של Inspector.

---

# 65. Inspector — חוק

Inspector אינו “כל האפשרויות שיש במערכת”.

הוא “האפשרויות ששייכות כרגע למה שנבחר”.

אם שום דבר לא selected:

Inspector כמעט ריק.

---

# 66. Inspector כששום Frame לא נבחר

להציג:

### פריסה

שם הפריסה:

`מובילה מימין`

כפתורים:

`↑ פריסה קודמת`
`↓ פריסה הבאה`

או UI קטן של arrows.

מתחת:

`6 תמונות`

אולי:

`התאמה 87`

לא להציג רשימת עשרות templates.

---

# 67. תבניות

ספריית templates מלאה לא צריכה להופיע תמיד.

כפתור:

`כל הפריסות`

פותח popover / drawer.

שם אפשר לראות:

* מומלצות
* שלי
* כל הפריסות

---

# 68. Candidates

ה-layout candidates של המנוע צריכים להיות ראשונים.

לא אחרי כל templates הידניים.

Section:

**מתאימות לכפולה הזו**

לכל candidate:

preview בלבד + שם.

Score לא חייב להיות מוצג למשתמש כברירת מחדל.

המערכת משתמשת בו.

הצלם שופט בעיניים.

---

# 69. למה לא להציג “ציון התאמה 84”

זה מידע של מנוע.

לא מידע שהצלם צריך לפעול עליו.

אפשר לשים tooltip/debug mode.

לא UI רגיל.

---

# 70. Inspector כש-Frame נבחר

להציג רק:

### תמונה

שם קובץ

### התאמה

חכם / מילוי / מלא

### זום

שדה מספרי או slider קטן.

### מיקום

לא sliders X/Y כברירת מחדל.

המשתמש מזיז בקנבס.

אפשר advanced disclosure:

`דיוק מספרי`

ושם X/Y.

---

# 71. להסיר sliders ראשיים של Frame Geometry

לא להציג תמיד:

* רוחב מסגרת
* גובה מסגרת
* מיקום מסגרת X
* גובה בעמוד Y

כי כבר ניתן לגרור ולשנות גודל ישירות.

אם רוצים דיוק:

Section מתקפל:

**מיקום וגודל**

ובתוכו מספרים:

X
Y
W
H

לא sliders.

---

# 72. Inspector hierarchy

דוגמה:

```text
תמונה
IMG_4821.CR2

התאמה
[ חכם | מילוי | מלא ]

זום
108%

────────────

מסגרת
מיקום וגודל ▸

שכבות ▸

────────────

הסרת תמונה
```

זה הכול במצב רגיל.

---

# 73. שכבות

`לחזית / לאחור`

לא floating bar על התמונה כברירת מחדל.

Inspector:

Section:

**סדר שכבות**

* הבא לחזית
* שלח לאחור

רק כאשר רלוונטי.

---

# 74. Photo Strip ב-Designer

בתחתית.

גובה:

`112px` לפי design token הקיים.

Header קטן:

`תמונות`

פילטרים מינימליים.

---

# 75. פילטרים ב-Designer

הייתי משאיר:

* לכפולה
* לא שובצו
* הכול

שלושה.

לא ארבעה/חמישה.

---

# 76. תמונות בכפולה

Thumbnail שמופיע בכפולה הנוכחית:

סימון קטן.

לא badge גדול.

---

# 77. תמונה שנמצאת באלבום אבל לא בכפולה

לא צריך לסמן אותה בצורה חזקה.

אם צריך:

dot קטן.

Tooltip:

`בשימוש בכפולה 12`

---

# 78. סטטוס ניתוח תמונה

להסיר מה-UI הראשי:

`נותחה`
`מנתח`
`ללא ניתוח`

הצלם לא צריך לנהל את pipeline.

אם analysis נכשל ויש לזה השפעה:

רק אז warning.

לדוגמה:

`חיתוך חכם אינו זמין לתמונה הזו`

---

# 79. שם קובץ

ב-photo strip:

לא תמיד.

אפשר tooltip.

אם selected:

Inspector מציג שם מלא.

---

# 80. Empty photo strip

אם אין תמונות בפילטר:

לא box גדול.

טקסט שקט:

`אין תמונות שלא שובצו`

---

# 81. כפתור הוספת תמונות ב-Designer

`+ תמונות`

פותח אותו Photo Picker.

לא file dialog ישירות אם האלבום נמצא בתוך Project.

האלבום צריך להשתמש בתמונות של הפרויקט.

---

# 82. Import קבצים ישירות

ב-project mode לא להציג פעולה שמייבאת קבצים ישירות לתוך האלבום, אלא אם זה behavior מוצר מכוון.

המקור הוא הפרויקט.

אם standalone legacy route חייב את זה טכנית — אפשר להשאיר רק שם.

---

# 83. Layout change keyboard

חובה:

`↑` candidate קודם

`↓` candidate הבא

`←` כפולה קודמת

`→` כפולה הבאה

ב-RTL צריך לבדוק בפועל מה מרגיש נכון למשתמש, אבל לשמור behavior עקבי.

---

# 84. Keyboard shortcuts

Designer:

`Ctrl+Z` Undo

`Ctrl+Shift+Z` / `Ctrl+Y` Redo

`Delete` הסרת תמונה

`Esc` יציאה מ-crop / deselect

`Enter` כניסה לעריכה כאשר רלוונטי

`G` guides

`Space` אפשר reserve ל-pan אם בעתיד יהיה zoom של canvas.

---

# 85. קיצורים לא עובדים בזמן typing

אם focus בתוך:

input
textarea
select

לא להפעיל navigation shortcuts.

---

# 86. Undo

כל פעולה משמעותית היא undoable:

* שינוי layout
* החלפת תמונה
* crop
* zoom
* resize
* move
* הוספת frame
* מחיקת frame
* הוספת/הסרת תמונה
* reorder spread
* שינוי cut

Drag רציף אחד = Undo אחד.

לא מאות entries בזמן pointermove.

---

# 87. Saving

Autosave.

לא כפתור Save.

ב-header אפשר להציג state קטן:

`נשמר`

רק כאשר יש שינוי:

`שומר…`

אם נכשל:

`לא נשמר`

עם action:

`נסה שוב`

---

# 88. לא להציג Toast על כל פעולה

כיום `notice` משמש הרבה.

להפחית.

לא צריך toast עבור:

* frame moved
* frame resized
* photo selected
* layout changed אם רואים אותו

Toast רק כשמידע לא ברור מהמסך:

* נוסף משהו
* משהו נמחק
* export מוכן
* error
* destructive action undone

---

# 89. הגדרות אלבום

לא side panel ענק שמכיל גם product setup וגם צבע רקע וגם guides וגם ICC.

לפתוח Dialog מסודר.

Tabs אם צריך:

### כללי

* שם
* מידות
* כיוון פתיחה
* סגנון

### דפוס

* בית דפוס
* PPI
* bleed
* safe
* color profile
* naming

### ברירות עיצוב

* background
* וכו'

---

# 90. שינוי מידות

פעולה מסוכנת.

כאשר משנים גודל אלבום:

להציג לפני Apply:

`שינוי המידה עשוי לשנות את החיתוכים והפריסות.`

אפשרויות:

`שנה מידה`

`ביטול`

אם אפשר לשמר layouts — לשמר.

---

# 91. הגדרות בית דפוס

זה לא חלק מהעבודה היומיומית.

לכן לא להחזיק אותן פתוחות ליד הקנבס.

הן נמצאות ב:

Album Settings → Print.

---

# 92. Background

אם background הוא החלטה לכל album:

הגדרה כללית.

אם רוצים background פר spread:

פעולה ב-Designer.

לא בשני המקומות ללא היררכיה.

צריך להגדיר:

default album background

ומעליו:

spread override.

---

# 93. Styles

לא tab בשם “עיצובים” שמציג שלושה buttons קבועים ובמקביל style גלובלי במקום אחר.

צריך מקור אחד.

Album style נמצא ב-Album Settings.

בתוך spread אפשר:

`החל סגנון מחדש לכפולה`

אם בכלל צריך.

---

# 94. כריכה

כריכה היא חלק מהאלבום, אבל לא mode שנמצא כל הזמן ב-toolbar.

Overview header → `⋯` → `כריכה ושדרה`

פותח Cover Editor.

---

# 95. Cover Editor

כשנכנסים:

Header:

`‹ חזרה לאלבום`

`כריכה ושדרה`

Canvas גדול.

Inspector ממוקד.

אותו design language כמו Designer.

לא מוצר נפרד.

---

# 96. Preflight

Preflight צריך להיות שקט.

המערכת בודקת כל הזמן.

לא צריך שהצלם ילחץ “בדיקת דפוס” כדי לדעת שיש בעיה.

---

# 97. חיווי Preflight ב-Overview

אם אין בעיות:

לא להציג שום badge ירוק.

שקט = תקין.

אם יש warning:

header:

`2 אזהרות`

אם blocker:

`בעיה אחת מונעת ייצוא`

לחיצה פותחת רשימה.

---

# 98. Preflight Panel

רשימה פשוטה:

```text
כפולה 4
רזולוציה נמוכה בתמונה IMG_4221

כפולה 17
פנים קרובות לקיפול
```

לחיצה על issue:

פותחת את הכפולה ומסמנת את האלמנט.

זה חשוב יותר מתיאור ארוך.

---

# 99. מסירה

Primary CTA ב-Overview.

`הגהה ומסירה`

פותח surface אחד.

---

# 100. Surface מסירה

לא dropdown קטן עם ארבעה דברים שונים.

מסך/Sheet ברור.

שלושה מסלולים:

### תצוגה והגהה

יצירת proof

### אישור לקוח

גרסה וקישור

### דפוס

ייצוא סופי

---

# 101. אם קיימים blockers

אפשר לפתוח Delivery.

אבל Export to print disabled.

להציג:

`יש 2 בעיות שצריך לתקן לפני יצוא לדפוס`

כפתור:

`הצג בעיות`

---

# 102. Preview

Preview הוא viewer.

לא editor.

Dark room.

כפולה גדולה.

Previous / next.

Esc חוזר.

אפשר full-screen.

---

# 103. Library — ספריית האלבומים

הספרייה צריכה להיות פשוטה יותר.

לא כל album card צריך להרגיש dashboard.

---

# 104. Library header

`‹ הפרויקט`

כותרת:

**אלבומים**

Secondary:

`3 אלבומים`

Primary:

`+ אלבום חדש`

---

# 105. Library layout

אם לרוב לפרויקט יש אלבום אחד או שניים:

לא צריך grid ענק של cards marketing-style.

אפשר rows רחבים או cards פשוטים.

לכל album:

Thumbnail אמיתי של הכריכה או הכפולה הראשונה אם קיים.

שם.

מידה.

מספר כפולות.

updated.

status אמיתי.

---

# 106. למחוק “Progress” של כמות תמונות ששובצו

`placedCount / photoCount` אינו בהכרח progress אמיתי.

אלבום יכול להיות טוב גם אם חלק מהתמונות לא נכנסו.

לא להציג `% התקדמות` על בסיס זה.

במקום:

סטטוס workflow אמיתי:

* טיוטה
* ממתין להגהה
* אצל הלקוח
* תיקונים
* מאושר
* מוכן לדפוס

---

# 107. Album card actions

Click על card → open.

`⋯`:

* שינוי שם
* שכפול
* מחיקה

לא צריך CTA נוסף “פתיחת האלבום” אם כל card כבר clickable.

---

# 108. מחיקה

לא `window.prompt`.

לא `window.confirm`.

Dialog מותאם למוצר.

---

# 109. Rename

Inline rename או small dialog.

לא browser prompt.

---

# 110. Empty Library

כותרת:

**עדיין אין אלבום לפרויקט הזה**

טקסט:

`צור אלבום מהתמונות שכבר נמצאות בפרויקט.`

Primary:

`צור אלבום`

לא illustration ענק.

---

# 111. Visual hierarchy כללית

בכל המודול:

הצילום > הכפולה > הפעולה הראשית > UI.

לא להפך.

---

# 112. צבע

להשתמש ב-design tokens הקיימים.

לא ליצור palette חדשה למודול האלבום.

Primary brand:

`--brand`

Canvas:

משפחת `--n-*`

Surfaces:

`--page`, `--card`, `--line`

---

# 113. נחושת / brand

נחושת משמשת:

* selection
* primary action
* active state
* modified indicator

לא:

* כל icon
* כל border
* כל heading
* backgrounds גדולים

---

# 114. אדום

רק:

* failure
* destructive
* blocker אמיתי

לא warning רגיל.

---

# 115. ירוק

לא “הכול בסדר” בכל מקום.

שקט הוא מצב תקין.

ירוק רק אם יש משמעות אמיתית כמו Approved.

---

# 116. Typography

להשתמש במערכת הקיימת.

UI:

Assistant.

Headings:

Rubik.

Data:

IBM Plex Mono.

Data כולל:

* PPI
* מידות
* filenames
* page numbers
* counts טכניים

---

# 117. Copy

כל הקופי בלשון זכר.

לעשות sweep מלא במודול.

להחליף למשל:

`בחרי` → `בחר`

`גררי` → `גרור`

`מלאי` → `מלא`

`הגדילי` → `הגדל`

`הוסיפי` → `הוסף`

לא להשאיר ערבוב.

---

# 118. כפתורים

Primary אחד בכל context.

לא שלושה כפתורים נחושת באותו מסך.

Overview:

Primary = מסירה.

Create dialog:

Primary = צור אלבום.

Photo picker:

Primary = הוסף תמונות.

---

# 119. Icon-only buttons

Undo, redo, close, previous/next יכולים להיות icon-only.

חובה:

aria-label.

Tooltip.

Hit area לפחות 32–36px.

---

# 120. Tooltips

Tooltips לכל icon שאינו חד-משמעי.

Delay קצר.

לא tooltips על כפתורי טקסט ברורים.

---

# 121. Hover

Hover לא משנה geometry.

לא להזיז layout.

רק:

* background
* border
* opacity
* shadow עדין

---

# 122. Pressed state

כפתור pressed צריך להרגיש pressed בהתאם ל-design system.

לא רק החלפת צבע.

---

# 123. Focus keyboard

כל controls מקבלים focus ברור.

לא להסיר outline בלי replacement.

---

# 124. Animation

מעט מאוד.

200ms בערך ל:

* panel
* popover
* hover

לא animation כשמשווים crop/layout.

כאשר מחליפים layout:

אפשר transition קצר מאוד או בכלל לא.

הצלם צריך לשפוט את התוצאה מיד.

---

# 125. Loading states

אין spinner באמצע מסך ריק.

### Loading album

Skeleton spreads.

### Analyzing photo

לא badge על כל thumbnail.

### Export

Progress באזור מסירה.

---

# 126. Errors

Error צריך להסביר:

מה קרה.

מה נשמר.

מה לא נשמר.

מה אפשר לעשות.

לא:

`משהו השתבש`

דוגמה:

`לא ניתן לשמור את שינויי האלבום. העיצוב נשאר פתוח במחשב. נסה שוב.`

---

# 127. Destructive confirmations

רק לדברים שבאמת מאבדים עבודה:

* מחיקת אלבום
* מחיקת spread אם משמעותית
* שינוי product אם גורם rebuild גדול

לא confirmation לכל photo removal כי Undo קיים.

---

# 128. Responsive desktop

המוצר authoring הוא Windows desktop.

יעדי רוחב:

### 1920

חוויה מלאה.

### 1440

חוויה מלאה.

### 1280

Inspector נשאר, canvas קטן יותר.

### מתחת 1100

אפשר לכווץ Inspector overlay.

אין צורך כרגע לבנות album authoring לנייד.

---

# 129. Scroll ownership

חשוב מאוד.

Overview:

הספר עצמו scroll אנכי ראשי.

Timeline scroll אופקי פנימי.

Designer:

Canvas לא צריך scroll page רגיל אם אפשר.

Photo strip אופקי.

Inspector אנכי פנימי.

לא ליצור מצב שיש 4 scrollbars ליד nhau.

---

# 130. Context menus

Right click על spread:

* עריכה
* פריסה אחרת
* שכפול כפולה
* מחיקה

Right click על photo:

* הסר מהכפולה
* פתח בתיקייה / הצג מקור אם יש
* מידע

לא חובה ל-v1 של השינוי, אבל הארכיטקטורה צריכה לאפשר.

---

# 131. שינוי פריסה אחרי עריכה ידנית

אם spread עבר custom frame edits והמשתמש לוחץ ↑/↓:

הפעולה עלולה למחוק manual layout.

צריך warning רק בפעם הראשונה:

**החלפת פריסה תאפס שינויים ידניים בכפולה הזו.**

Checkbox:

`אל תשאל שוב`

כפתור:

`החלף פריסה`

לאזהרה הזו יש הצדקה כי מדובר באובדן עבודה.

---

# 132. Lock spread

אם מנוע אוטומטי עתידי יכול לשנות spreads:

צריך Lock פשוט.

בתפריט `⋯` של spread:

`נעל כפולה`

כאשר locked:

אייקון lock קטן ליד המספר.

המכונה לא משנה אותה.

המשתמש עדיין יכול לפתוח ולערוך ידנית.

---

# 133. Status spread

לא צריך status draft/review/approved על כל spread במצב רגיל.

Review status צריך להופיע רק כאשר יש review פעיל.

לדוגמה:

dot ליד spread עם comment.

---

# 134. הערות לקוח

ב-Overview:

כפולה עם comments:

badge קטן:

`2`

לחיצה עליו:

פותחת comments.

לא להפוך כל spread card ל-review dashboard.

---

# 135. Designer עם comment

אם נכנסו מכיוון comment:

להציג side comment rail קטן או floating comment.

לא לפתוח ReviewWorkspace נפרד אם אפשר בעתיד.

אבל לא חובה בסבב הראשון.

---

# 136. בדיקות UX שחייבות לעבור

## תרחיש 1

צלם נכנס לפרויקט שיש בו 100 תמונות.

לוחץ:

`אלבום חדש`

תוך מספר פעולות מינימלי הוא רואה ספר בנוי.

לא נדרש לעבור חמישה screens.

---

## תרחיש 2

הצלם רואה שכפולה 4 עמוסה מדי.

הוא לוחץ בין התמונות ב-Timeline.

הכפולה מתפצלת.

הספר מתעדכן מיד.

---

## תרחיש 3

הצלם לא אוהב layout בכפולה 7.

מסמן אותה.

↑↓.

תוך שניות מוצא layout אחר.

לא פותח panel.

---

## תרחיש 4

צריך תיקון קטן.

Double-click.

Designer.

מחליף תמונה ב-drag.

מזיז crop.

Back.

חזר לאותה נקודה בדיוק ב-Overview.

---

## תרחיש 5

הצלם רוצה לראות print warning.

לא צריך לחפש “Preflight”.

ה-warning כבר קיים ליד הכפולה הבעייתית.

---

## תרחיש 6

אין בעיות.

אין badges ירוקים.

אין הודעות “הכול תקין”.

המערכת פשוט שקטה.

---

# 137. State restoration

כאשר יוצאים מ-Designer חזרה ל-Overview:

לשמור:

* scroll position
* selected spread
* timeline scroll position
* timeline open/collapsed

המשתמש חוזר בדיוק למקום שממנו הגיע.

---

# 138. פתיחת האלבום מחדש

לשמור:

* spread אחרון
* overview scroll
* designer/overview state רק אם זה הגיוני

המלצה:

כשפותחים Album מה-library → Overview.

לא לפתוח ישר Designer רק כי שם סגר את האפליקציה.

אבל אפשר לסמן “המשך מכפולה 12” בעתיד.

---

# 139. מבנה קומפוננטות מומלץ

אין חובה לבצע refactor מלא מיד, אבל ה-UI החדש צריך לשאוף למבנה הבא:

```text
AlbumStudio
  AlbumLibrary
  AlbumOverview
    AlbumHeader
    AlbumBook
      AlbumSpreadView
    AlbumTimeline
    AlbumPhotoPicker
  AlbumDesigner
    AlbumDesignerHeader
    AlbumCanvas
    AlbumInspector
    AlbumPhotoStrip
  AlbumSettings
  CoverEditor
  DeliveryWorkspace
  PreflightIssues
```

`AlbumStudio.tsx` לא צריך להמשיך לצבור כל control וכל interaction בקובץ אחד.

---

# 140. מה AlbumStudio צריך לעשות

Orchestration.

לא rendering של כל UI.

הוא מחזיק:

* project
* history
* active album
* active spread
* persistence
* routing/view state

והוא מעביר data/actions לקומפוננטות.

---

# 141. מה AlbumOverview עושה

רק:

* מציג spreads.
* selection.
* reorder.
* timeline.
* cuts.
* cycle layouts.
* add photos.
* open Designer.

---

# 142. מה AlbumDesigner עושה

רק spread אחד:

* canvas
* frame selection
* move
* resize
* crop
* swap
* layout candidates
* inspector
* photo strip

---

# 143. לא לשנות עכשיו

לא לשנות במסגרת העבודה הזו:

* אלגוריתם scoring.
* face detection.
* culling.
* identity.
* embeddings.
* מנוע AI.
* grouping intelligence.
* print rendering logic.
* export rendering.
* database architecture.

אם נמצא bug שמונע UI — לתקן נקודתית ולדווח.

---

# 144. לא להמציא state חדש אם קיים state מתאים

המודל כבר מחזיק:

* AlbumProject
* AlbumSpread
* frameSettings
* customSlots
* locked
* status
* PrintProductProfile

להשתמש בו.

לא ליצור “UIAlbumSpread2”.

---

# 145. CSS

`album.css` גדול מאוד.

לא להמשיך להוסיף עוד שכבה של overrides בסוף הקובץ בלי ניקוי.

כאשר מחליפים surface:

למחוק CSS הישן של אותו surface.

לדוגמה:

אם AlbumTimeline הישן כבר לא מסך fullscreen:

למחוק classes שלא בשימוש.

---

# 146. Naming CSS

שמות לפי surface.

למשל:

```css
.album-overview
.album-overview-head
.album-book
.album-spread
.album-timeline
.album-designer
.album-inspector
.album-photo-strip
```

לא `new-v2-final`.

---

# 147. שימוש ב-design tokens

אסור להמציא:

```css
#f6f6f6
#333
padding: 17px
border-radius: 13px
```

אם יש token מתאים.

Spacing על grid 4px.

---

# 148. Accessibility

כל button הוא `<button>`.

לא `<span onClick>` אלא אם יש סיבה חריגה.

Frame canvas יכול לדרוש exception, אבל actions מסביב צריכים להיות semantic.

---

# 149. Alt

Thumbnails דקורטיביים ב-strip:

`alt=""`

כאשר השם כבר קיים ב-UI.

תמונה מרכזית יכולה להשתמש בשם.

---

# 150. Confirmation של איכות

לפני שמכריזים שה-redesign הסתיים, חייבים לבדוק את ה-flow הבא מקצה לקצה:

```text
Project
→ Albums
→ New Album
→ Overview
→ split
→ merge
→ reorder photo
→ cycle layout
→ open Designer
→ swap photo
→ crop
→ resize frame
→ Undo
→ Back
→ Preview
→ Preflight issue
→ Delivery
```

כל transition צריך להרגיש כמו אותו מוצר.

---

# 151. Acceptance criteria — יצירת אלבום

המשימה נחשבת גמורה רק אם:

* אין wizard בן חמישה שלבים.
* אפשר ליצור אלבום בדיאלוג יחיד.
* אלבום חדש נפתח עם תוכן.
* אין כפולה ריקה כנקודת התחלה אם יש תמונות.
* אין CTA נוסף “בנה אלבום”.

---

# 152. Acceptance criteria — Overview

* כל הכפולות נראות.
* Timeline נמצא באותו מסך.
* split/merge משפיע live.
* אפשר reorder תמונות.
* אפשר reorder spreads.
* ↑↓ משנים layout.
* double click פותח Designer.
* אין mode switch.
* אין inspector.
* אין layout sidebar.

---

# 153. Acceptance criteria — Designer

* כפולה אחת גדולה.
* Inspector אחד.
* Photo strip אחד.
* אין spread navigator צדדי.
* direct manipulation היא הדרך הראשית.
* sliders של geometry אינם הדרך הראשית.
* crop עובד ב-drag.
* zoom עובד wheel.
* swap עובד drag.
* Back מחזיר לאותו מיקום ב-Overview.

---

# 154. Acceptance criteria — Chrome

בכל רגע המשתמש צריך להבין תוך פחות משנייה:

1. איפה אני?
2. על איזה אלבום/כפולה אני עובד?
3. מה הפעולה הראשית עכשיו?
4. איך אני חוזר?

אם צריך לקרוא toolbar שלם כדי לדעת — נכשלנו.

---

# 155. סדר מימוש

לא לעשות הכול ביחד.

## שלב 1 — למחוק complexity

* להסיר mode switch.
* להסיר wizard מה-flow.
* להסיר spread navigator מ-Designer.
* להסיר duplicate actions.
* להפחית inspector.

לא לשנות עיצוב עדיין בצורה דרמטית.

המטרה: architecture UX נקייה.

---

## שלב 2 — Overview

לבנות Overview נכון:

* book
* timeline dock
* selection
* layout cycling
* direct navigation

---

## שלב 3 — Designer

לנקות:

* header
* canvas
* inspector
* photo strip

---

## שלב 4 — Library/Create

לנקות library.

dialog חדש ליצירה.

---

## שלב 5 — Settings/Delivery/Preflight

לאחד ולנקות secondary flows.

---

## שלב 6 — Polish

רק בסוף:

* spacing
* animation
* hover
* typography
* tooltips
* keyboard focus
* empty states

---

# 156. כלל חשוב בזמן המימוש

לא “לייפות” UI ישן שאמור להיעלם.

אם החלטנו שה-Spread Navigator לא קיים — לא להשקיע שעה ב-CSS שלו.

אם Wizard נעלם — לא לתקן את האנימציות שלו.

אם mode switch נעלם — לא לשפר את הכפתורים שלו.

קודם architecture של החוויה.

אחר כך pixels.

---

# 157. מה אני רוצה לראות אחרי שלב 1

אני פותח אלבום קיים.

אני צריך לראות:

* שם האלבום.
* הספר כולו.
* Timeline למטה.
* כפתור מסירה.
* מעט מאוד דברים נוספים.

אני לא רוצה לראות:

* שלושה modes.
* עשרות templates.
* sliders.
* print settings.
* מאגר תמונות ענק.
* navigator כפול.
* build button.

---

# 158. מה אני רוצה לראות אחרי Double Click

אני רוצה שהעולם יצטמצם.

רק:

* הכפולה.
* התמונות הרלוונטיות.
* Inspector קטן.
* Back.

לא “כל המערכת אבל עם כפולה יותר גדולה”.

---

# 159. מבחן ההחלטות

על כל control חדש יש לשאול:

**האם הצלם חייב לקבל את ההחלטה הזו עכשיו?**

אם לא:

לא להציג אותו.

אם המערכת יודעת לבחור ברירת מחדל טובה:

המערכת בוחרת.

אם מדובר בהחלטה נדירה:

להכניס ל-⋯ / Settings / advanced.

---

# 160. מבחן השטח

על כל panel יש לשאול:

**האם הוא חשוב יותר מהתמונה?**

אם לא:

אסור לו לקחת שטח קבוע מהקנבס.

---

# 161. מבחן החזרתיות

על כל action יש לחפש:

האם היא קיימת בעוד מקום?

אם כן:

לבחור בית אחד ברור.

דוגמאות:

הוספת תמונות.

Build.

Settings.

Preflight.

Export.

Layout choice.

---

# 162. מבחן המקצוען

הצלם עובד שעות.

לכן:

* פחות clicks.
* פחות eye travel.
* keyboard.
* direct manipulation.
* persistent context.
* no modal unless necessary.
* no congratulations.
* no onboarding copy בכל מסך.
* no explanatory paragraphs בזמן עבודה.

---

# 163. מבחן “96%”

פרטים קטנים שחייבים לעבוד:

* cursor נכון על resize.
* pointer hit areas נדיבים.
* Back מחזיר scroll.
* tooltip לא מכסה את התמונה.
* drag לא בוחר טקסט.
* thumbnail לא קופץ בזמן loading.
* layout change לא מאבד selection סתם.
* undo אחרי drag הוא פעולה אחת.
* Escape תמיד סוגר את השכבה הכי פנימית.
* dropdown נסגר בלחיצה בחוץ.
* panel לא נשאר פתוח אחרי navigation.
* keyboard arrows לא גונבים cursor מתוך input.
* RTL arrows נבדקים ביד ולא מניחים.
* תמונה לא נמתחת.
* loading לא משנה aspect ratio.
* scroll position לא קופץ אחרי שינוי layout.
* focus לא נתקע מאחורי modal.
* מחיקה לא מוחקת source photo.
* crop ידני לא מתאפס בשמירה.
* swap לא מאפס layout.
* Back לא יוצר save כפול.
* autosave לא מייצר history entry.
* Undo לא מבטל save.
* opening/closing Timeline לא משנה album data.

---

# 164. הדבר הכי חשוב בסיום

אל תמדוד את ההצלחה לפי:

“כמה פיצ'רים יש במסך”.

תמדוד לפי:

**כמה מהר צלם יכול לקבל אלבום שכבר נראה טוב, לראות את הספר כולו, לזהות 5 מקומות שהוא לא אוהב, לתקן אותם ולצאת.**

זה כל המוצר של מודול האלבום.

ה-UI צריך להיעלם סביב העבודה.
