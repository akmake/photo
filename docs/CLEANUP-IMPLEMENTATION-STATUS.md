# Automatic cleanup implementation status

Updated 2026-09-08. This record does not declare a production-quality cleaner.

## User acceptance target

One cleanup action removes temporary blemishes and dirt while preserving beard,
eyelashes, eyebrows, hair, lips, facial shape, skin texture and lighting. Visible
painted patches are a failure even when detection recall improves. First prove
quality on the exact user-specified photograph:

`C:\Users\yosef dahan\Downloads\17072026\istockphoto-971105428-2048x2048.jpg`

SHA256: `b181fc402f9ec72b7d670016123d8006922e00a52c20958cfd60e376602e33bd`

The research report is `output/pdf/skin-cleanup-research-he.pdf`.

## Implemented and verified

`engine/cleanup_guard.py` is a model-independent compositor. It requires native
resolution RGB and explicit boolean repair/protection masks. Changes and their
feathering remain inside permitted repair pixels. Protected and unrequested
pixels remain bit-identical to the input. It does not infer masks, upsample a
low-resolution prediction, or silently substitute the legacy cleaner.

`engine/test_cleanup_guard.py`: five passing contract tests, including narrow
protected filaments intersecting repairs, full-image model corruption, empty
support, image-edge feathering, and invalid dimensions/mask types.

`tools/audit_cleanup_guard.py` ran on the exact source at 2048 x 1365. A deliberately
corrupted full-image prediction changed 164353 permitted pixels and zero protected
pixels (2631167 blocked). This proves composition boundaries, NOT retouching
quality or semantic mask accuracy. No stress prediction is presented as a clean
photograph. Outputs: `test-results/cleanup-guard-case/`.

The protection overlay was visually inspected. Existing geometric anatomy masks
cover eyes, brows, nose, mouth and contour, but also draw a band across the
forehead. This overprotection can preserve actual blemishes. The existing hair
class is not a validated beard detector. These masks must not be described as
complete or precise automatic preservation.

## Initial reconstruction evaluation: LaMa (2026-09-08)

The Baidu-dependent candidate is no longer the only path. LaMa was downloaded
and successfully executed locally. Its authors' repository links both an
Apache-2.0-tagged pretrained mirror and the simple-lama-inpainting third-party
implementation used here. This is a general inpainting model, not a specialized
skin retoucher. These sources establish a practical evaluation path, not proof
of skin quality or complete clearance of every possible deployment obligation:

- https://github.com/advimman/lama
- https://huggingface.co/smartywu/big-lama
- https://github.com/enesmsahin/simple-lama-inpainting

Downloaded TorchScript release: `engine/models/big-lama.pt` (205803670 bytes).
SHA256: `7ba7aa7ac37a4d41fdbbeba3a2af7ead18058552997e3a3cd1a3b2210c9e6b4c`.
Upstream license saved alongside it as `lama-LICENSE.txt`.

`tools/evaluate_lama_skin_case.py` provides two explicit diagnostic modes:

- Default: six manually annotated blemishes on the exact source. Native pixels,
  one face crop, no colour-evening or texture graft. Runtime including load and
  output preparation was 10.28 seconds on CPU. Changed 4073 pixels, zero outside
  the 4078-pixel annotation support. Visual inspection found promising removal
  of the isolated chin/forehead defects; this is not an automatic result and
  does not establish professional quality over the whole face.
- `--automatic`: existing `cleanup.detect` at the unchanged UI parameters
  redness=90/spots=25, with LaMa for reconstruction. Sixteen accepted regions;
  8760 changed pixels; zero changes outside requested repairs or inside the
  supplied feature protection. Runtime for reconstruction/load/output was
  9.64 seconds (excludes detection). Visual inspection: many blemishes remain,
  and the prominent chin lesion is only partly covered. This fails the user's
  one-click complete-cleanup target. A pretrained restorer alone does not fix
  the existing incomplete detector/masks.

Outputs, original-resolution images and comparison panels:
`test-results/lama-skin-case/` and `test-results/lama-auto-case/`.
No UI/pipeline integration was made on the basis of these incomplete results.

Perfectly Clear Retouching 2.0 is a potential paid, specialized alternative;
vendor documentation states local/cloud/mobile availability and separate blemish
removal/skin smoothing. It was not tested, licensed, purchased, or contacted:
https://perfectlyclear.ai/perfectly-clear-technology-updates/

## Specialized candidate access and product integration remain pending

No production cleanup route or UI was changed in this implementation step.
The new compositor is intentionally not integrated before native-resolution
reconstruction and mask quality are demonstrated together. Existing experimental
Telea/donor/colour outputs are not promoted as the new solution.

RetouchFormer official source and checkpoint instructions were verified:
https://github.com/Davidcoach/RetouchFormer_AAAI_24

Its loader uses a 512-pixel short side; repository license remains unverified.
RetouchGPT is the MIT-licensed official successor, but checkpoint access and
complete model dependency/weight terms remain unverified:
https://github.com/Davidcoach/RetouchGPT

Their official checkpoint links point to Baidu. Web access failed; browser access
to the RetouchFormer link was explicitly blocked by browser site-safety policy.
Do not try to bypass that restriction using shell downloads or another browser.
No checkpoint was downloaded. Targeted Hugging Face searches found no official
alternative release. A different officially authorized distribution source, with
verified usable model terms, is needed for that candidate path.

## Next acceptance work

1. Resolve an officially accessible, commercially permitted pretrained restorer;
   do not rebuild a paper model from random initialization or copy unlicensed code.
2. Validate semantic preservation (especially beard and lashes) separately from
   the compositor's already-tested immutable-pixel contract.
3. Prove reconstruction on the specified image, at original resolution and normal
   viewing size. Diagnostic exact masks may isolate reconstruction from detection,
   but do not count as automatic cleanup success.
4. Integrate through the existing engine pipeline only after the visual result
   satisfies both removal and preservation. Additional photos come after this
   case works, not as a substitute for it.
