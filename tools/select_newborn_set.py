"""Select a compact newborn story from a large local shoot.

The source folder is read-only. The tool asks TEZA's local engine for visual
fingerprints and measured image facts, then writes previews and an audit report
to a separate output folder. Closed eyes and intentional profile poses are not
rejections in newborn mode.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ENGINE = "http://127.0.0.1:8756"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
NEWBORN_HARD_REASONS = {
    "frame-blown", "frame-dark", "frame-soft", "face-soft", "blown", "crushed",
}


def natural_key(path: Path):
    return [int(part) if part.isdigit() else part.casefold()
            for part in re.split(r"(\d+)", path.name)]


def post(route: str, payload: dict, timeout: int = 3600) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{ENGINE}{route}", data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"{route}: engine {error.code}: {detail}") from error


def chunks(items: list[str], size: int):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def newborn_score(data: dict) -> float:
    quality = float(data.get("qualityScore") or 0)
    sharpness = float(data.get("sharpnessScore") or 0)
    exposure = float(data.get("exposure") or 0.5)
    exposure_score = max(0.0, 1.0 - abs(exposure - 0.55) / 0.55)
    clipping = float(data.get("blownFraction") or 0) + float(data.get("crushedFraction") or 0)
    face_bonus = 0.025 if data.get("faces") else 0.0
    # Eyes closed are often the subject of a newborn portrait. A turned head is
    # also frequently intentional, so neither field votes against the frame.
    return 0.58 * quality + 0.27 * sharpness + 0.15 * exposure_score + face_bonus - 0.18 * clipping


def newborn_eligible(data: dict) -> bool:
    codes = {reason.get("code") for reason in data.get("reasons", [])}
    return not bool(codes & NEWBORN_HARD_REASONS)


def representative_candidates(judged: list[dict], duplicate_groups: list[list[str]]) -> list[dict]:
    by_path = {item["path"]: item for item in judged}
    member_to_group: dict[str, int] = {}
    for index, group in enumerate(duplicate_groups):
        for path in group:
            member_to_group[path] = index

    groups: dict[str, list[dict]] = {}
    for item in judged:
        group_index = member_to_group.get(item["path"])
        key = f"duplicate-{group_index}" if group_index is not None else item["path"]
        groups.setdefault(key, []).append(item)

    representatives = []
    for group in groups.values():
        eligible = [item for item in group if newborn_eligible(item["data"])]
        pool = eligible or group
        best = max(pool, key=lambda item: newborn_score(item["data"]))
        representatives.append({
            **best,
            "score": newborn_score(best["data"]),
            "eligible": newborn_eligible(best["data"]),
            "duplicateAlternates": [item["path"] for item in group if item["path"] != best["path"]],
        })
    return representatives


def assign_sessions(candidates: list[dict], moments: list[list[str]]) -> list[list[dict]]:
    by_path = {item["path"]: item for item in candidates}
    session_by_path = {
        path: index for index, moment in enumerate(moments) for path in moment
    }
    labels = [session_by_path.get(item["path"]) for item in candidates]
    previous = None
    for index, label in enumerate(labels):
        if label is not None:
            previous = label
        elif previous is not None:
            labels[index] = previous
    following = None
    for index in range(len(labels) - 1, -1, -1):
        if labels[index] is not None:
            following = labels[index]
        elif following is not None:
            labels[index] = following

    sessions: list[list[dict]] = []
    active = object()
    for item, label in zip(candidates, labels):
        if not sessions or label != active:
            sessions.append([])
            active = label
        sessions[-1].append(item)
    return [session for session in sessions if session]


def allocate(total: int, sessions: list[list[dict]]) -> list[int]:
    if not sessions:
        return []
    if len(sessions) >= total:
        winners = sorted(
            range(len(sessions)),
            key=lambda index: max(item["score"] for item in sessions[index]),
            reverse=True,
        )[:total]
        return [1 if index in winners else 0 for index in range(len(sessions))]

    allocation = [1] * len(sessions)
    remaining = total - len(sessions)
    weights = [math.sqrt(len(session)) for session in sessions]
    source_total = sum(len(session) for session in sessions)
    # A tiny detail run deserves a beat in the story, not every variation it
    # contains. Cap each chapter near its proportional share, with a little
    # editorial headroom for short but important transitions.
    caps = [
        min(len(session), max(1, math.ceil(total * len(session) / source_total + 0.5)))
        for session in sessions
    ]
    while remaining:
        choices = [
            index for index, session in enumerate(sessions)
            if allocation[index] < caps[index]
        ]
        # Rounding can make the soft caps add up below the requested count. In
        # that case keep filling by weight; exact target size wins over the cap.
        if not choices:
            choices = [
                index for index, session in enumerate(sessions)
                if allocation[index] < len(session)
            ]
        if not choices:
            break
        index = max(choices, key=lambda i: weights[i] / (allocation[i] + 0.65))
        allocation[index] += 1
        remaining -= 1
    return allocation


def diverse_take(session: list[dict], count: int) -> list[dict]:
    chosen: list[dict] = []
    remaining = list(session)
    while remaining and len(chosen) < count:
        scales = Counter(item["data"].get("shotScale") for item in chosen)
        orientations = Counter(
            "landscape" if item["data"]["widthPx"] > item["data"]["heightPx"] else "portrait"
            for item in chosen
        )

        def adjusted(item: dict) -> float:
            data = item["data"]
            scale = data.get("shotScale")
            orientation = "landscape" if data["widthPx"] > data["heightPx"] else "portrait"
            novelty = (0.035 if not scales[scale] else 0) + (0.018 if not orientations[orientation] else 0)
            if chosen:
                nearest = min(abs(float(data.get("shotTime") or 0) - float(other["data"].get("shotTime") or 0))
                              for other in chosen)
                novelty += min(0.025, nearest / 2400.0)
            return item["score"] + novelty

        winner = max(remaining, key=adjusted)
        chosen.append(winner)
        remaining.remove(winner)
    return chosen


def make_preview(source: Path, destination: Path, width: int = 1600) -> None:
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        if image.width > width:
            height = max(1, round(image.height * width / image.width))
            image = image.resize((width, height), Image.Resampling.LANCZOS)
        image.save(destination, "JPEG", quality=90, optimize=True)


def make_contact_sheet(selected: list[dict], output: Path) -> None:
    columns, cell_w, cell_h, label_h = 5, 320, 230, 28
    rows = math.ceil(len(selected) / columns)
    sheet = Image.new("RGB", (columns * cell_w, rows * (cell_h + label_h)), "#eee9e2")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, item in enumerate(selected):
        row, column = divmod(index, columns)
        x, y = column * cell_w, row * (cell_h + label_h)
        with Image.open(item["path"]) as source:
            source = ImageOps.exif_transpose(source).convert("RGB")
            tile = ImageOps.fit(source, (cell_w - 8, cell_h - 8), method=Image.Resampling.LANCZOS)
        sheet.paste(tile, (x + 4, y + 4))
        label = f'{index + 1:02d}  {Path(item["path"]).name}  S{item["session"]}'
        draw.text((x + 7, y + cell_h + 5), label, fill="#28231f", font=font)
    sheet.save(output, "JPEG", quality=92, optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--count", type=int, default=40)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    files = sorted(
        [path for path in args.folder.rglob("*") if path.is_file() and path.suffix.casefold() in IMAGE_EXTENSIONS],
        key=natural_key,
    )
    if len(files) < args.count:
        raise SystemExit(f"Only {len(files)} images found; cannot select {args.count}")
    paths = [str(path.resolve()) for path in files]
    print(f"FOUND {len(paths)} images", flush=True)

    embedded = 0
    failed_embed = 0
    for chunk in chunks(paths, 8):
        result = post("/album/embed", {"paths": chunk})
        embedded += len(result.get("results", []))
        failed_embed += sum(1 for item in result.get("results", []) if not item.get("ok"))
        print(f"EMBED {embedded}/{len(paths)} failed={failed_embed}", flush=True)

    duplicates = post("/album/dedup", {"paths": paths})
    print(f'DEDUP groups={len(duplicates.get("groups", []))} duplicateFrames={duplicates.get("duplicateFrames", 0)}', flush=True)

    judged: list[dict] = []
    failed_cull = 0
    processed = 0
    for chunk in chunks(paths, 3):
        result = post("/album/cull", {"paths": chunk})
        for item in result.get("results", []):
            processed += 1
            if item.get("ok") and item.get("data"):
                judged.append({"path": item["path"], "data": item["data"]})
            else:
                failed_cull += 1
        print(f"CULL {processed}/{len(paths)} failed={failed_cull}", flush=True)

    candidates = representative_candidates(judged, duplicates.get("groups", []))
    eligible = [item for item in candidates if item["eligible"]]
    fallback = sorted(
        [item for item in candidates if not item["eligible"]],
        key=lambda item: item["score"], reverse=True,
    )
    story_pool = eligible if len(eligible) >= args.count else eligible + fallback
    story_pool.sort(key=lambda item: float(item["data"].get("shotTime") or 0))

    moments_result = post("/album/moments", {
        "paths": [item["path"] for item in story_pool],
        "times": [item["data"].get("shotTime") for item in story_pool],
    })
    sessions = assign_sessions(story_pool, moments_result.get("moments", []))
    allocations = allocate(args.count, sessions)
    selected: list[dict] = []
    for session_index, (session, amount) in enumerate(zip(sessions, allocations), start=1):
        for item in diverse_take(session, amount):
            selected.append({**item, "session": session_index})
    selected.sort(key=lambda item: float(item["data"].get("shotTime") or 0))
    selected_paths = {item["path"] for item in selected}
    alternates = sorted(
        [item for item in story_pool if item["path"] not in selected_paths],
        key=lambda item: item["score"], reverse=True,
    )[:12]

    args.output.mkdir(parents=True, exist_ok=True)
    previews = args.output / "selected-previews"
    previews.mkdir(exist_ok=True)
    for index, item in enumerate(selected, start=1):
        make_preview(Path(item["path"]), previews / f"{index:02d}-{Path(item['path']).stem}.jpg")
        print(f"PREVIEW {index}/{len(selected)}", flush=True)

    make_contact_sheet(selected, args.output / "contact-sheet.jpg")
    with (args.output / "selection.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "order", "session", "file", "sourcePath", "score", "quality", "sharpness",
            "shotScale", "eyesClosed", "eligible", "duplicateAlternates",
        ])
        writer.writeheader()
        for index, item in enumerate(selected, start=1):
            data = item["data"]
            writer.writerow({
                "order": index,
                "session": item["session"],
                "file": Path(item["path"]).name,
                "sourcePath": item["path"],
                "score": round(item["score"], 4),
                "quality": data.get("qualityScore"),
                "sharpness": data.get("sharpnessScore"),
                "shotScale": data.get("shotScale"),
                "eyesClosed": any(face.get("eyesShut") for face in data.get("faceDetail", [])),
                "eligible": item["eligible"],
                "duplicateAlternates": len(item["duplicateAlternates"]),
            })

    manifest = {
        "mode": "newborn",
        "sourceFolder": str(args.folder.resolve()),
        "sourceCount": len(paths),
        "selectedCount": len(selected),
        "alternateCount": len(alternates),
        "sessionCount": len([amount for amount in allocations if amount]),
        "sessionCandidates": [len(session) for session in sessions],
        "sessionSelections": allocations,
        "duplicateGroups": len(duplicates.get("groups", [])),
        "duplicateFrames": duplicates.get("duplicateFrames", 0),
        "failedEmbed": failed_embed,
        "failedAnalysis": failed_cull,
        "newbornPolicy": {
            "closedEyesAllowed": True,
            "profileAllowed": True,
            "hardReasons": sorted(NEWBORN_HARD_REASONS),
        },
        "selected": [{
            "path": item["path"], "session": item["session"],
            "score": round(item["score"], 6), "data": item["data"],
            "duplicateAlternates": item["duplicateAlternates"],
        } for item in selected],
        "alternates": [{"path": item["path"], "score": round(item["score"], 6)} for item in alternates],
    }
    (args.output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(f"DONE selected={len(selected)} sessions={manifest['sessionCount']} output={args.output.resolve()}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
