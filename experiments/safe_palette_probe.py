"""Safe two-stage colour transfer for one before/after pair.

Stage 1 uses the white-balance result measured by warm_cool_probe.
Stage 2 learns a small set of real colour anchors from the aligned pair and
interpolates smoothly between them. It is intentionally less expressive than a
3D LUT: unseen colours fall back to identity, low-chroma colours are protected,
and the detected person is largely preserved.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ENGINE = os.path.join(ROOT, "engine")
if ENGINE not in sys.path:
    sys.path.insert(0, ENGINE)

import common
import compare
import globals_py
import masks as masks_mod

from explog import log


WORK_MAX = 900
CLUSTERS = 18
MAX_SAMPLES = 120_000
MAX_ANCHOR_DELTA = 42.0
RBF_SIGMA = 18.0
TEMPERATURE = -30.0
EXPOSURE = 2.5


def resize_fit(rgb, cap=WORK_MAX):
    height, width = rgb.shape[:2]
    scale = min(1.0, cap / max(height, width))
    if scale == 1.0:
        return rgb
    return cv2.resize(
        rgb,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def base_grade(rgb):
    output, _ = globals_py.tone_color(
        rgb,
        {"temperature": TEMPERATURE, "exposure": EXPOSURE},
    )
    return output


def lab_float(rgb):
    return cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)


def features(lab):
    # Colour drives the clusters. Luminance only distinguishes a dark green
    # from a bright green and is deliberately down-weighted.
    return np.stack(
        [
            (lab[..., 0] - 128.0) * 0.28,
            lab[..., 1] - 128.0,
            lab[..., 2] - 128.0,
        ],
        axis=-1,
    )


def subject_mask(rgb):
    masks_mod.set_source(rgb)
    try:
        return masks_mod.get_mask(rgb, "subject").astype(np.float32)
    except Exception:
        return np.zeros(rgb.shape[:2], dtype=np.float32)
    finally:
        masks_mod.clear_source()


def cap_vectors(vectors, limit):
    length = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors * np.minimum(1.0, limit / np.maximum(length, 1e-6))


def fit_palette(before, after):
    corrected = base_grade(before)
    source_lab = lab_float(corrected)
    target_lab = lab_float(after)
    source_features = features(source_lab)

    person = subject_mask(before)
    chroma = np.hypot(source_lab[..., 1] - 128.0, source_lab[..., 2] - 128.0)

    height, width = before.shape[:2]
    rim = max(4, round(min(height, width) * 0.03))
    valid = np.ones((height, width), dtype=bool)
    valid[:rim] = False
    valid[-rim:] = False
    valid[:, :rim] = False
    valid[:, -rim:] = False
    valid &= person < 0.25
    valid &= chroma > 7.0

    positions = np.flatnonzero(valid.reshape(-1))
    rng = np.random.default_rng(5208)
    if len(positions) > MAX_SAMPLES:
        positions = rng.choice(positions, MAX_SAMPLES, replace=False)

    flat_features = source_features.reshape(-1, 3)[positions].astype(np.float32)
    flat_delta = (target_lab - source_lab).reshape(-1, 3)[positions]

    criteria = (
        cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER,
        80,
        0.05,
    )
    _, labels, centers = cv2.kmeans(
        flat_features,
        CLUSTERS,
        None,
        criteria,
        8,
        cv2.KMEANS_PP_CENTERS,
    )
    labels = labels.reshape(-1)

    anchors = []
    deltas = []
    confidences = []
    for index in range(CLUSTERS):
        selected = labels == index
        count = int(selected.sum())
        values = flat_delta[selected]
        median = np.median(values, axis=0)
        residual = np.linalg.norm(values - median, axis=1)
        spread = float(np.median(residual))
        confidence = float(np.clip(1.0 - spread / 22.0, 0.12, 1.0))
        support = float(np.clip(count / 2500.0, 0.2, 1.0))
        anchors.append(centers[index])
        deltas.append(median)
        confidences.append(confidence * support)

    anchors = np.asarray(anchors, dtype=np.float32)
    deltas = cap_vectors(np.asarray(deltas, dtype=np.float32), MAX_ANCHOR_DELTA)
    confidences = np.asarray(confidences, dtype=np.float32)

    model = {
        "anchors": anchors,
        "deltas": deltas,
        "confidences": confidences,
    }
    report = {
        "clusters": CLUSTERS,
        "samples": int(len(positions)),
        "temperature": TEMPERATURE,
        "exposure": EXPOSURE,
        "maxAnchorDelta": MAX_ANCHOR_DELTA,
        "anchors": [
            {
                "feature": [round(float(value), 3) for value in anchors[index]],
                "labDelta": [round(float(value), 3) for value in deltas[index]],
                "confidence": round(float(confidences[index]), 3),
            }
            for index in range(CLUSTERS)
        ],
    }
    return model, report


def apply_palette(
    rgb,
    model,
    protect_person=True,
    person=None,
    strength=1.0,
    rbf_sigma=RBF_SIGMA,
    tile_rows=256,
):
    corrected = base_grade(rgb)
    source_lab = lab_float(corrected)
    source_features = features(source_lab)
    if person is None:
        person = (
            subject_mask(rgb)
            if protect_person
            else np.zeros(rgb.shape[:2], np.float32)
        )

    height, width = rgb.shape[:2]
    output_lab = source_lab.copy()
    anchors = model["anchors"]
    anchor_delta = model["deltas"]
    anchor_confidence = model["confidences"]

    for y0 in range(0, height, tile_rows):
        y1 = min(height, y0 + tile_rows)
        values = source_features[y0:y1].reshape(-1, 3)
        distance2 = ((values[:, None, :] - anchors[None, :, :]) ** 2).sum(axis=2)
        nearest_distance = np.sqrt(distance2.min(axis=1))

        weights = np.exp(-distance2 / (2.0 * rbf_sigma * rbf_sigma))
        weights *= anchor_confidence[None, :]
        total = weights.sum(axis=1, keepdims=True)
        delta = weights @ anchor_delta / np.maximum(total, 1e-6)

        # Do not extrapolate into colours the reference pair never showed.
        familiarity = np.clip(1.0 - nearest_distance / 34.0, 0.0, 1.0)

        tile_lab = source_lab[y0:y1]
        chroma = np.hypot(
            tile_lab[..., 1] - 128.0,
            tile_lab[..., 2] - 128.0,
        ).reshape(-1)
        chroma_gate = np.clip((chroma - 5.0) / 13.0, 0.0, 1.0)

        # Preserve the person almost entirely. A later, dedicated subject pass
        # can learn skin without letting background colour statistics vote on it.
        region_gate = 1.0 - 0.92 * person[y0:y1].reshape(-1)
        amount = familiarity * chroma_gate * region_gate
        delta *= amount[:, None] * float(strength)

        values_out = tile_lab.reshape(-1, 3) + delta
        output_lab[y0:y1] = np.clip(values_out, 0, 255).reshape(
            y1 - y0, width, 3
        )

    return cv2.cvtColor(output_lab.astype(np.uint8), cv2.COLOR_LAB2RGB)


def look_error(rgb, target, person=None):
    def look(image):
        return cv2.GaussianBlur(lab_float(image), (0, 0), 2.0)

    delta = np.sqrt(((look(rgb) - look(target)) ** 2).sum(axis=2))
    if person is None or not (person > 0.5).any():
        return float(delta.mean())
    selected = person > 0.5
    return float(0.5 * delta[selected].mean() + 0.5 * delta[~selected].mean())


def choose_transfer(before, after, model, person):
    target_lab = lab_float(after)
    target_chroma95 = float(
        np.percentile(
            np.hypot(target_lab[..., 1] - 128.0, target_lab[..., 2] - 128.0),
            95,
        )
    )
    trials = []
    best = None
    for sigma in (7.0, 10.0, 14.0, 18.0):
        for strength in (0.75, 1.0, 1.35, 1.7, 2.1, 2.5):
            output = apply_palette(
                before,
                model,
                person=person,
                strength=strength,
                rbf_sigma=sigma,
            )
            error = look_error(output, after, person)
            output_lab = lab_float(output)
            chroma95 = float(
                np.percentile(
                    np.hypot(
                        output_lab[..., 1] - 128.0,
                        output_lab[..., 2] - 128.0,
                    ),
                    95,
                )
            )
            # Reject neon solutions rather than letting a lower mean error hide
            # them. The target itself defines the permitted colour envelope.
            safe = chroma95 <= target_chroma95 + 5.0
            trial = {
                "sigma": sigma,
                "strength": strength,
                "lookDeltaE": round(error, 4),
                "chroma95": round(chroma95, 3),
                "safe": bool(safe),
            }
            trials.append(trial)
            if safe and (best is None or error < best[0]):
                best = (error, strength, sigma, output)
    if best is None:
        safe_trials = sorted(trials, key=lambda trial: trial["chroma95"])
        fallback = safe_trials[0]
        output = apply_palette(
            before,
            model,
            person=person,
            strength=fallback["strength"],
            rbf_sigma=fallback["sigma"],
        )
        best = (
            look_error(output, after, person),
            fallback["strength"],
            fallback["sigma"],
            output,
        )
    return best, trials


def fit_luma_curve(source, target):
    source_l = lab_float(source)[..., 0].astype(np.uint8).reshape(-1)
    target_l = lab_float(target)[..., 0].reshape(-1)
    curve = np.full(256, np.nan, dtype=np.float32)
    for level in range(256):
        selected = source_l == level
        if selected.sum() >= 40:
            curve[level] = np.median(target_l[selected])
    known = np.isfinite(curve)
    if known.sum() < 8:
        return np.arange(256, dtype=np.float32)
    levels = np.arange(256)
    curve = np.interp(levels, levels[known], curve[known]).astype(np.float32)
    curve = cv2.GaussianBlur(curve.reshape(-1, 1), (0, 0), 2.2).reshape(-1)
    curve = np.maximum.accumulate(curve)
    identity = levels.astype(np.float32)
    return np.clip(identity + np.clip(curve - identity, -38.0, 38.0), 0, 255)


def apply_luma_curve(rgb, curve, strength=1.0):
    lab = lab_float(rgb)
    source_l = lab[..., 0].astype(np.uint8)
    mapped = curve[source_l]
    lab[..., 0] = np.clip(
        lab[..., 0] + (mapped - lab[..., 0]) * float(strength),
        0,
        255,
    )
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)


def choose_luma_curve(source, target, curve, person):
    trials = []
    best = None
    for strength in (0.35, 0.55, 0.75, 1.0, 1.2):
        output = apply_luma_curve(source, curve, strength)
        error = look_error(output, target, person)
        trials.append(
            {
                "strength": strength,
                "lookDeltaE": round(error, 4),
            }
        )
        if best is None or error < best[0]:
            best = (error, strength, output)
    return best, trials


def make_reference_sheet(before, base, output, after, destination):
    labels = ("SOURCE", "TEMP BASE", "SAFE PALETTE", "TARGET")
    images = (before, base, output, after)
    width = 720
    tiles = []
    for image in images:
        tile = common.to_pil(image).convert("RGB")
        tile = tile.resize(
            (width, round(tile.height * width / tile.width)),
            Image.Resampling.LANCZOS,
        )
        tiles.append(tile)
    height = tiles[0].height
    label_height = 40
    sheet = Image.new("RGB", (width * 2, (height + label_height) * 2), "#f4f4f4")
    draw = ImageDraw.Draw(sheet)
    for index, (label, image) in enumerate(zip(labels, tiles)):
        column = index % 2
        row = index // 2
        x = column * width
        y = row * (height + label_height)
        draw.text((x + 14, y + 13), label, fill="black")
        sheet.paste(image, (x, y + label_height))
    sheet.save(destination, quality=95, subsampling=0)


def make_batch_sheet(rows, destination):
    width = 620
    image_height = 414
    label_height = 34
    sheet = Image.new(
        "RGB",
        (width * 2, (image_height + label_height) * len(rows)),
        "#f4f4f4",
    )
    draw = ImageDraw.Draw(sheet)
    for row, (source_path, output_path) in enumerate(rows):
        for column, (path, label) in enumerate(
            ((source_path, "SOURCE"), (output_path, "SAFE PALETTE"))
        ):
            image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
            image.thumbnail((width, image_height), Image.Resampling.LANCZOS)
            x = column * width + (width - image.width) // 2
            y0 = row * (image_height + label_height)
            y = y0 + label_height + (image_height - image.height) // 2
            sheet.paste(image, (x, y))
            draw.text(
                (column * width + 12, y0 + 10),
                f"{label} - {source_path.name}",
                fill="black",
            )
    sheet.save(destination, quality=92, subsampling=0)


def serializable_model(model):
    return {key: value.tolist() for key, value in model.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--folder")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    output_dir = Path(args.out)
    output_dir.mkdir(parents=True, exist_ok=True)

    before = resize_fit(common.to_np(common.load_image(args.before)))
    after = resize_fit(common.to_np(common.load_image(args.after)))
    after, geometry = compare.align(before, after)

    started = time.time()
    model, report = fit_palette(before, after)
    base = base_grade(before)
    reference_person = subject_mask(before)
    selected, trials = choose_transfer(before, after, model, reference_person)
    _, selected_strength, selected_sigma, colour_learned = selected
    luma_curve = fit_luma_curve(colour_learned, after)
    luma_selected, luma_trials = choose_luma_curve(
        colour_learned,
        after,
        luma_curve,
        reference_person,
    )
    _, luma_strength, learned = luma_selected
    model["lumaCurve"] = luma_curve

    baseline_error = look_error(before, after, reference_person)
    base_error = look_error(base, after, reference_person)
    learned_error = look_error(learned, after, reference_person)
    report.update(
        {
            "geometry": geometry,
            "baselineLookDeltaE": round(baseline_error, 4),
            "baseLookDeltaE": round(base_error, 4),
            "learnedLookDeltaE": round(learned_error, 4),
            "baseGapClosed": round(1.0 - base_error / baseline_error, 4),
            "learnedGapClosed": round(1.0 - learned_error / baseline_error, 4),
            "selectedStrength": selected_strength,
            "selectedSigma": selected_sigma,
            "selectionTrials": trials,
            "lumaStrength": luma_strength,
            "lumaTrials": luma_trials,
            "fitSeconds": round(time.time() - started, 2),
        }
    )

    with open(output_dir / "safe-palette-model.json", "w", encoding="utf-8") as stream:
        json.dump(
            {"model": serializable_model(model), "report": report},
            stream,
            ensure_ascii=False,
            indent=2,
        )
    make_reference_sheet(
        before,
        base,
        learned,
        after,
        output_dir / "safe-palette-reference.jpg",
    )

    rows = []
    if args.folder:
        batch_dir = output_dir / "batch"
        batch_dir.mkdir(exist_ok=True)
        source_dir = Path(args.folder)
        files = sorted(
            path
            for path in source_dir.iterdir()
            if path.suffix.lower()
            in {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
            and "(1)" not in path.stem
        )
        for index, path in enumerate(files, 1):
            print(f"[{index}/{len(files)}] {path.name}", flush=True)
            image = common.load_image(str(path))
            rgb = common.to_np(image)
            palette_output = apply_palette(
                rgb,
                model,
                strength=selected_strength,
                rbf_sigma=selected_sigma,
            )
            output = common.to_pil(
                apply_luma_curve(palette_output, luma_curve, luma_strength)
            )
            destination = batch_dir / f"{path.stem}-safe-palette.jpg"
            output.save(
                destination,
                format="JPEG",
                quality=97,
                subsampling=0,
                optimize=True,
                progressive=True,
                icc_profile=image.info.get("icc_profile"),
            )
            rows.append((path, destination))
        make_batch_sheet(rows, output_dir / "safe-palette-batch.jpg")

    log(
        "safe-palette",
        {
            "clusters": CLUSTERS,
            "temperature": TEMPERATURE,
            "exposure": EXPOSURE,
            "maxDelta": MAX_ANCHOR_DELTA,
        },
        {
            "baseClosed": report["baseGapClosed"] * 100,
            "paletteClosed": report["learnedGapClosed"] * 100,
        },
        pair=os.path.basename(args.before),
        note="temperature base plus protected colour-anchor transfer",
        artifacts=[
            str(output_dir / "safe-palette-reference.jpg"),
            str(output_dir / "safe-palette-batch.jpg"),
        ],
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
