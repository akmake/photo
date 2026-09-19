# TEZA Backend — הפלטפורמה

ה-backend של TEZA: חשבונות, מנויים, הנפקת רישיונות, גלריות לקוח, ואזור ניהול.
מסמך ההחלטות המלא: [`../docs/LICENSING.md`](../docs/LICENSING.md).

> **תיקייה נפרדת, אותו ריפו.** ה-backend חי כאן, נפרד מ-`src` (הקליינט) ומ-`engine`
> (המנוע המקומי), אבל תחת אותו `main` — לא ענף (CLAUDE.md §3). הוא נפרס ל-VPS
> בנפרד; בפיתוח הוא רץ מקומית.

## מה זה מכיל

| חלק | קובץ | מצב |
|---|---|---|
| חשבונות (מייל/סיסמה + גוגל) | `app/routers/auth.py` | מייל/סיסמה עובד; גוגל שלד |
| מנויים + תשלום | `app/routers/billing.py` · `app/services/payments/` | ספק-דמה לפיתוח |
| הנפקת רישיונות (פתקים חתומים) | `app/routers/licenses.py` · `app/services/licensing.py` | Ed25519 אמיתי |
| גלריות לקוח | `app/routers/galleries.py` · `app/services/storage/` | בבנייה |
| אזור ניהול | `app/routers/admin.py` | בסיסי |
| האתר הציבורי + הפורטל | `web/` | בבנייה |

## הרצה בפיתוח

```bash
cd server
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8790
```

- API על `http://127.0.0.1:8790`. תיעוד חי: `http://127.0.0.1:8790/docs`.
- בהרצה ראשונה נוצר זוג מפתחות Ed25519 תחת `keys/` (לא נכנס ל-git).
  **המפתח הציבורי** (`keys/license_pub.pem`) הוא זה שמוטמע באפליקציה המקומית
  כדי לאמת פתקים. המפתח הפרטי לא עוזב את השרת.

## החלטות מקובעות

- **מקור-האמת = השרת.** האפליקציה המקומית מסתנכרנת אליו.
- **תשלומים מנותקי-ספק.** בפיתוח `stub` שלא מחייב. Stripe/סליקה מתחברים כמימוש של
  אותו ממשק, בלי לגעת בשאר. **אין נתונים מזויפים** — הדמה מסומן בבירור.
- **המקור (RAW) של הצלם לא עולה לעולם.** רק תצוגות גלריה, חשבונות, ורשומות.
- **DB:** SQLite בפיתוח, Postgres בייצור — דרך SQLAlchemy, החלפה בקונפיג.
