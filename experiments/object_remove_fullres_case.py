"""Full-resolution evidence harness for one object-removal photograph.

It keeps the source untouched and writes two comparable results:
1. the product's current MobileSAM -> LaMa path;
2. reference-assisted reconstruction, when a clean full-resolution reference
   of the same moment exists.

The reference is aligned geometrically to the source.  Only the selected
object mask is allowed to change the source photograph.
"""

from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

import object_remove  # noqa: E402
import pixel_color  # noqa: E402


def read_rgb(path: Path) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Could not read {path}")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def write_jpeg(path: Path, rgb: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(
        str(path),
        cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR),
        [cv2.IMWRITE_JPEG_QUALITY, 97],
    )


def decode_mask(data_url: str, shape: tuple[int, int, int]) -> np.ndarray:
    raw = base64.b64decode(data_url.split(",", 1)[1])
    mask = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
    h, w = shape[:2]
    return cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)


def align_reference(reference: np.ndarray, source: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict]:
    """Project reference pixels into source coordinates using scene features."""
    h, w = source.shape[:2]
    scale = min(1.0, 1400.0 / max(h, w))
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    src_small = cv2.resize(source, size, interpolation=cv2.INTER_AREA)
    ref_small = cv2.resize(reference, size, interpolation=cv2.INTER_AREA)
    src_gray = cv2.cvtColor(src_small, cv2.COLOR_RGB2GRAY)
    ref_gray = cv2.cvtColor(ref_small, cv2.COLOR_RGB2GRAY)

    orb = cv2.ORB_create(7000)
    kp_ref, des_ref = orb.detectAndCompute(ref_gray, None)
    kp_src, des_src = orb.detectAndCompute(src_gray, None)
    if des_ref is None or des_src is None:
        raise RuntimeError("Not enough features to align the reference")
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(des_ref, des_src, k=2)
    good = [a for a, b in pairs if a.distance < 0.74 * b.distance]
    if len(good) < 30:
        raise RuntimeError(f"Only {len(good)} reliable alignment matches")
    p_ref = np.float32([kp_ref[m.queryIdx].pt for m in good])
    p_src = np.float32([kp_src[m.trainIdx].pt for m in good])
    h_small, inliers = cv2.findHomography(p_ref, p_src, cv2.RANSAC, 2.0)
    if h_small is None or inliers is None:
        raise RuntimeError("Reference alignment failed")

    down = np.diag([scale, scale, 1.0])
    up = np.diag([1.0 / scale, 1.0 / scale, 1.0])
    homography = up @ h_small @ down
    aligned = cv2.warpPerspective(
        reference,
        homography,
        (w, h),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT,
    )
    valid = cv2.warpPerspective(
        np.full(reference.shape[:2], 255, np.uint8),
        homography,
        (w, h),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
    )
    meta = {
        "matches": len(good),
        "inliers": int(inliers.sum()),
        "inlierRatio": round(float(inliers.mean()), 4),
    }
    return aligned, valid, meta


def reference_fill(source: np.ndarray, aligned: np.ndarray, valid: np.ndarray,
                   mask: np.ndarray) -> np.ndarray:
    """Poisson-blend aligned real pixels through exactly the repair mask."""
    usable = ((mask > 0) & (valid > 0)).astype(np.uint8) * 255
    ys, xs = np.where(usable > 0)
    if not len(xs):
        raise RuntimeError("The aligned reference does not cover the selection")
    pad = max(24, round(source.shape[1] * 0.006))
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(source.shape[1], int(xs.max()) + pad + 1)
    y1 = min(source.shape[0], int(ys.max()) + pad + 1)
    src_patch = cv2.cvtColor(aligned[y0:y1, x0:x1], cv2.COLOR_RGB2BGR)
    dst = cv2.cvtColor(source, cv2.COLOR_RGB2BGR)
    patch_mask = usable[y0:y1, x0:x1]
    center = ((x0 + x1) // 2, (y0 + y1) // 2)
    blended = cv2.seamlessClone(src_patch, dst, patch_mask, center, cv2.NORMAL_CLONE)
    return cv2.cvtColor(blended, cv2.COLOR_BGR2RGB)


def colour_match_reference(source: np.ndarray, aligned: np.ndarray,
                           valid: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Undo the reference grade from corresponding clean pixels near the edit."""
    h, w = mask.shape
    ys, xs = np.where(mask > 0)
    pad = round(w * 0.09)
    x0, x1 = max(0, int(xs.min()) - pad), min(w, int(xs.max()) + pad + 1)
    y0, y1 = max(0, int(ys.min()) - pad), min(h, int(ys.max()) + pad + 1)
    region = np.zeros_like(mask, np.uint8)
    region[y0:y1, x0:x1] = 1
    excluded = cv2.dilate((mask > 0).astype(np.uint8),
                          cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (121, 121)))
    gray_s = cv2.cvtColor(source, cv2.COLOR_RGB2GRAY)
    gray_r = cv2.cvtColor(aligned, cv2.COLOR_RGB2GRAY)
    grad_s = cv2.magnitude(cv2.Sobel(gray_s, cv2.CV_32F, 1, 0),
                           cv2.Sobel(gray_s, cv2.CV_32F, 0, 1))
    grad_r = cv2.magnitude(cv2.Sobel(gray_r, cv2.CV_32F, 1, 0),
                           cv2.Sobel(gray_r, cv2.CV_32F, 0, 1))
    usable = (region > 0) & (excluded == 0) & (valid > 0) & (grad_s < 35) & (grad_r < 35)
    yy, xx = np.where(usable)
    if len(xx) < 5000:
        raise RuntimeError(f"Only {len(xx)} clean pixels for reference colour matching")
    stride = max(1, len(xx) // 160_000)
    xx, yy = xx[::stride], yy[::stride]
    # Work in Lab and fit each axis independently.  A cross-channel RGB
    # polynomial looked accurate on common foliage but extrapolated a pale
    # yellow tail into magenta.  Independent Lab curves cannot invent a hue
    # rotation outside the evidence and are the safer photographic transform.
    src_lab = cv2.cvtColor(source, cv2.COLOR_RGB2LAB).astype(np.float32)
    ref_lab = cv2.cvtColor(aligned, cv2.COLOR_RGB2LAB).astype(np.float32)
    corrected = ref_lab.copy()
    for channel in range(3):
        x = ref_lab[yy, xx, channel]
        y = src_lab[yy, xx, channel]
        keep = np.ones(len(x), bool)
        slope, intercept = 1.0, 0.0
        for percentile in (84, 74, 70):
            design = np.column_stack((x[keep], np.ones(int(keep.sum()), np.float32)))
            (slope, intercept), *_ = np.linalg.lstsq(design, y[keep], rcond=None)
            error = np.abs(x * slope + intercept - y)
            keep = error <= np.percentile(error, percentile)
        corrected[..., channel] = ref_lab[..., channel] * slope + intercept
    corrected = np.clip(np.rint(corrected), 0, 255).astype(np.uint8)
    return cv2.cvtColor(corrected, cv2.COLOR_LAB2RGB)


def feathered_reference_fill(source: np.ndarray, corrected: np.ndarray,
                             valid: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Keep native reference detail; feather only the selection boundary."""
    alpha = ((mask > 0) & (valid > 0)).astype(np.float32)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 2.2)
    alpha = np.clip(alpha[..., None], 0.0, 1.0)
    out = source.astype(np.float32) * (1.0 - alpha) + corrected.astype(np.float32) * alpha
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def lab_axis_match(source: np.ndarray, aligned: np.ndarray,
                   sample_mask: np.ndarray) -> np.ndarray:
    """Fit a conservative material-specific Lab transform."""
    src_lab = cv2.cvtColor(source, cv2.COLOR_RGB2LAB).astype(np.float32)
    ref_lab = cv2.cvtColor(aligned, cv2.COLOR_RGB2LAB).astype(np.float32)
    yy, xx = np.where(sample_mask > 0)
    if len(xx) < 5000:
        raise RuntimeError(f"Only {len(xx)} pixels for material colour matching")
    stride = max(1, len(xx) // 180_000)
    yy, xx = yy[::stride], xx[::stride]
    corrected = ref_lab.copy()
    for channel in range(3):
        x = ref_lab[yy, xx, channel]
        y = src_lab[yy, xx, channel]
        keep = np.ones(len(x), bool)
        slope, intercept = 1.0, 0.0
        for percentile in (86, 78, 72):
            design = np.column_stack((x[keep], np.ones(int(keep.sum()), np.float32)))
            (slope, intercept), *_ = np.linalg.lstsq(design, y[keep], rcond=None)
            error = np.abs(x * slope + intercept - y)
            keep = error <= np.percentile(error, percentile)
        corrected[..., channel] = ref_lab[..., channel] * slope + intercept
    corrected = np.clip(np.rint(corrected), 0, 255).astype(np.uint8)
    return cv2.cvtColor(corrected, cv2.COLOR_LAB2RGB)


def structured_reference_fill(source: np.ndarray, aligned: np.ndarray,
                              valid: np.ndarray, person_mask: np.ndarray,
                              background_matched: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Treat horse and background separately so no seam crosses the horse."""
    horse_pick = object_remove.select(aligned, 0.40, 0.55)
    horse_mask = decode_mask(horse_pick["maskPng"], source.shape)
    horse_mask = ((horse_mask > 0) & (valid > 0)).astype(np.uint8)

    # Learn the horse grade only from the horse pixels that were already visible
    # in the source; the person's silhouette is excluded with a broad guard.
    person_guard = cv2.dilate((person_mask > 0).astype(np.uint8),
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (161, 161)))
    horse_core = cv2.erode(horse_mask,
                           cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    gray_s = cv2.cvtColor(source, cv2.COLOR_RGB2GRAY)
    gray_r = cv2.cvtColor(aligned, cv2.COLOR_RGB2GRAY)
    grad_s = cv2.magnitude(cv2.Sobel(gray_s, cv2.CV_32F, 1, 0),
                           cv2.Sobel(gray_s, cv2.CV_32F, 0, 1))
    grad_r = cv2.magnitude(cv2.Sobel(gray_r, cv2.CV_32F, 1, 0),
                           cv2.Sobel(gray_r, cv2.CV_32F, 0, 1))
    samples = horse_core & (person_guard == 0) & (grad_s < 45) & (grad_r < 45)
    horse_matched = lab_axis_match(source, aligned, samples)

    # First restore only the non-horse part of the removed silhouette.
    horse_guard = cv2.dilate(horse_mask,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    background_hole = ((person_mask > 0) & (horse_guard == 0)).astype(np.uint8)
    output = feathered_reference_fill(source, background_matched, valid, background_hole)

    # Then lay the complete horse as one coherent object.  The boundary follows
    # its real silhouette, never a rectangular or person-shaped cut through fur.
    alpha = cv2.GaussianBlur(horse_mask.astype(np.float32), (0, 0), 1.25)[..., None]
    output = output.astype(np.float32) * (1.0 - alpha) + horse_matched.astype(np.float32) * alpha
    return np.clip(np.rint(output), 0, 255).astype(np.uint8), horse_mask


def preview(path: Path, images: list[tuple[str, np.ndarray]], mask: np.ndarray) -> None:
    panels = []
    for label, rgb in images:
        shown = rgb.copy()
        if label == "mask":
            shown[mask > 0] = (0.55 * shown[mask > 0] + 0.45 * np.array([40, 125, 255])).astype(np.uint8)
        shown = cv2.resize(shown, (900, 600), interpolation=cv2.INTER_AREA)
        cv2.putText(shown, label, (24, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.1,
                    (255, 255, 255), 3, cv2.LINE_AA)
        panels.append(shown)
    sheet = np.hstack(panels)
    write_jpeg(path, sheet)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--x", type=float, required=True)
    parser.add_argument("--y", type=float, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = read_rgb(args.source)
    args.output.mkdir(parents=True, exist_ok=True)
    selected = object_remove.select(source, args.x, args.y)
    selection = {"maskPng": selected["maskPng"], "margin": selected["margin"]}
    mask = object_remove.repair_mask(source.shape, selection)
    cv2.imwrite(str(args.output / "selection-mask.png"), mask * 255)

    current, meta = object_remove.apply(source, {"objectSelection": selection})
    write_jpeg(args.output / "current-lama-full.jpg", current)

    images = [("source", source), ("mask", source), ("current LaMa", current)]
    report = {"selection": {k: selected[k] for k in ("coverage", "score", "margin", "selectedIndex")},
              "current": meta, "sourceSize": [source.shape[1], source.shape[0]]}
    if args.reference:
        reference = read_rgb(args.reference)
        aligned, valid, alignment = align_reference(reference, source)
        write_jpeg(args.output / "reference-aligned-full.jpg", aligned)
        assisted = reference_fill(source, aligned, valid, mask)
        write_jpeg(args.output / "reference-assisted-full.jpg", assisted)
        corrected = colour_match_reference(source, aligned, valid, mask)
        write_jpeg(args.output / "reference-colour-matched-full.jpg", corrected)
        feathered = feathered_reference_fill(source, corrected, valid, mask)
        write_jpeg(args.output / "reference-feathered-full.jpg", feathered)
        # The product's fitted colour model is slower but materially safer for
        # mixed materials (white coat, cream tail, green foliage, brown soil)
        # than one local affine transform.  Fit it in the reverse direction so
        # the edited reference returns to the untouched source grade.
        colour_model, colour_report, _ = pixel_color.fit(aligned, source)
        product_matched, colour_apply = pixel_color.apply(aligned, colour_model)
        write_jpeg(args.output / "reference-product-colour-full.jpg", product_matched)
        product_fill = feathered_reference_fill(source, product_matched, valid, mask)
        write_jpeg(args.output / "reference-product-fill-full.jpg", product_fill)
        structured, horse_mask = structured_reference_fill(
            source, aligned, valid, mask, corrected,
        )
        write_jpeg(args.output / "reference-structured-full.jpg", structured)
        cv2.imwrite(str(args.output / "horse-mask.png"), horse_mask * 255)
        images.append(("real reference", structured))
        report["alignment"] = alignment
        report["colourFit"] = colour_report
        report["colourApply"] = colour_apply

    preview(args.output / "comparison-preview.jpg", images, mask)
    print(report)


if __name__ == "__main__":
    main()
