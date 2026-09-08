# מאגר 100 מודלי הראייה המקומיים המובילים לשימוש מסחרי

**תאריך אימות:** 2026-08-16  
**היקף:** משקולות ציבוריות להורדה, הבנת תמונה, ורישיון שמאפשר שימוש מסחרי (חלק מהרישיונות מותנים).

## מה יש במאגר

הקובץ `vision_models_top_100_commercial.csv` כולל 100 checkpoints רשמיים של המפרסמים, ללא כימותי קהילה כפולים. לכל שורה יש דירוג, קטגוריה, גודל, יכולות OCR ומסמכים, grounding, מסכות, פעולות GUI, יצירה/עריכה, וידאו, כלים, דרישת חומרה, רישיון, תנאים וקישורי מקור. גרסת Excel מעוצבת זמינה כ-`vision_models_top_100_commercial.xlsx`.

## תמצית

- 91 מודלים משתמשים ברישיון מתירני מוכר כגון Apache-2.0 או MIT.
- 9 מודלים מסחריים תחת רישיון מותנה כגון Gemma, Llama או OpenRAIL.
- 77 מודלים מסומנים כבעלי פעולה ממוקדת ישירה: קואורדינטות/תיבות, מסכות, חילוץ מסמך מובנה, פעולות GUI או יצירה/עריכה.
- דירוג S הוא הבחירה הכללית החזקה ביותר; דירוג "מומחה" אינו בהכרח חלש — הוא לעיתים ממוקד יותר ב-OCR, GUI או grounding.

## מובילים לפי קטגוריה

| קטגוריה | המודל המדורג ראשון | פעולה ממוקדת | רישיון |
|---|---|---|---|
| VLM כללי מתקדם | [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) | ישיר: קואורדינטות, תיבות, הצבעה, פלט מובנה ותכנון שימוש בכלים | apache-2.0 |
| VLM כללי | [google/gemma-4-31B-it](https://huggingface.co/google/gemma-4-31B-it) | עקיף: ניתוח, פלט מובנה והכוונת כלי חיצוני; לא משנה פיקסלים לבדו | apache-2.0 |
| VLM קומפקטי | [openbmb/MiniCPM-V-4.6-Thinking](https://huggingface.co/openbmb/MiniCPM-V-4.6-Thinking) | עקיף: OCR ופלט מובנה; יכול להכווין כלי חיצוני | apache-2.0 |
| VLM מרחבי/מצביע | [allenai/Molmo2-8B](https://huggingface.co/allenai/Molmo2-8B) | ישיר: הצבעה מדויקת, נקודות, קואורדינטות ומעקב חזותי | apache-2.0 |
| VLM כללי/MoE | [moonshotai/Kimi-VL-A3B-Thinking](https://huggingface.co/moonshotai/Kimi-VL-A3B-Thinking) | ישיר: grounding, קואורדינטות, reasoning חזותי ופלט מובנה | mit |
| מסמכים/VLM ארגוני | [ibm-granite/granite-vision-4.1-4b](https://huggingface.co/ibm-granite/granite-vision-4.1-4b) | ישיר: חילוץ מבני, טבלאות, פריסה ופלט מסמכים מובנה | apache-2.0 |
| VLM קטן/Edge | [HuggingFaceTB/SmolVLM2-2.2B-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct) | עקיף: פלט טקסט מובנה והכוונת כלי חיצוני | apache-2.0 |
| ראייה ממוקדת/grounding | [microsoft/Florence-2-large-ft](https://huggingface.co/microsoft/Florence-2-large-ft) | ישיר: captioning, OCR, תיבות, grounding, זיהוי ואזורים/מסכות | mit |
| סוכן GUI חזותי | [ByteDance-Seed/UI-TARS-1.5-7B](https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B) | ישיר: click, type, scroll, drag וקואורדינטות על ממשק | apache-2.0 |
| OCR/מסמכים | [zai-org/GLM-OCR](https://huggingface.co/zai-org/GLM-OCR) | ישיר: חילוץ טקסט, טבלאות, נוסחאות, פריסה ולעיתים תיבות | mit |
| הבנה + יצירה/עריכה | [google/diffusiongemma-26B-A4B-it](https://huggingface.co/google/diffusiongemma-26B-A4B-it) | ישיר: יצירת תמונה ועריכה מונחית טקסט/תמונה | apache-2.0 |

## איך נקבע הדירוג

זהו דירוג מערכתי-מערכתי ולא טבלת benchmark יחידה. הוא משקלל: איכות ורוחב יכולות ראייה; OCR ומסמכים; grounding ופעולות ממוקדות; בשלות מקומית ותמיכת runtimes; מוניטין ותחזוקת המפרסם; שימוש ואותות קהילה; ובהירות הרישיון המסחרי. מודלים מאותה משפחה בגדלים או במצבי Instruct/Thinking שונים נשמרו כאשר הם מייצגים checkpoint שימושי נפרד. כימותים והמרות קהילה לא נספרו כמודלים חדשים.

## משמעות הסימון "פעולה ממוקדת"

- **ישיר:** המודל מחזיר ייצוג פעולה שימושי — תיבה, נקודה, קואורדינטה, מסכה, מבנה מסמך, פקודת GUI או תמונה חדשה/ערוכה.
- **עקיף:** המודל מבין ומתכנן, אך נדרש כלי חיצוני כדי לבצע שינוי בתמונה או בממשק.
- **לא:** מיועד בעיקר להבנה/תיאור ללא ממשק פעולה שימושי.

## הערות רישוי חשובות

"מסחרי" אינו אומר "ללא תנאים". Apache-2.0 ו-MIT מתירניים, אך דורשים שמירת הודעות. Gemma, Llama ו-OpenRAIL מאפשרים שימושים מסחריים בכפוף לתנאים ולהגבלות שימוש. העמודה `commercial_conditions` היא תקציר בלבד ולא ייעוץ משפטי. לפני הפצה יש לקרוא את נוסח הרישיון וקובץ המודל המדויקים.

## מקורות ומתודולוגיה לאימות

- מטא-נתוני המאגר, מספר הורדות, לייקים, תאריך עדכון ותג הרישיון נקראו מ-[Hugging Face Hub API](https://huggingface.co/docs/huggingface_hub/package_reference/hf_api) בתאריך האימות.
- יכולות המודלים סוכמו מכרטיסי המודל הרשמיים המקושרים בכל שורת CSV.
- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0
- MIT: https://opensource.org/license/mit
- Gemma: https://ai.google.dev/gemma/terms
- Llama: https://www.llama.com/llama3_2/license/
- OpenRAIL: https://www.licenses.ai/ai-pubs-open-rails

## מגבלות

המספרים מ-Hugging Face הם snapshot ומשתנים. ציוני היכולות הם הערכה השוואתית המבוססת על כרטיסי מודל ושימושיות מעשית, לא תוצאות benchmark אחידות. תמיכה בפלט מרחבי תלויה לעיתים ב-prompt ובמעבד התמונה של היצרן. דרישות חומרה הן הנחיה גסה; כימות, אורך הקשר ורזולוציית התמונה משנים מאוד את צריכת הזיכרון.
