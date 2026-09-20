# TEZA — Product Expansion Architecture & Roadmap

> מסמך זה מתאר הרחבות מוצריות ל-TEZA על בסיס הקוד הקיים ב-`main`, ולא כרשימת פיצ'רים כללית.
>
> המטרה: לכל יכולת להגדיר **מה קיים היום, איפה הוא נמצא בקוד, מה חסר, מה צריך להיות, איפה המידע צריך לחיות, לאילו מערכות הוא מתחבר, ומה נחשב יישום שלם**.

---

## 1. עקרונות בסיס לפני שמוסיפים משהו

TEZA כבר אינה "עורך תמונות". בקוד הקיים יש ארבע מערכות מוצר שונות שמחוברות לאותה אפליקציה:

1. **ניהול סטודיו ועסק** — פרויקטים, לקוחות, תאריכים, מחיר, יתרה.
2. **Workflow של צילום** — ייבוא, מקבצים/רצפים, בחירה, עריכה, אלבום, מסירה.
3. **מנוע תמונה מקומי** — Python sidecar, עיבוד, AI, embeddings, culling, rendering.
4. **מערכת לקוח** — גלריה, בחירת לקוח, הערות, נעילה/פתיחה מחדש ופרסום.

לכן כל הרחבה צריכה להיכנס למקום הנכון, ולא להפוך לעוד state מקומי בתוך מסך.

### 1.1 גבול הנתונים שכבר קיים וצריך לשמור

הפרדה נכונה כבר קיימת ב-`src/studio/store.ts`:

- **מידע עסקי חוצה-פרויקטים** שייך למסד המרכזי:
  - לקוחות
  - כסף
  - משימות
  - תאריכים
  - התראות
  - עסקאות
  - קשרים בין לקוח לפרויקטים

  שכבות קיימות:
  - `src/db.ts`
  - `engine/db.py`
  - `src/studio/store.ts`

- **מידע שהוא חלק מעבודת התמונות של פרויקט אחד** צריך להישאר עם הפרויקט:
  - מקבצים
  - סטטוס של תמונות
  - recipes
  - בחירה
  - snapshots של עבודת הפרויקט
  - מידע טכני על קבצים

  שכבות קיימות:
  - `src/studio/store.ts`
  - `engine/workspace.py`
  - `project.json` בתיקיית הפרויקט

הכלל: **אם מעתיקים את תיקיית הפרויקט למחשב אחר, כל מה שנחוץ להמשך העבודה על התמונות צריך לעבור איתה. מידע עסקי של הסטודיו לא צריך להיות משוכפל לתוך כל פרויקט.**

### 1.2 V1 אינו יעד מוצרי

ב-`src/studio/store.ts` קיים מודל שלבים שלם:

`setup → import → batches → select → edit → album → deliver`

אבל V2 ב-`src/v2/V2App.tsx` מגדיר כרגע:

`client-status → gallery-upload → batches → send-to-client → gallery-edit → album-design`

כל הרחבה חדשה צריכה להיבנות קודם כל עבור V2. אם יש יכולת תקינה ב-V1, אפשר למחזר את הלוגיקה, אך לא לבנות מסך חדש שמעמיק את הפער בין הממשקים.

---

# חלק א' — השלמת Workflow הליבה

## 2. שלב בחירה / סינון אמיתי ב-V2

### למה זה חסר

זהו החור המבני הבולט ביותר כרגע. מודל הפרויקט כבר מכיר את שלב `select`, והמנוע כבר מכיר ניתוח culling, אבל ב-V2 המשתמש עובר מ-`מקבצים` ישר ל-`שלח ללקוח`.

### המצב הקיים

**Frontend**
- `src/v2/V2App.tsx`
  - אין stage בשם select/cull.
  - `BatchesV2` ממשיך ישירות אל `SendToClientV2`.
- `src/v2/screens/BatchesV2.tsx`
  - `onNext()` שולח ל-`send-to-client`.
- `src/studio/store.ts`
  - קיים `select` בתוך `STAGES`.
  - קיימים counters כמו `kept`, `picked`.
  - קיימים photo statuses ותשתיות בחירה ברמת הפרויקט.

**Engine**
- `engine/cull.py`
  - כבר מודד חדות, פנים, עיניים, חשיפה, head turn ועוד.
  - התוצאה היא non-destructive verdict עם reasons.
- `engine/embed.py`
  - כבר מספק embeddings להשוואה חזותית.
- `engine/identity.py`
  - כבר תומך בזהות פנים.
- `engine/server.py`
  - כבר מחבר את מנועי הניתוח ל-sidecar המקומי.

### מה צריך להיות

מסך V2 עצמאי, למשל:

`src/v2/screens/SelectV2.tsx`

המסך לא צריך להיות "עוד Grid". הוא צריך להיות סביב החלטות:

- נבחרות
- לבדיקה
- מומלץ לפסול
- סיבה לכל הצעה
- override ידני
- פילטר לפי reason
- כניסה לפריים מלא
- מעבר מהיר בין תמונות
- עבודה לפי מקבץ קיים, אבל בלי לייצר מחדש את המקבצים

### מודל נתונים

החלטת הצלם היא מידע של הפרויקט ולכן צריכה להישמר ב-`project.json`, דרך `studio/store.ts`.

מומלץ להפריד בין:

- `analysisVerdict` — מה המנוע חשב.
- `userDecision` — מה הצלם החליט.
- `reasons` — למה המנוע סימן.
- `decidedAt` / אופציונלי `decisionSource`.

אסור שהרצת analysis מחדש תמחק override ידני.

### חיבורים

- `ImportV2` → `BatchesV2` → **`SelectV2`** → `SendToClientV2`
- `TodayV2` צריך לחשב progress מתוך אותו שלב.
- `ProjectsV2` צריך להציג "בחירה" כאשר הפרויקט שם.
- `SendToClientV2` צריך לפרסם כברירת מחדל את ה-kept/selected, לא את כל ה-frames.

### Definition of Done

- V2 כולל stage בחירה אמיתי.
- החלטות נשמרות בפרויקט.
- rerun של AI אינו מוחק החלטת משתמש.
- אפשר להמשיך לגלריה רק עם הסט שנבחר, עם אפשרות מפורשת לבחור מקור אחר.

**עדיפות: P0**

---

## 3. שלב מסירה אמיתי ב-V2

### המצב הקיים

- `src/studio/store.ts` מכיר stage בשם `deliver`.
- `src/studio/screens/DeliverSet.tsx` מכיל implementation ישן של מסירה.
- `Project.state` כבר כולל `done`.
- V2 ב-`V2App.tsx` נעצר ב-`album-design` ואין stage מסירה.

### הבעיה

פרויקט יכול להגיע לסוף העריכה או האלבום בלי surface אחד שמגדיר "מה באמת נמסר".

### מה צריך להיות

`src/v2/screens/DeliverV2.tsx`

המסך צריך לענות על ארבע שאלות:

1. מה התחייבנו למסור?
2. מה כבר מוכן?
3. מה נמסר בפועל?
4. מה עדיין מונע סגירת פרויקט?

### Deliverable state

במקום ש-`hasAlbum` ו-`hasGallery` יהיו רק booleans, יש להוסיף שכבת state לכל deliverable:

- `not_started`
- `working`
- `waiting_client`
- `approved`
- `delivered`

סוגי deliverables ראשוניים:
- final files
- client gallery
- album
- future print products

### חיבורים

- `GalleryEditV2` / rendering
- `AlbumStudio`
- gallery state
- payment state
- project completion
- future delivery QC

### Definition of Done

פרויקט לא הופך `done` בגלל מעבר ידני לשלב האחרון. הוא הופך `done` כאשר כל deliverables הנדרשים הושלמו או כשהמשתמש סוגר אותם במפורש.

**עדיפות: P0**

---

# חלק ב' — לקוח ו-CRM

## 4. Client Entity אמיתי

### המצב הקיים

`src/v2/screens/ClientsV2.tsx` אינו קורא collection של clients. הוא משתמש ב-`useClientSummaries()`, כלומר הלקוח נגזר מקיבוץ projects לפי שם.

`NewProject.tsx` משתמש בשם לקוח ומנסה להשלים מול לקוחות מוכרים, אבל הקשר עדיין מבוסס טקסט.

### הבעיות במבנה הנוכחי

- שינוי spelling בשם יכול ליצור "לקוח חדש".
- שני אנשים עם אותו שם עלולים להתאחד.
- אין מקום טבעי למידע שאינו שייך לפרויקט אחד.
- פרטי קשר חוזרים על עצמם ברמת הפרויקט.
- אי אפשר לבנות CRM, preferences או היסטוריה אמינה על string.

### מה צריך להיות

Entity מרכזי:

```ts
interface Client {
  id: string;
  displayName: string;
  phones: string[];
  emails: string[];
  address?: string;
  notes?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}
```

ו-`Project` יקבל:

`clientId: string`

בשלב migration ניתן להשאיר `client` כ-denormalized display field לתאימות, אבל `clientId` יהיה מקור האמת לקשר.

### איפה המידע חי

DB מרכזי:
- `src/db.ts`
- `engine/db.py`

לא ב-`project.json`, כי לקוח שייך למספר פרויקטים.

### Frontend

- `ClientsV2.tsx` הופך למסך לקוחות אמיתי.
- מסך client detail חדש:
  - פרטי קשר
  - פרויקטים
  - יתרה כוללת
  - activity
  - tasks
  - notes
- `NewProject.tsx` בוחר Client ID קיים או יוצר חדש.

### Migration

יש לכתוב migration idempotent:
- קיבוץ projects קיימים לפי normalized name.
- יצירת Client.
- כתיבת `clientId` בפרויקטים.
- בלי למחוק את שדה השם הישן בשלב ראשון.

**עדיפות: P0/P1**

---

## 5. CRM קטן וממוקד לצלם

### לא מה לבנות

לא לבנות CRM כללי עם pipelines שרירותיים, custom objects ומאה שדות.

### מה כן חסר

פעולות יומיומיות סביב לקוח:

- להתקשר
- לשלוח הודעה
- לחכות לבחירה
- לחכות לתשלום
- לחזור בעוד שבוע
- לתעד בקשה
- לסמן follow-up

### מצב קיים

- `ClientsV2.tsx` מציג טלפון, מייל, היקף ויתרה.
- `TodayV2.tsx` כבר בנוי כ-dashboard.
- `V2App.tsx` כבר מחזיק Bell/attention בסיסי.

### מה צריך להיות

Entity של Activity/Task במאגר המרכזי:

```ts
type TaskStatus = 'open' | 'done' | 'dismissed';

interface StudioTask {
  id: string;
  clientId?: string;
  projectId?: string;
  title: string;
  dueAt?: string;
  status: TaskStatus;
  kind: 'call' | 'message' | 'payment' | 'approval' | 'delivery' | 'custom';
  createdAt: string;
}
```

### חיבורים

- Today: משימות של היום/באיחור.
- Client: כל המשימות של הלקוח.
- Project: משימות של העבודה.
- Notifications: deadline או event יכול להוליד attention item.

**עדיפות: P1**

---

## 6. Project Notes אמיתיות

### מצב קיים

יש הערות שנכנסות דרך מערכת הגלריה ו-`NoteViewer`, אבל אין "מחברת פנימית" פשוטה לפרויקט.

### מה צריך להיות

Notes פנימיות לצלם, למשל:
- "האמא ביקשה בלי תמונות של..."
- "כריכה לבנה"
- "הלקוח ביקש גרסה שחור לבן"
- "לא לפרסם ברשתות"

### איפה לחיות

אם הערה היא חלק מה-workflow של הפרויקט וצריכה לנוע עם תיקיית העבודה — `project.json`.

אם בעתיד רוצים notes ברמת client שחוצים פרויקטים — DB מרכזי.

### UI

- Project Overview
- Client detail עבור notes כלליות
- timestamp, edit, pin

**עדיפות: P1**

---

# חלק ג' — זמן, משימות ועסק

## 7. יומן אמיתי

### המצב הקיים

`src/v2/screens/CalendarV2.tsx` בונה calendar מתוך `Project.date` בלבד.

בנוסף, שדה התאריך הנוכחי הוא `dd.mm`, והקוד מסיק את השנה מתוך `createdAt`.

זה פתרון סביר לתצוגת צילום, אבל אינו מודל זמן מלא.

### מה צריך להיות

אירועי workflow אמיתיים:

- shoot
- meeting
- client selection deadline
- edit deadline
- album proof due
- delivery
- payment due
- custom

### מודל

```ts
interface CalendarEvent {
  id: string;
  projectId?: string;
  clientId?: string;
  type: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  completedAt?: string;
}
```

### שינוי חשוב בפרויקט

להחליף בהדרגה את `date: 'dd.mm'` בשדה תאריך מלא, למשל:

`shootAt: ISO-8601`

ניתן להשאיר `date` לתאימות בזמן migration.

### חיבורים

- `CalendarV2`
- `TodayV2`
- Project overview
- notifications/tasks

**עדיפות: P1**

---

## 8. משימות ודדליינים ברמת פרויקט

זה קשור ל-CRM אבל שונה ממנו: משימה יכולה להיות תוצאה אוטומטית של workflow.

### דוגמאות

- לאחר import: "השלם בחירה".
- לאחר publish gallery: "ממתין לבחירת לקוח".
- כשהלקוח נועל בחירה: "ייבא בחירה".
- כשהאלבום נשלח: "ממתין לאישור".
- יתרה פתוחה לקראת מסירה: "לגבות ₪X".

### מקור האמת

Task entity מרכזי ב-DB, עם projectId.

### כלל חשוב

לא לייצר duplicate tasks בכל render.

Workflow action צריך להיות idempotent:
- task key יציב, למשל `project:<id>:gallery-selection`.
- אם קיים task פתוח, מעדכנים אותו ולא יוצרים חדש.

### חיבורים

- `TodayV2`
- Project Overview
- Bell
- Client detail

**עדיפות: P1**

---

## 9. כספים אמיתיים — Transactions ולא רק price/paid

### מצב קיים

`Project` כולל:
- `price`
- `paid`

וה-UI מחשב יתרה פשוטה:

`price - paid`

זה עובד עבור מקדמה אחת, אבל לא מסביר מה קרה.

### מה צריך להיות

```ts
interface Transaction {
  id: string;
  projectId: string;
  amount: number;
  type: 'payment' | 'refund' | 'adjustment';
  method?: 'cash' | 'card' | 'transfer' | 'bit' | 'other';
  occurredAt: string;
  note?: string;
}
```

### נגזר ולא נשמר פעמיים

`paid` צריך בעתיד להיות derived מסכום transactions, או להישאר cache בלבד.

### UI

Project / Client:
- מחיר מוסכם
- שולם
- יתרה
- היסטוריית תשלומים
- הוספת תשלום
- refund/adjustment

### לא בשלב הראשון

חשבוניות/קבלות הן אינטגרציה חשבונאית נפרדת. קודם צריך ledger פנימי נכון.

**עדיפות: P1**

---

## 10. Activity Timeline לפרויקט

### הבעיה

המערכת כבר יודעת המון עובדות, אבל אין מקום אחד שבו אפשר לראות מה קרה.

### אירועים ראויים

- project created
- import completed
- batches generated/changed
- culling completed
- gallery published
- gallery locked by client
- client selection imported
- render completed
- album proof published
- album approved
- payment recorded
- delivered

### מודל

Append-only events במאגר המרכזי, לדוגמה:

```ts
interface ActivityEvent {
  id: string;
  projectId: string;
  clientId?: string;
  type: string;
  at: string;
  actor: 'studio' | 'client' | 'system';
  payload?: Record<string, unknown>;
}
```

### למה append-only

Timeline אינו state. הוא היסטוריה. שינוי state עתידי לא צריך לשכתב את העבר.

### חיבורים

- Project overview
- Client detail
- Today/alerts

**עדיפות: P1/P2**

---

# חלק ד' — Templates ו-Deliverables

## 11. Studio Templates

### מצב קיים

`NewProject.tsx` כבר כולל:
- event type
- price
- gallery
- album
- album size/style/cover

אבל כל פרויקט נבנה ידנית.

### מה צריך להיות

Template של studio workflow:

```ts
interface ProjectTemplate {
  id: string;
  name: string;
  eventType?: string;
  defaultPrice?: number;
  deliverables: DeliverableTemplate[];
  albumPlan?: ...;
  defaultDeadlines?: ...;
  defaultGalleryAlbums?: ...;
}
```

דוגמאות:
- חתונה מלאה
- בר/בת מצווה
- משפחה
- ניו בורן
- תדמית
- מוצר

### חיבורים

- NewProject
- default gallery quotas ב-`SendToClientV2`
- album defaults
- future deadlines/tasks

### כלל

Template הוא default בלבד. אחרי יצירת הפרויקט, הפרויקט עצמאי.

**עדיפות: P2**

---

## 12. Deliverables כישויות עם lifecycle

### מצב קיים

`Project` מחזיק:
- `hasAlbum`
- `hasGallery`

ו"final files" נחשב implicit.

### הבעיה

Boolean אומר רק "האם נמכר", לא:
- האם התחיל
- האם נשלח
- האם אושר
- האם נמסר

### מה צריך להיות

```ts
interface Deliverable {
  id: string;
  projectId: string;
  type: 'gallery' | 'album' | 'final-files' | 'print-product';
  label: string;
  status: 'not_started' | 'working' | 'waiting_client' | 'approved' | 'delivered';
  dueAt?: string;
  deliveredAt?: string;
}
```

### חיבורים

- NewProject
- SendToClient
- AlbumStudio
- DeliverV2
- Today
- Project progress

### מעבר

בשלב migration:
- `hasGallery=true` → ליצור gallery deliverable.
- `hasAlbum=true` → album deliverable.
- final-files תמיד נוצר.

**עדיפות: P1**

---

# חלק ה' — תשתית עבודה ואמינות

## 13. Background Jobs מרכזי

### מצב קיים

יש פעולות ארוכות רבות:
- import
- previews
- warm rendering
- culling
- embeddings
- gallery publish
- render
- album analysis/export

כל מסך מציג progress לעצמו, אם בכלל.

`engine/server.py` כבר מכיל worker, lanes, warm queue ו-caching, אבל אין model מוצרי אחיד של jobs.

### מה צריך להיות

Job manager ברור:

```ts
interface Job {
  id: string;
  type: string;
  projectId?: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  done?: number;
  total?: number;
  message?: string;
  error?: string;
  startedAt?: string;
}
```

### Backend

לא צריך מיד task queue חיצוני.

אפשר להתחיל ב-`engine/server.py` עם registry thread-safe:
- יצירת job
- progress
- cancellation
- status endpoint
- bounded history

### Frontend

Global Job Center ב-V2:
- פס קטן קבוע כשהעבודה רצה
- panel עם כל jobs
- retry failure
- open related project

### כלל

מסך לא צריך להמציא progress משלו אם העבודה עצמה ממשיכה גם כשהמסך נסגר.

**עדיפות: P1**

---

## 14. מרכז בריאות מערכת

### מצב קיים

`src/v2/screens/SettingsV2.tsx` בודק:
- workspace root
- engine availability
- DB health

זו התחלה טובה.

### מה להוסיף

Health endpoint מאוחד שיבדוק:

- engine
- database
- workspace read/write
- free disk
- models installed
- model checksum/size בסיסי
- gallery backend
- cloud source availability
- cache directory
- optional GPU/runtime providers

### Engine files רלוונטיים

- `engine/server.py`
- `engine/paths.py`
- `engine/setup_models.py`
- `engine/gallery_store.py`
- `engine/storage_locations.py`
- `engine/db.py`

### UI

ב-`SettingsV2`:
- תקין
- אזהרה
- שבור
- action ספציפי לכל בעיה

לא "engine down" כללי כאשר בעצם רק model אחד חסר.

**עדיפות: P1/P2**

---

## 15. Backup & Recovery Awareness

### מצב קיים

יש עקרון טוב: ה-import מעתיק את התמונות לתיקיית הפרויקט, והמקור לא משתנה.

אבל לא קיימת שכבה שאומרת למשתמש כמה עותקים יש בפועל ומה ניתן לשחזר.

### מה צריך להיות בשלב ראשון

לא שירות גיבוי, אלא **מודעות לגיבוי**:

- האם תיקיית הפרויקט נגישה
- האם `project.json` תקין
- האם ה-DB המרכזי ניתן לקריאה
- האם יש מספיק מקום בדיסק
- האם נמצא copy location נוסף שהמשתמש הגדיר

### Settings

אפשר להגדיר backup target אופציונלי.

### Project Health

לכל פרויקט:
- originals reachable
- project memory readable
- backup known/unknown
- last verified

### מה לא לעשות

לא לטעון "מגובה" רק כי התיקייה נמצאת בתוך Dropbox/Google Drive. Sync אינו בהכרח backup.

**עדיפות: P2**

---

## 16. Snapshots / Versions של מצב הפרויקט

### הבעיה

פעולות bulk מסוכנות:
- שינוי selection גדול
- apply recipe
- import client choice
- שינוי מבני באלבום

### מה צריך לשמור

לא RAW copies.

Snapshot לוגי של:
- statuses
- batches
- recipe
- selection
- album references/state לפי הצורך

### איפה

בתוך project folder, כי זה state של העבודה עצמה.

מומלץ:
`<project>/.teza/history/<timestamp>.json`

או בתוך workspace abstraction של `engine/workspace.py`.

### Triggers

- לפני bulk destructive logical change
- user-created checkpoint
- לפני import client selection אם הוא מחליף state קיים

### UI

"גרסאות" בתוך Project Overview:
- timestamp
- reason
- restore preview
- restore

### כלל

Restore צריך בעצמו ליצור snapshot של המצב הנוכחי לפני ההחזרה.

**עדיפות: P2**

---

# חלק ו' — Navigation, Search ו-Attention

## 17. חיפוש גלובלי / Command Palette

### מצב קיים

יש חיפוש מקומי ב-`ProjectsV2` וב-`ClientsV2`, אבל אין שכבת חיפוש של המוצר כולו.

### מה צריך להיות

`Ctrl+K`:

בשלב ראשון:
- project by client/name/event
- client by name/phone/email
- actions:
  - פרויקט חדש
  - ייבוא
  - פתח אלבום
  - פתח Settings

בשלב שני:
- file names
- visual search / identity / semantic photo search

### Architecture

חיפוש עסקי יכול לעבוד מה-mirrors שכבר בזיכרון.

חיפוש תמונות צריך API נפרד שמנצל indices קיימים ב-engine, ולא לסרוק דיסק בכל keypress.

### קבצים

חדש:
- `src/v2/CommandPalette.tsx`
- `src/v2/search.ts`

חיבור:
- `V2App.tsx`

**עדיפות: P2**

---

## 18. Inbox / Notification Center אמיתי

### מצב קיים

`V2App.tsx` כבר מחזיק Bell ו-`attention`, אבל כרגע attention נגזר בעיקר מ:
- projects במצב waiting
- shoots קרובים

זה useful, אבל אינו inbox.

### Events שצריכים להיכנס

- לקוח סיים לבחור
- הערה חדשה בגלריה
- gallery publish נכשל
- album approval
- deadline עבר
- payment due
- render/export הסתיים
- background job failed

### מודל

Notification צריך להיווצר מאירוע, לא להישמר כ-counter hard-coded.

```ts
interface Notification {
  id: string;
  type: string;
  projectId?: string;
  clientId?: string;
  createdAt: string;
  readAt?: string;
  title: string;
  body?: string;
  action?: { kind: string; target: string };
}
```

### חיבורים

- activity events
- tasks
- gallery
- job manager
- calendar

**עדיפות: P1/P2**

---

# חלק ז' — חוויית הלקוח

## 19. Client Portal אחד

### מצב קיים

יש מערכת גלריה משמעותית:

- `src/studio/screens/ClientGallery.tsx`
- `src/v2/screens/SendToClientV2.tsx`
- `src/gallery/*`
- `engine/gallery.py`
- `engine/gallery_store.py`

היא כבר תומכת בפרסום, credentials, בחירה, notes, locking ו-storage abstraction.

זה בסיס מצוין לפורטל, ולא צריך להתחיל מערכת חדשה.

### מה צריך להיות

אותו client-facing surface יתרחב בהדרגה:

1. בחירת תמונות — כבר קיים.
2. מצב הפרויקט.
3. אישור אלבום.
4. הערות/בקשות תיקון.
5. קבלת deliverables.
6. מידע על פעולות שמחכות ללקוח.

### עיקרון אבטחה

הפורטל לא יקבל גישה ל-originals.

הגבול הקיים ב-`gallery_store.py` — preview/thumbnail בלבד — צריך להישאר.

### Backend

להרחיב את gallery/client API במקום לפתוח backend מקביל.

### Studio UI

Project צריך לראות את אותו state שהלקוח רואה:
- awaiting selection
- awaiting album approval
- files ready
- delivered

**עדיפות: P2**

---

# חלק ח' — Dashboard שמנהל את הסטודיו

## 20. TodayV2 כ-Operations Dashboard

### מצב קיים

`TodayV2.tsx` כבר מחשב:
- active projects
- waiting projects
- upcoming shoots
- imported/kept/picked/rendered
- outstanding work

כלומר התשתית והרציונל כבר קיימים.

### מה חסר

כאשר נוסיף Tasks, Calendar Events, Notifications, Payments ו-Deliverables, Today לא צריך להמשיך להמציא "attention" ישירות מ-`Project.at`.

### היעד

Today צריך לענות:

**מה דורש פעולה ממני היום?**

סדר מומלץ:
1. overdue
2. client action received
3. money due
4. shoot today/soon
5. production work due
6. background failures

### לא להפוך אותו ל-reporting dashboard

הערך של Today הוא action, לא charts.

**עדיפות: נבנה בהדרגה יחד עם P0/P1 האחרים**

---

# 21. יחסי תלות בין היכולות

הרחבות אלה אינן 18 פרויקטים עצמאיים.

## שכבת יסוד

### A. Client Entity
מאפשר:
- CRM
- client detail
- tasks אמינים
- client timeline
- portal identity בעתיד

### B. Deliverables
מאפשר:
- delivery stage
- project completion אמיתי
- deadlines
- Today מדויק
- client portal מורחב

### C. Tasks + Activity
מאפשר:
- Today
- Inbox
- follow-up
- audit trail

### D. Background Jobs
מאפשר:
- progress גלובלי
- health
- reliable long-running operations

לכן סדר היישום צריך להתחשב בתלויות, ולא רק בערך הנראה של המסך.

---

# 22. סדר יישום מומלץ

## Phase 0 — לסגור חורים ב-V2

1. **SelectV2**
2. **DeliverV2**
3. לחבר מחדש project progress כך ש-V2 ו-`STAGES` לא יחזיקו שתי אמיתות שונות.

### תוצאה

Workflow מלא:

`סטטוס → ייבוא → מקבצים → בחירה → שליחה ללקוח → עריכה → אלבום → מסירה`

אפשר בעתיד להפוך חלק מהשלבים לאופציונליים לפי deliverables, אבל לא להעלים מידע מהמודל.

---

## Phase 1 — לבנות spine עסקי

1. Client Entity + migration
2. Deliverable Entity
3. Transactions
4. Tasks
5. Activity Events
6. Notifications בסיסיות

### תוצאה

TEZA יודעת לא רק "איזה מסך פתוח", אלא:
- מי הלקוח
- מה הובטח
- מה חייבים לעשות
- מה קרה
- מה שולם
- מה מחכה

---

## Phase 2 — להפוך את ה-dashboard והיומן לכלי עבודה

1. Calendar events מלאים
2. Today מבוסס tasks/events/deliverables
3. Client detail
4. Project notes
5. Inbox מלא

---

## Phase 3 — אמינות ותשתית

1. Background Jobs
2. Health Center
3. Backup awareness
4. Snapshots

---

## Phase 4 — קיצור עבודה והרחבת חוויית הלקוח

1. Studio Templates
2. Global Search / Command Palette
3. Client Portal מורחב

---

# 23. מפת קוד מוצעת

## Files שיש להוסיף

```text
src/v2/screens/SelectV2.tsx
src/v2/screens/DeliverV2.tsx
src/v2/screens/ClientDetailV2.tsx

src/v2/CommandPalette.tsx
src/v2/NotificationCenter.tsx
src/v2/JobCenter.tsx

src/studio/tasks.ts
src/studio/activities.ts
src/studio/notifications.ts
src/studio/clients.ts
src/studio/deliverables.ts
src/studio/transactions.ts
src/studio/calendarEvents.ts
src/studio/projectTemplates.ts

engine/jobs.py
engine/health.py
engine/snapshots.py
```

השמות אינם חוזה; הם נועדו לשמור separation of concerns. אין סיבה להעמיס עוד מאות שורות לתוך `store.ts` או `server.py`.

## Files מרכזיים שיצטרכו להשתנות

```text
src/v2/V2App.tsx
src/v2/screens/TodayV2.tsx
src/v2/screens/ClientsV2.tsx
src/v2/screens/CalendarV2.tsx
src/v2/screens/SettingsV2.tsx
src/v2/screens/BatchesV2.tsx
src/v2/screens/SendToClientV2.tsx

src/studio/store.ts
src/studio/screens/NewProject.tsx

src/db.ts
src/api.ts

engine/db.py
engine/server.py
engine/workspace.py
engine/gallery.py
engine/gallery_store.py
```

---

# 24. מה לא לעשות

## לא ליצור Store שני ל-V2

V2 הוא interface חדש, לא domain model חדש.

כללי project, clients, tasks, deliverables וכו' צריכים להיות משותפים ולא מוחזקים פעם ב-`studio/store.ts` ופעם ב-`v2/*`.

## לא לשמור אותו נתון בשלושה מקומות

לדוגמה:
- payment events הם מקור האמת.
- total paid הוא derived/cache.
- לא לעדכן ידנית שלושה counters בלתי תלויים.

## לא להפוך כל יכולת ל-AI

הרבה מהחורים הגדולים ביותר כאן הם state/workflow:
- מי מחכה למי
- מה עוד צריך להימסר
- מתי צריך לפעול
- כמה שולם
- מה השתנה

AI אינו הפתרון לבעיות האלה.

## לא ליצור backend נפרד לפורטל הלקוח

מערכת gallery הקיימת כבר מחזיקה את הגבול בין studio ל-client. יש להרחיב אותה.

## לא לקשור completion למעבר מסך

`Project.at` יכול לסמן איפה המשתמש נמצא, אבל completion צריך להיגזר מעובדות:
- selection done
- gallery state
- rendered outputs
- album approval
- deliverables delivered

## לא למחוק compatibility מוקדם

Client Entity, full dates ו-Deliverables דורשים migration הדרגתי. עד שהמידע הישן הומר ונבדק, שדות legacy יכולים להישאר לקריאה.

---

# 25. התוצאה המוצרית

לאחר השלבים האלה, TEZA לא תהיה אוסף של מסכים לצלם אלא מערכת רציפה:

```text
לקוח / ליד
    ↓
פרויקט + התחייבויות + תשלום
    ↓
צילום / יומן
    ↓
ייבוא
    ↓
מקבצים
    ↓
בחירה / סינון
    ↓
גלריית לקוח ובחירה
    ↓
עריכה
    ↓
אלבום / אישור
    ↓
מסירה
    ↓
סגירת יתרה
    ↓
היסטוריית לקוח + פרויקט סגור
```

ומסביב לזרימה הזו:

- Today אומר מה דורש פעולה.
- Inbox אומר מה השתנה.
- Calendar אומר מתי זה צריך לקרות.
- Tasks אומר מה עדיין פתוח.
- Activity אומר מה כבר קרה.
- Jobs אומר מה המחשב עושה.
- Health אומר אם אפשר לסמוך על המערכת.
- Snapshots ו-Backup Awareness מגנים על העבודה.

זהו הכיוון שבו כל יכולת חדשה מחזקת את אותה מערכת במקום להוסיף עוד אי עצמאי בתוך האפליקציה.
