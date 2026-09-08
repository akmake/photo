import numpy as np
from PIL import Image

from smart_cleanup_agent.contracts import Diagnosis
from smart_cleanup_agent.restore import IndependentRestorer


def _diagnosis(mask_path: str, *, safe: bool) -> Diagnosis:
    return Diagnosis.model_validate({
        "width": 96,
        "height": 96,
        "summary": "synthetic dirt",
        "model": "test",
        "problems": [{
            "id": "p1",
            "kind": "surface_dirt",
            "label": "dirt",
            "description": "synthetic dark spot",
            "box": {"x1": 40, "y1": 40, "x2": 56, "y2": 56},
            "confidence": 1,
            "severity": 0.5,
            "safe_to_auto_fix": safe,
            "preserve_warning": None,
            "repair_strategy": "texture_inpaint",
            "mask_path": mask_path,
        }],
    })


def test_restorer_obeys_safe_to_auto_fix(tmp_path):
    pixels = np.full((96, 96, 3), 220, dtype=np.uint8)
    pixels[42:54, 42:54] = 10
    image = Image.fromarray(pixels)
    mask = np.zeros((96, 96), dtype=np.uint8)
    mask[40:56, 40:56] = 255
    mask_path = tmp_path / "mask.png"
    Image.fromarray(mask).save(mask_path)

    restorer = IndependentRestorer()
    untouched = np.asarray(restorer.restore(image, _diagnosis(str(mask_path), safe=False)))
    repaired = np.asarray(restorer.restore(image, _diagnosis(str(mask_path), safe=True)))

    assert np.array_equal(untouched, pixels)
    assert not np.array_equal(repaired, pixels)

