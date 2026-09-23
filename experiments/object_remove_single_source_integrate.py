"""Integrate a single-source generative reconstruction into the full file.

The generated image is derived only from a native-resolution crop of the same
source photograph.  It supplies missing semantic structure; every pixel outside
the selected person's mask remains from the original 5472x3648 source.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

import object_remove  # noqa: E402


def read_rgb(path: Path) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Could not read {path}")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def write_jpeg(path: Path, rgb: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, 97])


def align_generated(generated: np.ndarray, crop: np.ndarray,
                    changed: np.ndarray) -> tuple[np.ndarray, dict]:
    """Align the edited crop back to the source using unchanged scene detail."""
    h, w = crop.shape[:2]
    generated = cv2.resize(generated, (w, h), interpolation=cv2.INTER_LANCZOS4)
    scale = min(1.0, 1500.0 / max(h, w))
    size = (round(w * scale), round(h * scale))
    src = cv2.resize(crop, size, interpolation=cv2.INTER_AREA)
    gen = cv2.resize(generated, size, interpolation=cv2.INTER_AREA)
    blocked = cv2.resize((changed > 0).astype(np.uint8), size,
                         interpolation=cv2.INTER_NEAREST)
    allowed = (blocked == 0).astype(np.uint8) * 255
    allowed = cv2.erode(allowed, np.ones((13, 13), np.uint8))
    gray_src = cv2.cvtColor(src, cv2.COLOR_RGB2GRAY)
    gray_gen = cv2.cvtColor(gen, cv2.COLOR_RGB2GRAY)
    orb = cv2.ORB_create(9000)
    kp_g, des_g = orb.detectAndCompute(gray_gen, allowed)
    kp_s, des_s = orb.detectAndCompute(gray_src, allowed)
    if des_g is None or des_s is None:
        raise RuntimeError("Not enough unchanged detail to align generated crop")
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(des_g, des_s, k=2)
    good = [a for a, b in pairs if a.distance < 0.72 * b.distance]
    p_g = np.float32([kp_g[m.queryIdx].pt for m in good])
    p_s = np.float32([kp_s[m.trainIdx].pt for m in good])
    h_small, inliers = cv2.findHomography(p_g, p_s, cv2.RANSAC, 2.0)
    if h_small is None or inliers is None or int(inliers.sum()) < 40:
        raise RuntimeError(f"Generated alignment failed ({len(good)} matches)")
    down = np.diag([scale, scale, 1.0])
    up = np.diag([1.0 / scale, 1.0 / scale, 1.0])
    homography = up @ h_small @ down
    aligned = cv2.warpPerspective(generated, homography, (w, h),
                                  flags=cv2.INTER_LANCZOS4,
                                  borderMode=cv2.BORDER_REFLECT)
    return aligned, {
        "matches": len(good),
        "inliers": int(inliers.sum()),
        "inlierRatio": round(float(inliers.mean()), 4),
    }


def match_colour(source: np.ndarray, generated: np.ndarray,
                 changed: np.ndarray) -> np.ndarray:
    """Remove small grade drift using corresponding clean pixels near the mask."""
    guard = cv2.dilate((changed > 0).astype(np.uint8),
                       cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (141, 141)))
    gray_s = cv2.cvtColor(source, cv2.COLOR_RGB2GRAY)
    gray_g = cv2.cvtColor(generated, cv2.COLOR_RGB2GRAY)
    grad_s = cv2.magnitude(cv2.Sobel(gray_s, cv2.CV_32F, 1, 0),
                           cv2.Sobel(gray_s, cv2.CV_32F, 0, 1))
    grad_g = cv2.magnitude(cv2.Sobel(gray_g, cv2.CV_32F, 1, 0),
                           cv2.Sobel(gray_g, cv2.CV_32F, 0, 1))
    sample = (guard == 0) & (grad_s < 30) & (grad_g < 30)
    yy, xx = np.where(sample)
    stride = max(1, len(xx) // 160_000)
    yy, xx = yy[::stride], xx[::stride]
    src_lab = cv2.cvtColor(source, cv2.COLOR_RGB2LAB).astype(np.float32)
    gen_lab = cv2.cvtColor(generated, cv2.COLOR_RGB2LAB).astype(np.float32)
    output = gen_lab.copy()
    for channel in range(3):
        x = gen_lab[yy, xx, channel]
        y = src_lab[yy, xx, channel]
        keep = np.ones(len(x), bool)
        slope, intercept = 1.0, 0.0
        for percentile in (86, 78, 72):
            design = np.column_stack((x[keep], np.ones(int(keep.sum()), np.float32)))
            (slope, intercept), *_ = np.linalg.lstsq(design, y[keep], rcond=None)
            error = np.abs(x * slope + intercept - y)
            keep = error <= np.percentile(error, percentile)
        output[..., channel] = gen_lab[..., channel] * slope + intercept
    output = np.clip(np.rint(output), 0, 255).astype(np.uint8)
    return cv2.cvtColor(output, cv2.COLOR_LAB2RGB)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("generated", type=Path)
    parser.add_argument("--crop", nargs=4, type=int, required=True,
                        metavar=("X0", "Y0", "X1", "Y1"))
    parser.add_argument("--x", type=float, required=True)
    parser.add_argument("--y", type=float, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = read_rgb(args.source)
    generated = read_rgb(args.generated)
    x0, y0, x1, y1 = args.crop
    crop = source[y0:y1, x0:x1]
    selected = object_remove.select(source, args.x, args.y)
    selection = {"maskPng": selected["maskPng"], "margin": selected["margin"]}
    full_mask = object_remove.repair_mask(source.shape, selection)
    crop_mask = full_mask[y0:y1, x0:x1]

    aligned, alignment = align_generated(generated, crop, crop_mask)
    matched = match_colour(crop, aligned, crop_mask)
    alpha = cv2.GaussianBlur(crop_mask.astype(np.float32), (0, 0), 2.0)[..., None]
    rebuilt_crop = crop.astype(np.float32) * (1.0 - alpha) + matched.astype(np.float32) * alpha
    rebuilt_crop = np.clip(np.rint(rebuilt_crop), 0, 255).astype(np.uint8)

    # The generated source is lower resolution than the native crop. Restore
    # camera-scale microcontrast without reintroducing the removed person.
    blurred = cv2.GaussianBlur(rebuilt_crop, (0, 0), 0.75)
    detail = rebuilt_crop.astype(np.float32) - blurred.astype(np.float32)
    sharpened = np.clip(rebuilt_crop.astype(np.float32) + detail * 0.35, 0, 255)
    rebuilt_crop = np.clip(
        rebuilt_crop.astype(np.float32) * (1.0 - alpha) + sharpened * alpha,
        0, 255,
    ).astype(np.uint8)

    # Gaussian tails approach zero but never become exactly zero. Snap every
    # pixel outside the declared edit support back to the source byte-for-byte.
    edit_support = alpha[..., 0] > 1e-5
    rebuilt_crop[~edit_support] = crop[~edit_support]

    result = source.copy()
    result[y0:y1, x0:x1] = rebuilt_crop
    args.output.mkdir(parents=True, exist_ok=True)
    write_jpeg(args.output / "single-source-full.jpg", result)
    cv2.imwrite(
        str(args.output / "single-source-full.png"),
        cv2.cvtColor(result, cv2.COLOR_RGB2BGR),
        [cv2.IMWRITE_PNG_COMPRESSION, 3],
    )
    write_jpeg(args.output / "generated-aligned-crop.jpg", aligned)
    write_jpeg(args.output / "single-source-native-crop.jpg", rebuilt_crop)
    cv2.imwrite(str(args.output / "person-mask.png"), full_mask * 255)
    changed_guard = np.zeros(full_mask.shape, np.uint8)
    changed_guard[y0:y1, x0:x1] = edit_support.astype(np.uint8)
    untouched = changed_guard == 0
    outside_delta = np.abs(result.astype(np.int16) - source.astype(np.int16))[untouched]
    print({
        "sourceSize": [source.shape[1], source.shape[0]],
        "generatedSize": [generated.shape[1], generated.shape[0]],
        "nativeCropSize": [crop.shape[1], crop.shape[0]],
        "selectionCoverage": selected["coverage"],
        "alignment": alignment,
        "maxChangeOutsideEdit": int(outside_delta.max()) if outside_delta.size else 0,
    })


if __name__ == "__main__":
    main()
