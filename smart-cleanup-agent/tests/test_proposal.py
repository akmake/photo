import numpy as np
from PIL import Image, ImageDraw

from smart_cleanup_agent.proposal import PixelAnomalyProposer


def test_pixel_proposer_finds_sharp_spot_and_line():
    image = Image.fromarray(np.full((512, 512, 3), 150, dtype=np.uint8))
    draw = ImageDraw.Draw(image)
    draw.ellipse((80, 90, 118, 128), fill=(15, 15, 15))
    draw.line((250, 180, 410, 390), fill=(245, 245, 245), width=9)

    proposals = PixelAnomalyProposer(max_side=512).propose(image)

    assert len(proposals) >= 2
    assert any(p.box.x1 <= 99 <= p.box.x2 and p.box.y1 <= 109 <= p.box.y2 for p in proposals)
    assert any(p.box.x1 <= 330 <= p.box.x2 and p.box.y1 <= 285 <= p.box.y2 for p in proposals)
