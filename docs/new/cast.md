# מפרט מלא — בחירת לקוח, תיקונים, גרסאות ואישור

העיקרון העסקי נשאר קשיח:

**בחירה → נעילה → עבודה של הצלם → תיקונים → גרסאות → אישור.**

לא מערבבים בין בחירה לתיקונים. הקוד הנוכחי כבר אוכף שני חוקים נכונים: אי־אפשר לשלוח הערות לפני שהבחירה נסגרה, ואחרי הנעילה אי־אפשר להמשיך לשנות את הבחירה. בנוסף, רק תמונות שנבחרו יכולות לקבל הערות.

גם המנגנון של גרסאות כבר קיים בצורה נכונה עקרונית: הערה שייכת לגרסה שעליה נכתבה, ופרסום גרסה חדשה פותח מחדש את התמונה לאישור הלקוח.

המפרט הבא לוקח את הבסיס הזה והופך אותו למערכת מלאה.

---

# 1. הגדרת המוצר

האזור הזה אינו "גלריה".

מבחינת המוצר יש כאן שני שלבים שונים לחלוטין:

## שלב A — בחירת תמונות

מטרת הלקוח:

**להחליט אילו תמונות נכנסות לכל אחד מהתוצרים שנמכרו לו.**

הפעולות היחידות הרלוונטיות:

בחירה, ביטול בחירה, שיוך לאלבומים, מעקב אחר מכסה, צפייה גדולה, סיום בחירה.

אין תיקונים.

אין הערות.

אין אישורי גרסה.

---

## שלב B — הגהה ותיקונים

מתחיל רק לאחר שהלקוח סיים את הבחירה.

מטרת הלקוח:

**לעבור על התמונות שנבחרו, לבקש תיקונים במידת הצורך, ולאשר את התוצאה.**

הפעולות:

פתיחת תמונה, הצבעה על מקום, בקשת תיקון, צפייה בגרסה חדשה, אישור תמונה.

---

# 2. State machine

לא לנהל את המוצר באמצעות אוסף מקרי של booleans במסך.

להגדיר state עסקי ברור.

```ts
type ClientGalleryPhase =
  | 'draft'
  | 'publishing'
  | 'selecting'
  | 'selection_submitted'
  | 'reviewing'
  | 'approved'
  | 'frozen';
```

אין צורך בהכרח לשמור את כל הערכים האלה בבסיס הנתונים.

חלק מהם יכולים להיות derived state.

לדוגמה:

```ts
if (!publishedAt) draft
else if (!lockedAt) selecting
else if (approvedAt) approved
else reviewing
```

---

# 3. החוק החשוב ביותר

## `lockedAt` הוא קו הגבול

לפני `lockedAt`:

מותר לשנות בחירה.

אסור ליצור הערות.

אחרי `lockedAt`:

אסור לשנות בחירה.

מותר לבקש תיקונים.

זה כבר עיקרון מוכח בקוד ובבדיקות.

לא לשבור אותו.

---

# 4. מבנה מסך הצלם

הגלריה לא צריכה להמשיך להיראות כמו subsection קטן בתוך "בחירה".

זו מערכת עם lifecycle משלה.

בתוך שלב הבחירה בפרויקט יהיה block ברור:

**בחירת לקוח**

עם status.

לחיצה עליו פותחת workspace מלא.

---

# 5. Client Review Workspace — צד הצלם

מבנה:

```text
┌────────────────────────────────────────────────────────┐
│ Header                                                 │
├────────────────────────────────────────────────────────┤
│ Status / summary                                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│ Main workspace                                         │
│                                                        │
└────────────────────────────────────────────────────────┘
```

לא טופס צר של 62em עם הכול אחד מתחת לשני.

---

# 6. Header בצד הצלם

צד אחד:

`‹ הפרויקט`

כותרת:

**בחירת לקוח**

Sub:

`משפחת כהן`

מצד שני:

פעולה ראשית לפי state.

---

# 7. CTA לפי state

לפני יצירה:

**צור גלריה**

בזמן העלאה:

אין CTA.

בזמן בחירה:

**העתק קישור**

אחרי שהלקוח סיים:

**פתח את הבחירה**

בזמן תיקונים:

**הצג בקשות פתוחות**

כאשר הכול מאושר:

**המשך למסירה**

---

# 8. לא להציג הכול תמיד

כיום אותו surface מציג:

קישור, credentials, meters, status, notes, logo, freeze, delete, reopen.

זה יותר מדי.

לחלק לפי relevance.

---

# 9. Navigation בתוך workspace של הצלם

שלושה אזורים בלבד:

**בחירה**
**תיקונים**
**הגדרות**

אבל לא tabs אם phase מסוים עדיין לא קיים.

לפני lock:

בחירה + הגדרות.

אחרי lock:

בחירה + תיקונים + הגדרות.

---

# 10. "בחירה" בצד הצלם

מציג overview בלבד.

לא מאפשר לצלם להתעסק ידנית עם כל selection של הלקוח אלא אם הוא פתח מחדש את הבחירה.

---

# 11. Setup — יצירת גלריה

כיום הצלם בוחר מקור מתוך:

`כל התמונות` או `Batch` אחד.

זה צריך להשתנות.

אחרי ההפרדה שעשינו בין קבוצת עריכה לרצף סיפורי, **אסור להשתמש בקבוצת עריכה כמקור ברירת המחדל לגלריית לקוח.**

---

# 12. בחירת חומר ללקוח

Section:

**מה הלקוח יראה**

ברירת מחדל:

`הנבחרות של הפרויקט`

אפשרויות:

* הנבחרות.
* כל התמונות שסומנו כמוכנות ללקוח.
* רצפים מסוימים.
* בחירה ידנית.

---

# 13. לא להשתמש ב־Edit Batch

קבוצת תאורה אינה הגדרה של "מה הלקוח יקבל".

אפשר עדיין advanced option אם באמת צריך.

לא ברירת מחדל.

---

# 14. Preview של החומר

לפני Publish:

לא להסתפק ב:

`426 תמונות`

להציג strip קטן של thumbnails.

ליד:

**426 תמונות יפורסמו**

Action:

`הצג את כולן`

---

# 15. שינוי הבחירה

`שנה תמונות`

פותח Photo Picker.

אותו contact-sheet infrastructure שהוגדר קודם.

---

# 16. Gallery setup לא יהיה wizard

Surface אחד.

Sections ברורים.

---

# 17. Section 1 — התמונות

כמות + source + preview.

---

# 18. Section 2 — מה הלקוח צריך לבחור

כותרת:

**תוצרים ובחירה**

לא "אלבומים וכמות תמונות".

כי בעתיד יכול להיות:

אלבום זוג.

אלבום הורים.

הדפסות.

בחירת עריכה.

---

# 19. כרגע model יכול להישאר Album

אין צורך לעשות abstraction ענק עכשיו.

אבל בקופי:

**בחירות**

---

# 20. שורה אחת לכל אלבום

לדוגמה:

```text
אלבום הזוג       80 תמונות
הורי החתן        40 תמונות
הורי הכלה        40 תמונות
```

---

# 21. Quota

ה־quota הנוכחי הוא hard limit.

זה נכון.

השרת כבר אוכף שמכסה היא קיר ולא אזהרה בלבד.

להשאיר.

---

# 22. לא לאפשר מספר 0

Minimum:

1.

---

# 23. Add album

`+ תוצר נוסף`

ולא בהכרח `+ אלבום`.

---

# 24. Remove

Icon button קטן.

אם נשאר רק אחד:

אפשר להסיר רק אם מוסיפים אחר.

הגלריה דורשת לפחות אלבום אחד גם היום.

---

# 25. שמות ברירת המחדל

לא לקבע תמיד:

הזוג / הורי החתן / הורי הכלה.

אפשר preset:

**חתונה — 3 אלבומים**

אבל photographer יכול לשנות.

---

# 26. Presets

מאוחר יותר:

`חתונה`

`בר מצווה`

`משפחה`

לא חובה ל־v1.

---

# 27. Gallery name

שם gallery כבר נגזר מהלקוח/פרויקט.

לא צריך לשאול אם אפשר ליצור אוטומטית.

---

# 28. Branding

הלוגו הוא account-level setting, לא project setting.

הקוד הנוכחי כבר מתייחס אליו כמשהו שמופיע בכל הגלריות, כולל קיימות.

לכן להעביר אותו:

**Settings → Brand**

לא להציג upload logo בתוך כל gallery workflow.

---

# 29. CTA לפני הפרסום

**שלח ללקוח**

מתחת:

`426 תמונות · 3 בחירות`

לא:

`צור גלריה ופרסם 426 תמונות`

הלקוח/צלם לא צריכים להבין implementation.

---

# 30. לחיצה על שלח

Dialog סיכום קטן:

**הגלריה מוכנה לפרסום**

`426 תמונות`

`אלבום הזוג — עד 80`

`הורי החתן — עד 40`

`הורי הכלה — עד 40`

Primary:

**פרסם**

Secondary:

`חזור`

---

# 31. Publish progress

הקוד כבר מעלה ב־chunks ולא מפיל את כל התהליך בגלל קובץ אחד פגום.

לשמור.

UI:

**מפרסם את הגלריה**

`184 מתוך 426`

Progress bar.

---

# 32. לא להציג percentage בלבד

המספר חשוב יותר.

`184 / 426`

---

# 33. Failed files

אם 3 נכשלו:

לא להכריז publish success רגיל.

State:

**423 פורסמו · 3 נכשלו**

Actions:

`נסה שוב את 3 הקבצים`

`הצג פרטים`

---

# 34. אין צורך לבטל את 423 הטובים

זה כבר עיקרון נכון ב־publish הקיים.

---

# 35. Credentials

כיום נוצר username + password והסיסמה מוצגת פעם אחת בלבד.

זה נכון.

---

# 36. אחרי Publish

להציג success surface:

**הגלריה מוכנה**

קישור.

שם משתמש.

סיסמה.

Primary:

**העתק הודעה ללקוח**

Secondary:

`פתח תצוגת לקוח`

---

# 37. "העתק הודעה"

לא רק URL.

העתקה בפורמט:

```text
הגלריה שלכם מוכנה.

קישור:
...

שם משתמש:
...

סיסמה:
...
```

---

# 38. אסור להסתיר את הסיסמה לפני שהצלם קיבל הזדמנות

צריך acknowledgment.

לא dialog שנעלם מיד.

---

# 39. לאחר שהצלם עזב

הסיסמה אינה נשמרת plaintext.

זה כבר design נכון.

אם שכח:

**הנפק פרטים חדשים**

---

# 40. הנפקת credentials מחדש

להוסיף confirmation:

**הפרטים הקודמים יפסיקו לעבוד.**

Primary:

`הנפק מחדש`

---

# 41. Preview as client

חובה.

כפתור:

**תצוגת לקוח**

פותח gallery במצב preview.

לא צריך להקליד credentials.

אבל אסור שמצב preview יאפשר לשנות selection אמיתי.

---

# 42. מצב בחירה — צד הצלם

אחרי הפרסום, מסך photographer צריך להיות dashboard קטן וברור.

Header:

**ממתין לבחירת הלקוח**

---

# 43. Summary

לדוגמה:

`הלקוח בחר 63 תמונות`

מתחת meters:

`הזוג 63/80`

`הורי החתן 28/40`

`הורי הכלה 31/40`

---

# 44. אין progress percentage כולל

כי 80+40+40 עשויים לחפוף באותן תמונות.

להציג כל quota בפני עצמו.

---

# 45. Last activity

להוסיף:

`פעילות אחרונה לפני 14 דקות`

לא חובה realtime websocket.

Polling 45 שניות שכבר קיים מספיק למוצר הזה.

---

# 46. Manual refresh

Icon refresh.

Tooltip:

`רענן עכשיו`

---

# 47. Gallery unreachable

הקוד כבר מבדיל נכון בין "אין נתונים" לבין "לא ניתן להגיע לשרת".

להציג:

**לא ניתן לעדכן את מצב הגלריה כרגע**

ולא לאפס counters.

---

# 48. שלב הלקוח — Login

המסך צריך להיות מינימלי.

לוגו.

שם gallery.

שדות:

שם משתמש.

סיסמה.

Primary:

**כניסה לגלריה**

---

# 49. אין "הרשמה"

אין forgot password.

אין email recovery.

הצלם מנפיק credentials חדשים.

זה design מכוון וטוב ב־engine.

---

# 50. Login mobile-first

Touch targets לפחות 44px.

Input font 16px.

Password show/hide button.

---

# 51. טעויות Login

לא:

`401`

כן:

**שם המשתמש או הסיסמה אינם נכונים**

---

# 52. Gallery frozen

אם הוקפאה:

מסך ברור:

**הגלריה אינה זמינה כרגע**

`פנו לצלם לקבלת גישה.`

---

# 53. בחירת הלקוח — Header

Sticky.

לא גדול מדי.

לוגו קטן.

שם.

Sub:

`בחרתם 54 תמונות`

---

# 54. מכסות

הרצועה הקיימת של meters הגיונית.

להשאיר scroll אופקי בטלפון.

אבל לשפר hierarchy.

---

# 55. Meter

לדוגמה:

**הזוג**
`54 / 80`

Progress קטן.

---

# 56. כאשר כמעט מלא

`74 / 80`

לא warning אדום.

---

# 57. מלא

`80 / 80`

State ברור:

**מלא**

---

# 58. Quota exceeded

לעולם לא קורה optimistic UI קבוע.

השרת הוא authority.

כיום הוא מחזיר 409 וה־UI עושה rollback. זה נכון.

---

# 59. הודעת full

לא:

`"הזוג" מלא (80). הסירו תמונה...`

אפשר user copy יותר נקי:

**הגעתם ל־80 תמונות באלבום הזוג.**

`כדי לבחור תמונה אחרת, הסירו אחת מהבחירה.`

---

# 60. Grid

התשתית הנוכחית virtualized ידנית.

זה טוב מאוד ל־600 תמונות בטלפון.

לא לזרוק.

---

# 61. Aspect

כיום grid הוא ריבועים crop.

זה טוב לסקירה מהירה, אבל יכול להסתיר קומפוזיציה.

להוסיף setting קל:

`רשת` / `יחס מקורי`

לא חובה בגרסה ראשונה.

---

# 62. Selection action

ה־heart יכול להישאר.

אבל צריך להיות ברור שזה **בחירה**, לא Favorite.

---

# 63. Icon

לב הוא אינטואיטיבי, אבל semantic copy צריך להגיד:

`בחר תמונה`

ולא "אהבתי".

כיום aria כבר אומר "בחר תמונה".

---

# 64. מה Heart עושה עם כמה אלבומים

הקוד הנוכחי מגדיר במפורש:

Heart = מוסיף לכל האלבומים.

והבדיקות מאמתות זאת.

אם משאירים את החוק הזה, **חייבים להפוך אותו לגלוי**.

---

# 65. בפעם הראשונה שהלקוח בוחר כאשר יש כמה אלבומים

Small tooltip:

**נבחר לכל האלבומים. אפשר לשנות בתוך התמונה.**

לא להציג שוב.

---

# 66. חלופה עתידית

אפשר בעתיד לתת לצלם לבחור default selection policy.

לא להוסיף עכשיו.

---

# 67. Selected state ב־grid

Outline ברור.

Heart filled.

לא overlay כהה.

התמונה צריכה להישאר קריאה.

---

# 68. Tap על התמונה

פותח Lightbox.

Tap על heart:

רק selection.

---

# 69. Lightbox לפני lock

מטרה:

בחירה מדויקת + album assignment.

לא comments.

---

# 70. תמונה

גדולה ככל האפשר.

Dark background.

הקוד הנוכחי כבר עושה את זה.

---

# 71. Navigation

Swipe.

חצים desktop.

Counter:

`123 / 426`

---

# 72. Preload

תמונה קודמת/באה.

כבר קיים.

להשאיר.

---

# 73. Controls לפני lock

Primary:

Heart / `בחר`

מתחת:

album chips.

---

# 74. Chips

אם התמונה נמצאת באלבום:

active.

אם לא:

inactive.

---

# 75. אלבום מלא

Chip disabled כאשר הוספה אליו אינה אפשרית.

אבל אם התמונה כבר בו:

עדיין אפשר להסיר.

---

# 76. Counter לכל album chip

לא חובה בכל chip.

Header meter מספיק.

---

# 77. Rename album by client

כיום הלקוח יכול לשנות שם album.

אני הייתי משאיר אם יש לזה צורך עסקי.

אבל לא באמצעות click על meter name בלי הסבר.

---

# 78. Rename UX

`⋯` ליד שם album:

**שנה שם**

---

# 79. Photographer sees rename

כיום `nameSetByClient` נשמר ומוצג לצלם.

להשאיר.

---

# 80. Bottom CTA בזמן selection

Sticky:

**סיימנו לבחור**

מעליו summary:

`54 תמונות נבחרו`

---

# 81. מתי הכפתור enabled

לא רק `chosen > 0`.

צריך policy.

אם כל quotas חייבים להיות מלאים:

Enable רק כאשר requirements fulfilled.

אם quotas הם maximum ולא required exact amount:

אפשר לסיים לפני המכסה.

---

# 82. לפי הקוד היום quota הוא מקסימום

לא minimum.

לכן לא להכריח fill.

---

# 83. Finish confirmation

Dialog:

**לסיים את הבחירה?**

Summary לפי album.

לדוגמה:

`הזוג 74/80`

`הורי החתן 40/40`

`הורי הכלה 36/40`

---

# 84. אם חסרות תמונות ביחס למכסה

לא error.

Info:

`אפשר לבחור עד 80; בחרתם 74.`

---

# 85. Primary

**כן, סיימנו**

Secondary:

**חזור לבחירה**

---

# 86. אחרי lock

לא להשאיר אותו grid של 426 תמונות.

הקוד הנוכחי כבר מצמצם ל־chosen בלבד. זו החלטה נכונה.

---

# 87. Screen transition

לאחר lock:

Header משתנה.

**הבחירה נשלחה לצלם**

Sub:

`74 תמונות`

---

# 88. אל תכניס מיד את הלקוח למצב תיקונים כאילו הוא חייב להעיר

להציג completion state:

**הבחירה נשלחה.**

`כשהתמונות יהיו מוכנות, תוכלו לעבור עליהן כאן.`

---

# 89. שלב הצלם אחרי lock

ברגע שהבחירה מגיעה:

לא ליצור "מקבץ בחירת הלקוח" כאמת הסמנטית הראשית.

כיום זה נעשה לצורך integration.

אפשר לשמור compatibility זמנית.

אבל source of truth צריך להיות:

```ts
clientSelection
clientAlbums
```

---

# 90. Membership לפי אלבומים נשמר

זה כבר קיים בפרויקט ומיועד לעבור למכונת האלבום.

להשאיר.

---

# 91. Photographer selection view

לאחר lock:

להציג contact sheet של הנבחרות.

Filters:

* הכול
* הזוג
* הורי החתן
* הורי הכלה

---

# 92. תמונה יכולה להיות בכמה albums

לא clone.

אותו frame.

כמה memberships.

---

# 93. missing frames

המערכת כבר מזהה אם הלקוח בחר frame שאינו נמצא יותר בפרויקט ומחזירה את שמו במקום לבלוע אותו בשקט.

זו יכולת קריטית.

---

# 94. Missing UX

לא block ירוק עם רשימה טכנית באמצע.

Banner:

**3 תמונות שנבחרו אינן נמצאות בפרויקט**

Action:

`הצג`

---

# 95. לכל missing

filename.

אילו albums.

Action עתידי:

`מצא קובץ חלופי`

---

# 96. לא silently remove

לעולם.

---

# 97. מעבר משלב Selection ל־Review

צריך state ברור בצד הצלם:

**בחירה התקבלה**

ואז:

**ערוך ושלח להגהה**

---

# 98. Review אינו מתחיל רק כי selection locked

הלקוח סיים את חלקו.

הצלם עדיין עובד.

---

# 99. Photographer ready for review

כשהצלם מוכן:

Action:

**שלח להגהה**

---

# 100. למה זה חשוב

אחרת הלקוח יכול לפתוח את gallery מיד אחרי lock ולהתחיל להעיר על הגרסאות הראשוניות לפני שהצלם בכלל ערך אותן.

זה לא workflow נכון.

---

# 101. לכן להוסיף reviewAvailableAt

```ts
reviewAvailableAt?: number;
```

---

# 102. לפני `reviewAvailableAt`

הלקוח רואה:

**הבחירה נשלחה לצלם**

לא annotation mode.

---

# 103. אחרי `reviewAvailableAt`

הלקוח נכנס ל:

**הגהה**

---

# 104. זה שינוי חשוב לעומת המצב הנוכחי

כיום lock עצמו מאפשר comments.

אני ממליץ לפצל:

`selection locked`

מ־

`review opened`.

---

# 105. Photographer sends first review version

ה־v1 הקיים יכול עדיין להיות preview selection.

אבל review version מבחינת business יכול להיות:

`reviewVersion 1`

גם אם storage technical version הוא v1/v2.

---

# 106. לא לערבב technical image version עם review round

צריך להבדיל:

**Frame Version**

גרסת תמונה.

**Review Round**

סבב הגהה.

---

# 107. Data model

```ts
interface ReviewRound {
  id: string;
  number: number;
  openedAt: number;
  closedAt?: number;
}
```

---

# 108. למה

כי ייתכן שבסבב 2 שונו 12 מתוך 80 תמונות.

לא צריך להעלות v3 לכל 80.

---

# 109. Item review status

```ts
type ReviewItemStatus =
  | 'waiting'
  | 'changes_requested'
  | 'updated'
  | 'approved';
```

---

# 110. Derivation

`waiting`

נשלחה להגהה ועוד לא אושרה.

`changes_requested`

יש comment פתוח.

`updated`

הצלם שלח גרסה חדשה.

`approved`

הלקוח אישר את הגרסה הנוכחית.

---

# 111. `clientDone`

היום יש boolean.

אפשר לשמור אותו compatibility.

אבל UI/business צריכים status עשיר יותר.

---

# 112. הערה היא לא status

לא:

Comment resolved = image approved.

אלה דברים שונים.

---

# 113. מצב Review בצד הלקוח

Grid מציג רק selected frames.

---

# 114. Header

**הגהת התמונות**

Sub:

`52 מתוך 74 אושרו`

---

# 115. Filters

* הכול
* ממתינות
* ביקשתי תיקון
* עודכנו
* אושרו

---

# 116. לא להציג albums כברירת המחדל כעניין המרכזי בשלב הזה

כבר סיימנו selection.

אפשר filter לפי album secondary.

---

# 117. Grid state indicators

בלי badges ענקיים.

בכל thumbnail:

Approved → check קטן.

Requested → comment indicator.

Updated → dot / label קטן `חדש`.

---

# 118. Lightbox Review

זה המסך החשוב ביותר.

מבנה:

```text
┌────────────────────────────────────┐
│ X                  12 / 74         │
│                                    │
│            PHOTO                   │
│                                    │
├────────────────────────────────────┤
│ review / comments / actions        │
└────────────────────────────────────┘
```

---

# 119. Pin comments

הרעיון הנוכחי נכון מאוד.

לקוח לוחץ על מקום בתמונה.

נשמר x/y normalized.

להשאיר.

---

# 120. אבל לא כל comment חייב Pin

צריך שני סוגי בקשה.

### נקודתית

`תוריד את האדם הזה`

עם Pin.

### כללית

`אפשר לעשות אותה שחור לבן?`

ללא Pin.

---

# 121. UI

Button:

**בקש תיקון**

נפתח:

`סמן מקום בתמונה`

או:

`הערה כללית`

---

# 122. Mobile

Tap על התמונה לא אמור תמיד ליצור Pin בטעות.

היום כאשר locked כל click על התמונה מציב pin.

זה מסוכן.

---

# 123. Annotation mode

חובה mode מפורש.

לוחצים:

**סמן תיקון**

רק אז cursor/tap יוצר pin.

---

# 124. אחרי Pin

Marker עם מספר:

`1`

נפתח composer.

---

# 125. Composer

Placeholder:

`מה תרצו לשנות כאן?`

Primary:

`שלח בקשה`

Secondary:

`ביטול`

---

# 126. Pin numbering

אם יש 3 requests:

1, 2, 3.

כך הצלם והלקוח יכולים לדבר באותו הקשר.

---

# 127. Pin לא מכסה את הבעיה

Ring + number offset.

עיקרון ה־ring הקיים טוב.

---

# 128. Comment thread

כאן אני כן ממליץ להרחיב את המודל.

לא chat כללי.

**Thread ששייך לתמונה ולבקשה.**

---

# 129. Model

```ts
interface ReviewThread {
  id: string;
  itemId: string;
  anchor?: { x: number; y: number };
  createdOnVersion: number;
  status: 'open' | 'answered' | 'resolved';
  messages: ReviewMessage[];
}
```

---

# 130. Message

```ts
interface ReviewMessage {
  id: string;
  author: 'client' | 'photographer';
  text: string;
  createdAt: number;
}
```

---

# 131. למה צריך reply של הצלם

לדוגמה:

לקוח:

`תוריד את האיש מאחור.`

צלם:

`טיפלתי. שולח גרסה חדשה.`

או:

`אי אפשר להסיר אותו בלי לפגוע ביד, אפשר לחתוך מעט.`

הלקוח:

`חיתוך בסדר.`

כל השיחה נשארת על התמונה.

---

# 132. לא להפוך לצ'אט חופשי

אין inbox messages כלליים.

כל conversation חייב להיות:

Photo + optional pin.

---

# 133. Photographer review queue

זה צריך להיות workspace אמיתי.

לא rows קטנים בתוך ClientGallery.

---

# 134. Layout

צד:

filters/status.

מרכז:

list / contact sheet.

כשפותחים:

תמונה גדולה + thread.

---

# 135. Queue filters

* פתוחות
* בטיפול
* נשלחה גרסה
* אושרו
* הכול

---

# 136. Counter

`12 בקשות פתוחות`

לא `12 comments`.

בקשה יכולה להכיל כמה messages.

---

# 137. Queue item

Thumbnail.

Pin.

Filename.

טקסט ראשון.

Status.

זמן.

---

# 138. click Queue item

פותח photo review detail.

---

# 139. Photo detail — photographer

תמונה גדולה.

Pins.

Side panel:

threads.

---

# 140. Action

**פתח לעריכה**

לוקח ישירות את הצלם ל־Bench על אותה תמונה.

---

# 141. זה קריטי

לא לגרום לצלם:

לזכור filename → לצאת → לחפש בתיקייה → לפתוח editor.

---

# 142. Back from editor

מחזיר ל־Review Detail של אותה תמונה.

---

# 143. אחרי עריכה

המערכת יודעת `frame.edited`.

כיום כבר מופיע "שלח גרסה מעודכנת" רק כאשר יש edited frame.

להשתמש בזה.

---

# 144. Primary action

**שלח גרסה חדשה ללקוח**

---

# 145. לא לסגור את הבקשה לפני publish success

כיום הקוד מפרסם גרסה ואז resolve. זו הסדר הנכון.

להשאיר.

---

# 146. Send updated

Dialog קטן:

**לשלוח את הגרסה המעודכנת?**

Preview.

`גרסה 2`

Primary:

`שלח`

---

# 147. אחרי send

Thread state:

`updated`

Client approval resets to false.

המנוע כבר עושה זאת בגרסה חדשה.

---

# 148. בצד הלקוח

Thumbnail:

**עודכן**

---

# 149. פתיחת התמונה

Label:

**גרסה חדשה מהצלם**

---

# 150. אפשרות Before / After

מאוד שימושי.

Button:

`השווה לקודמת`

---

# 151. Compare

Swipe / split.

לא חובה לסבב הראשון, אבל להכין version model לכך.

---

# 152. Client actions אחרי גרסה חדשה

שתי פעולות:

**מאושר**

**צריך עוד תיקון**

---

# 153. "צריך עוד תיקון"

לא יוצר thread חדש בהכרח.

אם זה אותו עניין:

reply באותו thread.

אם עניין חדש:

new thread.

---

# 154. Approve photo

כאשר הלקוח מרוצה:

**✓ מאשר את התמונה**

---

# 155. Approval belongs to version

לא לתמונה לנצח.

```ts
approvedVersionN: number
```

---

# 156. גרסה חדשה

מבטלת approval אוטומטית.

זה כבר intent של `clientDone = false`.

---

# 157. תמונה בלי שום תיקון

לקוח לוחץ:

**מאושר**

מייד.

---

# 158. Quick approve

Grid יכול להציע check button.

אבל עדיף בשלב ראשון רק מתוך Lightbox כדי למנוע טעויות.

---

# 159. Swipe review

אחרי approve:

אוטומטית לתמונה הבאה.

זה חוסך עשרות taps.

---

# 160. Progress

Header:

`52 / 74 אושרו`

---

# 161. Global completion

כאשר כל selected images מאושרות ואין threads פתוחים:

Footer CTA:

**סיימנו את ההגהה**

---

# 162. לפני completion

Dialog:

**לאשר שהכול מוכן?**

`74 מתוך 74 תמונות אושרו`

`אין בקשות פתוחות`

Primary:

**כן, הכול מאושר**

---

# 163. `approvedAt`

להוסיף ל־gallery/review:

```ts
approvedAt?: number;
```

---

# 164. Photographer sees

Status:

**הלקוח אישר את כל התמונות**

Timestamp.

---

# 165. Final state

לאפשר view בלבד.

לא עוד comments.

---

# 166. Reopen after approval

רק דרך הצלם.

פעולה:

`פתח הגהה מחדש`

---

# 167. Reopen selection ≠ reopen review

שתי פעולות שונות.

חובה להפריד.

---

# 168. היום יש רק `פתח את הבחירה מחדש`

זה לא מספיק.

להגדיר:

**פתח בחירה מחדש**

ו־

**פתח הגהה מחדש**

---

# 169. Reopen selection

פעולה כבדה.

כי ייתכן שהצלם כבר ערך.

Confirmation:

**פתיחת הבחירה מאפשרת ללקוח להוסיף ולהסיר תמונות. הדבר עשוי לשנות את העבודה שכבר התחלת.**

---

# 170. אחרי reopen selection

לא למחוק היסטוריה.

לשמור revision.

---

# 171. Selection Revision

```ts
selectionRevision: number;
```

---

# 172. lock מחדש

Revision עולה.

---

# 173. Photographer sees diff

**בחירה עודכנה**

`+3 תמונות`

`-2 תמונות`

---

# 174. זה עדיף על overwrite שקט

הצלם חייב לדעת מה השתנה.

---

# 175. Removed selected image שכבר נערכה

לא למחוק edit.

רק להוציא מה־current client selection.

---

# 176. Added image

נכנסת ל־work queue.

---

# 177. שינוי album membership בלבד

גם diff.

`IMG_1234 הועברה מאלבום הזוג להורי הכלה`

---

# 178. Review requests בזמן reopened selection

אם פותחים selection מחדש אחרי review התחיל:

לאפשר רק אחרי confirmation רציני.

המלצה:

לסגור זמנית review עד submission חדש.

---

# 179. Notifications

המערכת צריכה ליידע את הצלם על אירועים חשובים.

לא כל heart.

---

# 180. אירועים לצלם

* הלקוח סיים בחירה.
* בחירה נפתחה/נשלחה מחדש.
* נוספה בקשת תיקון.
* הגרסה החדשה אושרה.
* כל ההגהה אושרה.

---

# 181. לא notification לכל selection tap

זה רעש.

---

# 182. Client notifications

* gallery ready.
* review ready.
* photographer sent updated version.
* gallery reopened.

---

# 183. כרגע copy/link ידני מספיק

Email/WhatsApp automation אפשר בעתיד.

לא prerequisite.

---

# 184. Photographer Overview

בתוך Project overview:

בחירת לקוח צריכה להציג meaningful state.

לדוגמה:

**ממתין לבחירה**
`54/80 באלבום הראשי`

או:

**12 תיקונים פתוחים**

או:

**ממתין לאישור 3 גרסאות**

---

# 185. לא status generic של "waiting"

להגיד מה מחכים לו.

---

# 186. Version history

חובה לשמור versions.

כבר קיים array versions ב־gallery item.

לא overwrite.

---

# 187. Client sees latest by default

אבל יכול לפתוח history.

---

# 188. History

`גרסה 1`

`גרסה 2`

`גרסה 3`

Timestamp.

---

# 189. Comments tied to version

כבר קיים `versionN`.

להציג:

`נכתב על גרסה 1`

אם עכשיו רואים v2.

---

# 190. Pin על גרסה קודמת

לא להציג כאילו הוא בהכרח נמצא באותו מקום בגרסה החדשה אם crop השתנה.

---

# 191. לכן כשהגרסה משתנה

Thread נשמר.

אבל pin label:

`מהגרסה הקודמת`

---

# 192. אם crop geometry השתנה משמעותית

normalized x/y עלול לא להצביע על אותו אובייקט.

לכן history חשובה.

---

# 193. Photographer יכול לפתוח את exact version שעליה נכתבה הבקשה

זה הרבה יותר נכון.

---

# 194. General note

אין pin.

מוצגת בראש threads.

---

# 195. Delete/edit client comment

לאחר שליחה:

אפשר לערוך/למחוק במשך חלון קצר, למשל 5 דקות.

לא חובה ל־v1.

---

# 196. Photographer resolve

לא להשתמש ב"סמן שטופל" כמסלול עיקרי כאשר נדרש client approval.

יש שני סוגים:

### resolved internally

למשל הלקוח ביקש משהו והצלם החליט שזה טופל בלי צורך בגרסה חדשה.

### sent for approval

גרסה נשלחה.

---

# 197. ברירת מחדל לבקשת תיקון

היא נסגרת רק כאשר:

נשלחה גרסה + הלקוח אישר.

---

# 198. Photographer override

`סגור ללא גרסה`

דרך `⋯`.

---

# 199. Reason optional

לא צריך bureaucracy.

---

# 200. Review queue grouping

לא להציג 5 comments של אותה תמונה כחמש תמונות.

Group by item.

---

# 201. Row

`IMG_4821`

`3 בקשות`

Status:

`בטיפול`

---

# 202. Detail פותח את שלושת ה־pins

---

# 203. Search

filename.

Client name לא צריך בתוך project-specific workspace.

---

# 204. Filters photographer

* חדש
* בטיפול
* ממתין ללקוח
* אושר
* הכול

---

# 205. Sort

ברירת מחדל:

דורש פעולה קודם.

כלומר:

חדש → בטיפול → waiting client → approved.

---

# 206. בתוך status

ישן יותר קודם.

---

# 207. Bulk actions

אפשר לבחור כמה requests:

`סמן שטופל`

אבל **לא** bulk publish version.

כל תמונה צריכה version משלה.

---

# 208. Image-specific status

Card/thumbnail:

* comment count.
* latest version.
* approval.

---

# 209. Client Done

להחליף copy.

לא:

`סיימתי עם התמונה`

כן:

**מאשר את התמונה**

זה ברור יותר.

---

# 210. אם קיימת בקשה פתוחה

כפתור "מאשר" disabled או דורש resolve.

עדיף disabled:

`יש בקשת תיקון פתוחה`

---

# 211. אם client אומר "עזבו, זה בסדר"

Action על thread:

`בטל את הבקשה`

ואז אפשר approve.

---

# 212. Photographer reply

Notification badge בצד הלקוח.

---

# 213. Unread state

צריך timestamp/readAt או lastSeen.

לא חובה ל־phase ראשון.

אבל architecture צריכה לאפשר.

---

# 214. Client mobile UX

זה מוצר phone-first.

הקוד כבר מכוון לכך.

---

# 215. Grid

2 columns בטלפון קטן.

3 columns גדול.

כיום זה כבר מוגדר כך.

---

# 216. Lightbox

Image max space.

Controls bottom safe-area.

---

# 217. Annotation

לאפשר pinch zoom בזמן request.

אחרת קשה לסמן פרטים קטנים.

---

# 218. כאשר zoomed

Tap point צריך להומר נכון ל־normalized coordinates של original rendered image.

---

# 219. Pan

שני אצבעות/pinch.

Tap רגיל אחרי "סמן תיקון" יוצר pin.

---

# 220. Desktop client gallery

אפשר 5–6 columns.

כבר קיים responsive עד 6 columns.

---

# 221. Keyboard desktop

Left/Right navigation.

Esc close.

Space selection בזמן selection.

A approve בזמן review, אם רוצים advanced.

---

# 222. Selection optimistic

להשאיר.

הלב חייב להגיב מייד.

הקוד כבר עושה optimistic update + rollback.

---

# 223. Comment send

לא optimistic באופן מלא.

להראות:

`שולח…`

רק אחרי success הופך sent.

---

# 224. Offline/error

אם comment נכשל:

הטקסט לא נעלם.

להשאיר composer עם:

`לא נשלח. נסו שוב.`

---

# 225. Selection error

Rollback + toast.

---

# 226. Session expiration

אם token פג:

להחזיר ל־Login.

לא לאבד client draft comment אם אפשר.

---

# 227. Security

לא להכניס originals.

המערכת כיום מייצרת preview ו־thumb, וזה נכון.

בבדיקות preview הוא 1600px long edge ו־thumb 400px.

---

# 228. Downloads

אם אין כוונה עסקית לאפשר download:

לא להוסיף Download.

---

# 229. Browser protection

לא להבטיח "אי אפשר לגנוב".

Preview שניתן לצפייה ניתן לשמור טכנית.

לא לעשות security theater.

---

# 230. Watermark

אפשר account/gallery option.

לא חובה.

---

# 231. Branding

לוגו.

שם סטודיו.

אולי accent color account-level.

לא לבנות website builder.

---

# 232. Freeze

Freeze היא action תפעולית.

לא toolbar primary.

---

# 233. Settings → Access

שם:

`הקפא גישה`

---

# 234. Frozen retention

המנוע שומר gallery קפואה ל־30 יום לפני removal לפי הקוד.

אם זה policy מוצר אמיתי:

להציג date מדויק.

---

# 235. Delete Gallery

Danger zone בלבד.

לא ליד copy link.

---

# 236. Confirmation מותאם

לא browser `confirm`.

כיום יש `confirm()` בקוד.

להחליף modal מוצר.

---

# 237. Delete copy

**למחוק את הגלריה?**

`הקישור יפסיק לעבוד והתמונות שפורסמו יימחקו מהגלריה. קבצי הפרויקט המקומיים לא יימחקו.`

---

# 238. Credentials

גם תחת Settings → Access.

לא במרכז workflow אחרי שכבר נשלחו.

---

# 239. Status model בצד הצלם

להציג state אחד מרכזי.

לא ארבעה pills.

---

# 240. States אפשריים בקופי

**טיוטה**

**מפרסם**

**ממתין לבחירת הלקוח**

**הבחירה התקבלה**

**בעבודה**

**ממתין להגהת הלקוח**

**12 תיקונים פתוחים**

**ממתין לאישור 3 גרסאות**

**אושר**

**מוקפא**

---

# 241. לא "done" generic

להגיד מה קרה.

---

# 242. Client side phase copy

Selection:

**בחרו את התמונות שלכם**

Review:

**עברו על התמונות ואשרו**

Complete:

**הכול מאושר**

---

# 243. אין onboarding paragraph ארוך

2 שורות מקסימום.

---

# 244. Empty requests

Photographer:

**אין בקשות תיקון פתוחות**

לא:

`אין הערות מהלקוח.`

---

# 245. All approved

לא green dashboard מלא.

שקט + clear success.

---

# 246. Notifications badge

Project nav:

`3`

רק unresolved items requiring photographer action.

---

# 247. History/Audit

לשמור timestamps:

publishedAt.

lockedAt.

reviewOpenedAt.

approvedAt.

version sent times.

comment times.

---

# 248. למה

כאשר לקוח אומר:

"שלחתי לכם תיקון ביום שלישי"

הצלם יכול לדעת.

---

# 249. Audit לא מוצג תמיד

`⋯ → פעילות`

---

# 250. Activity timeline

לדוגמה:

`12/9 21:04 — הלקוח סיים לבחור`

`13/9 10:12 — נשלחה הגהה`

`13/9 22:37 — התקבלו 4 בקשות`

`14/9 09:18 — נשלחו 3 גרסאות חדשות`

---

# 251. API additions

ה־API הקיים כולל:

select, rename album, lock, comment, mark done, resolve comment, publish version.

להוסיף בהדרגה.

---

# 252. Review open

```http
POST /api/gallery/open-review
```

---

# 253. Global approval

```http
POST /g/:slug/approve
```

---

# 254. Thread reply

```http
POST /g/:slug/thread-reply
```

או generic message endpoint.

---

# 255. Photographer reply

```http
POST /api/gallery/thread-reply
```

---

# 256. Thread resolve/cancel

נפרד מ־image approval.

---

# 257. Selection revision

Existing unlock יכול להישאר.

אבל lock צריך לשמור revision number.

---

# 258. API backward compatibility

לא לשבור galleries קיימות.

Fields חדשים optional.

---

# 259. Existing comment migration

כל `GalleryComment` קיים הופך ל־thread עם message אחד.

---

# 260. Existing resolvedAt

יכול למפות ל־thread `resolved`.

---

# 261. Existing clientDone

אם true:

`approvedVersionN = currentVersion`

---

# 262. Version semantics

Existing `versions[]` נשאר.

לא צריך migration קשה.

---

# 263. Database source of truth

Gallery server הוא source of truth ל:

selection.

comments.

versions.

review approval.

---

# 264. Project.json source of truth

Project הוא source of truth ל:

local frame/edit state.

imported selection.

album membership copy.

---

# 265. לא לתת לשני הצדדים לכתוב אותו state

ה־gallery polling architecture נבנתה בדיוק כדי למנוע race על project.json.

להשאיר את העיקרון.

---

# 266. Polling

45 שניות בזמן workspace פתוח זה סביר.

---

# 267. Manual immediate refresh

לאחר photographer action:

refresh מיידי.

---

# 268. Notifications עתידיים

אפשר webhook/push later.

לא prerequisite.

---

# 269. Photographer → editor integration

Review Queue חייב לדעת:

`frameId`

כבר קיים.

---

# 270. "פתח לעריכה"

navigate:

ProjectBench(frameId).

---

# 271. Editor indicator

בתוך editor:

`בקשת לקוח`

עם count.

---

# 272. Pin overlay ב־editor

אפשר להציג את pin של הלקוח ישירות מעל התמונה בזמן תיקון.

זה פיצ'ר חזק מאוד.

---

# 273. לא רק thumbnail queue

אותו x/y normalized יכול לעבור ל־Bench.

---

# 274. Photographer can toggle pin visibility

כי לפעמים הוא מסתיר detail.

---

# 275. Thread in editor

Small drawer:

בקשת הלקוח.

לא entire gallery UI.

---

# 276. Action after edit

**שלח ללקוח**

ישירות מה־Bench.

---

# 277. Confirmation

Preview derived version.

---

# 278. לאחר publish

לא להוציא את הצלם מה־Bench בכוח.

Toast:

`גרסה 2 נשלחה ללקוח`

---

# 279. Review queue updates

Item → `ממתין ללקוח`.

---

# 280. Album integration

בחירת album membership מהלקוח כבר נשמרת ומועברת ל־album machine.

להמשיך.

---

# 281. אבל Review approval לא משנה album membership

אלה שני domains שונים.

---

# 282. תיקון לא מוציא תמונה מהאלבום

אלא אם selection נפתחה מחדש והלקוח הסיר אותה.

---

# 283. Final approved image

ה־album יכול להשתמש בגרסה המקומית המעודכנת.

לא ב־gallery preview.

---

# 284. Counts

`chosen` חייב להיות unique frames.

כיום זה נספר לפי items שיש להם לפחות album אחד.

נכון.

---

# 285. Album counters

Membership count.

---

# 286. Review counter

Unique selected frames.

---

# 287. Open request count

Unique threads, לא messages.

---

# 288. Pending client approval

Unique items שהצלם עדכן אחרי latest client approval.

---

# 289. Visual language — client

התמונות הן העיקר.

מעט chrome.

---

# 290. Visual language — photographer

Professional utility.

יותר מידע מותר.

אבל queue ולא dashboard.

---

# 291. צבע

Selection:

brand.

Correction request:

warning/copper.

Approved:

שקט/green מינימלי.

---

# 292. לא אדום ל־request

בקשת תיקון אינה error.

---

# 293. Error

רק network/upload/security.

---

# 294. Accessibility client

Heart button real button.

Pins selectable.

Thread keyboard accessible.

---

# 295. Pin touch target

לפחות 32px למרות ring קטן יותר.

---

# 296. zoom

Pins scale/position correctly.

---

# 297. Text size

Client inputs 16px minimum mobile.

---

# 298. Safe area

Bottom controls respect iOS safe area.

כבר נעשה ב־CSS הקיים.

---

# 299. Loading

Grid placeholder uses average frame color.

זה כבר design טוב מאוד בקוד.

להשאיר.

---

# 300. No layout shift

Critical.

---

# 301. Session persistence

Current token in localStorage.

להשאיר.

---

# 302. Session expiry

12 שעות כרגע ב־engine.

ללקוח שעובר על חתונה במשך כמה ימים, הוא פשוט יתחבר שוב לאחר expiry.

זה סביר.

---

# 303. Draft comments

לא צריך server draft.

Local state מספיק.

---

# 304. Photographer queue performance

70 selected images, אולי 40 comments.

אין בעיית scale.

---

# 305. Client grid performance

600–1500 frames כן.

Virtualization חובה.

כבר קיימת.

---

# 306. Tests — business rule

No comments before selection lock.

כבר test קיים.

---

# 307. Test

No selection changes after lock.

כבר קיים.

---

# 308. Test

Only selected frame can receive correction.

כבר קיים.

---

# 309. Test

Quota cannot be exceeded.

כבר קיים.

---

# 310. Test

One frame can belong to multiple albums.

כבר קיים.

---

# 311. Test

New version resets approval.

כבר חלק מהמימוש.

---

# 312. Tests חדשים

Selection locked but review not opened → comment rejected.

---

# 313. Review opened → selected frame can comment.

---

# 314. Approval belongs to version N.

---

# 315. Publish vN+1 invalidates approval.

---

# 316. All images approved → global approve permitted.

---

# 317. Open request exists → global approve refused.

---

# 318. Reopen review clears global approvedAt but not history.

---

# 319. Reopen selection increments revision.

---

# 320. Re-lock selection preserves edit data.

---

# 321. Removed frame isn't deleted locally.

---

# 322. Missing selected frame is reported by name.

---

# 323. Thread created on version 1 remains visible on version 2.

---

# 324. Pin points to exact old version.

---

# 325. Photographer reply cannot mutate client selection.

---

# 326. UI test — client selection

600 photos.

Tap heart.

Immediate visual reaction.

---

# 327. Album quota reached

Next add rolls back clearly.

---

# 328. Finish choice

Confirmed.

Grid becomes chosen-only.

---

# 329. Before review ready

No correction controls.

---

# 330. Review opens

Correction controls appear.

---

# 331. Add pin

Write request.

Pin remains after reload.

---

# 332. Photographer sees same pin location.

---

# 333. Photographer edits.

Publishes.

---

# 334. Client sees `עודכן`.

---

# 335. Client approves.

---

# 336. Photographer status updates.

---

# 337. Final approval

Project says approved.

---

# 338. UX scenario מלא

```text
צלם
→ בוחר 426 תמונות
→ מגדיר 80/40/40
→ מפרסם
→ שולח קישור

לקוח
→ נכנס
→ בוחר
→ משייך לאלבומים
→ מסיים בחירה

צלם
→ מקבל את הבחירה
→ עורך
→ שולח להגהה

לקוח
→ עובר על 74 תמונות
→ מאשר 68
→ מבקש תיקונים ב-6

צלם
→ רואה 6 תמונות שדורשות פעולה
→ פותח ישירות לעריכה
→ שולח 6 גרסאות חדשות

לקוח
→ רואה "עודכן"
→ מאשר את 6

מערכת
→ 74/74 מאושרות
→ הלקוח מסיים הגהה

צלם
→ רואה "אושר"
→ ממשיך לאלבום/מסירה
```

זה ה־happy path.

כל החלטת UX צריכה לשרת אותו.

---

# 339. סדר מימוש

## Phase 1 — לנקות צד צלם

להוציא ClientGallery מתוך הטופס הצר.

Workspace מלא.

Creation ברור.

Live status ברור.

Danger/settings נפרד.

---

# 340. Phase 2 — Selection Client UX

ללטש:

Grid.

meters.

Lightbox.

album assignment.

Finish selection.

לא לשנות logic.

---

# 341. Phase 3 — להוסיף Review Gate

`reviewAvailableAt`.

Lock selection אינו פותח comments מיד.

Photographer explicitly:

**שלח להגהה**

---

# 342. Phase 4 — Approval per frame

להחליף `clientDone` ב־semantics של approval/version.

UI:

מאושר / צריך תיקון / עודכן.

---

# 343. Phase 5 — Photographer correction workspace

Queue.

Photo detail.

Open in editor.

Publish new version.

---

# 344. Phase 6 — Threads

Messages photographer/client.

Pins.

General notes.

---

# 345. Phase 7 — Global approval

74/74.

Close review.

Approved state.

---

# 346. Phase 8 — Selection revisions

Reopen selection.

Diff.

Revision tracking.

---

# 347. Phase 9 — Deep integration

Pins ב־Bench.

Send version מתוך editor.

Notifications.

Before/after.

---

# 348. מה לא לעשות עכשיו

לא לבנות:

CRM messaging.

general chat.

email marketing.

file downloads.

social sharing.

AI writing replies.

client portal מלא.

payment system.

---

# 349. לא להפוך את המוצר ל־Pixieset clone

היתרון כאן הוא לא gallery hosting.

היתרון הוא:

**הבחירה שהלקוח עושה הופכת מיד לעבודה בתוך TEZA, והתיקונים חוזרים בדיוק לאותה תמונה שהצלם עורך.**

---

# 350. Definition of Done

המערכת לא גמורה אם:

הלקוח יכול לבקש תיקונים לפני שהצלם פתח הגהה.

הצלם צריך לחפש ידנית filename כדי לתקן תמונה.

"סמן שטופל" הוא סוף workflow בלי אישור הלקוח.

גרסה חדשה דורסת ישנה.

לא ברור אם הלקוח אישר את הגרסה החדשה.

Selection reopen מוחק היסטוריה.

Comments שטוחים ולא קשורים לגרסה.

הצלם לא יודע אילו דברים דורשים פעולה עכשיו.

הלקוח צריך להסתכל שוב על מאות התמונות אחרי שסיים לבחור.

---

# 351. כלל המוצר הסופי

לפני בחירה:

**מה אתם רוצים?**

אחרי בחירה:

**מה צריך לתקן?**

אחרי תיקון:

**האם עכשיו זה מאושר?**

אסור שבאותו רגע המשתמש יישאל יותר משאלה אחת מהשלוש.

זה בעיניי המבנה הנכון ביותר לאזור הזה. הוא שומר על הרציונל שכבר קיים בקוד, אבל הופך את החצי השני — שכיום הוא `comment → resolve / publish version` — ל־workflow מקצועי וסגור של תיקון ואישור.
