# מחקר מהירות — איך התוכנה תעוף על כל מחשב

> **תאריך:** 2026-09-14
> **מה יש כאן:** מדידות שנעשו היום על המחשב של הצלם, ומחקר מהרשת (מאמרים, פטנטים,
> תיעוד של תוכנות מקצועיות, ספריות קוד פתוח ורישיונות).
> **החלטה שקדמה למחקר:** לא מסתמכים על כרטיס מסך. כל החיסכון בא מהמעבד, מהזיכרון
> ומסדר העבודה.
> **חשוב:** כל מספר מסומן אם **נמדד אצלנו** או **מהמקור**. מה שלא נמדד כתוב כך.

---

## חלק 1 — מה מדדנו אצלנו היום

המחשב: מעבד 24 ליבות (Intel Core Ultra 9 275HX), 31GB זיכרון.
התמונות: 12 תמונות אמיתיות מחתונה (5472×3648), חמשת כלי הפנים בהגדרות ברירת המחדל.

| מה | תוצאה | הערה |
|---|---|---|
| 12 תמונות, אחת אחרי השנייה | **3 דק' 9 שנ'** (כ-16 שנ' לתמונה) | נמדד |
| 12 תמונות, 4 במקביל (6 ליבות לכל אחד) | **1 דק' 9 שנ'** — פי 2.75 | נמדד. כולל כ-20 שנ' טעינה בכל מסלול, אז הגבול גבוה יותר |
| אותה תמונה, פעם ראשונה מול פעם שנייה | **32 שנ' מול 2.3 שנ'** | נמדד על תמונה אחת. רוב הזמן = "להבין" את התמונה, לא לערוך אותה |
| הגבלת העיבוד לליבה אחת בעריכה חוזרת | 2.5 שנ' מול 2.3 | נמדד. כמעט אין תועלת מריבוי ליבות בתוך תמונה אחת → הרווח הוא בכמה תמונות במקביל |
| זיכרון שעותק אחד של המנוע צריך | **3.1–4.9GB בשיא** | נמדד על 3 תמונות. זה מה שיגביל מחשבים חלשים, לא הליבות |
| הפעלת עותק חדש של המנוע | כ-6 שנ' טעינת קוד + כ-20 שנ' טעינת מודלים בתמונה הראשונה | נמדד (הערכה מתוך הפרש הזמנים) |
| ניקוי כתמים על תמונה **בלי פנים** | **12.6 שנ'** | נמדד. עבודה מבוזבזת |
| פתיחת קובץ | תמיד בגודל מלא, גם כשצריך רק גרסה קטנה | נבדק בקוד |
| "חימום" ברקע | מתחיל רק כשפותחים מסך, לא בייבוא | נבדק בקוד |
| חישובים בזיכרון | כבר בדיוק מופחת (float32) | נבדק בקוד — **אין מה להרוויח כאן**, לא לרדוף אחרי זה |

---

## חלק 2 — תשובה לשאלה: אפשר שהתוכנה תתאים את עצמה לכל מחשב?

**כן.** ומהמדידה עולה שיש ארבעה דברים שהיא צריכה לדעת על המחשב:

1. **זיכרון** — הגורם המגביל. עותק מנוע צריך עד כ-5GB.
   - מחשב 8GB → מסלול אחד.
   - מחשב 16GB → שניים.
   - מחשב 32GB → ארבעה עד חמישה.
2. **ליבות** — וגם איזה סוג. במעבדי אינטל חדשים יש ליבות חזקות וליבות חסכוניות, ו-Windows יודע
   לומר לתוכנה מה יש לה (`GetLogicalProcessorInformationEx`, שדה `EfficiencyClass`).
3. **סוללה או חשמל** — Windows מדווח (`GetSystemPowerStatus`). על סוללה: פחות מסלולים, בלי מאוורר צורח.
4. **מה הצלם עושה עכשיו** — אם הוא גורר סליידר, העבודה ברקע צריכה לפנות את הדרך.

### איך זה עובד בפועל (ההמלצה)

- **בהפעלה הראשונה על מחשב חדש:** מדידה קצרה (עשרות שניות, ברקע) של כמה זמן וזיכרון תמונה
  אחת לוקחת, ושמירת התוצאה. זה דפוס מוכר — ספריית FFTW עושה בדיוק את זה ("wisdom"): מודדים
  פעם אחת על המכונה, שומרים, ומודדים מחדש אחרי עדכון גרסה.
- **בכל רגע:** בודקים כמה זיכרון פנוי. אם נגמר — מוותרים על מסלול. Windows גם שולח התראה
  כשהזיכרון נמוך (`CreateMemoryResourceNotification`) ומאפשר לשאול כמה פנוי (`GlobalMemoryStatusEx`).
- **המסלולים נשארים חיים:** הפעלת עותק עולה כ-25 שניות, אז פותחים אותם פעם אחת ולא לכל משימה.
- **עבודת רקע במצב רקע של Windows:** עדיפות נמוכה (`PROCESS_MODE_BACKGROUND_BEGIN`) — Windows
  מוריד לה גם מעבד, גם דיסק וגם זיכרון כשהצלם עובד. אפשר גם "מצב חיסכון" (EcoQoS) שמעביר אותה
  לליבות החסכוניות ומוריד חום ורעש.
- **מה שעל המסך — קודם.** כבר קיים חלקית (התור הוא "האחרון שנלחץ קודם").

---

## חלק 3 — כל הדרכים לחסוך, מדורגות לפי ההשפעה אצלנו

לכל אחת: מה זה בפשטות · מה זה ייתן אצלנו · הוכחה · רישיון · לבנייה.

### 1. "להבין" כל תמונה פעם אחת, ברקע, מיד בייבוא
- **בפשטות:** הזיהוי של פנים, עור, שיער ורקע הוא החלק היקר (13–20 שניות לתמונה חדשה). הוא לא
  תלוי בעריכה — רק בתמונה. אז עושים אותו ברגע שהתמונות נכנסות, ברקע, ושומרים.
- **אצלנו:** אחרי זה כל עריכה, תיקון לקוח או רינדור למאגר הסופי = שניות בודדות (נמדד: 2.3 שנ').
- **הוכחה:** Lightroom ממליץ לבנות "Smart Previews" בזמן הייבוא בדיוק מהסיבה הזאת; פטנטים של
  עורכי מדיה מתארים תור רקע שרץ רק כשאין עבודה רגילה.
- **לבנייה:** מטמון המסכות על הדיסק כבר קיים; חסר רק מי שמפעיל אותו בייבוא. זהירות ידועה:
  המטמון חייב לדעת מאיזו גרסת קוד נוצר (ראו BUGS.md BUG-005).

### 2. כמה תמונות במקביל, מותאם למחשב
- **בפשטות:** במקום תור אחד — כמה תורים, לפי הזיכרון והליבות (חלק 2).
- **אצלנו:** נמדד פי 2.75 אצלך עם 4 מסלולים. במחשב של 16GB — בערך פי 1.8 (שני מסלולים; **לא נמדד**, הערכה).
- **הוכחה:** המדידה למעלה. אזהרה מהמדידה הקודמת (SLOW.md): שני חוטים באותו תהליך היו **איטיים**
  יותר. הרווח בא רק מתהליכים נפרדים שכל אחד מקבל חלק מהליבות.
- **לבנייה:** `ProcessPoolExecutor` עם initializer שטוען מודלים, `cv2.setNumThreads(ליבות/מסלולים)`
  בכל מסלול; `threadpoolctl` לספריות אחרות.

### 3. לשמור את התוצאה אחרי השלבים הכבדים
- **בפשטות:** אם הצלם כבר ריטש את הפנים ועכשיו רק מזיז צבע — אין סיבה לרטש שוב. שומרים את התמונה
  אחרי שלב הפנים, ומשנים רק את מה שאחריו.
- **אצלנו:** שינוי צבע על תמונה מרוטשת יהיה מיידי, גם בגודל מלא.
- **הוכחה:** darktable עובד כך — שומר תוצאת ביניים אחרי כל שלב, ומחשב מחדש רק מהשלב ששונה והלאה.
- **לבנייה:** מפתח = תמונה + המתכון **עד השלב** + גרסת הקוד.

### 4. לפתוח תמונה בגודל שצריך, לא בגודל מלא
- **בפשטות:** קובץ JPG יודע להיפתח ישר בחצי, רבע או שמינית מהגודל — בלי לפתוח הכול ואז להקטין.
- **אצלנו:** היום כל תמונה נפתחת מלאה (20 מגה-פיקסל) גם כשצריך רק תצוגה או זיהוי (שנעשה ב-1600px).
  פתיחה ברבע גודל = בערך פי 4 פחות עבודה בפתיחה ובהקטנה (**מהמקור**).
- **רישיון:** Pillow — קוד פתוח מתירני (HPND).
- **לבנייה:** `Image.draft("RGB", (w, h))` לפני קריאת הפיקסלים. רק ל-JPG.

### 5. לדלג על עבודה מיותרת
- **בפשטות:** תמונה בלי פנים לא צריכה ניקוי כתמים.
- **אצלנו:** 12.6 שניות נחסכות על כל תמונה כזאת (נמדד). בחתונה יש הרבה תמונות בלי פנים קרובות.
- **לבנייה:** לבדוק למה `skin-cleanup` עובד כשאין פנים — לא נבדק עדיין.

### 6. לעבוד בקטן ולהגדיל את התוצאה (רק לפעולות "רכות")
- **בפשטות:** פעולות כמו השוואת גוון עור או ריכוך — אפשר לחשב על תמונה קטנה, ללמוד "מה השתנה",
  ולהחיל את זה על הגדולה. נקבוביות וכתמים — **לא**, הם חייבים גודל מלא.
- **אצלנו:** פוטנציאל גדול לשלבי ההחלקה. **לא נמדד** — וחייב לעבור את בדיקת ההתאמה בין תצוגה
  למסירה (SLOW.md מזהיר שזה כבר נשבר פעם).
- **הוכחה:** Google — "Bilateral Guided Upsampling" (2016): הקטנה פי 8 נותנת עד פי 64 מהירות
  לפעולות גוון וצבע. אפליקציות יופי בטלפון מחליקות עור על תמונה מוקטנת פי 2–4.
- **רישיון:** השיטה מתוארת במאמר; את הרישיון של הקוד של Google **לא בדקתי**.

### 7. מסננים מהירים במקום מסננים איטיים
- **בפשטות:** יש מסנני החלקה ששומרים על קצוות ולוקחים זמן קבוע לא משנה כמה חזקים הם.
- **אצלנו:** **לא ידוע עדיין** אם השלבים האיטיים משתמשים במסננים שאפשר להחליף. צריך מדידה פנימית
  של ניקוי הכתמים (6–38 שנ' לתמונה לפי SLOW.md).
- **הוכחה:** Guided Filter (He et al.), Domain Transform (Gastal & Oliveira, SIGGRAPH 2011),
  Fast Local Laplacian (Aubry et al., 2014 — פי 50).
- **רישיון:** OpenCV (כולל התוספים `ximgproc` עם guidedFilter ו-dtFilter) — Apache 2.0.

### 8. סדר עדיפויות וביטול עבודה ישנה
- **בפשטות:** מה שהצלם רואה — קודם. מה שכבר לא רלוונטי (הזיז סליידר שוב) — מבטלים. ואפשר להראות
  מהר גרסה גסה ולהחליף בחדה.
- **אצלנו:** קיים חלקית. חסר: ביטול באמצע, והצגה גסה-ואז-חדה.
- **הוכחה:** פטנט של Apple/Adobe על תור רקע שמחכה לתור הרגיל; פטנט על עדיפות למה שנראה במסך.

### 9. מודלי הבינה — לטעון פעם אחת ולכוון
- **בפשטות:** המודלים נטענים לאט (כ-20 שנ'). משאירים אותם טעונים, ומכוונים כמה ליבות כל אחד לוקח.
- **אצלנו:**
  - ONNX Runtime ממתין "בסיבוב" על המעבד בין משימות כברירת מחדל — שורף מעבד וסוללה. יש הגדרה
    מומלצת מהתיעוד שלהם (`spin_backoff`), במיוחד למעבדים עם ליבות חזקות וחסכוניות.
  - הקטנת דיוק המודל (INT8) — לפעמים פי 1.5–3, אבל **חייבים לבדוק איכות** לכל מודל.
  - OpenVINO של אינטל — בדרך כלל פי 2–3 על מעבדי אינטל, אבל לא על AMD. אם משתמשים — רק כתוספת
    לאינטל, לא כבסיס.
- **רישיונות:** ONNX Runtime — MIT. OpenVINO — Apache 2.0. MediaPipe — Apache 2.0.
  MobileSAM — Apache 2.0. LaMa — Apache 2.0.
- **נפסל:** EdgeSAM (פי 7 מהיר מ-MobileSAM) — **רישיון לא-מסחרי**. אסור.

### 10. פתיחה ושמירה מהירות של JPG, והקטנות
- **אצלנו:** פתיחה ושמירה קורות בכל תמונה, הרבה פעמים.
- **הוכחה:**
  - מאמר השוואה של 9 ספריות (Iglovikov, 2025): ספריות מבוססות libjpeg-turbo מהירות עד פי 1.5.
  - libvips: פי 5 מהיר ופי 4 פחות זיכרון מ-Pillow-SIMD במבחן שלהם; יש חבילה מוכנה ל-Windows.
- **רישיונות:** libjpeg-turbo — BSD/IJG/zlib (חובה לציין "based in part on the work of the
  Independent JPEG Group"). libvips — LGPL 2.1 (מותר לשימוש מסחרי כקישור, בלי לשנות אותה).
- **הערה:** הזמן הכבד אצלנו הוא בכלי הפנים, לא בפתיחה. זה שיפור משני.

### 11. פייתון בלי "נעילה" — לעתיד
- **בפשטות:** גרסה חדשה של פייתון מאפשרת לרוץ על כמה ליבות בתוך תהליך אחד. אז המודלים ייטענו
  לזיכרון **פעם אחת** ולא בכל מסלול — וזה בדיוק מה שמגביל מחשבים של 8–16GB.
- **מצב:** אנחנו כבר על פייתון 3.14.6 (הגרסה הרגילה). הגרסה בלי הנעילה איטית ב-5–10% בעבודה
  בודדת, וספריות שלא הותאמו (כנראה OpenCV ו-MediaPipe) מחזירות את הנעילה. **לעקוב, לא לבנות עכשיו.**

### 12. הדפדפן — רשתות של מאות תמונות
- **בפשטות:** לא לפתוח תמונה שלא על המסך, ולפתוח תמונות בלי לתקוע גלילה.
- **לבנייה:** `loading="lazy"`, `decoding="async"`, `content-visibility: auto`. **לא בדקתי** מה קיים היום.

### 13. דיסק — קטן
- מודלים מופיעים כמה פעמים בתיקיית המנוע (למשל קובץ של 217MB שלוש פעמים). לא משפיע על מהירות,
  כן על גודל ההתקנה.

---

## חלק 4 — מה נבדק ונפסל

| רעיון | למה לא |
|---|---|
| כרטיס מסך | החלטת מוצר: לא מסתמכים עליו |
| EdgeSAM | רישיון לא-מסחרי |
| להמיר חישובים לדיוק מופחת | כבר מופחת בקוד |
| כמה חוטים באותו תהליך | נמדד בעבר: איטי יותר (82 מול 48 שנ') |
| לרנדר רק את האזור הנראה בזום | נמדד בעבר: חוסך 10% ולא מדויק (SLOW.md S-1) |

---

## חלק 5 — הסדר המומלץ

1. **לדלג על ניקוי כתמים בתמונה בלי פנים** — קטן, 12.6 שנ' לתמונה כזו.
2. **לפתוח תמונות בגודל הנדרש** — קטן, חוסך בכל מסך.
3. **"הבנה" בייבוא + מסלולים מקבילים שמתאימים את עצמם למחשב** — הבסיס. דורש אישור (משנה איך המנוע עובד).
4. **שמירת תוצאה אחרי שלבי הפנים** — עריכת צבע מיידית.
5. **מדידה פנימית של ניקוי הכתמים** — ואז מסננים מהירים / עבודה בקטן, רק עם בדיקת התאמה.
6. **כיוון מודלים** — הגדרות המתנה, ובדיקת דיוק מופחת מודל-מודל עם בדיקת איכות.

---

## מקורות

**ליבות, תהליכים, זיכרון, Windows**
- [threadpoolctl](https://github.com/joblib/threadpoolctl) — BSD-3
- [Parallelism in Numerical Python Libraries](https://thomasjpfan.github.io/parallelism-python-libraries-design/)
- [ONNX Runtime — thread management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- [Intel — detecting P/E cores](https://www.intel.com/content/www/us/en/developer/articles/guide/12th-gen-intel-core-processor-gamedev-guide.html) · [HybridDetect](https://github.com/GameTechDev/HybridDetect) · [PROCESSOR_RELATIONSHIP](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-processor_relationship)
- [SetProcessInformation / EcoQoS](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation)
- [SetPriorityClass / background mode](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setpriorityclass)
- [GetSystemPowerStatus](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getsystempowerstatus)
- [CreateMemoryResourceNotification](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-creatememoryresourcenotification) · [GlobalMemoryStatusEx](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex)
- [FFTW wisdom](https://www.fftw.org/fftw3_doc/Words-of-Wisdom_002dSaving-Plans.html) · [caveats](https://www.fftw.org/fftw3_doc/Caveats-in-Using-Wisdom.html)
- [Python free threading](https://docs.python.org/3/howto/free-threading-python.html) · [OpenCV forum on 3.13+](https://forum.opencv.org/t/opencv-python-compatibility-with-python-versions-3-13-experimental-rc-releases-for-multithreading/23902)
- [ProcessPoolExecutor](https://docs.python.org/3/library/concurrent.futures.html) · [loky](https://pypi.org/project/loky/3.4.0)
- [ONNX Runtime weight sharing](https://github.com/microsoft/onnxruntime/issues/15301)

**תוכנות מקצועיות ופטנטים**
- [Lightroom — optimize performance](https://helpx.adobe.com/lightroom-classic/kb/optimize-performance-lightroom.html) · [Lightroom Queen — previews & caches](https://www.lightroomqueen.com/lightroom-performance-previews-caches/)
- [darktable — memory & performance](https://docs.darktable.org/usermanual/development/en/special-topics/mem-performance/) · [pixelpipe](https://deepwiki.com/darktable-org/darktable/2-image-processing-pipeline) · [Ansel — pipeline cache](https://ansel.photos/en/news/fixing-pipe-cache-10-yo-bugs/)
- [Capture One — hardware acceleration](https://support.captureone.com/hc/en-us/articles/360002412798-What-does-Hardware-Acceleration-do-and-how-do-I-use-it-in-Capture-One)
- [Patent: media editing with automatic background rendering](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8910032)
- [Patent: image application performance optimization](https://patents.google.com/patent/US9092240B2/en)
- [Patent: rendering priority for visible items](https://patents.google.com/patent/US11023098B2/en)
- [Patent: real-time skin smoothing](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9390478)

**אלגוריתמים**
- [Bilateral Guided Upsampling](https://dl.acm.org/doi/10.1145/2980179.2982423) · [google/bgu](https://github.com/google/bgu)
- [Domain Transform](https://dl.acm.org/doi/10.1145/1964921.1964964)
- [Fast Local Laplacian Filters](https://imagine.enpc.fr/~aubrym/projects/llf/texts/2014-fast-laplacian-filter.pdf)
- [Efficient edge-aware filtering tutorial](https://sites.google.com/site/filteringtutorial/)
- [Fast bilateral O(1)](https://arxiv.org/pdf/1603.08109)

**תמונות, קבצים, ספריות**
- [Pillow — draft / JPEG](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html) · [draft in practice](https://github.com/jackal998/photo-manager/issues/865)
- [Need for Speed: JPEG decoders in Python](https://arxiv.org/abs/2501.13131)
- [libjpeg-turbo license](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/LICENSE.md)
- [libvips speed & memory](https://github.com/libvips/libvips/wiki/Speed-and-memory-use) · [license](https://github.com/libvips/libvips/blob/master/LICENSE) · [pyvips-binary](https://pypi.org/project/pyvips-binary/)
- [Pillow performance](https://python-pillow.github.io/pillow-perf/) · [Uploadcare — fastest resize](https://uploadcare.com/blog/the-fastest-image-resize/)
- [Numba (BSD-2)](https://numba.pydata.org/numba-doc/dev/user/performance-tips.html)

**מודלים ורישיונות**
- [ONNX Runtime — MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) · [OpenVINO — Apache 2.0](https://github.com/openvinotoolkit/openvino/blob/master/LICENSE) · [MediaPipe — Apache 2.0](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)
- [OpenVINO vs ONNX Runtime on CPU](https://academy.ultralytics.com/courses/yolo-in-production/openvino-on-cpu)
- [Efficient SAM variants survey](https://arxiv.org/html/2410.04960v1) · [EdgeSAM (S-Lab, non-commercial)](https://github.com/chongzhou96/EdgeSAM)
- [MobileSAM — Apache 2.0](https://huggingface.co/spaces/dhkim2810/MobileSAM/blob/main/README.md) · [LaMa — Apache 2.0](https://github.com/advimman/lama)

**דפדפן**
- [Maximally optimizing image loading](https://www.industrialempathy.com/posts/image-optimizations/) · [Image loading on the web (2026)](https://www.ludicon.com/castano/blog/2026/05/image-loading-on-the-web/)
