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

## Reconstruction and integration are still pending

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
