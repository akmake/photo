# Experiment log — learning a grade from a before/after pair

Every number here was measured, not estimated. Configurations that were tried
and lost are kept deliberately: the record of what does **not** work is what
stops it being tried again.

Metric unless stated otherwise: **LOOK** — mean CIE ΔE against the reference
edit, both frames blurred σ=2 first so that a sub-pixel misregistration cannot
masquerade as a colour difference. `closed` = how much of the before→after
distance the recipe covers.

`blotch` = micro-contrast the recipe ADDS to a smooth out-of-focus patch that
had none. A grade should add zero. This number, not the score, is what caught
every artefact.

---

## Reference pairs

| tag | frames | edit |
|---|---|---|
| `poppy` | IMG_2034 | greens crushed to grey, subject warmed and lifted, painterly softening |
| `olive` | 321A5290 | whole scene warmed green→gold, blues preserved, hazy lift |
| `haze` | 321A5208 | dehaze: warm flare removed, greens and contrast restored |

---

## 1 · Parametric recipe fitting — abandoned

Fitting the engine's own sliders by search. On `poppy`:

| tools | closed |
|---|---|
| tone-color + dimension + color-grade | 47.6% |
| + hsl (8 hue bands × 3) | 51.9% |
| + region masking (subject / background) | 55.6% |
| + texture tools, registration-robust metric | 59.0% |
| derived by calibration instead of search | **−9.1%** |

Each architectural addition bought ~4 points and the search took ~20 minutes.
It plateaued because the model was the wrong shape: a dozen sliders cannot
express an arbitrary colour mapping, and `temperature` sat pinned at +100
through every variant — the field wanted cooling while the subject wanted
warming, and one slider cannot do both.

The learned recipes were also unreadable — ~150 numbers including
`purpleHue -100`, `greenHue +100`, values with no relationship to the edit that
would do something arbitrary to the next photograph.

## 2 · 3D LUT by lattice regression

Same machinery, a real colour transformation. 33³, trilinear fit, tetrahedral
apply via OpenColorIO.

| pair | closed | cube coverage | cellSpread95 | verdict |
|---|---|---|---|---|
| `olive` | **83.3%** | 17.8% | 31.2 | clean, shipped |
| `poppy` | 62.7% | 12.2% | 59.8 | marbling in bokeh |
| `haze` | 63.0% | 9.5% | 70.1 | **images destroyed** |

`cellSpread95` measures how far apart the outputs are that one input colour was
asked to produce. It predicted all three outcomes before anything was rendered.

Lattice size sweep on `haze` (displacement formulation):

| size | closed | blotch |
|---|---|---|
| 9³ | 51.2% | +0.89 (skin went pink) |
| 13³ | 56.1% | +1.07 |
| 17³ | 58.9% | +1.10 |
| 25³ | 61.7% | +1.40 |
| 33³ | 63.0% | +1.73 (foliage destroyed) |

No size wins — coarse breaks skin, fine breaks foliage. Not a resolution
problem.

Tried and rejected on `poppy`: weighted monotone projection (60.9%, −1.8 and
did not remove the marbling), subject/background LUT split (62.4%, no gain —
which proved the leftover was a *gradient*, not a region).

Unweighted monotone projection scored **−54.7%**: with 88% of the lattice
inferred, pooling drags well-measured nodes to the average of guessed ones.

## 3 · Bilateral grid — current

`(x, y, luma)` → a colour transform per cell. HDRNet's representation.

**Selection by held-out error**, fitting on part of the frame and scoring on
strips never seen. Chosen because fitting the whole frame picked 32×32, which
scored 80.4% on its own frame and then put purple on the paths and green on the
faces of every other frame in the gallery.

| grid | haze seen/unseen | olive seen/unseen | gap |
|---|---|---|---|
| 4×4 | 41.5 / 36.2 | 76.4 / 72.0 | 9.7 |
| **6×6** | 45.2 / **38.6** | 77.2 / **72.8** | 10.9 |
| 8×8 | 46.7 / 34.6 | 77.8 / 72.7 | 17.3 |
| 12×12 | 46.7 / 37.5 | 78.4 / 71.5 | 16.0 |
| 16×16 | 44.6 / 34.5 | 78.9 / 71.2 | 17.8 |
| 32×32 | 40.7 / 29.6 | 78.6 / 70.4 | 19.2 |

The seen/unseen gap widens monotonically with resolution — the signature of
memorising composition.

Transfer to the 10 unseen frames of `haze`:

| model | closed (own frame) | added blotch, mean / worst |
|---|---|---|
| 3D LUT 33³ | 63.0% | +1.73 — unusable |
| grid 32×32×24, full affine | 80.4% | +1.46 / +2.42 — purple, neon |
| grid 6×6×16, full affine | 65.7% | +1.46 / +2.42 — still neon |
| **grid 6×6×16, cross-channel pinned** | 57.9% | **+0.02 / +0.18 — clean** |

The last change was the one that mattered and it was not about resolution: a
full 3×4 affine per cell can take red from the blue channel and is unbounded
outside the range it was fitted on. Solving for the departure from identity and
pinning the off-diagonal terms (`LAMBDA_CROSS = 12`) caps them at 0.079.

Open: greens run more vivid than the reference on `haze`.

---

## Standing lessons

1. **The score on the frame you fitted hides transfer failure.** 80.4% and
   ruined every other frame. Select on held-out data.
2. **ΔE does not see artefacts.** It is blurred; blotching is high-frequency.
   The `blotch` measurement is a separate, required gate.
3. **Predictions were wrong seven times out of eight** — HSL, masking, texture,
   constraints, weighting, monotonicity, region split, finer lattices. Only
   measurement moved anything. Measure first.

## Other measured facts

- BiRefNet vs MediaPipe matting: 4.9s vs 0.9s per frame; partial-alpha pixels
  3.67% vs 2.02% — visibly resolves hair strands the segmenter renders as card.
- 3D LUT apply: 1.79s for 26MP (OpenColorIO, tetrahedral) → 200 frames in 6 min.
  Bilateral grid apply: ~30s for 20MP → 200 frames in ~1.7 h.
- Export bug found: previews were q90 4:2:0 and the save button handed them
  over — 91.4% of pixels discarded, and 47.7 dB PSNR against q97 4:4:4 at the
  same frame size, which is visible loss on skin gradients.
- Two engines bound port 8756 simultaneously on Windows three times, serving
  requests at random from stale code. `SO_EXCLUSIVEADDRUSE` now refuses.
