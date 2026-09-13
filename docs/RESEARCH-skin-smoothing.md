# החלקת פנים — מחקר לפני בנייה

14.09.2026. נכתב אחרי שהכלי `skin` (החלקת עור) נכשל בבדיקה על תמונות אמיתיות,
ואחרי סבבי ניסויים שלא היו מבוססים על הבנה של התחום. המסמך הזה הוא ההבנה.

סימון: **[מקור]** = נלקח ממקור חיצוני (רשימה בסוף). **[נבדק]** = הרצתי ובדקתי
בעצמי. **[מסקנה]** = הסקה שלי, לא עובדה.

---

## 1. מה זה "החלקת פנים" בעיני צלם

כשצלם אומר "החלקת עור" הוא לא מתכוון לטשטוש. הוא מתכוון ש**העור ייראה נקי ורגוע
ועדיין יהיה עור**. ריטושרים מקצועיים מפרקים את זה לארבע בעיות שונות, שכל אחת
דורשת פעולה אחרת **[מקור: Retouching Academy, PHLEARN, Pratik Naik, darktable]**:

| בעיה | דוגמה | הפעולה המקצועית | מה אסור |
|---|---|---|---|
| **פגמים נקודתיים** | פצעון, נקודה אדומה, גלד, פירור | Healing — שחזור עור תקין במקום | לטשטש אותם (נשאר כתם דהוי) |
| **אי-אחידות גוון** | אדמומיות בלחיים, כתם כתום, צל מנומר | עבודה על השכבה הנמוכה / סקאלות גסות, בעדינות | להשטיח את כל הפנים לצבע אחד |
| **מעברי אור קטנים** (micro transitions) | בליטות, שקעים, צללים זעירים שיוצרים "עור לא שקט" | Dodge & Burn — להבהיר את הכהה ולהכהות את הבהיר, **בהירות בלבד** | לטשטש — זה מוחק מרקם |
| **מרקם** | נקבוביות, שערות דקות | **נשמר.** לכל היותר מרוכך מעט, לא באופן אחיד על כל הפנים | להסיר או להחליק אחיד — "מראה בובה" |

ומה שחייב להישאר: **נפח הפנים** (אור וצל גדולים — עצם הלחי, הלסת), **תווי הפנים**
(עיניים, גבות, שפתיים, נחיריים), **סימני זהות** (שומות, נמשים — לפי בחירה),
**התאמת צבע בין הפנים לצוואר**.

**הסדר המקצועי:** קודם ניקוי פגמים → אחר כך השוואת גוון → אחר כך D&B →
ורק בסוף, אם בכלל, ריכוך מרקם **[מקור: Lightroom guides — "remove blemishes first";
Pratik Naik]**.

**למה עור נראה פלסטיק** **[מקור]**: הפחתת מרקם אחידה על כל הפנים; טשטוש של
השכבה הנמוכה שמוחק גם את נפח הפנים; שכבת מרקם "חדה מדי" אחרי healing
אגרסיבי; ובכלי AI כלליים — עריכת-יתר, מחיקת שומות, ברק סינתטי **[מקור: BeautyGRPO]**.

**[מסקנה]** "החלקה" בשוק = **לחיצה אחת שמבצעת כמה פעולות שונות בפנים**. כפתור
יחיד לא מחייב פעולה יחידה על כל פיקסל.

---

## 2. מה עושים הכלים המסחריים

| כלי | מה המשתמש רואה | מה ידוע על המנגנון |
|---|---|---|
| **Photoshop — Neural Filter "Skin Smoothing"** | שני סליידרים: Blur (מרקם, פצעונים) ו-Smoothness (גוון, כתמים) | AI. כשל מתועד: אפור ובוצי בקו הלסת, פוסטריזציה בצללים, מחיקת נפח. אנשי מקצוע מתקנים: שכבה נפרדת, מצב Luminosity, אטימות 50–60% **[מקור: Adobe, CloudRetouch]** |
| **Lightroom** | מסכת People → Face Skin + פריסט "Soften Skin", ומורידים את כמות המסכה | Texture/Clarity שליליים על מסכת עור. ההמלצה: להסיר פגמים קודם **[מקור]** |
| **Evoto** | כלים **נפרדים**: Even with D&B, Textured Smoothing, Frequency Separation (High/Low), Skin Softening; גוף בנפרד; ברירת מחדל לגוף 0 | הפרדת תדרים + D&B אוטומטי. סוקר 2026: נוטה לרכות על פורטרטים קרובים, מומלץ 40–50% **[מקור: Evoto support, סקירת Kukebal]** |
| **Retouch4me** | תוספים **נפרדים**: Heal, Dodge&Burn, Skin Tone, Portrait Volumes… | רשתות שאומנו על אלפי עריכות מקצועיות. D&B יוצא כשכבת Soft Light. Heal מסיר פגמים "בלי לטשטש" **[מקור]**. עלות: 169$ ל-2400 ריטושים בשנה, דרך ענן או אפליקציה שלהם **[מקור: CLEANUP-IMPLEMENTATION-STATUS]** |
| **Luminar Neo — Skin AI** | Amount + Shine Removal | "מחליק ומסיר וריאציות תוך שמירת מרקם" **[מקור]** |
| **Portraiture (Imagenomic)** | Detail Smoothing בשלוש רצועות: Fine / Medium / Large + Threshold; מסכת גוון עור; מתאים עצמו ל"גודל פורטרט" | Medium היא הרצועה עם ההשפעה הגדולה ביותר על עור ממוצע **[מקור]** |

**[מסקנה] מה משותף לכולם:**
1. הסרת פגמים היא **חלק מהחלקה** או צעד שקודם לה. אצל Adobe הסליידר הראשון
   עצמו "מסיר כתמים ופצעונים".
2. שמירת מרקם היא טענת המכירה המרכזית. אף אחד לא מוכר "טשטוש".
3. התוצאה תמיד מעורבבת עם המקור (אטימות או סליידר), וההמלצות המעשיות הן
   **פחות ממקסימום**.
4. המנגנון מתייחס לגודל הפנים ולא לפיקסלים מוחלטים.

---

## 3. מה קיים בחינם, ברצינות

### כלים ידניים ואלגוריתמים פתוחים

| כלי | מה עושה | רישיון |
|---|---|---|
| **GIMP + Wavelet Decompose** | מפרק ל-5 סקאלות + שארית. Bilateral על סקאלה 5 (מרחב 10, ערך 7, 2 איטרציות), עדין יותר על 4 (7, 4, 1). את השארית מתקנים בצבע. "סדרה של שינויים קטנים" **[מקור: pixls.us, Pat David]** | GPL (כלי, לא ספרייה) |
| **darktable — retouch** | פירוק wavelet עם "merge from" (עריכה אחת על כמה סקאלות גסות), blur גאוסיאני/bilateral, healing על סקאלה גסה בלבד כך ששערות בסקאלה העדינה נשמרות **[מקור: מדריך darktable]** | GPL |
| **G'MIC — Smooth Skin** | הערכת מסכת עור אוטומטית ← פירוק רב-סקאלתי ← החלקה (bilateral כברירת מחדל) **של הסקאלות הבינוניות** ← הגברת פרטים קלה (0.05) **[מקור: discuss.pixls.us]** | CeCILL. **לא בדקתי** אם מותר לשלב קוד במוצר סגור, ולכן: ללמוד מהרעיון, לא להעתיק |
| **High Pass Skin Smoothing** (מימוש YUCI) | מסכה של פרטים כהים וקטנים מערוצי ירוק/כחול (high-pass, hard light פי 3) ← **הבהרה דרך עקומה** רק בתוך המסכה ← חידוד. כלומר **dodge אוטומטי של מעברים קטנים, בלי טשטוש**. רדיוס 8px, עקומה (120→146) **[מקור: GitHub YuAo]** | MIT |

### מודלים מאומנים

| מודל | מה | זמינות / רישיון | [מסקנה] למוצר |
|---|---|---|---|
| **DAMO / ModelScope skin retouching** | **שלושה מודלים**: (1) השוואת עור — ABPN, שכבת blend; (2) הסרת פגמים — גלאי UNet ב-768 + רשת שחזור, ספים 0.35/0.5; (3) הלבנה — מסכת עור TF. ברירות המחדל בקוד הרשמי: `degree=0.7`, **הלבנה פועלת, הסרת פגמים כבויה** **[מקור: README + ms_wrapper.py]** | **Apache 2.0**. **כבר על הדיסק**: `engine/models/damo_skin_official`, ו-`modelscope` מותקן **[נבדק]** | המועמד המעשי היחיד שמכסה גם פגמים וגם אחידות, מקומי ובחינם |
| **RetouchFormer** (AAAI 2024) | איתור פגמים + "soft inpainting". מנצח את ABPN במדדי FFHQR **[מקור]** | רישיון לא אומת; משקולות ב-Baidu (הגישה נחסמה) | חסום כרגע |
| **RetouchGPT** (AAAI 2025) | ממשיך, עם LLM | קוד MIT; משקולות ב-Baidu; דורש LLM | כבד וחסום |
| **BeautyGRPO** (CVPR 2026) | LoRA על FLUX.1-Kontext-dev, 1024px, 28 צעדים | קוד MIT, אבל **הבסיס FLUX Kontext dev ברישיון לא-מסחרי** **[מקור: BFL]** | לא מתאים למוצר בתשלום, ולא למחשב של צלם |
| **ICCV 2025 — Spectral Restorement** | מזהה אובדן תדרים גבוהים ברטושי רשת | לא נמצאו קוד ומשקולות | רק רעיון |

**כשלים מתועדים של מודלים ייעודיים** **[מקור: BeautyGRPO]**: זיהוי פגמים לא
מדויק, הסרה חלקית, **החלקת-יתר שמוחקת מרקם**. מודלי עריכה כלליים: מוחקים שומות,
ברק סינתטי.

**מה שופטים אנושיים בודקים** (FRPref-10K, חמישה צירים): החלקה, הסרת פגמים,
איכות מרקם, חדות, שימור זהות.

---

## 4. מה יש אצלנו, ולמה זה נכשל

### `engine/skin.py` — הכלי שבמוצר
- עושה **רק** את השורה השנייה בטבלה 1 (גוון): bilateral על שכבה נמוכה.
- **אין** הסרת פגמים, **אין** D&B למעברים קטנים.
- ברירת המחדל כמעט לא עושה כלום: הסיר 4.4% מאי-האחידות **[מקור: TOOLS-STATUS]**;
  שינוי ממוצע ‎0.5 L* על שתי תמונות **[נבדק]**.
- במקסימום: sigmaColor 180 מתנהג כמעט כמו טשטוש רגיל ומוחק נפח. שינוי צורת
  האור והצל גבוה פי 5 מגישה ששומרת נפח (1.58 מול 0.31) **[נבדק]**.
- **באג פעיל:** ב-321A5015, בסליידרים גבוהים, פני הילדה נמרחו (אף, שפתיים, עין).
  לא אובחן **[נבדק, ויזואלי]**.
- **[מסקנה]** זה לא כלי גרוע שצריך כיוון. זה כלי שמטפל ברבע מהבעיה.

### `engine/abpn.py` — עטיפה של רכיב אחד מתוך DAMO
- חשוף במנוע כנתיב `face-retouch`, **וגם** קיים בקטלוג הממשק
  (`src/toolRegistry.ts`) ובקטגוריית הריטוש של V2. *(תיקון 14.09: בגרסה
  הקודמת של המסמך נכתב "לא קיים בממשק" — חיפשתי את המחרוזת `abpn` ולא את המזהה
  `face-retouch`.)*
- **ורשת ההשוואה שלו רצה בלי ה-sigmoid האחרון של המודל** — השכבה חזקה פי ~57
  מהמודל של DAMO. כלומר מה שנבדק ב-13.09 בשם "ABPN" לא היה המודל. ראו
  `docs/BUGS.md` BUG-008.
- מריץ **רק** את מודל ההשוואה (1). בלי גלאי הפגמים ובלי השחזור.
- מוסיף שני "מעקות": (א) מחזיר את השדה הנמוך (0.12·face_d) **מהמקור**;
  (ב) אוסר על כל פיקסל לחצות את הסביבה שלו.
- **[מסקנה, לא נמדד]** מעקה (א) מבטל חלק ממה שהמודל נועד לעשות — השוואת גוון
  בסקאלה בינונית. כלומר מה שבדקנו ב-13.09 **אינו** המודל הרשמי.

### DAMO הרשמי, מלא, בלי הלבנה — בדיקה שלי, 14.09 **[נבדק]**
על שתי פנים (בחור עם אקנה מסטוק; האישה ב-321A5015):
- **אקנה:** הרשמי מסיר את רוב האקנה ו**משאיר יותר מרקם** מהעטיפה שלנו; נשארים
  סימנים דהויים בודדים. העטיפה שלנו נקייה יותר, אבל ורודה ושעוותית יותר, ויש בה
  מעבר צבע בלסת.
- **האישה:** שלושתם טבעיים. הרשמי המלא מסיר את הפצעון בסנטר לגמרי.
- **זמנים (CPU):** טעינה 29 שניות פעם אחת; 3.3 שניות לפנים בודדות; 5.4 שניות
  לשלוש פנים.
- **הערה:** בטעינה, ModelScope דיווח "Downloading 6/6 files" עבור גלאי הפנים.
  זה נראה כמו בדיקת מטמון (0.1 שנייה), אבל לא אימתתי שלא נשלחה בקשה החוצה.
- **גבול:** שתי פנים בלבד. זו הבנה של הכלי, לא הוכחה שהוא מתאים לכל התמונות.

---

## 5. מה נדרש מכלי "החלקת עור" שעובד — קריטריוני קבלה

נגזרים מסעיפים 1–3. כולם נבדקים **בגודל צפייה רגיל וב-100%**, על פנים שבאמת
צריכות טיפול (אקנה, עור מבוגר, אדמומיות), וגם על פנים נקיות (ילדים) — שם הכלי
צריך כמעט לא לגעת.

1. פגמים נקודתיים בולטים נעלמים, ולא הופכים לכתם דהוי או לנקודה בצבע אחר (הכשל
   של C מ-13.09).
2. אי-אחידות גוון יורדת בלי להשטיח: עצם הלחי והלסת נשארות.
3. מרקם נשמר בעין ב-100%. אין "שעווה".
4. תווי פנים נשמרים. אף פעם לא נמרחים, גם בעוצמה מלאה (הבאג ב-321A5015).
5. אין קו צבע בין הפנים לצוואר.
6. אין שינוי בגוון הכללי ואין הלבנה אם לא ביקשו.
7. שומות ונמשים — החלטת מוצר פתוחה (ראו 6).
8. ברירת המחדל נראית טוב בלחיצה אחת. הסליידר מוריד, הוא לא "מציל".
9. עובד על קבוצות (כל פנים בגודל שלהן) ועל פנים קטנות (מסרב בגלוי, לא בשקט).
10. זמן: שניות בודדות לפנים ב-CPU.

---

## 6. [מסקנה] הכיוון, והחלטות שפתוחות אצלך

**הכיוון שנגזר מהמחקר**, לא עוד כיוונון של אותו רעיון:
הכלי צריך לבצע את **הסדר המקצועי** מאחורי כפתור אחד. הבסיס המעשי הקיים, החינמי,
המקומי ובעל הרישיון המתאים, הוא **שרשרת DAMO הרשמית כפי שהיא** (הסרת פגמים ←
השוואת עור), **בלי הלבנה ובלי המעקה שמבטל אותה**. סביבה שלושה דברים שחסרים בה:
הגנה על תווי פנים, התאמת צבע פנים–צוואר, והפעלה לכל פנים בנפרד.

**מה לא:** עוד bilateral/wavelet בכיוונון ידני כמנוע הראשי (הוכח שמטפל רק ברבע);
FLUX/BeautyGRPO (רישיון וכוח חישוב); Retouch4me (עלות לכל תמונה וענן; הצלם כבר
דחה ספק חיצוני שאינו מוטמע).

**החלטות מוצר שהן שלך, לפני בנייה:**
1. **האם "החלקת עור" כוללת הסרת פצעונים?** בכל הכלים בשוק כן. אבל אצלנו הסרת
   כתמים היא כלי נפרד שנדחה.
2. **שומות ונמשים:** להשאיר תמיד, או לתת לבחור? הגלאי הרשמי מסיר גם שומות
   **[מקור: README]**.
3. **כמה שליטה:** סליידר אחד (כמו Luminar), או שניים — פגמים ואחידות (כמו
   Photoshop)?

**מה עדיין לא ידוע:** אם השרשרת הזו עומדת בקריטריונים 1–10 על התמונות **שלך**.
זה נבדק רק על שתי פנים.

---

## מקורות

- [Frequency Separation That Looks Natural Not Plastic — DIYPhotography](https://www.diyphotography.net/skin-retouching-technique-frequency-separation/)
- [Dodge and Burn: Working with Micro Transitions — Retouching Academy](https://retouchingacademy.com/dodge-burn-working-with-micro-transitions/)
- [Micro Dodge and Burn vs Frequency Separation — CloudRetouch](https://www.cloudretouch.com/micro-dodge-and-burn-vs-frequency-separation/)
- [Should You Use Dodging and Burning or Frequency Separation — Fstoppers](https://fstoppers.com/education/should-you-use-dodging-and-burning-or-frequency-separation-retouching-images-458825)
- [Pratik's Retouching Guide — The Portrait Masters](https://theportraitmasters.com/wp-content/uploads/2019/11/Pratiks-Retouching-Guide-PDF-download.pdf)
- [Using the Skin Smoothing Neural Filter — Photofocus](https://photofocus.com/software/adobe/using-the-skin-smoothing-neural-filter-in-photoshop/)
- [Neural Filter Skin Smoothing: Fix Gray Artifacts — CloudRetouch](https://www.cloudretouch.com/neural-filter-skin-smoothing-artifacts/)
- [How to Smooth Skin in Lightroom Using Masks — Lou & Marks](https://loumarkspresets.com/blogs/lightroom/how-to-smooth-skin-in-lightroom-using-masks)
- [Evoto — Portrait Retouching Module: Skin Retouching](https://support.evoto.ai/portrait-retouching-module-skin-retouching/)
- [Evoto AI Review (2026) — Jana Kukebal](https://www.janakukebal.com/blog/evoto-ai-review-workflow-retouching)
- [Retouch4me Dodge&Burn](https://retouch4.me/dodgeburn)
- [Luminar Neo Skin AI — Skylum](https://skylum.com/luminar/skin-ai)
- [Portraiture Plug-in User's Guide — Imagenomic](https://www.imagenomic.com/StaticFiles/Portraiture2PluginUsersGuide.pdf)
- [Skin Retouching with Wavelet Decompose — PIXLS.US](https://pixls.us/articles/skin-retouching-with-wavelet-decompose/)
- [darktable user manual — retouch](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/retouch/)
- [G'MIC Smooth Skin command line — discuss.pixls.us](https://discuss.pixls.us/t/how-to-make-a-stand-alone-command-line-for-the-filter-smooth-skin/20054)
- [YUCIHighPassSkinSmoothing — GitHub](https://github.com/YuAo/YUCIHighPassSkinSmoothing)
- [ModelScope skin_retouching pipeline](https://github.com/modelscope/modelscope/blob/master/modelscope/pipelines/cv/skin_retouching_pipeline.py)
- [RetouchFormer — GitHub](https://github.com/Davidcoach/RetouchFormer_AAAI_24)
- [RetouchGPT — GitHub](https://github.com/Davidcoach/RetouchGPT)
- [BeautyGRPO — arXiv](https://arxiv.org/html/2603.01163v1) · [GitHub](https://github.com/vivoCameraResearch/BeautyGRPO)
- [FLUX.1 Kontext dev — Hugging Face (license)](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev)
- [Face Retouching with Diffusion Data Generation and Spectral Restorement — ICCV 2025](https://openaccess.thecvf.com/content/ICCV2025/html/Xu_Face_Retouching_with_Diffusion_Data_Generation_and_Spectral_Restorement_ICCV_2025_paper.html)
- מחקר קודם בפרויקט: `docs/CLEANUP-IMPLEMENTATION-STATUS.md`, `tmp/pdfs/report-source.md`
