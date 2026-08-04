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
