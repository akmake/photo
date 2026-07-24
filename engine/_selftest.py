"""Offline self-test: verifies smoothing reduces skin-region noise."""

import io
import base64
import numpy as np
from PIL import Image

import skin


def make_noisy_skin(w=400, h=400):
    base = np.zeros((h, w, 3), dtype=np.float32)
    base[..., 0] = 200  # R
    base[..., 1] = 150  # G
    base[..., 2] = 130  # B  -> a skin-like tone
    noise = np.random.normal(0, 22, (h, w, 3))
    img = np.clip(base + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(img)


def to_b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


if __name__ == "__main__":
    img = make_noisy_skin()
    before = np.asarray(img).astype(np.float32)
    mask = skin.skin_mask(img)
    out_b64, coverage = skin.process(to_b64(img), 80)
    after = np.asarray(skin.b64_to_image(out_b64)).astype(np.float32)

    # local variance proxy: std of (pixel - 3x3-ish blurred) inside skin region
    def detail_std(a):
        blurred = np.asarray(
            Image.fromarray(a.astype(np.uint8)).resize((100, 100)).resize((400, 400))
        ).astype(np.float32)
        return float((np.abs(a - blurred).mean()))

    print(f"skin coverage: {coverage*100:.1f}%")
    print(f"detail(before): {detail_std(before):.2f}")
    print(f"detail(after):  {detail_std(after):.2f}")
    print("PASS" if detail_std(after) < detail_std(before) else "FAIL")
