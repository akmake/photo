# BUGS

Defects found and measured, whether or not they were fixed. One entry per
defect, newest first.

This file is in **English** on purpose: entries are read while looking at code,
and every identifier, path and log line in them is English already.

## What belongs here, and what does not

| | goes here | goes elsewhere |
|---|---|---|
| A tool produces the wrong picture on a specific frame | | `docs/TOOLS-STATUS.md` — per-tool quality records, in Hebrew, with sheets |
| A tool is wired up wrong, never runs, runs twice, or disagrees with itself between two paths | ✔ | |
| The UI shows something different from what the export produces | ✔ | |
| A crash, a hang, a leak, corrupted output | ✔ | |
| "This could be faster" / "this could be nicer" | | not a bug — that is a task |

The line between this file and `TOOLS-STATUS.md`: **TOOLS-STATUS asks whether a
tool's judgement is good. BUGS asks whether the machine does what it says.**
A tool that flags the wrong blemish is a TOOLS-STATUS record. A tool that
silently never runs is a BUGS entry. When one turns out to be the other, move
it and leave the ID behind with a pointer.

---

## How to write an entry

Copy the template at the bottom. Rules, in order of how often they are broken:

**1. Measure before you write.** No entry lands on "it looks wrong" or "this
seems to". Every claim of severity carries a number, and the number carries the
command that produced it, so the next person can re-run it rather than trust it.
If you could not measure it, the entry still belongs here — say **`UNMEASURED —
hypothesis`** in that sentence, in bold, so nobody reads a guess as a finding.

**2. Separate what you saw from what you think caused it.** The `Symptom` and
`Cause` sections are separate because they have different confidence. A
confirmed symptom with a wrong hypothesis is a useful entry. A confident-sounding
hypothesis presented as fact costs the next person a day.

**3. Cite `file.py:line` for every claim about the code.** Not "the render
path" — `engine/server.py:185`. Line numbers drift; that is fine, they are a
starting point, and the quoted snippet next to them survives the drift.

**4. Show the whole picture, not the crop that proves you right.** If a table
has a row where the bug does not reproduce, that row stays in the table. A
measurement that only covers the failing case is not a measurement, it is an
illustration.

**5. Name the blast radius.** Before writing the entry, check whether the same
pattern exists elsewhere — the same constant, the same call, the same
assumption. Most defects worth writing down are not alone. If you checked and it
IS alone, say that you checked.

**6. Record the options you rejected and why.** The next person will think of
them too. Two lines each saves them the round trip.

**7. Say what would catch it next time.** An entry without a `Guard` section is
an invitation to reintroduce the defect. If no guard is practical, say why.

**Status values:** `OPEN` · `FIXED <commit>` · `WONTFIX <reason>` ·
`MOVED <where>`. Never delete an entry — a fixed bug's record is what stops it
coming back. IDs are permanent and never reused.

---

## Index

| ID | Status | Severity | Title |
|---|---|---|---|
| [BUG-001](#bug-001--every-face-tool-is-inert-in-every-preview-the-app-renders) | `OPEN` | High | Every face tool is inert in every preview the app renders |
| [BUG-002](#bug-002--a-graded-frame-is-re-segmented-for-every-display-width-and-again-for-every-change-of-look) | `FIXED` | High | A graded frame is re-segmented for every display width, and again for every change of look |
| [BUG-003](#bug-003--the-drool-fluid-trail-is-detected-and-then-thrown-away-by-the-mean-width-gate) | `OPEN` | High | The drool (fluid trail) is detected and then thrown away by the mean-width gate |
| [BUG-004](#bug-004--skin-cleanup-heals-the-eye-corners-at-full-resolution-invisible-in-preview) | `FIXED` | Medium | skin-cleanup heals the eye corners at full resolution, invisible in preview |
| [BUG-005](#bug-005--the-mask-cache-serves-stale-masks-after-any-change-to-mask-code) | `FIXED` | High | The mask cache serves stale masks after any change to mask code |

---

## BUG-001 — Every face tool is inert in every preview the app renders

**Status:** `OPEN` · found 2026-08-03 · not fixed, recorded by decision
**Severity:** High — the five face tools appear broken while editing, then act
on export. The photographer is shown a picture that is not the one they get.

### Symptom

Drag any face-tool slider. Nothing happens on screen, at any zoom level the app
offers. Export the same frame and the tool has applied at full strength.

### Measurement

`engine/_diag_resolution_cliff.py`, maxed parameters, on two frames from the
holdout set. Widths are the effective **pipeline** widths (see Cause), and the
cell is the largest 8-bit change the tool made anywhere in the frame:

```
321A5327.JPG  5472x3648
   width  face_d   face-retouch   skin-cleanup           skin        contour          blush
          floor:            100            180            120            120            120
     640      56           DEAD           DEAD           DEAD           DEAD           DEAD
    1600     138           DEAD           DEAD           DEAD       5 levels           DEAD
    full     478      41 levels      44 levels      40 levels      18 levels      15 levels

321A5427.JPG  5472x3648
   width  face_d   face-retouch   skin-cleanup           skin        contour          blush
          floor:            100            180            120            120            120
     640      56           DEAD           DEAD           DEAD           DEAD           DEAD
    1600     140           DEAD           DEAD           DEAD       5 levels           DEAD
    full     480      25 levels      79 levels      51 levels      17 levels      16 levels
```

Reproduce:

```bash
cd engine && ./.venv/Scripts/python.exe _diag_resolution_cliff.py
```

`640` is every grid in the app. `1600` is the widest preview that exists
anywhere. `full` is what export renders. **Five tools out of five are dead at
640; four of five are dead at 1600.** The one survivor, contour at 5 levels, is
below what a photographer would notice against a 17-level export.

Note the 1600 row of the first frame: whole-frame `face_d` is 138, above
face-retouch's floor of 100, and the tool is still dead. `apply()` dispatches to
a per-face loop when more than one face is found
(`engine/abpn.py:102-110`), and each individual crop lands under the floor. The
whole-frame number is not the number that decides.

### Cause

Two correct pieces that are wrong together.

**a. The preview pipeline resizes before the recipe runs.**
`engine/server.py:185-188`, in `_render_proxy`:

```python
work = _fit_size(im.size, max(width, 640))
if work != im.size:
    im = im.resize(work, Image.LANCZOS)
im, _ = render.render(im, recipe)
```

So the recipe never sees the photograph — it sees a thumbnail of it. The same
happens on the POST path at `engine/server.py:507`, whose own comment states it
plainly: *"`w` caps the long edge BEFORE the pipeline runs."*

**b. Every face tool refuses to run below a fixed pixel floor.**

| tool | constant | guard | value |
|---|---|---|---|
| face-retouch | `engine/abpn.py:33` | `engine/abpn.py:118` | 100 |
| blush | `engine/blush.py:31` | `engine/blush.py:103` | 120 |
| contour | `engine/contour.py:50` | `engine/contour.py:213` | 120 |
| skin | `engine/skin.py:37` | `engine/skin.py:151` | 120 |
| skin-cleanup | `engine/cleanup.py:43` | `engine/cleanup.py:859`, `:1360` | 180 |

`face_d` is `sqrt(skin pixel count)`, so it scales linearly with the resize. A
5472px frame rendered at 640 is 0.117x, and a 478px face becomes 56px.

**The floors are not the defect.** They are protecting real quality: there is
no blemish to find in a 56px face, and no texture to preserve. The defect is
*where the floor is measured*. "Is this face big enough for this tool to mean
anything?" is a question about the **photograph**. It is currently answered with
a number taken from the **screen**, so the same face gives a different answer at
a different zoom.

The failure mode was already known at full resolution and written down at
`engine/cleanup.py:1659` — *"the five faces are 137-154px against MIN_FACE_PX
180, so the tool did nothing"*. What was not noticed is that the preview
pipeline puts **every** frame in that state.

### Blast radius

Checked, not assumed:

- **All five face tools**, per the table above. `engine/eyes.py:63` has a
  related `irisTooSmall` counter but a different mechanism — not verified as
  part of this defect.
- **Every live preview call site in the app.** Requested widths:
  `src/studio/screens/Batches.tsx:144`, `:214`,
  `src/studio/screens/FramePicker.tsx:52`,
  `src/studio/screens/ProjectFiles.tsx:172` — all 320;
  `src/studio/screens/BeforeAfter.tsx:75`, `:83` — 520;
  `src/studio/screens/BeforeAfter.tsx:97`, `:101` — 1600;
  `src/studio/screens/ColorMatch.tsx:299` — 900. Defaults in
  `src/api.ts:405` and `src/api.ts:433` are both 320. **The maximum anywhere is
  1600.**
- **`renderRecipeAtPath` (`src/api.ts:441`) accepts an uncapped width and has
  no callers** — dead API surface, so it does not rescue any screen today.
- **Export is unaffected** and renders at full resolution. That is precisely
  what makes this a disagreement rather than a dead feature.

### The signal exists and nothing consumes it

Each tool already returns the reason it skipped — `{"faceTooSmall": 1}` at
`engine/abpn.py:119`, `engine/blush.py:104`, `engine/contour.py:214`,
`engine/skin.py:154`, `engine/cleanup.py:1725`. `engine/cleanup.py:1655-1660`
even carries a comment about keeping the counter from being lost on the
multi-face path. No UI code reads any of it. Whatever the eventual fix, the
cheap half is to stop swallowing a diagnosis the engine already made.

### Options

| | verdict |
|---|---|
| Lower or remove the floors | **No.** Replaces "does nothing" with "does something wrong": these tools cannot produce a sane result on a 56px face. Strictly worse than the current behaviour. |
| Render previews large enough for the tools | **No.** Needs ~2000-5500px per frame and turns every grid thumbnail into a full render, which is exactly what the proxy cache at `engine/server.py:61-72` exists to prevent. |
| Take the face crop from the ORIGINAL, composite the result down | **Viable.** The tools already crop to the face — `engine/abpn.py:121` via `common.region_box` — and the engine already holds the file. Cost is bounded by face area, not frame area. |
| ...and only for the frame being edited | **Recommended.** A 320px grid exists to *choose* frames, not to judge retouching. Full-resolution face work on the edit view and zoom only: one frame at a time instead of 1,900. |
| Surface `faceTooSmall` in the UI | **Ship regardless.** Small, and it ends the silent lie even before the real fix lands. |

Not yet decided. Recorded at the user's request; no code touched.

### Guard

There is no test that renders the same recipe at two sizes and compares. That
absence is the reason this survived. The pattern to copy is
`engine/test_parity.py`, which guards the JS preview against the Python export
on the *language* axis; this is the same class of defect on the *resolution*
axis, and wants the same shape of guard: render at preview width, render at
full width, assert that a tool which acts in one acts in the other.

---

## BUG-002 — A graded frame is re-segmented for every display width, and again for every change of look

**Status:** `FIXED` · found 2026-08-04 · caching landed same day; the
first-view wait was removed after that — see *What closed it*
**Severity:** High — reported from use: "it takes over a minute to load, and I
am talking about 7 photographs; after 3 minutes it still had not loaded", and
the before/after sheet "4 minutes easily". No tool had been tuned yet. At this
cost a real set — 300 frames, not 7 — is unusable.

### Symptom

A project with a learned colour on one batch. Opening the strip, the frame
picker or the before/after sheet leaves thumbnails blank for minutes. Frames in
batches with **no** colour step appear instantly. Nothing in the UI is doing
work; the engine is.

### Measurement

All numbers from the running engine over HTTP, 7 frames, 4 of which carry the
learned colour (`perBatch["קבלת פנים"]`, 18 anchors + skin model).

**Where the cost is — sequential, one request at a time, cold, `w=640`:**

```
321A1770.JPG        12.31s     <- in the graded batch
321A1784.JPG        12.05s     <- in the graded batch
321A1791.JPG        11.31s     <- in the graded batch
321A1809.JPG        11.54s     <- in the graded batch
321A1809 (2).jpg     0.51s     <- no colour step
321A1819.JPG         0.20s     <- no colour step
321A1823.JPG         0.21s     <- no colour step
wall                48.13s
```

The split is exact: the cost belongs to the learned colour, not to decoding,
not to HTTP, not to file size.

**It is not the colour maths.** Same frame twice, all models already warm:

```
321A1784.JPG   first render 11.81s   second 0.24s
321A1791.JPG   first render 11.58s   second 0.10s
321A1809.JPG   first render 11.83s   second 0.12s
```

`render.render` reports `pixel-color ms: 241` on the second run. So ~11.6s of
every ~11.8s is per-frame analysis that is thrown away.

**Profile, models warm, mask cache on disk, in-memory cache cleared** (sorted by
`tottime`, top 3):

```
6.385s  onnxruntime.capi...state.run          <- birefnet.subject_alpha
0.578s  mediapipe ... dispatch_and_free
0.236s  render.render TOTAL cumulative        <- the colour work itself
```

**The per-width multiplication**, before the fix — the same 7 frames at the
three widths the UI actually asks for:

```
w=200  wall 64.35s
w=320  wall 35.61s
w=520  wall 34.47s
```

Three full segmentations of the same photographs. *(These three runs did not
start from a wiped mask cache, so they understate the cold cost; they are
included to show the per-width repetition, not the absolute floor.)*

**After the fix**, every cache wiped first
(`rm -rf $LOCALAPPDATA/TEZA/cache/{proxy,masks,subject}`):

```
1. strip @200          (ICE COLD)      106.24s
2. picker @320         (same render)     0.02s
3. contact sheet @520  (same render)     0.02s
4. back to strip @200                    0.02s
re-grade, NEW recipe key on same frames  3.29s
re-grade again, another look             3.89s
```

Changing a look on 7 frames: **~106s → 3.3s**. Revisiting at another size:
**~35s → 0.02s**. First-ever view: unchanged, ~15s per frame.

**Correctness of the caches** — the numbers that make them admissible:

```
subject alpha identical      : True
max abs difference           : 0.0
full render identical        : True
```

### Cause

Three independent places, each cheap on its own and compounding.

**1. The proxy cache was keyed by output width.** `engine/server.py`,
`_proxy_path` hashed `width` into the identity:

```python
ident = hashlib.sha1(f"{_PROXY_VERSION}|{src_path}|{stamp}|{width}"...)
```

Rendering is *not* proportional to output size — it is dominated by a fixed
per-frame cost — so a width-keyed cache bought nothing and charged three times.

**2. `engine/birefnet.py:subject_alpha` had no cache at all.** One
`onnxruntime` run at 1024×1024 per call, profiled at **6.385s**, invoked once
per frame per render. It does not go through `masks.get_mask`, so the mask
cache never covered it — this is why the first attempt at a fix only halved the
cost (13.16s → 7.72s) instead of removing it.

**3. `engine/masks.py:get_mask` cached in memory only** — `_CACHE_MAX = 24`,
lost on restart, and never shared between two recipes. A mask says *where the
subject, the skin and the fabric are*; grading does not move them, so keying
this work to the recipe was wrong in principle, not just slow.

### Blast radius

Checked, and it is not alone:

| site | state | note |
|---|---|---|
| `engine/birefnet.py` | **fixed** | disk cache keyed on the prepared tensor |
| `engine/masks.py` | **fixed** | disk cache keyed on the downscaled image |
| `engine/regions.py:53` | **same pattern, not fixed** | MobileSAM, in-memory `OrderedDict`, `_CACHE_MAX = 8` — smaller than masks', so it thrashes sooner |
| `engine/depth.py:57` | **same pattern, not fixed** | MiDaS, **no cache of any kind**. **UNMEASURED — hypothesis**: same class of cost. Only reachable through `dehaze`, which is not in a default recipe, so it has not been felt yet |
| `engine/abpn.py:96` | not the same class | output depends on tool parameters, not on the picture alone; not cacheable on image identity |

The live workbench path (`POST /render`) pays the same per-frame cost and
benefits from the same caches, since they sit below it.

### Options

| | verdict |
|---|---|
| Render each width separately, as before | **No.** The measured premise was false: cost is per frame, not per pixel. |
| One canonical render, derive other sizes by resizing | **Done.** `_PROXY_CANON = 640`; a resize is single-digit ms. Widths above the canonical still render at their own size. |
| Cache masks/subject in memory only, raise `_CACHE_MAX` | **No.** Does not survive a restart and does not help the operation that actually hurts — changing the look, which is a new recipe key every time. |
| Cache the masks keyed by recipe | **No.** Wrong in principle. The subject does not move when the grade changes; keying on the recipe is what made a re-grade cost a re-segmentation. |
| Cache to disk, keyed on the picture | **Done.** Masks store the *small* array before upscale; subject stores the model's own 1024px output before upscale and edge refinement. Both then go through the identical arithmetic on the way out — verified bit-identical. |
| Drop the protection masks for small outputs | **No.** Makes a thumbnail lie about the result the export will produce. That is BUG-001's defect, deliberately reintroduced. |
| Serve the raw frame instantly, upgrade to graded when ready | **Done.** `?fast=1` on `/preview`. Carries `X-Teza-Graded: 0`, and `useSetPreview.pending()` makes the tile say *המראה נטען…* — a silent raw frame under a label promising the edit is the confusion the recipe model exists to remove. |
| Warm the set in the background after import / after a look is set | **Done.** `POST /preview/warm`; triggered from the import grid, the batch pool, the frame picker, and — the one that matters — the moment a look is applied in `ColorMatch`. |

### What closed it

The caches made the cost once-per-photograph. They did not stop it being paid
**in front of the user**, and that is what the second round fixed.

```
7 frames, brand-new look, proxy cache wiped

TIME TO FIRST PIXELS      0.84s   (slowest single request 0.84s)
   all 7 marked X-Teza-Graded: 0
FULLY GRADED, background 73.17s   while the screen is already usable
```

Against **106s** before, for the same work. Two things were needed, and the
first attempt had only one of them:

**1. Warm ahead.** `POST /preview/warm` pushes a set onto a LIFO stack drained
by one background thread. LIFO because the newest click matters more than a
minute-old one; one thread because rendering two frames at once was measured
*slower* than one after another (82s vs 48s for the same seven).

**2. The instant reply must not queue behind the warming.** The first version
measured **35.5s to first pixels** — worse than useless — because the fast
reply went through `on_worker`, landing behind a 12s warm render. Two fixes:

- the fast reply renders **off the worker**. An empty recipe touches no model,
  so `_render_proxy` is a decode and a resize, and the thread-safety reason the
  worker exists does not apply;
- the warm loop **stands aside** while anything interactive is in flight
  (`_INTERACTIVE`), so warming can never become the thing being waited for.

**A third defect found while verifying:** warming writes at `_PROXY_CANON`
(640), so a `fast` request at 320 saw no entry at *its* width and served raw
even though the graded frame existed. The fast path now derives from the
canonical first. Verified:

```
fast=1 on an already-warmed frame -> X-Teza-Graded: 1   mean (128,132,111)
                            (raw would be (147,149,143))
```

### Guard

None exists, and its absence is why three separate caches were missing at once.
What is wanted is a timing test in the shape of `engine/test_parity.py` — fixed
frames, fixed recipe, assert that:

1. the same frame at three widths triggers **one** render, not three;
2. a second recipe over the same frames does not re-run `birefnet.subject_alpha`
   (assert on a call counter, not on wall-clock, so it does not go flaky on a
   loaded machine);
3. cached and uncached renders are `np.array_equal` — the assertion that makes
   the caches admissible at all, and the one that would catch a future change
   to the upscale path silently altering cached output.

A wall-clock budget test is explicitly **not** wanted: it fails on slow CI for
reasons unrelated to the defect. Count the model calls instead.

---

## BUG-003 — The drool (fluid trail) is detected and then thrown away by the mean-width gate

**Status:** `OPEN` · found 2026-08-04
**Severity:** High — the fluid detector's *only* validated true positive is this
one baby's drool, and it returns 0 on it at delivery resolution. A whole
subsystem (`cleanup._fluid_trails`, ~120 lines, plus `_orifice_context` and the
wet-trail rescue in `_structure_gate`) is dead weight on the exact case it was
written for. The strand ships uncorrected in the delivered frame.

### Symptom

`321A1809.JPG` — four children, the toddler second from left has a wet drool
strand hanging from the lower lip down the chin, ending in a droplet. Plainly
visible. `skin-cleanup` heals nothing on it; `fluidTrails` and `wetTrails` are
both 0.

### Measurement

```bash
cd engine && ./.venv/Scripts/python.exe _diag_fluid_1809.py
```

```
detect() notes: {'lineVetoed': 6, 'shadingVetoed': 4, 'creaseVetoed': 2, 'wetTrails': 0, 'fluidTrails': 0}
  -> fluidTrails = 0  wetTrails = 0

face_d(working)=259  vertical-bridge=7px  width-gate bar = face_d*0.03 = 7.8px
strand fragments after bridging: 17
  frag 1 area= 152 len= 28 meanW= 5.4 y=[135,162] -> ['no-anchor']
  frag 6 area= 655 len= 54 meanW=12.1 y=[205,258] -> ['WIDTH 12.1>7.8']
  frag15 area= 449 len= 55 meanW= 8.2 y=[291,345] -> ['WIDTH 8.2>7.8']
```

`frag 6` is the top of the drool and it **reaches the lip anchor** (no
`no-anchor` in its reject list); `frag15` is the lower run plus the droplet.
Both are killed by one rule: mean width. Nothing else rejects them.

The top-level `fluidTrails = 0` is identical on the app path and a direct call —
see BUG-005's measurement, same frame, `render.detect_cleanup` == `cleanup.detect`.

### Cause

Two failures compound; either alone would sink it.

**a. The strand fragments and the bridge cannot rejoin it.** A drool strand
glints where it catches light and nearly vanishes between glints, so the tophat
returns the glints and drops the dim stretches between them. `_fluid_trails`
already knows this and bridges with a vertical close — `engine/cleanup.py:414`:

```python
extent, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, bridge))
```

but `bridge = max(3, int(face_d * 0.03)) | 1` is **7px** on this 259px face, and
the gap between `frag 6` (ends y=258) and `frag15` (starts y=291) is **33px**. So
the drool never becomes one component; it is judged in pieces.

**b. The mean-width gate rejects a strand that ends in a droplet.**
`engine/cleanup.py:438`:

```python
if length < face_d * 0.05 or area / max(1, length) > face_d * FLUID_MAX_WIDTH:
    continue
```

`area / length` is *mean* width. A hanging fluid is thin along its length and
bulges at the terminal droplet, and the droplet's area inflates the mean: 655/54
= 12.1 and 449/55 = 8.2, both over the 7.8 bar. **This is the third recorded
time the same gate rejects the same drool.** `FLUID_MAX_WIDTH`'s own comment,
`engine/cleanup.py:70-76`, already records the first two: *"0.02 rejected the
real 321A1809 drool (11.4 against an 11.0 bar) and the bar was raised to 0.03. It
then rejected the SAME drool a second time, at 8.28 against 7.77."* Raising it a
third time is not a fix — a strand-with-droplet is the wrong shape for a
mean-width test at any threshold, and a higher bar readmits shine patches.

### Blast radius

- The mean-width descriptor is the *same class of mistake* this module has
  already corrected twice elsewhere, and says so: `decide()` gates blush by
  **thickness not bounding-box** (`engine/cleanup.py:1045-1051`), and the ridge
  veto admits a thick line only by **elongation** (`RIDGE_MIN_ELONGATION`,
  `engine/cleanup.py:126-133`). Both replaced a scalar that a droplet-or-blob
  inflates. `_fluid_trails` is the one strand test that never got that treatment.
- The fragment-then-judge-alone failure is the exact bug `hysteresis_core` was
  written to fix for lesions (`engine/cleanup.py:972`) and that the seed/extent
  hysteresis inside `_fluid_trails` (`engine/cleanup.py:404-407`) was meant to
  fix for strands. It fixes the *contrast* gaps; it does not fix a *spatial* gap
  wider than the bridge. Found here a third time, in the same file.
- Only `321A1809` carries a real fluid in the corpus, so this is the whole
  evidence base. `_orifice_context` (`engine/cleanup.py:283`) deliberately
  dropped tear-track detection to kill false positives on dry faces; that half
  works. The drool half does not.

### Options

| | verdict |
|---|---|
| Raise `FLUID_MAX_WIDTH` a third time | **No.** 0.02→0.03→? is a parameter, not a mechanism; the file already says so. A higher bar readmits temple/philtrum shine. |
| Replace `area/length` with **median half-thickness** (distance transform along the component) | **Recommended.** A strand is thin along its length whatever its ends do: the median of the distance-transform ridge stays small while the droplet only lifts the max. Scale-free, same instrument `decide()` already trusts. |
| Widen `bridge` so glints rejoin across a dim gap | **Needed alongside.** ~7px cannot span a measured 33px gap; a vertical close near `face_d*0.15` would, without merging neighbouring strands sideways (the close is 1-px wide horizontally by construction). Must be re-measured against the dry-face false-positive set. |
| Detect the strand by following the ridge down from the anchor instead of thresholding | **Deferred.** The principled fix, but a larger rewrite; the two above are measured and local. |

Not yet built. Recorded before touching the fluid code, at the user's request.

### Guard

`engine/test_cleanup_recall.py` injects *synthetic* marks and never exercises the
real drool — which is why this crosses the whole suite green. The guard is a
recall case on `321A1809` itself asserting `fluidTrails >= 1` and a residual drop
on a hand-drawn drool mask, in the shape the recall test already uses for its
injected marks.

---

## BUG-004 — skin-cleanup heals the eye corners at full resolution, invisible in preview

**Status:** `FIXED` 2026-08-04 (uncommitted) · found 2026-08-04
**Severity:** Medium — the tool rebuilds eye-corner tissue (the pink caruncle,
the outer skin fold) as if it were a blemish. It never shows in an editing
preview because the faces there are under the size floor (BUG-001); it only
happens at the full resolution the client is delivered.

### Symptom

Run `cleanup.detect` at full resolution on frames with clearly-resolved eyes and
several candidates sit on the eye corners — some with verdict `heal`, i.e. the
automatic path rebuilds them. User-reported across more than one frame.

### Measurement

On `321A1809` (four faces), each candidate's centroid distance to the nearest
eye-corner landmark, in `face_d` units, before the fix:

```
12 candidates within 0.18*face_d of a corner; TWO were accepted heals ON the corner:
  face3 (baby)  heal  area=177  outer-canthus  d=0.04
  face2         heal  area=220  outer-canthus  d=0.06
```

Radius sweep of the fix (fresh masks, disk cache bypassed):

```
cap     accepted heals on corner   any corner cand.(d<.10)   real cheek heals
0.00           2                        8                        12
0.08           0                        0                        14   <- chosen
0.12           0                        0                        12   <- eats real marks
```

### Cause

The eye is protected by the convex hull of its landmark ring plus a 3% dilation
— `engine/masks.py:354`:

```python
m = cv2.dilate(m, _kern(fw * 0.030))  # lashes sit outside the ring
```

The hull's own vertices **are** the corner landmarks, so 3% reaches only ~3%
past them. The canthus tissue the skin model reads as novelty — reddish
caruncle, outer fold — lives just beyond that margin, so it is inside the
heal-eligible `region` and becomes a candidate.

### Fix

Canthus caps: a disc at each of the four corner landmarks, folded into the
`eye-{side}` part in `anatomy_parts` so it flows into `face-anatomy` (blocks
detection) and `face-eye-region` (blocks the fluid pass) on every frame.
`engine/masks.py:57` (`EYE_CORNERS`), `:75` (`EYE_CORNER_CAP = 0.08`, radius set
by the sweep above), `:362` (the `cv2.circle` in `anatomy_parts`). The tight hull
is deliberately kept — an outer-*lid* lesion must stay reachable — so this adds a
corner cap, it does not fatten the whole eye. Invariants held: `marking==apply`
0px diff, `test_blush` PASS, `test_cleanup_structure` unchanged (its light-strand
failure is BUG-003's family and identical with the cap off).

### Blast radius

The only production consumer of `face-anatomy` / `face-eye-region` /
`face-pigment-protect` is `engine/cleanup.py` (`pigment.py` only receives the mask
as an argument). In every path the change makes eye protection *larger*, i.e.
one-directionally safer. Validated on one frame (four faces); not swept across
the corpus.

### Guard

None yet. Wanted: a detection test asserting no `heal` candidate's centroid
falls within `EYE_CORNER_CAP` of a corner landmark, on a fixed full-res frame.

---

## BUG-005 — The mask cache serves stale masks after any change to mask code

**Status:** `FIXED` 2026-08-04 (uncommitted) · found 2026-08-04
**Severity:** High — silent and cross-cutting. After any edit to how a mask is
computed, every already-seen frame keeps getting the *old* mask, in the app and
in tests, with no error. It cost a live debugging session: the BUG-004 fix
"did nothing" in the app while a fresh script showed it working, on the *same
image*, for no visible reason — the classic "here it works, there it doesn't".

### Symptom

Edit mask code, run the tool in the app on a frame it has rendered before, and
the behaviour is the pre-edit behaviour. A script that computes masks fresh
disagrees with the app on the identical file.

### Measurement

Same frame, same params, through both entry points, after clearing the stale
cache:

```bash
cd engine && ./.venv/Scripts/python.exe -c "..."   # render.detect_cleanup vs cleanup.detect
```

```
APP  path (render.detect_cleanup): faces=4 items=26 notes={... fluidTrails: 0}
MINE direct (cleanup.detect):      faces=4 items=26 notes={... fluidTrails: 0}
```

Identical once fresh — proving the code paths never differed. The only variable
was the cache: 257 stale mask files under `%LOCALAPPDATA%/TEZA/cache/masks`,
written by an earlier version of `masks.py`, still being served.

### Cause

Both caches key on the **image only**, with no code identity.
`engine/masks.py`, before the fix:

```python
def _cache_key(rgb, kind):        # in-memory
    ... return (kind, rgb.shape, blake2b(thumb).digest())
def _disk_path(small, kind):      # on disk
    ... return join(_disk_dir(), f"{digest}-{kind}.npy")
```

A mask is a pure function of `(image, mask-code)`, but only the image is in the
key. Grading does not move a mask, which is the correct insight BUG-002 built the
cache on — but *editing the mask function* does change it, and nothing expressed
that.

### Fix

Fold a content hash of `masks.py`'s own source into both keys —
`engine/masks.py:460` (`_MASK_CODE_VERSION`), `:481` (`_cache_key`), `:497`
(`_disk_path`, filename `{digest}-{version}-{kind}.npy`). Any edit to the file
moves the hash, so old entries stop matching and are recomputed; old files are
orphaned, not served. Automatic — it cannot be forgotten the way a hand-bumped
number is. Cost: a comment edit also invalidates, so the first render of each
frame after any `masks.py` change pays the ~11.8s segmentation once (BUG-002's
number). Verified: token present in both keys, cold and warm runs return
identical results (26/26 items), versioned files written.

### Blast radius

The same image-only keying was noted in BUG-002 for the model caches
(`birefnet.py`, `regions.py`, `depth.py`). Those cache **model** outputs, which
do not change when *mask* code changes, so they are unaffected by this class —
but each has its own "stale after the model or its pre/post code changes"
exposure, **UNMEASURED — hypothesis**, and none carries a code-version token
either. If one is ever edited, the same silent staleness applies.

### Guard

The token is itself the guard for masks. A cheap unit assertion would pin it:
changing `anatomy_parts` (or any mask function) changes `_MASK_CODE_VERSION`.

---

## Template

```markdown
## BUG-00N — <one line, the defect, not the area>

**Status:** `OPEN` · found YYYY-MM-DD
**Severity:** <High|Medium|Low> — <why that level, in terms of what the user loses>

### Symptom
What is observed, from outside the code.

### Measurement
Numbers, with the command that produced them. Every row, including the ones
that do not reproduce. Mark anything unmeasured as **UNMEASURED — hypothesis**.

### Cause
`path/file.py:line` for each claim, with the snippet. If unproven, say so here
rather than implying it.

### Blast radius
Where else the same pattern lives. Say that you checked, even when the answer
is "nowhere else".

### Options
Table of what was considered, each with a verdict and a reason — including the
ones rejected.

### Guard
The test that would have caught this, or why none is practical.
```
