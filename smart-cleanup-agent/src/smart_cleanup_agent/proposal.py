from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

from .contracts import Box, Problem, ProblemKind


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    if not intersection:
        return 0.0
    return intersection / float((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection)


class PixelAnomalyProposer:
    """Model-independent, full-frame candidate proposal for local anomalies."""

    def __init__(self, max_side: int = 1600, max_candidates: int = 48) -> None:
        self.max_side = max_side
        self.max_candidates = max_candidates

    def propose(self, image: Image.Image) -> list[Problem]:
        rgb = np.asarray(image.convert("RGB"))
        height, width = rgb.shape[:2]
        scale = min(1.0, self.max_side / max(width, height))
        if scale < 1:
            work = cv2.resize(rgb, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        else:
            work = rgb

        lab = cv2.cvtColor(work, cv2.COLOR_RGB2LAB).astype(np.float32)
        luminance = lab[..., 0]
        local = cv2.GaussianBlur(luminance, (0, 0), 7.0)
        broad = cv2.GaussianBlur(luminance, (0, 0), 18.0)
        luminance_residual = np.maximum(np.abs(luminance - local), np.abs(local - broad))
        chroma = lab[..., 1:]
        chroma_background = cv2.GaussianBlur(chroma, (0, 0), 12.0)
        chroma_residual = np.linalg.norm(chroma - chroma_background, axis=2) * 0.7
        score = np.maximum(luminance_residual, chroma_residual)
        # Compact dark/bright marks can disappear into a Gaussian field. A
        # morphological black/top-hat keeps them visible even on soft bokeh.
        gray_u8 = np.clip(luminance, 0, 255).astype(np.uint8)
        spot_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
        dark_spots = cv2.morphologyEx(gray_u8, cv2.MORPH_BLACKHAT, spot_kernel)
        bright_spots = cv2.morphologyEx(gray_u8, cv2.MORPH_TOPHAT, spot_kernel)
        spot_score = np.maximum(dark_spots, bright_spots).astype(np.float32)
        score = np.maximum(score, spot_score)

        median = float(np.median(score))
        mad = float(np.median(np.abs(score - median))) + 1e-4
        threshold = max(median + 7.0 * mad, float(np.quantile(score, 0.995)), 14.0)
        strong = score >= threshold
        spot_strong = np.zeros_like(strong, dtype=bool)
        tile_size = 128
        for top in range(0, spot_score.shape[0], tile_size):
            for left in range(0, spot_score.shape[1], tile_size):
                tile = spot_score[top : top + tile_size, left : left + tile_size]
                tile_median = float(np.median(tile))
                tile_mad = float(np.median(np.abs(tile - tile_median))) + 1e-4
                tile_threshold = max(8.0, tile_median + 6.0 * tile_mad)
                spot_strong[top : top + tile_size, left : left + tile_size] = tile >= tile_threshold
        strong |= spot_strong
        weak_threshold = max(median + 3.5 * mad, threshold * 0.42, 7.0)
        binary = (score >= weak_threshold).astype(np.uint8)
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

        count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        frame_area = work.shape[0] * work.shape[1]
        ranked: list[tuple[float, tuple[int, int, int, int], int]] = []
        for index in range(1, count):
            x, y, box_width, box_height, area = map(int, stats[index])
            if area < 8 or area > frame_area * 0.025:
                continue
            member = labels == index
            if not np.any(strong[member]):
                continue
            component_scores = score[member]
            strength = float(np.quantile(component_scores, 0.9))
            density = area / max(1, box_width * box_height)
            rank = strength * (0.65 + min(0.35, density))
            pad = max(3, round(max(box_width, box_height) * 0.12))
            ranked.append((rank, (
                max(0, x - pad), max(0, y - pad),
                min(work.shape[1], x + box_width + pad),
                min(work.shape[0], y + box_height + pad),
            ), area))

        spot_binary = spot_strong.astype(np.uint8)
        spot_binary = cv2.morphologyEx(
            spot_binary, cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
        )
        spot_count, spot_labels, spot_stats, _ = cv2.connectedComponentsWithStats(spot_binary, 8)
        for index in range(1, spot_count):
            x, y, box_width, box_height, area = map(int, spot_stats[index])
            if area < 8 or area > frame_area * 0.01:
                continue
            member_scores = spot_score[spot_labels == index]
            strength = float(np.quantile(member_scores, 0.9))
            pad = max(3, round(max(box_width, box_height) * 0.18))
            ranked.append((strength, (
                max(0, x - pad), max(0, y - pad),
                min(work.shape[1], x + box_width + pad),
                min(work.shape[0], y + box_height + pad),
            ), area))

        chosen: list[tuple[float, tuple[int, int, int, int], int]] = []
        for candidate in sorted(ranked, reverse=True):
            if any(_iou(candidate[1], existing[1]) > 0.35 for existing in chosen):
                continue
            chosen.append(candidate)
            if len(chosen) >= self.max_candidates:
                break

        inverse = 1.0 / scale
        problems: list[Problem] = []
        for index, (rank, (x1, y1, x2, y2), area) in enumerate(chosen, 1):
            confidence = float(np.clip((rank - threshold) / max(20.0, threshold) + 0.45, 0.35, 0.92))
            problems.append(Problem(
                id=f"pixel-{index}",
                kind=ProblemKind.OTHER,
                label="local visual anomaly",
                description="Pixel-level proposal awaiting semantic verification",
                box=Box(
                    x1=max(0, round(x1 * inverse)), y1=max(0, round(y1 * inverse)),
                    x2=min(width, round(x2 * inverse)), y2=min(height, round(y2 * inverse)),
                ),
                confidence=confidence,
                severity=float(np.clip(area / max(64.0, frame_area * 0.002), 0.05, 1.0)),
                safe_to_auto_fix=False,
                preserve_warning="Candidate is not auto-fixable until semantic verification",
                repair_strategy="manual_review",
            ))
        return problems
