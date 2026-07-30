import type {
  ToolDef,
  Recipe,
  ToolInstance,
  ToolMask,
  ParamValues,
  SpotSelection,
} from './types';

/* The eight hue bands, generated rather than typed out: 24 sliders written by
 * hand is 24 chances to mistype a param id that the engine then silently
 * ignores. Centres match engine/hsl.py — they are uneven on purpose, crowded
 * through red/orange/yellow because skin lives there. */
const HUE_BANDS: [string, string][] = [
  ['red', 'אדום'],
  ['orange', 'כתום'],
  ['yellow', 'צהוב'],
  ['green', 'ירוק'],
  ['aqua', 'טורקיז'],
  ['blue', 'כחול'],
  ['purple', 'סגול'],
  ['magenta', "מג'נטה"],
];

/* The four curve channels and five fixed tonal points — generated, like the
 * hue bands, so a mistyped param id cannot silently detach a slider. Names
 * match engine/globals_py._CURVE_POINTS. */
const CURVE_CHANNELS: [string, string][] = [
  ['luma', 'בהירות'],
  ['red', 'אדום'],
  ['green', 'ירוק'],
  ['blue', 'כחול'],
];
const CURVE_POINTS: [string, string][] = [
  ['Blacks', 'שחורים'],
  ['Shadows', 'צללים'],
  ['Mids', 'אמצעים'],
  ['Highlights', 'היילייטים'],
  ['Whites', 'לבנים'],
];

const HSL_TOOL: ToolDef[] = [
  {
    id: 'hsl',
    label: 'צבע לפי גוון',
    kind: 'global',
    category: 'artistic',
    order: 41,
    batchPolicy: 'absolute',
    params: HUE_BANDS.flatMap(([id, he]) => [
      { id: `${id}Hue`, label: `${he} · גוון`, min: -100, max: 100, step: 1, default: 0 },
      { id: `${id}Sat`, label: `${he} · רוויה`, min: -100, max: 100, step: 1, default: 0 },
      { id: `${id}Lum`, label: `${he} · בהירות`, min: -100, max: 100, step: 1, default: 0 },
    ]),
  },
];

// THE registry. Adding a tool (global or AI) = one entry here. Nothing else
// in the app needs to special-case it — the UI and pipeline are built from this.
export const TOOLS: ToolDef[] = [
  {
    // sensor noise is removed FIRST, before anything sharpens or stretches it.
    // Windows are fixed-pixel, not frame-relative — noise lives at pixel scale.
    id: 'noise-reduction',
    label: 'הפחתת רעש',
    kind: 'global',
    category: 'tone-color',
    order: 5,
    batchPolicy: 'absolute',
    params: [
      { id: 'luminance', label: 'רעש בהירות', min: 0, max: 100, step: 1, default: 0 },
      { id: 'detail', label: 'שימור פירוט', min: 0, max: 100, step: 1, default: 50 },
      { id: 'color', label: 'רעש צבע', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  {
    id: 'face-retouch',
    label: 'ריטוש פנים (AI)',
    kind: 'ai',
    category: 'local-ai',
    order: 8, // the learned model runs first, on neutral data
    batchPolicy: 'absolute',
    params: [{ id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 70 }],
  },
  {
    // Engine-side this is `cleanup.py`, and it is TWO operators, so it gets two
    // dials rather than one. They are not a fine/coarse pair — they do different
    // things and carry opposite risk:
    //
    //   אדמומיות  diffuse pigment. Edits a*/b* and lifts L* only where the colour
    //             channels prove the darkness is pigment, so it cannot flatten a
    //             crease or blur a pore. Safe high, and it is where the result
    //             comes from: 85 of the 86 marks removed on the reference face.
    //   כתמים     discrete reconstruction. Still has the known missing
    //             mid-frequency band, so repairs can read as patches. It earned 1
    //             mark in 86, so it defaults low — enough for a scab or a crumb,
    //             which nothing else can remove.
    //
    // A single slider had no good setting: at the old default of 60 it withheld
    // the safe half to restrain the risky one, and threw away more than half the
    // achievable result (marks -17% against -44%).
    id: 'skin-cleanup',
    label: 'ניקוי כתמים',
    kind: 'ai',
    category: 'local-ai',
    order: 10,
    batchPolicy: 'absolute',
    params: [
      { id: 'redness', label: 'אדמומיות וכתמי צבע', min: 0, max: 100, step: 1, default: 90 },
      { id: 'spots', label: 'ניקוי נקודתי', min: 0, max: 100, step: 1, default: 25 },
    ],
  },
  {
    id: 'skin',
    label: 'החלקת עור',
    kind: 'ai',
    category: 'local-ai',
    order: 20, // AI retouch runs on neutral data, before the creative grade
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 60 },
      // The two settings the frequency separation used to hardcode. `scale` is
      // where tone ends and texture begins; `evenness` is how hard the tone
      // side is flattened. 50/50 is the behaviour every existing recipe has.
      { id: 'scale', label: 'גודל אי-האחידות', min: 0, max: 100, step: 1, default: 50 },
      { id: 'evenness', label: 'השוואת טון', min: 0, max: 100, step: 1, default: 50 },
      { id: 'texture', label: 'שימור טקסטורה', min: 0, max: 100, step: 1, default: 100 },
      // neck, arms and hands — they received nothing at all until now
      { id: 'body', label: 'עור הגוף', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  {
    // Dodge & burn. Not another contrast slider: clarity and texture amplify
    // light that is already there, this puts light where the bone is. Runs
    // after smoothing, which would otherwise flatten a highlight it just added.
    id: 'contour',
    label: 'פיסול אור וצל',
    kind: 'ai',
    category: 'local-ai',
    order: 21,
    batchPolicy: 'absolute',
    params: [
      // one slider per anatomical move; the cheekbone pair is ONE move —
      // lifting the bone without deepening the hollow is just a bright patch
      { id: 'cheekbones', label: 'עצמות לחיים', min: -100, max: 100, step: 1, default: 0 },
      { id: 'forehead', label: 'מרכז המצח', min: -100, max: 100, step: 1, default: 0 },
      { id: 'jaw', label: 'קו הלסת', min: -100, max: 100, step: 1, default: 0 },
      // the concealer move — a lift of the tear trough below each eye. Sized
      // by the eye itself; the features mask keeps it off lashes and waterline
      { id: 'undereye', label: 'מתחת לעיניים', min: -100, max: 100, step: 1, default: 0 },
      // needs no landmarks: amplifies the modelling the frame already has, so
      // it works at any head angle and never invents a highlight
      { id: 'sculpt', label: 'הגברת התאורה הקיימת', min: 0, max: 100, step: 1, default: 0 },
      // how much the anatomical bands defer to the scene's light: at 100 a
      // cheek in deep shadow gets nothing, at 0 both cheeks get the same push
      // regardless of the light (measured reading as fill on side-lit faces)
      { id: 'fidelity', label: 'נאמנות לאור הסצנה', min: 0, max: 100, step: 1, default: 70 },
      { id: 'softness', label: 'רכות המעברים', min: 0, max: 100, step: 1, default: 50 },
    ],
  },
  // Colour work on the retouched face. These three are the same operation —
  // a mask plus a push in Lab — and none of them reconstructs pixels, so they
  // sit safely after smoothing and before the global grade.
  {
    id: 'blush',
    label: 'סומק ורודם',
    kind: 'ai',
    category: 'local-ai',
    order: 22,
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 45 },
      { id: 'size', label: 'גודל', min: 0, max: 100, step: 1, default: 50 },
      { id: 'warmth', label: 'חמימות', min: 0, max: 100, step: 1, default: 35 },
    ],
  },
  {
    id: 'eye-sparkle',
    label: 'ברק בעיניים',
    kind: 'ai',
    category: 'local-ai',
    order: 23,
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 50 },
      { id: 'whites', label: 'לובן העין', min: 0, max: 100, step: 1, default: 40 },
      { id: 'sparkle', label: 'חדות הקשתית', min: 0, max: 100, step: 1, default: 45 },
    ],
  },
  {
    id: 'hair-tones',
    label: 'גוונים בשיער',
    kind: 'ai',
    category: 'local-ai',
    order: 24,
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 45 },
      { id: 'warmth', label: 'חמימות', min: -100, max: 100, step: 1, default: 40 },
      { id: 'shine', label: 'ברק', min: 0, max: 100, step: 1, default: 35 },
      { id: 'richness', label: 'עומק', min: 0, max: 100, step: 1, default: 40 },
    ],
  },
  {
    id: 'background-blur',
    label: 'טשטוש רקע',
    kind: 'ai',
    category: 'scene',
    order: 25, // runs in the engine stage, after skin, before the global grade
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 60 },
      { id: 'bokeh', label: 'אופי בוקה', min: 0, max: 100, step: 1, default: 50 },
      { id: 'feather', label: 'ריכוך קצוות', min: 0, max: 100, step: 1, default: 40 },
    ],
  },
  {
    id: 'tone-color',
    label: 'טון וצבע',
    kind: 'global',
    category: 'tone-color',
    order: 30,
    batchPolicy: 'absolute',
    params: [
      // ±200 = ±4 stops. 100 still means +2 stops, exactly as before — the
      // range grew, the scale did not move. A frame shot two stops under needs
      // the room, and the shoulder above 0.72 keeps the top from clipping flat.
      { id: 'exposure', label: 'חשיפה', min: -200, max: 200, step: 1, default: 0 },
      { id: 'contrast', label: 'ניגודיות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'highlights', label: 'היילייטים', min: -100, max: 100, step: 1, default: 0 },
      { id: 'whites', label: 'לבנים (שרוף)', min: -100, max: 100, step: 1, default: 0 },
      { id: 'shadows', label: 'צלליות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'blacks', label: 'שחורים', min: -100, max: 100, step: 1, default: 0 },
      // How much of the zone a pixel belongs to is read from its SURROUNDINGS
      // rather than from itself. 0 is the tool as it always was. This is what
      // separates recovering a shadow from flattening the whole picture.
      { id: 'recovery', label: 'שחזור מקומי', min: 0, max: 100, step: 1, default: 0 },
      // ±200 = ±4 stops / ±56%. The slope is untouched, so every value an
      // existing recipe holds means exactly what it meant — there is simply
      // more travel past the old ends, where a rescue actually lives.
      { id: 'temperature', label: 'חום', min: -200, max: 200, step: 1, default: 0 },
      { id: 'tint', label: 'גוון', min: -200, max: 200, step: 1, default: 0 },
      { id: 'saturation', label: 'רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'vibrance', label: 'חיוניות', min: -100, max: 100, step: 1, default: 0 },
    ],
  },
  {
    // Parametric curves (the Lightroom form): five fixed tonal points per
    // channel, outputs as sliders — a free point-curve cannot live in flat
    // numeric params, and this expresses the same moves. Engine mirror:
    // globals_py._curves.
    id: 'curves',
    label: 'עקומות',
    kind: 'global',
    category: 'tone-color',
    order: 32,
    batchPolicy: 'absolute',
    params: CURVE_CHANNELS.flatMap(([ch, he]) =>
      CURVE_POINTS.map(([pt, hept]) => ({
        id: `${ch}${pt}`,
        label: `${he} · ${hept}`,
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      })),
    ),
  },
  {
    // The photographer's "3D" (הסבר על כלים.mp4): Nik Tonal Contrast 80/80/80
    // Strong at ~26% opacity, hand-masked onto the CLOTHES, faces only after
    // smoothing. Structure contrast split by tonal zone, with the mask work
    // replaced by region sliders. Zone shape ships as her preset (60/60/60);
    // `amount` is the one dial she actually turns.
    id: 'tonal-contrast',
    label: 'תלת מימד',
    kind: 'ai',
    category: 'scene',
    order: 33,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      { id: 'highlights', label: 'בהירים', min: -100, max: 100, step: 1, default: 60 },
      { id: 'midtones', label: 'גוני אמצע', min: -100, max: 100, step: 1, default: 60 },
      { id: 'shadows', label: 'צללים', min: -100, max: 100, step: 1, default: 60 },
      // she lowers Nik's colour push; ours is L-only at 0, this adds/removes
      { id: 'saturation', label: 'צבעוניות', min: -100, max: 100, step: 1, default: 0 },
      // Nik's "Contrast Type" enum as an axis: fine detail-pop at 0, broad
      // modelling at 100. 50 = the measured knit/bark scale (3% of long edge)
      { id: 'scale', label: 'גודל המבנה', min: 0, max: 100, step: 1, default: 50 },
      // where the structure lands. Her defaults exactly: clothes yes, skin and
      // background no. Hair is never a target — crunchy peyos are a bug.
      { id: 'fabric', label: 'בגדים', min: 0, max: 100, step: 1, default: 100 },
      { id: 'skin', label: 'עור', min: 0, max: 100, step: 1, default: 0 },
      { id: 'rest', label: 'רקע', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  {
    // Haze sits in FRONT of the scene, so it comes off before anything shapes
    // the tone behind it. Negative adds it back — atmosphere is a look.
    // `ai`, not `global`: transmission comes from the depth model, which has no
    // browser mirror. The dark-channel version that could run in JS was built,
    // measured and rejected — it reads a white dress as dense haze. See
    // engine/dehaze.py.
    id: 'dehaze',
    label: 'אובך',
    kind: 'ai',
    category: 'scene',
    order: 34,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: -100, max: 100, step: 1, default: 0 },
      // how fast haze piles up with distance: low touches only the far horizon,
      // high clears everything past the subject's plane
      { id: 'depth', label: 'טווח מרחק', min: 0, max: 100, step: 1, default: 50 },
      // how far the densest haze may be pushed before it turns to noise
      { id: 'floor', label: 'עומק החילוץ', min: 0, max: 100, step: 1, default: 50 },
    ],
  },
  {
    // Renamed from "תלת מימדיות" (2026-07-29): the 3D name moved to the new
    // zonal tonal-contrast tool the photographer asked for. Same id — recipes
    // and the JS mirror are untouched.
    id: 'dimension',
    label: 'מרקם וניגודיות',
    kind: 'global',
    category: 'tone-color',
    order: 35,
    batchPolicy: 'absolute',
    params: [
      { id: 'clarity', label: 'ניגודיות מקומית', min: -100, max: 100, step: 1, default: 0 },
      // A third of clarity's radius, and edge-guarded — so it lands on weave,
      // pores and grain and not on the outline of a bridle. Negative is how
      // you take texture down without smearing the edges with it.
      { id: 'texture', label: 'טקסטורה', min: -100, max: 100, step: 1, default: 0 },
    ],
  },
  {
    // Split out of `dimension`: this one is defined relative to the FRAME, and
    // sharing an id with clarity and texture put all three in the engine's
    // FRAME_ONLY set — which meant neither of those could ever be masked to a
    // region. Order 36 keeps it exactly where it used to run in the chain.
    id: 'vignette',
    label: 'וינייטה',
    kind: 'global',
    category: 'artistic',
    order: 36,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      // where the falloff begins: low = darkening reaches toward the centre,
      // high = only the far corners. 50 = the historical behavior.
      { id: 'midpoint', label: 'נקודת אמצע', min: 0, max: 100, step: 1, default: 50 },
    ],
  },
  {
    // RETIRED — merged into grade-zones. Its two warm/cool axes were a strictly
    // poorer version of three zones with a free hue, and they moved colour with
    // RGB offsets, which drags brightness along. `fade` lives on as the matte in
    // grade-zones, with identical maths. Kept here only so a style saved before
    // the merge still resolves and still renders the way it was saved.
    id: 'color-grade',
    label: 'צבעוניות (הוחלף)',
    kind: 'global',
    category: 'artistic',
    order: 40,
    batchPolicy: 'absolute',
    legacy: true,
    params: [
      { id: 'shadowsWarm', label: 'חום בצללים', min: -100, max: 100, step: 1, default: 0 },
      { id: 'highlightsWarm', label: 'חום בהיילייטים', min: -100, max: 100, step: 1, default: 0 },
      { id: 'fade', label: 'דהייה (מאט)', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  // Per-hue colour. Eight bands, three independent knobs each, because one
  // saturation slider can only travel one road: this set exists so a recipe can
  // crush the green of a field while leaving skin and blonde hair alone.
  ...HSL_TOOL,
  {
    id: 'grade-zones',
    label: 'גריידינג לפי טונים',
    kind: 'global',
    category: 'artistic',
    order: 42,
    batchPolicy: 'absolute',
    params: [
      { id: 'shadowsHue', label: 'צלליות · גוון', min: 0, max: 360, step: 1, default: 0 },
      { id: 'shadowsSat', label: 'צלליות · רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'shadowsLum', label: 'צלליות · בהירות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'midtonesHue', label: 'אמצעיים · גוון', min: 0, max: 360, step: 1, default: 0 },
      { id: 'midtonesSat', label: 'אמצעיים · רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'midtonesLum', label: 'אמצעיים · בהירות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'highlightsHue', label: 'היילייטים · גוון', min: 0, max: 360, step: 1, default: 0 },
      { id: 'highlightsSat', label: 'היילייטים · רוויה', min: -100, max: 100, step: 1, default: 0 },
      { id: 'highlightsLum', label: 'היילייטים · בהירות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'balance', label: 'איזון בין הטווחים', min: -100, max: 100, step: 1, default: 0 },
      // The matte, inherited from the retired color-grade. `fade` is that
      // tool's slider unchanged, so a migrated recipe lands on the same pixels;
      // the other two are the parts that used to be hardcoded into it — which
      // colour the range is lifted toward, and whether the lift is flat across
      // the range (0 = the old behaviour) or stays in the shadows.
      { id: 'fade', label: 'דהייה (מאט)', min: 0, max: 100, step: 1, default: 0 },
      { id: 'fadeWarmth', label: 'מאט · חמימות', min: -100, max: 100, step: 1, default: 0 },
      { id: 'fadeRolloff', label: 'מאט · שמירת לבנים', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  {
    id: 'light-point',
    label: 'נקודת אור טבעית',
    kind: 'global',
    category: 'scene',
    order: 45,
    batchPolicy: 'absolute',
    params: [
      { id: 'strength', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      { id: 'x', label: 'מיקום אופקי', min: 0, max: 100, step: 1, default: 50 },
      { id: 'y', label: 'מיקום אנכי', min: 0, max: 100, step: 1, default: 30 },
      { id: 'size', label: 'גודל', min: 5, max: 100, step: 1, default: 50 },
      { id: 'warmth', label: 'חמימות', min: 0, max: 100, step: 1, default: 60 },
    ],
  },
  {
    // kind 'ai', not 'global': the people/skin/fabric sliders are driven by the
    // engine's masks, which have no JS mirror. The frame-wide `amount` is the
    // old glow, unchanged. Each of the three region sliders is an independent
    // strength — "skin 50 + fabric 15" is a valid mix, not a mode switch.
    id: 'glow',
    label: 'גלואו',
    kind: 'ai',
    category: 'artistic',
    order: 55,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה כללית', min: 0, max: 100, step: 1, default: 0 },
      { id: 'people', label: 'אנשים — כל הדמות', min: 0, max: 100, step: 1, default: 0 },
      { id: 'skin', label: 'עור בלבד', min: 0, max: 100, step: 1, default: 0 },
      { id: 'fabric', label: 'בגדים ולבנים', min: 0, max: 100, step: 1, default: 0 },
      { id: 'radius', label: 'רכות', min: 0, max: 100, step: 1, default: 40 },
    ],
  },
  {
    id: 'oil-paint',
    label: 'אפקט ציור שמן',
    kind: 'global',
    category: 'artistic',
    order: 58,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      { id: 'radius', label: 'גודל מכחול', min: 0, max: 100, step: 1, default: 30 },
    ],
  },
  {
    id: 'sharpen',
    label: 'חידוד',
    kind: 'global',
    category: 'artistic',
    order: 60,
    batchPolicy: 'absolute',
    params: [
      { id: 'amount', label: 'עוצמה', min: 0, max: 100, step: 1, default: 0 },
      { id: 'radius', label: 'רדיוס', min: 0, max: 100, step: 1, default: 20 },
      // 0 = everything is sharpened (the old behavior, and old recipes keep
      // it); higher = only real edges, so skin and bokeh stay quiet
      { id: 'masking', label: 'מיסוך — רק קצוות', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
];

export function getTool(id: string): ToolDef {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tool: ${id}`);
  return t;
}

export function defaultParams(def: ToolDef): ParamValues {
  const p: ParamValues = {};
  for (const spec of def.params) p[spec.id] = spec.default;
  return p;
}

// A fresh recipe: every current tool present, global tools enabled, AI tools
// off until used. Retired tools are not offered — only inherited.
export function defaultRecipe(): Recipe {
  return {
    tools: TOOLS.filter((def) => !def.legacy).map<ToolInstance>((def) => ({
      toolId: def.id,
      params: defaultParams(def),
      enabled: def.kind === 'global',
    })),
  };
}

/** Reconcile a stored recipe with the registry as it stands today.
 *
 * A style is saved to localStorage as a literal snapshot, so every change we
 * ship reaches it as damage: a slider added since (masking, midpoint, the
 * curve points, the matte) is a missing key, which makes its input
 * uncontrolled, and a retired tool id throws straight out of getTool(). So
 * every path that reads a recipe back from storage runs it through here —
 * missing tools and params take their defaults, unknown ids are dropped, and a
 * retired tool is carried only while it is still doing something.
 */
export function normalizeRecipe(recipe: Recipe): Recipe {
  const stored = new Map((recipe?.tools ?? []).map((t) => [t.toolId, t]));
  // The vignette used to live inside `dimension`. A recipe saved back then
  // carries it there, and the engine still honours it — so it has to move
  // across here, or it would be applied twice.
  const oldDim = stored.get('dimension');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const movedAmount = num(oldDim?.params?.vignette);
  const movedMid = num(oldDim?.params?.midpoint);

  const tools: ToolInstance[] = [];
  for (const def of TOOLS) {
    const prev = stored.get(def.id);
    if (!prev && def.legacy) continue;
    const params = defaultParams(def);
    for (const spec of def.params) {
      const v = prev?.params?.[spec.id];
      if (typeof v === 'number' && Number.isFinite(v)) params[spec.id] = v;
    }
    if (def.id === 'vignette' && !prev && movedAmount) {
      params.amount = movedAmount;
      if (movedMid !== undefined) params.midpoint = movedMid;
    }
    const inst: ToolInstance = {
      toolId: def.id,
      params,
      enabled: prev ? !!prev.enabled : def.kind === 'global',
    };
    // a mask survives normalization — but a PAINTED one only for the same
    // photo; styles go through stripPerPhotoState() before saving
    if (prev?.mask) inst.mask = prev.mask;
    if (def.legacy && isToolAtDefault(inst)) continue;
    tools.push(inst);
  }
  return { tools };
}

export function getInstance(recipe: Recipe, toolId: string): ToolInstance {
  const inst = recipe.tools.find((t) => t.toolId === toolId);
  if (!inst) throw new Error(`tool not in recipe: ${toolId}`);
  return inst;
}

export function isToolAtDefault(inst: ToolInstance): boolean {
  const def = getTool(inst.toolId);
  return def.params.every((s) => inst.params[s.id] === s.default);
}

// Tools that actually change the image, in pipeline order.
export function activeTools(recipe: Recipe): ToolInstance[] {
  return [...recipe.tools]
    .filter((inst) => {
      const def = getTool(inst.toolId);
      return def.kind === 'ai' ? inst.enabled : inst.enabled && !isToolAtDefault(inst);
    })
    .sort((a, b) => getTool(a.toolId).order - getTool(b.toolId).order);
}

export function isRecipeActive(recipe: Recipe): boolean {
  return activeTools(recipe).length > 0;
}

/** All tool instances in pipeline order (for UI rendering). */
export function orderedInstances(recipe: Recipe): ToolInstance[] {
  return [...recipe.tools].sort(
    (a, b) => getTool(a.toolId).order - getTool(b.toolId).order,
  );
}

/** What the UI offers: the same list, minus a retired tool sitting at rest.
 *  A retired tool that a recipe still leans on stays on screen — you must be
 *  able to see it and turn it down; you just cannot pick it up fresh. */
export function visibleInstances(recipe: Recipe): ToolInstance[] {
  return orderedInstances(recipe).filter((inst) => {
    const def = getTool(inst.toolId);
    return !def.legacy || !isToolAtDefault(inst);
  });
}

// Immutable updates
export function updateToolParams(
  recipe: Recipe,
  toolId: string,
  patch: ParamValues,
): Recipe {
  return {
    tools: recipe.tools.map((t) =>
      t.toolId === toolId ? { ...t, params: { ...t.params, ...patch } } : t,
    ),
  };
}

export function setToolEnabled(recipe: Recipe, toolId: string, enabled: boolean): Recipe {
  return {
    tools: recipe.tools.map((t) => (t.toolId === toolId ? { ...t, enabled } : t)),
  };
}

export function updateToolMask(
  recipe: Recipe,
  toolId: string,
  mask: ToolMask | null,
): Recipe {
  return {
    tools: recipe.tools.map((t) => {
      if (t.toolId !== toolId) return t;
      if (!mask) {
        const { mask: _drop, ...rest } = t;
        return rest;
      }
      return { ...t, mask };
    }),
  };
}

/** Which detected blemishes to treat, for a tool that reports candidates.
 *  `null` hands the decision back to the engine; an empty polygon list is the
 *  opposite answer — "none of them" — and both must be expressible. */
export function updateToolSelection(
  recipe: Recipe,
  toolId: string,
  selection: SpotSelection | null,
): Recipe {
  return {
    tools: recipe.tools.map((t) => {
      if (t.toolId !== toolId) return t;
      if (!selection) {
        const { selection: _drop, ...rest } = t;
        return rest;
      }
      return { ...t, selection };
    }),
  };
}

/** What may be saved into a STYLE. A painted mask is a correction for one
 *  photograph; carrying it into a style would stamp that photo's strokes onto
 *  every other frame. Semantic-region masks transfer and stay.
 *
 *  A spot selection is the same kind of thing, only more so: it names marks on
 *  one face in one frame, by their outlines. Nothing about it can mean anything
 *  in another photograph. */
export function stripPerPhotoState(recipe: Recipe): Recipe {
  return {
    tools: recipe.tools.map((t) => {
      const { selection: _sel, ...kept } = t;
      if (kept.mask?.region !== 'painted') return t.selection ? kept : t;
      const { mask: _drop, ...rest } = kept;
      return rest;
    }),
  };
}

export function cloneRecipe(recipe: Recipe): Recipe {
  return {
    tools: recipe.tools.map((t) => ({ ...t, params: { ...t.params } })),
  };
}
