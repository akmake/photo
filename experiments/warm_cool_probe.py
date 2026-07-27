"""Side experiment: can a clean warm/cool axis explain a before/after edit?

This intentionally does not touch the production recipe fitter. It measures
three nested models:

    temperature
    temperature + exposure
    temperature + exposure + tint

If the simple model closes most of the gap, white balance is a good first
stage. If it does not, later stages must explain the remaining look without
forcing white balance to compensate for them.
"""

import argparse
import json
import os
import sys
from itertools import product

import cv2
import numpy as np
from PIL import Image, ImageDraw


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ENGINE = os.path.join(ROOT, "engine")
if ENGINE not in sys.path:
    sys.path.insert(0, ENGINE)

import common
import compare
import globals_py

from explog import log


WORK_MAX = 720
LOOK_SIGMA = 2.0


def fit_size(rgb):
    height, width = rgb.shape[:2]
    scale = min(1.0, WORK_MAX / max(height, width))
    if scale == 1.0:
        return rgb
    return cv2.resize(
        rgb,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def look_lab(rgb):
    lab = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    return cv2.GaussianBlur(lab, (0, 0), LOOK_SIGMA)


def score(rgb, target_lab, valid):
    delta = np.sqrt(((look_lab(rgb) - target_lab) ** 2).sum(axis=2))
    return float(delta[valid].mean())


def render(before, params):
    output, _ = globals_py.tone_color(before, params)
    return output


def search_axis(before, target_lab, valid, base, key, values):
    best_params = dict(base)
    best_image = render(before, best_params)
    best_score = score(best_image, target_lab, valid)
    curve = []
    for value in values:
        params = dict(base)
        params[key] = float(value)
        image = render(before, params)
        value_score = score(image, target_lab, valid)
        curve.append({"value": round(float(value), 3), "error": round(value_score, 4)})
        if value_score < best_score:
            best_params = params
            best_image = image
            best_score = value_score
    return best_params, best_image, best_score, curve


def coordinate_search(before, target_lab, valid, initial, axes, rounds=4):
    params = dict(initial)
    image = render(before, params)
    best_score = score(image, target_lab, valid)
    for _ in range(rounds):
        improved = False
        for key, values in axes:
            candidate_params, candidate_image, candidate_score, _ = search_axis(
                before, target_lab, valid, params, key, values
            )
            if candidate_score < best_score - 1e-5:
                params = candidate_params
                image = candidate_image
                best_score = candidate_score
                improved = True
        if not improved:
            break
    return params, image, best_score


def nested_fit(before, after):
    after, geometry = compare.align(before, after)

    # Alignment fills borders by replication. Excluding a thin rim prevents
    # those invented pixels from voting on white balance.
    height, width = before.shape[:2]
    rim = max(3, round(min(height, width) * 0.025))
    valid = np.ones((height, width), dtype=bool)
    valid[:rim] = False
    valid[-rim:] = False
    valid[:, :rim] = False
    valid[:, -rim:] = False

    target_lab = look_lab(after)
    baseline = score(before, target_lab, valid)

    temperature_values = np.linspace(-100, 100, 81)
    exposure_values = np.linspace(-60, 60, 49)
    tint_values = np.linspace(-100, 100, 81)

    temp_params, temp_image, temp_error, temp_curve = search_axis(
        before, target_lab, valid, {}, "temperature", temperature_values
    )

    temp_exp_params, temp_exp_image, temp_exp_error = coordinate_search(
        before,
        target_lab,
        valid,
        temp_params,
        (
            ("temperature", temperature_values),
            ("exposure", exposure_values),
        ),
    )

    full_params, full_image, full_error = coordinate_search(
        before,
        target_lab,
        valid,
        temp_exp_params,
        (
            ("temperature", temperature_values),
            ("exposure", exposure_values),
            ("tint", tint_values),
        ),
    )

    def result(params, error):
        return {
            "params": {key: round(float(value), 2) for key, value in params.items()},
            "lookDeltaE": round(float(error), 4),
            "gapClosed": round(max(0.0, 1.0 - error / max(baseline, 1e-6)), 4),
        }

    report = {
        "baselineLookDeltaE": round(baseline, 4),
        "temperatureOnly": result(temp_params, temp_error),
        "temperatureExposure": result(temp_exp_params, temp_exp_error),
        "temperatureExposureTint": result(full_params, full_error),
        "temperatureCurve": temp_curve,
        "geometry": geometry,
        "workSize": [width, height],
    }
    images = {
        "before": before,
        "after": after,
        "temperature": temp_image,
        "temperatureExposure": temp_exp_image,
        "full": full_image,
    }
    return report, images


def tile(rgb, width=720):
    image = common.to_pil(rgb).convert("RGB")
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def comparison_sheet(report, images, destination):
    entries = [
        ("SOURCE", images["before"]),
        ("TARGET", images["after"]),
        (
            f"TEMP {report['temperatureOnly']['params'].get('temperature', 0):+.1f}"
            f" | closed {report['temperatureOnly']['gapClosed'] * 100:.1f}%",
            images["temperature"],
        ),
        (
            "TEMP + EXP"
            f" | closed {report['temperatureExposure']['gapClosed'] * 100:.1f}%",
            images["temperatureExposure"],
        ),
        (
            "TEMP + EXP + TINT"
            f" | closed {report['temperatureExposureTint']['gapClosed'] * 100:.1f}%",
            images["full"],
        ),
    ]
    tiles = [(label, tile(rgb)) for label, rgb in entries]
    width = tiles[0][1].width
    height = tiles[0][1].height
    label_height = 40
    sheet = Image.new("RGB", (width * 2, (height + label_height) * 3), "#f3f3f3")
    draw = ImageDraw.Draw(sheet)
    for index, (label, image) in enumerate(tiles):
        column = index % 2
        row = index // 2
        x = column * width
        y = row * (height + label_height)
        draw.text((x + 14, y + 13), label, fill="black")
        sheet.paste(image, (x, y + label_height))
    sheet.save(destination, quality=95, subsampling=0)


def arc_sheet(before, after, report, destination):
    best_exposure = report["temperatureExposure"]["params"].get("exposure", 0)
    temperatures = (-100, -67, -33, 0, 33, 67, 100)
    width = 430
    before_tiles = []
    for temperature in temperatures:
        image = render(
            before,
            {"temperature": temperature, "exposure": best_exposure},
        )
        before_tiles.append((temperature, tile(image, width)))
    target = tile(after, width)
    height = target.height
    label_height = 36
    sheet = Image.new(
        "RGB",
        (width * 4, (height + label_height) * 2),
        "#f3f3f3",
    )
    draw = ImageDraw.Draw(sheet)
    for index, (temperature, image) in enumerate(before_tiles):
        column = index % 4
        row = index // 4
        x = column * width
        y = row * (height + label_height)
        draw.text((x + 12, y + 11), f"TEMPERATURE {temperature:+d}", fill="black")
        sheet.paste(image, (x, y + label_height))
    x = 3 * width
    y = height + label_height
    draw.text((x + 12, y + 11), "TARGET", fill="black")
    sheet.paste(target, (x, y + label_height))
    sheet.save(destination, quality=94, subsampling=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    before = fit_size(common.to_np(common.load_image(args.before)))
    after = fit_size(common.to_np(common.load_image(args.after)))

    report, images = nested_fit(before, after)
    report_path = os.path.join(args.out, "warm-cool-report.json")
    comparison_path = os.path.join(args.out, "warm-cool-comparison.jpg")
    arc_path = os.path.join(args.out, "warm-cool-arc.jpg")

    with open(report_path, "w", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    comparison_sheet(report, images, comparison_path)
    arc_sheet(images["before"], images["after"], report, arc_path)

    log(
        "warm-cool",
        {"axes": ["temperature", "exposure", "tint"], "workMax": WORK_MAX},
        {
            "temperatureClosed": report["temperatureOnly"]["gapClosed"] * 100,
            "temperatureExposureClosed": report["temperatureExposure"]["gapClosed"] * 100,
            "fullClosed": report["temperatureExposureTint"]["gapClosed"] * 100,
        },
        pair=os.path.basename(args.before),
        note="isolated white-balance probe",
        artifacts=[comparison_path, arc_path, report_path],
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
