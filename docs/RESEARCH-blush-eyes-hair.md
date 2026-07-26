# Research: blush, eye sparkle, hair tones

Background for the three tools the engine was missing. Everything below is what
professional retouchers actually do, with the reason it works — the point is to
implement the *technique*, not a slider that happens to have the same name.

Researched 2026-07-26. Sources at the bottom.

---

## The finding that shapes all three

All three are the same operation: **take a mask, push colour and/or tone inside
it, leave structure alone.** None of them reconstructs pixels. That is why they
are safe in a way healing is not — nothing can be "invented" wrong, because
nothing is invented at all.

So they share one primitive (`local_color.py`) and differ only in mask and push.

The colour space is **CIELAB**, not RGB, and this is not a stylistic choice.
Dermatological colorimetry uses L\*a\*b\* precisely because the axes separate the
things we need to control independently:

| axis | physical meaning | our use |
|---|---|---|
| `L*` | lightness | eye sparkle, hair shine |
| `a*` | red↔green — **correlates with erythema** (vascularisation) | blush |
| `b*` | yellow↔blue — **correlates with melanin/pigmentation** | hair warmth |

Blush is literally increased vascularisation of the cheek. In Lab that is a
**pure `a*` push** — the same axis a colorimeter measures it on. That is why
doing it in Lab looks like blood under skin, and doing it in RGB looks like
paint on skin.

---

## 1. Blush (סומק)

### Placement — the part everyone gets wrong

The naive implementation puts a pink disc on the *apple* of the cheek. That is
where blush goes on a toddler in a cartoon. The professional stroke is:

> **temple → across the cheekbone → down toward the corner of the mouth**

It follows the zygomatic bone, not the soft tissue. It is a **diagonal band**,
widest at the cheekbone, tapering at both ends. The existing `cheeks` mask in
[masks.py](../engine/masks.py) is a soft disc at landmark 50/280 — the apple.
Reusing it would build the cartoon version, so the blush tool builds its own
cheekbone band from landmarks.

### Amount — there is a published ceiling

The constraint from retouching practice: the blushed area should **not deviate
more than 10–15 points in the Red channel** from the surrounding skin. That is a
real, checkable bound, and it becomes the clamp on the `a*` push rather than a
number picked by eye. Above it, the result reads as makeup applied in post.

### Blend

- **Color** mode → hue/saturation only, luminance untouched. This is the correct
  default: skin texture survives perfectly because `L*` is never written.
- **Soft Light** → adds a little luminance modelling too; useful at low opacity
  for a "flushed from the cold" look rather than "wearing blush".

### Must respect

Blush harmonises with the subject's undertone **and the scene light**. A warm
backlit portrait needs a different push than a cool studio one — so the tool
samples the actual local skin colour and pushes *relative to it*, never toward a
fixed pink.

---

## 2. Eye sparkle (ברק בעיניים)

This is the tool where the research changed the design most. The instinct is
"brighten the iris and the whites". Both are wrong on their own.

### The anatomy that matters

Six structures: **pupil, iris, limbus, sclera, cornea, eyelid.** The limbus is
the dark ring at the iris edge, and it does most of the work.

### What actually creates sparkle: contrast, not brightness

> "The light source always enters one side of the iris and is refracted from the
> opposite side."

So the bright part of an iris is **opposite the catchlight**, not centred, and
not uniform. And:

> "The eyelid naturally casts a shadow on the upper portion of the iris."

Therefore a uniform brightening of the iris destroys exactly the two gradients
that make an eye look three-dimensional. The professional result comes from
**darkening the pupil and the limbus** as much as from brightening the lit side.
Contrast is what reads as sharpness and depth.

### Named mistakes to avoid

- brightening with single brush strokes (no gradient) — reads as amateur
- **over-sharpening the limbus** — the tell-tale of a fake eye
- **over-brightening the sclera** — produces an artificial glow
- removing under-eye shadow completely — kills desirable definition

### Sclera

Brighten *slightly*, and **reduce yellow and red** — i.e. pull `a*`/`b*` toward
neutral. Explicitly **do not remove the blood vessels**; a vessel-free sclera is
uncanny. So: chroma reduction with a hard clamp, small `L*` lift, structure
untouched.

### Available geometry

MediaPipe's face landmarker returns **478 landmarks on this project's model** —
verified, not assumed. Points **468–472 (left iris)** and **473–477 (right
iris)** give an exact iris centre and radius per eye. This is what makes a
correct limbus/pupil/iris split possible at all; without it the tool would be
guessing at circles.

---

## 3. Hair tones (גוונים בשיער)

### Method

The professional technique is a **gradient map**, not a global hue shift:
different colours are mapped to shadows, midtones and highlights, then the
result is composited at low opacity.

The classic hair recipe: **reds into the shadows, yellows into the highlights.**
That is what produces the warm, dimensional look — cool-neutral roots and depth,
warm glow on the lit strands. A single hue push flattens hair into a wig.

### Blend

- **Color** → changes hue/saturation while **preserving hair texture** entirely.
- **Soft Light** → adds contrast, "more dynamic", at the cost of some texture.

Both at **low opacity**; the repeated instruction across every source is that
realism comes from restraint.

### Shine

Shine is dodge-and-burn along existing highlights, built up gradually with low
flow — not a specular layer pasted on. Practically: modulate `L*` by the hair's
own luminance, so strands that already catch light catch more, and strands in
shadow stay in shadow.

### The mask already exists

`masks.get_mask(rgb, "hair")` works and returned **2.70% of frame** on the test
image. [masks.py:9](../engine/masks.py#L9) even documents it as existing *for*
hair tones. Nothing new is needed on the mask side.

---

## Implementation consequences

1. One shared primitive: mask + Lab push + blend mode. Three thin tools on top.
2. Lab throughout — `a*` for blush, `b*` for hair warmth, `L*` for shine/sparkle.
3. Blush = cheekbone band, not an apple disc, capped at ~10–15 R points.
4. Eyes = **contrast**, built from real iris landmarks: darken pupil + limbus,
   brighten the side opposite the catchlight, desaturate sclera gently.
5. Hair = luminance-split gradient map (red shadows / yellow highlights), Color
   blend, low opacity.
6. Every one of them is clamped. Every source, on every one of the three tools,
   says the failure mode is doing too much.

---

## Sources

- [Understanding the Human Eye and How To Retouch it Naturally — Fstoppers](https://fstoppers.com/bts/understanding-human-eye-and-how-retouch-it-naturally-60235)
- [Master Retouching Eyes — PHLEARN](https://phlearn.com/tutorial/master-retouching-eyes/)
- [Editing Blush in Photos: Photoshop Tricks](https://buycosmetics.cy/editing-blush-in-photos-photoshop-tricks-for-a-flawless-finish/)
- [How to put blush on face in Photoshop — Adobe Community](https://community.adobe.com/t5/photoshop-ecosystem-discussions/how-to-put-blush-on-face-in-photoshop/td-p/14773170)
- [Add Shine, Color and Volume to Hair in Photoshop — Photoshop Roadmap](https://www.photoshoproadmap.com/add-shine-color-and-volume-to-hair-in-photoshop/)
- [How To Change Hair Color In Photoshop — Photoshop Training Channel](https://photoshoptrainingchannel.com/how-to-change-hair-color-in-photoshop/)
- [Advanced Color Grading in Photoshop — Noble Desktop](https://www.nobledesktop.com/learn/photoshop/advanced-techniques-for-color-grading-your-adobe-photoshop-images)
- [Cutaneous Colorimetry: Objective Skin Color Measurement — Journal of Investigative Dermatology](https://www.jidonline.org/article/S0022-202X(19)33397-4/fulltext)
- [Skin Color Measurements in Terms of CIELAB Color Space Values — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0022202X92903477)
- [Soft-light blend mode algorithm (ISO 32000 / W3C Compositing) — W3C public-svg-wg](https://lists.w3.org/Archives/Public/public-svg-wg/2009JanMar/0132.html)
- [Skin Retouching — Evoto support](https://support.evoto.ai/portrait-retouching-module-skin-retouching/)
