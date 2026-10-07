# הגנה על הקוד בחבילה — מסמך הכלי וטיים־ליין

## איפה אנחנו עומדים (עדכון אחרון: 07.10.2026)

- **מה הוחלט:** שלושה חלקים (הצלם, 07.10): (1) המנוע — הקוד שלנו מקומפל לקוד מכונה; (2) המעטפת
  (החלון) — מקובצת, מכווצת ומומרת לבייטקוד של V8; (3) נעילה מפני שינוי — "פיוזים" של Electron
  ובדיקת טביעות של קובצי המנוע לפני שהוא מופעל. חתימה דיגיטלית — לא עכשיו.
- **הנחיית הצלם:** "תכין הכל, לא לארוז מחדש כרגע. כשאגיד לארוז — תדעו בדיוק באיזו תצורה."
  התצורה כתובה ב-`docs/PACKAGING.md` §6.
- **מה מוכן ונבדק / לא נבדק:** ראה טיים־ליין למטה.

## מה זה "הצליח"

נכתב לפני העבודה:

1. **מנוע:** בחבילה אין אף מודול שלנו כבייטקוד פייתון. `archive_viewer` על `teza-engine.exe` לא מוצא
   את `cleanup`, `masks`, `server` וכו' בארכיון ה-PYZ; במקומם קובצי `.pyd` (קוד מכונה). ההסברים
   שבקוד (docstrings) לא קיימים בחבילה. המנוע עובר את בדיקות המנוע ועולה מהמעטפת.
2. **מעטפת:** אין בחבילה `main.cjs`/`updater.cjs`/`serverOrigin.cjs` כטקסט; במקומם `shell.jsc` (בייטקוד)
   ומטען קטן. התוכנה עולה, מפעילה את המנוע, ובודקת עדכונים כמו קודם.
3. **נעילה:** שינוי של בייט אחד ב-`app.asar` → התוכנה לא עולה. שינוי של קובץ מנוע שלנו או של קובצי
   הרישוי → המנוע לא מופעל וכתוב "ההתקנה פגומה". `npx @electron/fuses read` מראה את הפיוזים.
4. **ללקוח אין הבדל:** אותו גודל בערך, אותה מהירות פתיחה (±10%).

---

## טיים־ליין

### 07.10.2026 — ממצאים: מה חשוף בחבילה 0.2.1 (נבדק בפועל, על `release/win-unpacked` של 25.09)
- **המנוע** (`resources/engine/teza-engine.exe`, PyInstaller): כל המודולים שלנו בארכיון PYZ כבייטקוד.
  עם `PyInstaller.utils.cliutils.archive_viewer` (מותקן כבר ב-`engine/.venv`) רשימת המודולים יוצאת
  בשניות: `cleanup, color_harmonization, gallery_remote, license_state, local_color, masks, object_fill,
  pixel_color, render, server, skinmodel, triage` ועוד (10,447 רשומות). חילוץ `cleanup` מתוך החבילה:
  docstring של 1,722 תווים שמתאר את שיטת הזיהוי, ו-51 פונקציות בשמן. `license_state`: 29 פונקציות,
  כולל `verify` — כלומר אפשר לא רק לקרוא אלא גם לעקוף. `optimize=0` בספק → ה-docstrings בפנים.
- **המעטפת** (`app.asar` → `electron/main.cjs` ועוד): טקסט קריא, 581 שורות עם כל ההערות.
- **הממשק** (`dist/assets/*.js`): מכווץ, בלי קובצי מפה. אין שם סוד — נשאר כמו שהוא.
- **מודלים** (`resources/models`): ברובם פתוחים (LaMa, MobileSAM, BiRefNet, DINOv2…). אין טעם להסתיר.
- **קובצי רישוי** (`license-config.json`, `license-public.pem`): מחוץ ל-asar, אפשר להחליף. המנוע מקבע
  את טביעת המפתח (`license:pin`) — אבל המנוע עצמו היה קריא וניתן לשינוי.
- **אין פיוזים** מוגדרים (`package.json` build).

### 07.10.2026 — מחקר
| מקור | מה לקחנו |
|---|---|
| PyInstaller 6 הסיר את הצפנת הבייטקוד (`--key`) — [CVE-2025-59042](https://nvd.nist.gov/vuln/detail/CVE-2025-59042) | אין "מנעול" מובנה ב-PyInstaller; צריך לא לשלוח בייטקוד בכלל |
| Cython — תומך ב-3.14 ([PyPI 3.2.5](https://pypi.org/project/Cython/3.2.5/)), Apache-2.0 | מקמפל את המודולים שלנו ל-`.pyd`; PyInstaller נשאר — צינור שכבר עובד |
| Nuitka — תמיכה רשמית ב-3.14 מגרסה 4.2 (08.2026) — [nuitka.net](https://nuitka.net/posts/nuitka-release-42.html), Apache-2.0 | חלופה: מקמפל הכול. נדחה כצעד ראשון: מחליף את כל צינור האריזה (torch, onnxruntime, mediapipe) — סיכון גבוה בלי תועלת נוספת לקוד שלנו |
| PyArmor | נדחה: רישיון מסחרי בתשלום, ונפרץ שוב ושוב |
| Electron ASAR integrity — [docs](https://electronjs.org/docs/latest/tutorial/asar-integrity) | Windows נתמך מ-Electron 30 (אצלנו 44). electron-builder 26 מטמיע את הטביעה ב-EXE (`electronWin.addWinAsarIntegrity`) |
| בייטקוד V8 — [electron-vite](https://electron-vite.org/guide/source-code-protection), bytenode (MIT) | רק לתהליך הראשי, לא לממשק. נכתב בבית (כמו bytenode) — בלי תלות חדשה |

### 07.10.2026 — תנאי מוקדם שחסר במחשב
- `cl.exe` ו-`link.exe` קיימים (Build Tools 18, MSVC 14.51), אבל **Windows SDK לא מותקן** (`Windows Kits\10`
  מכיל רק Redist). בלעדיו אי אפשר לקמפל הרחבות פייתון. ההתקנה — דרך Visual Studio Installer
  ("Windows 11 SDK" ברכיב Build Tools). זו התקנת מערכת — נשארה לצלם. גם Cython לא מותקן ב-`engine/.venv`.

### 07.10.2026 — נבנה (בלי לארוז, לפי הנחיית הצלם)
- **מנוע:** `engine/build_protected.py` — מקמפל ב-Cython כל מודול שהספק שולח (אותו כלל בחירה), עם
  `annotation_typing=False` (שהקוד יתנהג כמו פייתון ולא יאכוף רמזי טיפוס), בלי חתימות ובלי שורות מקור
  ב-C. כותב `engine/.protect/modules.json` עם טביעת המקור של כל מודול. `teza-engine.spec` עם
  `TEZA_PROTECT=1`: הניתוח רץ על ה-.py (כדי ללמוד אילו ספריות צריך), ואז המודולים שלנו יוצאים מה-PYZ
  ונכנסים כ-`.pyd`. מודול חסר / מקור שהשתנה → הבנייה נעצרת.
  - **שינוי במנוע שנדרש לזה:** `launch.py` הריץ את `server`/`prep` דרך `runpy` כ-`__main__` — מודול מקומפל
    לא ניתן להרצה כך. עכשיו `server.serve()` ו-`prep.main()`; גוף בלוק ה-`__main__` של `server.py` עבר
    כמו שהוא לפונקציה `serve()`. משורת הפקודה — אותה התנהגות. נבדק: שני הקבצים עוברים ניתוח תחבירי;
    לא הורץ (הרצת המנוע מכאן אסורה — זיכרון "engine from Claude desktop splits data").
- **מעטפת:** `scripts/protect-shell.cjs` — esbuild (bundle + minify, בלי הערות) → בייטקוד V8 בתוך
  ה-Electron של הפרויקט (`ELECTRON_RUN_AS_NODE`) → `electron/shell.jsc`; טוען בחזרה לבדיקה.
  `electron/bytecode.cjs` — המטען (השיטה של bytenode, נכתבה בבית: אורך מקור מהכותרת, החלפת hash הדגלים,
  `--no-lazy` + `--no-flush-bytecode`). **נבדק:** נבנה 37,336 בתים ונטען ב-Electron 44.4.2; בקובץ אין
  "WHAT THIS IS FOR", "ATTACHING IS NOT A FALLBACK", ולא שמות הפונקציות `engineCommand`/`startEngine`.
  **לא נבדק:** הפעלת המעטפת מהבייטקוד (זה מפעיל את התוכנה ואת המנוע).
- **נעילה:** `build.electronFuses` ב-`package.json` (runAsNode, NODE_OPTIONS, --inspect כבויים; טביעת asar
  + טעינה רק מ-asar). נבדק בקוד של electron-builder 26.0.12: הטביעה מוטמעת ב-EXE ב-Windows גם כש-
  `signAndEditExecutable: false` (`ElectronFramework.beforeCopyExtraFiles` → `addWinAsarIntegrity`).
  `grantFileProtocolExtraPrivileges` נשאר ברירת מחדל: הממשק נטען מ-`file://` (`loadFile`).
  חותמת המנוע: `scripts/engine-manifest.cjs` + `electron/integrity.cjs`, נקראת ב-`main.cjs` לפני הפעלת
  המנוע (רק בחבילה). **נבדק:** `tests/integrity.test.ts` — שלם עובר, שינוי ומחיקה מזוהים בשמם, רשימה
  ריקה אף פעם לא "שלמה". עלות בפתיחה: גיבוב ה-EXE וה-.pyd שלנו — לא נמדד (אין עדיין .pyd).
- **לא נבדק — מחכה לאריזה הבאה:** הכול ברשימת "בדיקות ההגנה" ב-`docs/PACKAGING.md` §6 שלב ה.
