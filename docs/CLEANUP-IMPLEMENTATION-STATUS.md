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

### Product and cost constraint clarified by user

Commercial licensing is not approved merely because it exists: the user needs
an economical solution and editing must remain embedded in this product, without
switching into the supplier's application. Do not substitute a purchased desktop
plugin for an embedded product engine.

Public Retouch4me annual offers checked 2026-09-09: USD 169 / 2400 retouches,
299 / 6000, 759 / 18000. Effective unit costs at full utilization are about
USD 0.0704, 0.0498, 0.0422 respectively; these require the stated annual purchase,
are displayed as offers, and are not a negotiated redistribution quote.
API documentation says each accepted job deducts one retouch credit. Editing
can use an embedded UI with background API processing, but the documented token
flow requires a verified supplier account. Invisible end-customer onboarding
and resale terms have not been established.
https://retouch4.me/pricing
https://retouch4.me/docs/cloud_retouching_api/en/webhooks.html

EyeQ describes Desktop SDK pricing as monthly service pricing, with computation
on the end-customer computer. Exact embedded-license cost was not found.
Its license documentation includes protected, time-limited, and unprotected
bundles; the latter two do not require separate license activation. Availability
and cost of the appropriate bundle must be obtained from the vendor, together
with confirmation of the new AI Blemish Removal model's native availability.
The public USD 0.10 Photo Corrections price is not a verified price for that
new model or for a redistributable native SDK.
https://perfectlyclear.ai/compare-our-solutions/
https://docs.eyeq.photos/docs/general-info/licensing
https://perfectlyclear.ai/pricing/

## Pixel-boundary protection audit (2026-09-09)

User narrowed the work to skin/hair protection, specifically individual beard
hairs and eyelashes, not broad facial ellipses. Added repeatable native-grid
audits in `tools/evaluate_skin_protection.py`. Green means model-eligible skin,
never validated safety. The output separates raw BiSeNet skin from the existing
agent's erosion/ellipses/oval. Four-times nearest-neighbor inspection windows are
derived from landmarks, not manually drawn reference annotations.

Ran on 321A5078 (7 faces) and 321A1809 (4 faces). On the frontal bearded face in
5078, raw and existing masks both include much of the beard as skin. The eye
ellipses exclude healthy skin while the raw mask includes upper-lid/lash regions.
Artifacts: `test-results/original-5078-protection/` and
`test-results/original-1809-protection/`.

A lower-face diagnostic box passed to original SAM-HQ selected mouth/chin and
extraneous pixels rather than the beard. This was a geometry-derived diagnostic
prompt on one selected face, not automatic beard detection or ground truth.
Artifact: `test-results/original-5078-hair-hq/`.

### EasyPortrait candidate and verified input correction

EasyPortrait explicitly excludes beard from skin in its annotation convention.
Evaluated its SegFormer-B0 1024 face-parsing checkpoint using a third-party ONNX
conversion. This is evaluation only, not product integration. The converter's
Apache metadata does not resolve upstream's custom attribution/share-alike
license; the original PDF explicitly says it is not a Creative Commons license.
Product distribution has not been approved under the project's MIT/Apache/BSD
model rule. No supplier contacted, user photos uploaded, or purchases made.

Sources:
https://github.com/ai-forever/easyportrait
https://huggingface.co/sadzip/EasyPortrait-ONNX
https://raw.githubusercontent.com/ai-forever/easyportrait/main/license/en_us.pdf

Found a concrete error in the converter's documented BGR input preprocessing.
The original checkpoint's `img_norm_cfg` specifies `to_rgb=True`; its original
first convolution weights exactly match the converted weights, and ONNX passes
input values directly into that convolution (other input consumers read shape
only). Corrected the evaluator to RGB. `tools/verify_easy_portrait_input.py`
reproduces these checks using restricted checkpoint loading and AST inspection
of config text, without executing it. This is input-contract verification, not
independent full-network parity. Converter-reported logit parity has not been
independently reproduced here.

Original checkpoint SHA-256:
`5ab2628aeaa3b6746aa7d79f7c67d7d052357d94d1a7c596d4bea18b87406f48`
ONNX SHA-256:
`d3d2172f6fd2c97660a1c0c7f5f8480626eafcb902ba3f56f065bd1f5f1d9bdc`

After RGB correction, visual review shows substantially better beard/moustache
exclusion on the frontal bearded face, including retained exposed skin beside
the chin hair. The side-profile beard also improves. The model still has hard,
imprecise boundaries and misses lashes. Removed mask pixel counts are not true
positive counts. About 0.4-0.6 seconds per face on CPU in this audit, with some
runtime variation. Artifacts: `test-results/original-*-easyportrait-rgb/`.
Older non-rgb directories retain the rejected preprocessing for comparison.

### Native-resolution matting diagnostic

`tools/evaluate_protection_matting.py` applies published closed-form matting from
PyMatting 1.1.16 (MIT) to the native crop. Dependencies installed in the isolated
`test-results/protection-research/matting-deps` directory, not the production
environment. Numba 0.67.0 and llvmlite 0.49.0. Restricted sandbox cannot read
those installed directories; inference worked with an approved escalated run.
Reference: https://pymatting.github.io/alpha.html

Symmetric 4-pixel trimaps can re-open parts of previously excluded eye boundaries.
The evaluator therefore defaults to an inward-only band: all existing excluded
pixels remain alpha 0. Both anchor classes are checked exactly, finite outputs
checked, solver warnings retained. All 11 faces passed those numerical contracts
without solver warnings. This says nothing about semantic correctness of anchors.

Four-pixel inward matting smooths jagged borders but leaves missed lashes. A
12-pixel diagnostic on 1809 protects more of the lash area but also suppresses
surrounding healthy skin, visible in the eye inspection. Neither variant proves
individual-hair accuracy. An opacity estimate is not a semantic confidence score.
Artifacts: `original-5078-protection-matting-inward`,
`original-1809-protection-matting-inward`, and
`original-1809-protection-matting-wide` under `test-results/`.

No production route/UI changed. Current unresolved acceptance: accurate eyelash
and fine-hair protection without broad loss of editable skin; validated native
reference masks and independent conversion parity; usable distribution terms
for the chosen semantic model. Do not present the beard improvement as completion
of the pixel-accurate protection stage.

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

## Corrected pretrained implementation and boundary audit (2026-09-08)

`engine/abpn_local.py` had checkpoint-compatible keys but incorrect inference:
encoder LeakyReLU instead of ReLU, batch normalization after gating instead of
before activation/gating, and missing final tanh in reconstruction. Corrected
against installed official ModelScope code. Both learned networks now pass
numerical parity tests at absolute tolerance 1e-6 on the same pretrained weights
and non-square input. Together with compositor checks, seven tests pass.
The initial detector comparison failed on every output pixel (maximum logit
error 117.58). Earlier evaluations of this local implementation cannot establish
the quality of the official model. This module is used by diagnostic scripts;
the production cleanup route does not import it.

Reference: https://github.com/modelscope/modelscope/tree/master/modelscope/models/cv/skin_retouching

`tools/evaluate_learned_defect_masks.py` evaluated the corrected detector on the
exact source using YuNet face crops and upstream 768-pixel inference/cutoffs.
GPU inference/report time: 2.73 seconds. Low mask: 14343 pixels, 56 components;
high mask: 10166 pixels. Component count is not a count of true blemishes.
Visual inspection finds missed cheek defects and included mole-like marks.
The broad face crop also includes neck. No protection or retouching applied.
Outputs: `test-results/learned-defect-case/`.

`tools/evaluate_sam2_blemish_boundaries.py` tested the existing pretrained SAM2.1
small model using six manual box prompts and native 256-pixel crops. These are
diagnostic prompts, not automatic detection or ground-truth masks. All model
loading key/error lists are empty; Transformers warns that the saved config is
sam2_video while the instantiated image model is sam2. Runtime after imports:
2.13 seconds on CUDA. Visual inspection: cases 3 and 6 produce conspicuous
extraneous mask regions. Others appear localized but pixel accuracy is not
validated. The model's predicted IoU is not measured accuracy. Do not integrate
these masks for autonomous removal. Outputs: `test-results/sam2-blemish-case/`.

## Next acceptance work

1. Resolve an officially accessible, commercially permitted pretrained restorer;
   do not rebuild a paper model from random initialization or copy unlicensed code.
2. Validate semantic preservation (especially beard and lashes) separately from
   the compositor's already-tested immutable-pixel contract.
3. Prove reconstruction on the original test photographs, at original resolution
   and normal viewing size. Diagnostic masks may isolate reconstruction from
   detection, but do not count as automatic cleanup success.
4. Integrate through the existing engine pipeline only after the visual result
   satisfies both removal and preservation. The user explicitly changed the
   primary benchmark to the original test photos; retain the dense-acne image
   as a later stress case, not the sole acceptance image.

## Original-photo benchmark and semantic localization (2026-09-09)

The user requested the original experimental photographs. Located and evaluated
`17072026/11/44/321A1809.JPG` (four children) and
`17072026/11/33/321A5078.JPG` (seven detected faces). Source SHA-256 values are
recorded in each diagnostic report. The lower part of 321A1809 decodes as a grey
region already in the source; these experiments do not restore that region.

Fixed Qwen3-VL coordinates in the standalone agent: model boxes are relative
0..1000, not overview pixels. Conversion uses outward rounding and validates
bounds. Three coordinate tests plus existing contracts test pass. Reference:
https://github.com/QwenLM/Qwen3-VL/blob/main/cookbooks/2d_grounding.ipynb

The corrected learned detector finds only fragments of the white forehead mark
and saliva in 1809. General Qwen localization finds saliva with a conservative
prompt and the forehead line with an observation-only prompt. Neither prompt
finds both reliably. All seven 5078 faces yield no marks with both prompts;
enlarging one face does not resolve this. Empty predictions do not demonstrate
preservation of beard or lashes.

`tools/evaluate_face_grounding.py` records all automatic boxes and raw responses.
`tools/evaluate_grounded_boundaries.py` compares SAM2, converted Transformers
SAM-HQ and original SAM-HQ. SAM2's highest predicted IoU selects an overly broad
forehead mask. Converted SAM-HQ produces disconnected regions outside the prompt
box, also with eager attention. Original authors' SAM-HQ code/checkpoint gives
the same score but a different, still overly broad mask. Conversion parity is
not established; neither result is approved for autonomous cleanup. Original
checkpoint was loaded with weights_only=True and strict=True. References:
https://github.com/SysCV/sam-hq and https://huggingface.co/lkeab/hq-sam

`tools/evaluate_semantic_repairs.py` tests LaMa using automatically grounded
rectangles intersected with eroded learned skin masks. The context variant
removes the forehead line and saliva in 1809 in visual review. It changes 11778
pixels across two faces and zero pixels outside the permitted masks. The other
two detected faces remain unchanged. Output comparison:
`test-results/original-1809-context-repairs/before-after.png`.
These are broad rectangles, not precise defect boundaries; healthy skin texture
inside them can change. Numerical mask containment is not semantic preservation.
BiSeNet has no explicit beard class. This is encouraging reconstruction evidence,
not a finished one-click tool, and it is not integrated into the production UI.

Next diagnostic: `tools/evaluate_candidate_semantics.py` checks every learned
detector proposal with face context and an enlarged local crop, including tiny
proposals. Its classifications are an audit, not permission to remove regions.
No image is sent to an external service by these scripts.

### Candidate-context audit result

Completed all proposals without selecting only favorable examples:

| Photograph | Detected faces | Proposals | Classified temporary material |
| --- | ---: | ---: | ---: |
| 321A1809 | 4 | 6 | 2 |
| 321A5078 | 7 | 18 | 0 |
| 321A4934 | 2 | 8 | 0 |

This is model output, not measured accuracy. In 1809, different fragments of the
same forehead line receive contradictory temporary/permanent interpretations.
The droplet is recognized as saliva. In 5078, enlarged crops still produce
unsupported hair/permanent-mark explanations. In 4934, the model calls two
lighting regions temporary in its boolean while categorizing them as lighting.
One similar category/boolean contradiction occurs in 1809. Raw responses are
preserved under each `original-*-candidate-semantics` directory. The diagnostic
now explicitly flags contradictory fields; no classification authorizes repair.
There is not enough evidence to promote this combination to the one-click tool.

### Dedicated vendor alternatives researched, not tested

Retouch4me Heal offers a Windows demo and a documented Cloud API with a Heal-only
task and optional layers. Cloud execution requires a verified account token.
The desktop product license is not evidence of redistribution/SDK permission.
No installer executed, account created, credits purchased, vendor contacted or
user image uploaded. Primary documentation:
https://retouch4.me/heal
https://retouch4.me/docs/cloud_retouching_api/en/

EyeQ offers a native Windows/Desktop SDK for licensed integration. Its August
2026 update announces AI Blemish Removal in Playground. This does not establish
that this specific new model is available in the native SDK; confirm that and
integration pricing before choosing it. Vendor quality claims have not been
validated on our photographs. Primary sources:
https://perfectlyclear.ai/perfectly-clear-sdks/
https://perfectlyclear.ai/perfectly-clear-technology-updates/
