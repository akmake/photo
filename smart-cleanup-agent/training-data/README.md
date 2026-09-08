# Face defect training data

Each JSONL record represents one complete removable defect instance, not a
collection of unrelated bright pixels.

Required files per record:

- `image`: full-resolution face crop.
- `mask`: exact binary mask for one complete defect.
- `protected_mask`: pixels that must never be cleaned (eyes, lashes, brows,
  lips, nostrils, ears, hair, and non-face areas).
- `defect_type`: blemish, wound/scab, scratch, dirt, food, saliva/mucus, or other.
- `source`: `real_annotated` or `synthetic_bootstrap`.
- `split`: train, validation, or test. The same person/session must not cross splits.

Synthetic examples only bootstrap the mask decoder. Production approval
requires a held-out test set of real, manually corrected pixel masks.
