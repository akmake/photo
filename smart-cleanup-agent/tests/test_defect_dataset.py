import numpy as np

from smart_cleanup_agent.defect_dataset import mask_box


def test_mask_box_covers_complete_instance():
    mask = np.zeros((30, 40), dtype=np.uint8)
    mask[7:18, 9:27] = 255
    assert mask_box(mask) == [9, 7, 27, 18]
