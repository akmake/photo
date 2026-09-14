# מסמך מסירה למפתח — מערכת תבניות מקצועית לכלי האלבומים

עודכן: 14 בספטמבר 2026

## 1. מטרת המסמך

המסמך הזה נועד לאפשר למפתח אחר להמשיך את בניית כלי האלבומים בדיוק מהמקום שבו העבודה נעצרה, בלי לנחש את כוונת המוצר ובלי לחזור על ניסויים שכבר נכשלו.

המטרה אינה "להוסיף עוד כמה layouts". המטרה היא לבנות מערכת תבניות מקצועית שמסוגלת לייצג את ספריית העיצוב שבקובץ:

`C:\Users\yosef dahan\Downloads\הכספת.pdf`

הספרייה כוללת 146 עמודים, מתוכם 145 כפולות מעוצבות ועמוד אחרון ריק. היא נוצרה ב־Adobe InDesign 17.0. היא כוללת פריסות מתמונה אחת ועד כפולות צפופות, רקעים, צבעים, מסגרות, קווים, טקסטים, סמלים, קישוטים, שכבות חופפות וקומפוזיציות מוטות.

התוצאה הרצויה היא:

1. המשתמש בוחר תמונות ויוצר אלבום.
2. המערכת מחלקת את האלבום לפי סשנים ורגעים.
3. לכל קבוצת תמונות נבחרת תבנית שמתאימה להקשר, לא רק למספר התמונות.
4. כל רכיב בתבנית נשאר עריך: תמונות, טקסט, צבעים, מסגרות וקישוטים.
5. אותה תוצאה נראית במסך, בהגהה ובקובץ הדפוס.
6. המשתמש יכול לערוך ידנית ברמה המזכירה PowerPoint/InDesign: בחירה מרובה, יישור, גודל זהה, ריווח שווה, קווי עזר, מספרים מדויקים וסדר שכבות.

## 2. מה לא לעשות

### 2.1 לא להפוך כל עמוד PDF לתמונת רקע

זו הדרך המהירה ביותר לקבל תצוגה דומה, אבל היא אינה מערכת תבניות. היא תגרום לכך שאי אפשר יהיה:

- להחליף תמונות באופן בטוח;
- לערוך טקסט;
- לשנות צבע רקע;
- להזיז קישוט;
- לבצע preflight למסגרות;
- להתאים תבנית ליחס אלבום אחר;
- לייצא ברזולוציה מלאה בלי להגדיל PDF משוטח.

מותר לשמור צילום של עמוד המקור רק כ־reference preview לצורכי בדיקת התאמה חזותית.

### 2.2 לא להוסיף מאות מלבנים ישירות ל־layoutEngine.ts

`layoutEngine.ts` הוא מנוע בחירה, לא מסד נתונים של תבניות. ספריית התבניות חייבת לעבור לקבצי manifest נפרדים עם schema שניתן לבדיקה ולגרסאות.

### 2.3 לא לבחור תבנית לפי מספר תמונות בלבד

מספר תמונות הוא תנאי סף. הבחירה חייבת להתחשב גם בכיוון התמונות, איכות, תמונת גיבור, בטיחות חיתוך, מיקום פנים, סשן, מיקום בסיפור, צפיפות הכפולות הסמוכות וחזרתיות.

### 2.4 לא לדרוס אלבומים קיימים

יש כבר אלבומים שמורים ב־localStorage/IndexedDB. שינוי schema חייב לכלול migration ותאימות ל־`customSlots` הקיים.

### 2.5 לא למחוק או לנקות שינויים שאינם קשורים למשימה

ה־working tree אינו נקי. יש שינויים וקבצים של המשתמש. אין להשתמש ב־`git reset --hard`, `git checkout --` או מחיקה רחבה.

## 3. בדיקת המקור שבוצעה

### 3.1 ממצאים חזותיים

כל 146 העמודים רונדרו ונבדקו. הקובץ בנוי כספריית תבניות מדורגת:

- כפולות של תמונה אחת: full bleed, תמונה בעמוד אחד, תמונה תחומה, תמונה קטנה עם שטח שלילי, מסגרת כפולה, טקסט וקישוט.
- כפולות של שתי תמונות: שוויון, גיבור ותומכת, שני עמודים, חפיפה, מסגרות, מרכז טקסטואלי ורצועות צבע.
- כפולות של שלוש וארבע תמונות: triptych, grid, גיבור + רצף, רצועות, חלוקה אסימטרית ואלמנטים דקורטיביים.
- כפולות צפופות: פסיפסים, עמודות, שורות, מסגרות מקוננות, תמונות חופפות וקולאז'ים מוטים.
- רקעים עיקריים: חום כהה, שחור, בז', זהב, אפרסק, אפור ולבן.
- אלמנטים: קווים דקים, מסגרות כפולות, לבבות, כוכבים, מלבני טקסט, חתימות, שכבות צבע ומסגרות מוטות.

### 3.2 ממצאים טכניים

- PDF version 1.4.
- 146 עמודים.
- גודל עמוד: 1587.4×595.276 pt, יחס של כ־2.667:1.
- 287 image XObjects ייחודיים.
- 77 Form XObjects ייחודיים.
- פעולות ציור וקטוריות נמצאות ב־145 עמודים.
- אין Optional Content Groups; כלומר שכבות InDesign לא נשמרו כשכבות PDF עריכות.
- רק 17 עמודים מכילים טקסט חי שניתן לחילוץ.
- הטקסט החי הוא `You are so sweet` בגופן `SydneySignature`.
- רוב העברית, האייקונים והכותרות הומרו לצורות וקטוריות או לאלמנטים גרפיים.

### 3.3 משמעות הממצאים

אם ניתן לקבל מהעורכת את קובץ המקור, לבקש לפי הסדר:

1. חבילת InDesign מלאה: קובץ `.indd`, תיקיית `Links` ותיקיית `Document fonts`.
2. לחלופין קובץ `.idml` עם Links וגופנים.
3. לחלופין PDF + קבצי SVG/PNG נפרדים של הקישוטים + רשימת גופנים.

עם PDF בלבד אפשר לשחזר את המראה, אבל לא לשמר אוטומטית את משמעות הטקסט והשכבות. טקסטים יצטרכו בנייה מחדש; אלמנטים וקטוריים חוזרים יוכלו להישמר כ־SVG assets.

## 4. מצב הקוד הנוכחי

### 4.1 הקבצים המרכזיים

- `src/album/model.ts` — מודל אלבום, תמונות, כפולות ו־LayoutSlot.
- `src/album/layoutEngine.ts` — יצירת מועמדי פריסה ודירוג לפי תוכן.
- `src/album/albumFlow.ts` — חלוקת רצף התמונות לקבוצות וכפולות.
- `src/album/styleEngine.ts` — העדפות סגנון.
- `src/album/cropEngine.ts` — crop חכם, פנים ונושא.
- `src/album/AlbumStudio.tsx` — מסך האלבום והעורך הידני.
- `src/album/AlbumOverview.tsx` — תצוגת כל האלבום.
- `src/album/SpreadThumb.tsx` — תצוגה מוקטנת של כפולה.
- `src/album/exportEngine.ts` — רינדור הגהה ודפוס ב־Canvas.
- `src/album/preflightEngine.ts` — בדיקות חיתוך, רזולוציה וחפיפות.
- `src/album/albumStorage.ts` — שמירת אלבומים ואינדקס לפי projectId.
- `src/album/album-redesign.css` — עיצוב ממשק האלבום.

### 4.2 שינויים שכבר קיימים ויש לשמר

- `AlbumProject.projectId` נוסף והאינדקס מסונן לפי פרויקט.
- קיימים `AlbumSession`, `sessionId` ו־`sessionStart`.
- `buildAutomaticAlbum` מחלק כל סשן בנפרד.
- נוסף `contextualCuts` שבוחן איכות, orientation ורציפות חזותית במקום rhythm קשיח בלבד.
- `buildAlbumLayoutCandidates` מקבל `AlbumLayoutContext` ומדרג תבניות לפי הקשר.
- style משמש העדפה רכה, לא פקודת צפיפות קשיחה.
- פריסות full-page מקבלות קנס כשהן אינן פתיחת סשן.
- ספריית הפריסות הנוכחית מספקת בבדיקת smoke:
  - 11 תבניות לתמונה אחת;
  - 12 לשתיים;
  - 16 לשלוש;
  - 13 לארבע;
  - 11 לחמש;
  - 11 לשש.
- בעורך הידני קיימים כרגע:
  - X/Y/רוחב/גובה באחוזים;
  - יישור שמאל/מרכז/ימין;
  - יישור עליון/אמצע/תחתון;
  - רוחב אחיד, גובה אחיד וגודל זהה;
  - ריווח אופקי ואנכי;
  - snapping וקווי עזר כחולים.
- build מלא עבר בהצלחה לאחר השינויים.

### 4.3 מגבלות המודל הקיים

`AlbumLayoutTemplate` מכיל `slots` בלבד. `AlbumSpread` מכיל background כמחרוזת צבע. לכן אין דרך לייצג:

- טקסט;
- צורות וקווים;
- strokes למסגרות;
- corner radius;
- opacity;
- SVG/PNG דקורטיבי;
- rotation;
- group transforms;
- z-index מפורש;
- mask שאינה מלבן;
- נעילת שכבה;
- ערכי צבע הניתנים להחלפה ברמת theme.

## 5. הארכיטקטורה הנדרשת

יש להפריד בין שלושה מושגים:

### 5.1 TemplateDefinition

הגדרה קבועה בספריית התבניות. אינה מכילה תמונות משתמש ואינה משתנה כאשר משתמש עורך אלבום.

```ts
export interface AlbumTemplateDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  source: 'vault-pdf' | 'manual' | 'personal';
  sourcePage?: number;
  family: string;
  nativeAspect: number;
  photoCount: number;
  density: 'airy' | 'balanced' | 'rich';
  tags: AlbumTemplateTag[];
  compatibility: TemplateCompatibility;
  theme: TemplateTheme;
  layers: AlbumTemplateLayer[];
  previewAsset: string;
}
```

### 5.2 SpreadTemplateInstance

שימוש בתבנית באלבום מסוים. כאן נמצאים השיבוצים והשינויים שביצע המשתמש.

```ts
export interface SpreadTemplateInstance {
  templateId: string;
  templateVersion: number;
  photoBindings: Record<string, string>; // layerId -> photoId
  textOverrides: Record<string, string>;
  colorOverrides: Record<string, string>;
  layerOverrides: Record<string, Partial<LayerTransform & LayerStyle>>;
  hiddenLayerIds: string[];
}
```

### 5.3 AlbumTemplateLayer

Discriminated union. לכל שכבה id קבוע, transform יחסי ו־zIndex.

```ts
export interface LayerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

interface BaseLayer {
  id: string;
  name: string;
  zIndex: number;
  locked?: boolean;
  visible?: boolean;
  transform: LayerTransform;
}

export interface PhotoLayer extends BaseLayer {
  type: 'photo';
  role: 'hero' | 'support' | 'detail';
  preferred: PhotoOrientation[];
  fit: 'smart' | 'cover' | 'contain';
  mask: LayerMask;
  frame?: FrameStyle;
  allowCrossGutter?: boolean;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  defaultText: string;
  editable: boolean;
  direction: 'rtl' | 'ltr';
  fontFamily: string;
  fontAsset?: string;
  fontSize: number; // יחס מגובה הכפולה
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  align: 'start' | 'center' | 'end';
  colorToken: string;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line';
  fillToken?: string;
  strokeToken?: string;
  strokeWidth?: number;
  radius?: number;
}

export interface AssetLayer extends BaseLayer {
  type: 'asset';
  assetPath: string;
  assetKind: 'svg' | 'png';
  colorizable?: boolean;
  colorToken?: string;
}

export interface GroupLayer extends BaseLayer {
  type: 'group';
  childIds: string[];
}

export type AlbumTemplateLayer = PhotoLayer | TextLayer | ShapeLayer | AssetLayer | GroupLayer;
```

### 5.4 Masks ו־FrameStyle

```ts
export type LayerMask =
  | { type: 'rect'; radius?: number }
  | { type: 'ellipse' }
  | { type: 'svg'; assetPath: string };

export interface FrameStyle {
  fillToken?: string;
  strokeToken?: string;
  strokeWidth?: number;
  innerStrokeToken?: string;
  innerStrokeWidth?: number;
  padding?: number;
  shadow?: {
    x: number;
    y: number;
    blur: number;
    color: string;
  };
}
```

### 5.5 Theme וצבעים

לא לשמור `#3a2419` בעשרות שכבות. להגדיר tokens:

```ts
export interface TemplateTheme {
  id: string;
  tokens: Record<string, string>;
}

// דוגמה
{
  id: 'vault-autumn',
  tokens: {
    background: '#392419',
    surface: '#6c5037',
    accent: '#c99b55',
    line: '#f3eadf',
    text: '#ffffff'
  }
}
```

המשתמש משנה theme או token; המערכת אינה מחליפה ידנית כל שכבה.

## 6. תאימות לאחור ומיגרציה

אין למחוק את `LayoutSlot` בשלב הראשון.

### 6.1 הוספת שדות

להוסיף ל־`AlbumSpread`:

```ts
templateInstance?: SpreadTemplateInstance;
customLayers?: AlbumTemplateLayer[];
```

### 6.2 Adapter ישן לחדש

ליצור `src/album/templateCompatibility.ts`:

```ts
export function legacySlotsToLayers(
  slots: LayoutSlot[],
  photoIds: string[],
): { layers: PhotoLayer[]; bindings: Record<string, string> };
```

כל `LayoutSlot` הופך ל־PhotoLayer מלבני. `spread.background` הופך ל־theme token או ShapeLayer תחתון.

### 6.3 כלל resolution

בעת פתיחת כפולה:

1. אם קיים `customLayers`, משתמשים בו.
2. אחרת אם קיים `templateInstance`, טוענים TemplateDefinition ומחילים overrides.
3. אחרת אם קיימים `customSlots`, ממירים בזמן ריצה לשכבות legacy.
4. אחרת טוענים את `layoutId` הישן וממירים אותו.

אין לכתוב migration בלתי הפיך בזמן load. שומרים בפורמט החדש רק אחרי שהמשתמש ביצע שינוי או שמירה.

## 7. מבנה קבצים מומלץ

```text
src/album/templates/
  types.ts
  registry.ts
  resolveTemplate.ts
  scoreTemplate.ts
  legacyAdapter.ts
  render/
    LayerRenderer.tsx
    renderLayerToCanvas.ts
    resolveLayerStyle.ts
    geometry.ts
  editor/
    selectionModel.ts
    alignment.ts
    snapping.ts
    layerCommands.ts
  library/
    vault-autumn.manifest.json
    vault-autumn.theme.json

public/album-templates/vault-autumn/
  previews/
  assets/
  fonts/

tools/album_templates/
  inspect_pdf.py
  render_reference_pages.py
  extract_pdf_objects.py
  build_manifest.py
  validate_manifest.py
```

אין חובה לשמור בדיוק את השמות, אבל חובה לשמור הפרדה בין model, registry, renderer, editor ו־importer.

## 8. תכנית ביצוע מדורגת

### שלב A — snapshot ובדיקות בסיס

1. להריץ `git status --short` ולשמור את הפלט.
2. לא לגעת במחיקות תחת `tmp/pdfs/deps`; הן אינן חלק ממשימת האלבום.
3. להריץ `npm run build` לפני שינוי.
4. ליצור fixture קטן של AlbumProject קיים עם `customSlots` כדי לבדוק תאימות.
5. ליצור screenshot/reference של כפולה קיימת לפני migration.

קריטריון סיום: build עובר וה־fixture הישן נפתח בלי שינוי חזותי.

### שלב B — schema וממיר legacy

1. ליצור את טיפוסי השכבות.
2. להוסיף `templateInstance` ו־`customLayers` ל־AlbumSpread.
3. לממש `legacySlotsToLayers`.
4. לממש `resolveSpreadLayers(spread, templateRegistry)`.
5. להחליף רק את תצוגת הכפולה הפנימית להשתמש ב־resolved layers.
6. עדיין לא לשנות export.

קריטריון סיום: כל האלבומים הקיימים נראים בדיוק כפי שנראו לפני השינוי.

### שלב C — renderer יחיד למסך

לבנות `LayerRenderer` שמקבל:

- layers מסודרות לפי zIndex;
- photo bindings;
- photosById;
- frame settings;
- theme tokens;
- interactive boolean.

התנהגות:

- PhotoLayer: clip לפי mask, frame padding/stroke, ואז תמונה לפי cropEngine.
- TextLayer: direction, font, lineHeight ו־alignment.
- ShapeLayer: fill/stroke/radius.
- AssetLayer: SVG/PNG עם opacity/rotation/color token.
- GroupLayer: transform משותף לילדים.

אין לשכפל JSX בין AlbumStudio, SpreadThumb ו־ReviewWorkspace. שלושתם צריכים להשתמש באותו resolver; thumbnail רשאי להשתמש בגרסת renderer קלה.

קריטריון סיום: template fixture עם תמונה, מלבן, קו, SVG וטקסט נראה זהה ב־Studio וב־SpreadThumb.

### שלב D — renderer לייצוא

`src/album/exportEngine.ts` מצייר היום background ואז PhotoSlots בלבד. יש להוסיף `renderLayerToCanvas` ולצייר לפי zIndex.

סדר ציור:

1. resolve theme ו־overrides.
2. shape/background.
3. asset תחתון.
4. photo layers.
5. frame strokes ומסכות.
6. text.
7. asset עליון.
8. watermark של proof בלבד.

דרישות:

- Canvas proof ו־print משתמשים באותה פונקציה.
- rotation סביב מרכז השכבה.
- clip נשמר ומבוטל עם save/restore.
- SVG נטען ל־ImageBitmap או Path2D באופן דטרמיניסטי.
- fonts נטענים וממתינים ל־`document.fonts.ready` לפני export.
- אין fallback שקט לגופן אחר בקובץ דפוס.
- אם font asset חסר, preflight blocker.

קריטריון סיום: PNG שיוצא ב־120PPI וב־300PPI שומר בדיוק על אותם יחסים, צבעים וסדר שכבות.

### שלב E — 12 תבניות פיילוט

לא לבחור 12 עמודים אקראיים. לבחור משפחות מייצגות:

1. עמוד 4 — תמונה אחת + בלוק צבע + טקסט ומסגרת.
2. עמוד 7 — תמונה אחת + קווים + סמל.
3. עמוד 14 — תמונה מלאה + inset + label.
4. עמוד 23 — שתי תמונות שוות עם פס צבע.
5. עמוד 35 — גיבור + inset + טקסט.
6. עמוד 46 — שתי תמונות וכותרת עברית מרכזית.
7. עמוד 56 — שתי תמונות + מסגרת טקסט.
8. עמוד 68 — שתי תמונות אנכיות + אזור טקסט גדול.
9. עמוד 75 — שלוש תמונות + שלושה סמלים.
10. עמוד 89 — שלוש תמונות + מסגרת צבעונית כפולה.
11. עמוד 118 — גיבור + שלוש תמונות חופפות.
12. עמוד 142 — קולאז' מוטה עם מסגרת קבוצתית.

לכל תבנית:

- לשמור reference preview.
- להזין ידנית geometry מתוך העמוד.
- להגדיר photo layers.
- ליצור מחדש shape layers.
- ליצור text layers עם placeholder עריך.
- לחלץ/לצייר asset דקורטיבי נפרד.
- להוסיף tags והגבלות.
- לבדוק עם תמונות שונות מהדמו שב־PDF.

קריטריון סיום: כל 12 התבניות מאפשרות החלפת כל תמונה, שינוי טקסט וצבע וייצוא ללא הבדל מבני מהמקור.

### שלב F — עורך ידני מקצועי

המצב הנוכחי הוא התחלה בלבד. נדרש selection model אמיתי:

```ts
interface LayerSelection {
  primaryId: string | null;
  selectedIds: string[];
}
```

התנהגות חובה:

- click בוחר שכבה אחת.
- Shift/Ctrl-click מוסיף או מסיר שכבה מהבחירה.
- drag על רקע יוצר marquee selection.
- Escape מנקה בחירה.
- Delete מוחק שכבות לא נעולות.
- drag של אחת מהשכבות הנבחרות מזיז את כולן.
- resize של selection מרובה שומר יחסים לפי modifier.
- Alt-drag משכפל רק אם undo מוכן.

פקדי inspector:

- X, Y, width, height במספרים.
- rotation.
- opacity.
- lock/unlock.
- align left/center/right.
- align top/middle/bottom.
- distribute horizontal/vertical.
- equal width/height/size.
- gap מספרי מדויק.
- bring forward/backward/front/back.
- group/ungroup.

snapping:

- קצוות הכפולה.
- קו קפל.
- safe area.
- קצוות ומרכזי שכבות אחרות.
- equal-gap detection: כאשר המרווח קרוב למרווח קיים, להציג שני קווי ריווח ותווית מספרית.
- snapping tolerance צריך להיות בפיקסלי מסך ולהומר ליחידות יחסיות; לא threshold יחסי קבוע בכל zoom.

כל פעולה חייבת להיות command יחיד ב־undo/redo, לא עשרות snapshots בזמן pointermove.

### שלב G — דפדפן תבניות

לא להציג רשימה שטוחה של 145 כרטיסים.

מבנה UI:

- בראש: "מומלצות לכפולה" — 6–12 מועמדות מדורגות.
- filters: מספר תמונות, airy/balanced/rich, with-text, framed, collage, full-bleed, sequence.
- family tabs: נקי, מסגרות, טקסט, קולאז', צפוף, פתיחה/סיום.
- חיפוש בשם/tag.
- preview ביחס הכפולה האמיתי.
- badge של מספר תמונות וטקסט עריך.
- hover/selection מציג הסבר למה התבנית מתאימה.

כאשר מחליפים תבנית:

1. לנסות לשמר photo bindings לפי role.
2. hero עובר ל־hero.
3. support נשמר לפי סדר.
4. טקסטים עם אותו semantic key נשמרים.
5. להציג אזהרה לפני אובדן overrides ידניים.

### שלב H — מנוע התאמה לפי הקשר

להגדיר hard constraints:

- photoCount מתאים בדיוק או לתבנית יש optional photo layers.
- aspect compatibility עם מוצר האלבום.
- אין ערבוב sessionId.
- crop safety מעל סף.
- אין פנים בקפל עבור שכבה שחוצה gutter.
- assets/fonts קיימים.

לאחר סינון, score:

```text
score =
  25 * storyContextFit
  + 20 * cropSafety
  + 12 * orientationFit
  + 10 * heroAssignmentQuality
  + 8  * sequenceCoherence
  + 8  * rhythmFitWithNeighbors
  + 5  * stylePreference
  - 12 * exactTemplateRepeat
  - 10 * familyRepeat
  - 20 * unnecessaryFullBleed
  - 30 * foldRisk
```

המשקלים הם נקודת התחלה בלבד. לשמור breakdown כדי להסביר בחירה ולכוונן.

Template tags מוצעים:

```ts
type AlbumTemplateTag =
  | 'session-opener'
  | 'session-closer'
  | 'hero'
  | 'duet'
  | 'sequence'
  | 'details'
  | 'portraits'
  | 'landscapes'
  | 'mixed-orientation'
  | 'with-text'
  | 'framed'
  | 'collage'
  | 'full-bleed'
  | 'quiet'
  | 'dense';
```

### שלב I — יבוא יתר הספרייה

רק אחרי שהפיילוט עובד.

הגישה המומלצת אם יש IDML:

1. לפתוח IDML כ־ZIP.
2. לקרוא Spread XML, Stories, Resources, Styles ו־Links.
3. להמיר page coordinates ל־0..1.
4. למפות image frames ל־PhotoLayer.
5. למפות text frames ל־TextLayer.
6. למפות rectangles/lines ל־ShapeLayer.
7. להעתיק linked graphics ל־assets.
8. ליצור manifest ו־preview.

אם יש PDF בלבד:

1. לרנדר reference לכל עמוד.
2. לנתח content streams, CTM, `Do`, clipping ו־Form XObjects.
3. לזהות image placements.
4. לא לייבא את שתי תמונות הדמו כנכסי תבנית.
5. לזהות אלמנטים חוזרים לפי object/hash ולהוציאם כ־asset.
6. לשחזר shapes וצבעים מפקודות vector.
7. טקסטים שאינם live: OCR + אישור ידני + בנייה מחדש.
8. עמודים מורכבים או מוטים עוברים review ידני.

אסור להבטיח importer אוטומטי של 100%. יעד נכון ל־PDF בלבד:

- geometry אוטומטי לרוב מסגרות התמונה;
- colors/shapes אוטומטיים חלקית;
- assets חוזרים אוטומטיים חלקית;
- text וקומפוזיציות מורכבות עם review ידני.

## 9. שינויי אחסון

היום האלבום נשמר תחת `teza-album-{id}-v1` ו־DB version 1.

המלצה:

- לא לשמור את כל TemplateDefinition בתוך כל אלבום.
- לשמור registry גלובלי עם `templateId` ו־`templateVersion`.
- באלבום לשמור instance ו־overrides בלבד.
- assets מובנים יישבו תחת `public/album-templates` או אחסון מנוהל.
- personal templates יישבו ב־IndexedDB, לא ב־localStorage בלבד, במיוחד אם יש SVG/PNG.
- להוסיף `schemaVersion` ל־SavedAlbum לפני migration משמעותי.

אם תבנית משתנה בעתיד, SpreadInstance חייב להמשיך להפנות לגרסה הישנה או לעבור migration מפורש. אין לשנות אלבום קיים רק כי manifest עודכן.

## 10. Preflight חדש

להוסיף בדיקות:

- `MISSING_TEMPLATE`
- `MISSING_TEMPLATE_ASSET`
- `MISSING_FONT`
- `TEXT_OVERFLOW`
- `LAYER_OUTSIDE_BOUNDS`
- `PHOTO_LAYER_EMPTY`
- `MASK_RENDER_FAILURE`
- `DECORATION_IN_SAFE_ZONE` אם רלוונטי למוצר
- `FOLD_RISK` גם לטקסט ולסמלים, לא רק לפנים
- `UNSUPPORTED_BLEND_MODE`

Export לדפוס חייב להיחסם על missing asset/font/mask. Proof יכול לצאת עם watermark ואזהרה גלויה.

## 11. בדיקות נדרשות

### 11.1 Unit tests

- resolve theme tokens.
- legacy slots to layers.
- apply overrides.
- zIndex stable sort.
- align/distribute geometry.
- snapping tolerance לפי zoom.
- template hard constraints.
- score breakdown.
- migration של אלבום v1.

### 11.2 Golden visual tests

לכל אחת מ־12 תבניות הפיילוט:

1. fixture קבוע של תמונות.
2. screenshot של editor.
3. render proof.
4. render print מוקטן לבדיקה.
5. השוואת pixel/perceptual מול golden.

לא להשתמש רק ב־pixel equality בגלל antialiasing של טקסט. להשתמש threshold קטן ולצרף diff image במקרה כשל.

### 11.3 תרחישי משתמש

- יצירת אלבום מפרויקט עם שני סשנים.
- בחירת תבנית עם טקסט.
- החלפת כל התמונות.
- שינוי טקסט עברי וכיוון RTL.
- החלפת theme.
- בחירה מרובה ו־equal size.
- distribute עם gap מספרי.
- undo/redo לכל פעולה.
- שמירה, רענון ופתיחה מחדש.
- שכפול אלבום.
- גרסת review.
- proof ו־print export.

## 12. קריטריוני קבלה

### Milestone 1 — שכבות בלי שבירה

- אלבומים ישנים נפתחים זהה.
- כל slot ישן נפתר ל־PhotoLayer.
- build עובר.
- proof של אלבום ישן אינו משתנה חזותית.

### Milestone 2 — תבנית מקצועית אחת

- תבנית עמוד 4 מיושמת עם תמונה, רקע, shape, מסגרת וטקסט עריך.
- עובדת ב־Studio, thumbnail, review ו־export.
- reload אינו מאבד overrides.

### Milestone 3 — פיילוט 12

- כל 12 המשפחות קיימות.
- כל התבניות נבדקו עם תמונות אחרות.
- אין faces cut או text overflow שקט.
- משתמש יכול לשנות טקסט וצבע.

### Milestone 4 — עורך מקצועי

- multi-select, marquee, align, equal size, exact gap, snapping, rotation, z-order ו־undo.
- ההתנהגות עקבית ב־100% בין mouse drag לשדות מספריים.

### Milestone 5 — ספרייה מלאה

- כל 145 העמודים מסווגים: imported, needs-review או intentionally-skipped.
- אין template ללא preview ו־metadata.
- browser אינו מציג רשימה שטוחה לא שימושית.
- מנוע ההקשר בוחר רק תבניות חוקיות.

## 13. סדר PR מומלץ

1. `album-template-schema-and-legacy-adapter`
2. `album-layer-renderer-screen`
3. `album-layer-renderer-export`
4. `vault-template-pilot-12`
5. `album-multiselect-alignment`
6. `album-template-browser`
7. `album-context-template-scoring`
8. `vault-library-import`

לא לערבב schema, importer, UI וכל 145 התבניות ב־PR אחד. יהיה בלתי אפשרי לבדוק regression.

## 14. המשימה הראשונה למפתח — מדויק

1. לקרוא את המסמך הזה ואת `docs/new/album-visual-language.md`.
2. לפתוח את `src/album/model.ts`, `layoutEngine.ts`, `exportEngine.ts`, `SpreadThumb.tsx` ו־`AlbumStudio.tsx`.
3. ליצור branch עם prefix `codex/` אם נדרש branch חדש.
4. להריץ build ולתעד baseline.
5. ליצור `src/album/templates/types.ts` עם schema מהסעיף 5.
6. להוסיף `templateInstance?` ו־`customLayers?` באופן backward-compatible.
7. ליצור `legacyAdapter.ts`.
8. ליצור tests לממיר לפני שינוי UI.
9. ליצור TemplateDefinition יחיד שמייצג את עמוד 4 של הכספת.
10. להציג אותו במסך דרך renderer חדש, אך לא לשנות עדיין export.
11. לצלם screenshot ולבדוק ידנית מול עמוד 4.
12. רק לאחר התאמה, לחבר את אותו renderer ל־SpreadThumb ול־ReviewWorkspace.
13. לעצור בסוף Milestone 1 ולבקש review לפני המשך.

## 15. שאלות שיש לסגור עם בעל המוצר

- האם קיימת חבילת InDesign/IDML מקורית?
- האם יש רישיון להשתמש מסחרית בתבניות ובאלמנטים?
- אילו טקסטים צריכים להיות placeholders עריכים ואילו לוגואים/קישוטים קבועים?
- האם הספרייה מיועדת רק ליחס 2.667:1 או גם ל־30×30 פתוח ביחס 2:1?
- האם התאמה ליחס אחר מבצעת scale, crop, reflow או מסתירה תבניות לא תואמות?
- האם המשתמש בוחר theme שלם או כל צבע בנפרד?
- האם personal template נשמר רק למשתמש או משותף לסטודיו?

ברירת המחדל הבטוחה עד לקבלת תשובות:

- לא להציג תבנית ביחס לא תואם.
- לא למתוח geometry.
- לא להחליף גופן בשקט.
- לא לפרסם assets לפני אישור רישוי.
- לשמור personal templates מקומית ולפי studio/project scope.

## 16. הערת מוצר אחרונה

הכספת אינה רק "עוד תבניות". היא מראה שמודל המוצר הנוכחי צר מדי. הערך שלה הוא אוצר המילים: קומפוזיציה, שכבות, היררכיה, טקסט, מסגרות, צבע וקישוט. אם נייבא אותה כתמונות רקע נקבל דמו יפה וכלי חלש. אם נבנה schema ורינדור שכבות תחילה, נקבל בסיס שיכול לשרת את הכספת הזאת, תבניות עתידיות ותבניות שהמשתמש ייצור בעצמו.

הצלחה אינה נמדדת במספר התבניות שהופיעו ברשימה. היא נמדדת בכך שתבנית אחת יכולה להיטען, לקבל תמונות אחרות, לשמור על חיתוך ופנים, לאפשר שינוי טקסט וצבע, להיערך ידנית, להישמר, להיפתח מחדש ולהיות זהה בקובץ הדפוס.

## 17. הודעת פתיחה מוכנה למפתח הבא

אפשר להעתיק אליו את הטקסט הבא כפי שהוא:

> המשך את בניית כלי האלבומים לפי המסמך `docs/new/album-template-system-handoff.md`. אל תנסה בשלב הראשון לייבא את כל 145 עמודי המקור ואל תשתמש בעמודי PDF משוטחים כרקע. שמור את כל שינויי המשתמש הקיימים ב־working tree. התחל ב־Milestone 1 בלבד: הגדר schema חדש לתבנית שכבות, כתוב validator וממיר backward-compatible מהמבנה הישן, הוסף tests לממיר, וממש ידנית תבנית ניסוי אחת לפי עמוד 4 של `C:\Users\yosef dahan\Downloads\הכספת.pdf`. הצג אותה דרך renderer משותף חדש. התמונות חייבות להישאר בתוך מסכותיהן בלי עיוות, טקסט/צורות/נכסים חייבים להיות שכבות נפרדות, ותוכן ישן חייב להמשיך להיטען. אל תשנה עדיין את כל ה־UI ואל תבצע migration הרסני. הרץ typecheck/build/tests, צלם תוצאה חזותית, ותעד אילו קבצים שונו, מה עבר, מה עדיין חסר ומה הסיכון לפני מעבר ל־Milestone 2.

### מה המפתח חייב להחזיר בסוף המשימה הראשונה

1. רשימת קבצים ששונו והסבר קצר לכל קובץ.
2. הגדרת ה־schema בפועל ולא רק הצעה תאורטית.
3. תוצאת tests לממיר legacy → layers.
4. תוצאת build/typecheck.
5. צילום מסך של תבנית הפיילוט עם תמונות אמיתיות.
6. צילום/השוואה מול עמוד הייחוס.
7. הוכחה ששמירה, סגירה ופתיחה מחדש אינן מאבדות שכבות.
8. הוכחה שתמונה אינה נמתחת ושחיתוך נשאר בתוך המסכה.
9. רשימת פערים מדויקת לקראת Milestone 2.
10. עצירה ל־review — לא להרחיב לעשרות תבניות לפני שהבסיס מאושר.

### קבצים עם שינויים קיימים שיש לשמור במיוחד

בעת כתיבת המסמך היו שינויים פעילים באזור האלבום. לפני עריכה יש לבדוק `git status` ו־`git diff`, ולא לדרוס אותם. בין הקבצים שנגעו בהם במהלך העבודה נמצאים:

- `src/album/AlbumStudio.tsx`
- `src/album/AlbumTimeline.tsx`
- `src/album/album-redesign.css`
- `src/album/albumFlow.ts`
- `src/album/layoutEngine.ts`
- `src/album/styleEngine.ts`

הרשימה היא אזהרת שימור ולא תחליף לבדיקה עדכנית של ה־working tree.
