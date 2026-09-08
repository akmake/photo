# Smart Cleanup Agent

שירות מקומי ועצמאי לניתוח, סימון ותיקון בעיות בתמונה. השירות אינו מייבא קוד
מפרויקט הצילום ואינו תלוי במנוע העריכה שלו.

## המודלים

- `Qwen/Qwen3-VL-4B-Instruct` — הבנת התמונה, אבחון וסיווג בעיות.
- `facebook/sam2.1-hiera-small` — הפיכת תיבות האבחון למסכות פיקסל מדויקות.
- משחזר מקומי עצמאי — בשלב הראשון OpenCV inpainting; הממשק שלו נפרד כדי
  להחליפו במודלי שחזור ייעודיים לפי סוג הבעיה.

שני מודלי המשקולות מסומנים ברישיון Apache-2.0 בדפי המודל הרשמיים. יש לשמור
את הודעות הרישיון בהפצה מסחרית.

## הפעלה ב-Windows

```powershell
./scripts/setup.ps1
./scripts/download-models.ps1
./scripts/run.ps1
```

השרת יעלה ב-`http://127.0.0.1:8765`. המשקולות יורדות לתיקיית `models/`
בפקודת ההורדה בלבד. אין קריאות ענן בזמן ניתוח תמונה לאחר ההורדה.

## API

- `GET /health` — מצב השירות והמודלים.
- `POST /v1/analyze` — אבחון ומסכות ללא שינוי התמונה.
- `POST /v1/clean` — אבחון, מסכות ותמונה מתוקנת.
- `GET /annotator` — מסך מקומי לסימון מסכת פגם ומסכת אזורים אסורים ברמת פיקסל.
- `POST /v1/annotations` — שמירת דוגמת אימון אמיתית ומסומנת.

שתי פעולות ה-POST מקבלות שדה multipart בשם `image`.

## מצב איכות נוכחי

זוהי גרסת פיתוח, לא מנוע אוטומטי מוכן לייצור. Qwen, הצעות הפיקסלים ו-SAM
רצים מקצה לקצה, אך הצעות שאינן מאומתות מסומנות `manual_review` ואינן מתוקנות.
השלב הבא הוא אימון/כיול מאמת פגמים על מאגר clean/defect מסומן, כדי לצמצם
ממצאים טבעיים בלי להחמיץ לכלוך אמיתי.

## מסלול המודל הייעודי

הבסיס שנבחר למסכות הוא `facebook/sam2.1-hiera-small` ברישיון Apache-2.0.
רכיב הראייה נותן תיבה גסה של פגם שלם; רכיב המסכה של SAM 2 מכוונן על
מסכות פגמים אמיתיות. מקודד התמונה נשאר קפוא כדי שהאימון יתאים לכרטיס עם
12GB זיכרון. כל מסכה עוברת בסוף חיסור קשיח של עיניים, ריסים, גבות, שפתיים,
נחיריים, אוזניים ושיער.

דוגמאות מלאכותיות נועדו לאתחול ובדיקת התשתית בלבד:

```powershell
python scripts/generate_bootstrap_dataset.py --base-faces training-data/base_faces --output training-data/bootstrap-v1 --count 100
python scripts/train_sam2_defects.py --manifest training-data/bootstrap-v1/manifest.jsonl --model models/sam2.1-hiera-small --output models/sam2-defects-v1
python scripts/evaluate_sam2_defects.py --manifest training-data/bootstrap-v1/manifest.jsonl --model models/sam2.1-hiera-small --decoder models/sam2-defects-v1/mask_decoder.pt --output runs/eval.json
```

אין לאשר מודל לייצור על סמך דוגמאות מלאכותיות. נדרש סט בדיקה נפרד של
תמונות אמיתיות ומסכות שתוקנו ידנית עד לרמת פיקסל.
