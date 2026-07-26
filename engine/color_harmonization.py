"""Direct, local colour matching for repaired skin.

This module does one job: make a reconstructed patch meet the untouched skin
with the colour that the *local* healthy skin predicts.  It deliberately does
not detect blemishes and it does not synthesize texture.

The pipeline is component based:

1. trace an outward normal from every repair-boundary pixel;
2. skip suspicious pixels until a run of confirmed healthy skin is found;
3. extrapolate that local healthy colour profile back to the repair boundary;
4. use the measured boundary mismatch as Dirichlet constraints;
5. harmonically extend the additive Lab correction through the repair and its
   individually measured halo;
6. recombine corrected low-frequency colour with separately feathered texture.

The result is spatially varying.  The top, bottom and sides of a repair can all
receive different corrections; no component-wide colour average is used.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class HarmonizationConfig:
    """Independent controls for the local colour-matching stages."""

    enabled: bool = True
    strength: float = 1.0
    search_radius_ratio: float = 0.060
    healthy_confidence: float = 0.10
    healthy_run: int = 3
    sample_radius: int = 1
    minimum_coverage: float = 0.48
    boundary_smooth_radius: int = 2
    colour_sigma: float = 1.6
    texture_feather_ratio: float = 0.004
    edge_sigma: float = 8.0
    maximum_lightness_delta: float = 7.0
    maximum_chroma_delta: float = 5.0
    maximum_iterations: int = 320
    convergence: float = 0.002

    @classmethod
    def from_params(cls, params: dict) -> "HarmonizationConfig":
        """Build a config while keeping advanced controls optional.

        Public controls use the familiar 0..100 range.  Defaults are deliberately
        conservative; callers that only provide ``strength`` get the complete
        system without acquiring a second mandatory setting.
        """

        enabled = float(params.get("colorMatch", 100)) > 0
        strength = np.clip(float(params.get("colorMatch", 100)) / 100.0, 0.0, 1.0)
        search = np.clip(
            float(params.get("colorSearch", 60)) / 1000.0, 0.025, 0.10
        )
        healthy = np.clip(
            float(params.get("healthySkinStrictness", 70)) / 100.0, 0.0, 1.0
        )
        # Greater strictness means a lower accepted suspicion value and a
        # longer consecutive run before a sample is trusted.
        healthy_confidence = float(0.18 - healthy * 0.12)
        healthy_run = int(round(2 + healthy * 3))
        smooth = int(round(np.clip(
            float(params.get("boundaryStability", 50)) / 100.0, 0.0, 1.0
        ) * 4))
        texture = np.clip(
            float(params.get("textureTransition", 40)) / 10000.0,
            0.001,
            0.009,
        )
        return cls(
            enabled=enabled,
            strength=float(strength),
            search_radius_ratio=float(search),
            healthy_confidence=healthy_confidence,
            healthy_run=healthy_run,
            boundary_smooth_radius=smooth,
            texture_feather_ratio=float(texture),
        )


@dataclass
class BoundaryMatch:
    """A direct correspondence from a repair-boundary pixel to healthy skin."""

    contour_index: int
    point: tuple[int, int]
    donor: tuple[int, int]
    donor_distance: float
    target_lab: np.ndarray
    delta_lab: np.ndarray
    confidence: float
    path: list[tuple[int, int]]


@dataclass
class HarmonizationResult:
    image: np.ndarray
    tone_mask: np.ndarray
    correction_lab: np.ndarray
    metadata: dict


def _lab_float(rgb: np.ndarray) -> np.ndarray:
    source = rgb.astype(np.float32) / 255.0
    return cv2.cvtColor(source, cv2.COLOR_RGB2LAB)


def _rgb_u8(lab: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_LAB2RGB)
    return np.clip(np.rint(rgb * 255.0), 0, 255).astype(np.uint8)


def _binary(mask: np.ndarray) -> np.ndarray:
    if mask.ndim == 3:
        mask = mask.max(axis=2)
    return (mask > 0).astype(np.uint8)


def _odd(value: int) -> int:
    value = max(3, int(value))
    return value if value % 2 else value + 1


def _shift(array: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """Return values at (y + dy, x + dx), with zeros outside the image."""

    out = np.zeros_like(array)
    h, w = array.shape[:2]
    dst_y0, dst_y1 = max(0, -dy), min(h, h - dy)
    dst_x0, dst_x1 = max(0, -dx), min(w, w - dx)
    src_y0, src_y1 = dst_y0 + dy, dst_y1 + dy
    src_x0, src_x1 = dst_x0 + dx, dst_x1 + dx
    out[dst_y0:dst_y1, dst_x0:dst_x1] = array[
        src_y0:src_y1, src_x0:src_x1
    ]
    return out


def _boundary(component: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    contours, _ = cv2.findContours(
        component.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE
    )
    if not contours:
        return np.empty((0, 2), np.int32), np.zeros_like(component, np.uint8)
    contour = max(contours, key=cv2.contourArea)[:, 0, :]
    boundary = np.zeros_like(component, np.uint8)
    cv2.drawContours(boundary, [contour[:, None, :]], -1, 1, 1)
    return contour.astype(np.int32), boundary


def _outward_normal_field(component: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    soft = cv2.GaussianBlur(component.astype(np.float32), (5, 5), 0)
    gx = cv2.Sobel(soft, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(soft, cv2.CV_32F, 0, 1, ksize=3)
    # The mask rises from zero outside to one inside; negate its gradient.
    nx, ny = -gx, -gy
    norm = np.sqrt(nx * nx + ny * ny)
    return nx / np.maximum(norm, 1e-5), ny / np.maximum(norm, 1e-5)


def _patch_is_healthy(
    x: int,
    y: int,
    healthy: np.ndarray,
    radius: int,
) -> bool:
    h, w = healthy.shape
    x0, x1 = max(0, x - radius), min(w, x + radius + 1)
    y0, y1 = max(0, y - radius), min(h, y + radius + 1)
    patch = healthy[y0:y1, x0:x1]
    return patch.size > 0 and float(patch.mean()) >= 0.80


def _sample_healthy_lab(
    low_lab: np.ndarray,
    healthy: np.ndarray,
    x: int,
    y: int,
    radius: int,
) -> np.ndarray | None:
    h, w = healthy.shape
    x0, x1 = max(0, x - radius), min(w, x + radius + 1)
    y0, y1 = max(0, y - radius), min(h, y + radius + 1)
    selected = healthy[y0:y1, x0:x1] > 0
    if selected.sum() < max(2, selected.size // 2):
        return None
    return np.median(low_lab[y0:y1, x0:x1][selected], axis=0).astype(np.float32)


def _trace_boundary_match(
    contour_index: int,
    point: tuple[int, int],
    normal: tuple[float, float],
    original_low: np.ndarray,
    healed_low: np.ndarray,
    healthy: np.ndarray,
    max_radius: int,
    config: HarmonizationConfig,
) -> BoundaryMatch | None:
    px, py = point
    nx, ny = normal
    if not np.isfinite(nx + ny) or np.hypot(nx, ny) < 0.5:
        return None

    h, w = healthy.shape
    samples: list[tuple[float, int, int, np.ndarray]] = []
    run: list[tuple[int, int, int]] = []
    path: list[tuple[int, int]] = [(px, py)]
    seen: set[tuple[int, int]] = {(px, py)}

    for distance in range(1, max_radius + 1):
        x = int(round(px + nx * distance))
        y = int(round(py + ny * distance))
        if x < 0 or y < 0 or x >= w or y >= h:
            break
        if (x, y) not in seen:
            path.append((x, y))
            seen.add((x, y))

        if _patch_is_healthy(x, y, healthy, config.sample_radius):
            run.append((distance, x, y))
        else:
            run.clear()

        if len(run) < config.healthy_run:
            continue

        start_distance = run[0][0]
        # Continue a few pixels through healthy skin so a local slope can be
        # estimated instead of copying a single noisy sample.
        for extra in range(0, config.healthy_run + 3):
            d = start_distance + extra
            sx = int(round(px + nx * d))
            sy = int(round(py + ny * d))
            if sx < 0 or sy < 0 or sx >= w or sy >= h:
                break
            if not _patch_is_healthy(sx, sy, healthy, config.sample_radius):
                continue
            value = _sample_healthy_lab(
                original_low, healthy, sx, sy, config.sample_radius
            )
            if value is not None:
                samples.append((float(d), sx, sy, value))
        break

    if len(samples) < config.healthy_run:
        return None

    distances = np.array([item[0] for item in samples], np.float32)
    colours = np.stack([item[3] for item in samples])
    first = colours[0]
    if len(samples) >= 3 and float(np.ptp(distances)) > 0:
        slopes = []
        for i in range(len(samples) - 1):
            dt = max(1.0, float(distances[i + 1] - distances[i]))
            slopes.append((colours[i + 1] - colours[i]) / dt)
        slope = np.median(np.stack(slopes), axis=0)
        slope = np.clip(slope, [-0.85, -0.45, -0.45], [0.85, 0.45, 0.45])
    else:
        slope = np.zeros(3, np.float32)

    # Extrapolate the locally observed healthy-skin profile back to the repair
    # boundary.  Limits prevent a long search from amplifying a small slope.
    extrapolation = np.clip(
        slope * distances[0],
        [-3.5, -2.0, -2.0],
        [3.5, 2.0, 2.0],
    )
    target = first - extrapolation
    residual = float(np.median(np.linalg.norm(colours - np.median(colours, axis=0), axis=1)))
    confidence = float(
        np.exp(-distances[0] / max(1.0, max_radius * 0.75))
        * np.exp(-residual / 2.5)
    )

    delta = target - healed_low[py, px]
    delta = np.clip(
        delta,
        [
            -config.maximum_lightness_delta,
            -config.maximum_chroma_delta,
            -config.maximum_chroma_delta,
        ],
        [
            config.maximum_lightness_delta,
            config.maximum_chroma_delta,
            config.maximum_chroma_delta,
        ],
    ).astype(np.float32)

    donor_distance, donor_x, donor_y, _ = samples[0]
    # The trace loop appends positions before testing them, so the first
    # healthy sample (and the complete confirming run) is already in `path`.
    # Rounded shallow normals can revisit a pixel; never infer distance from
    # path length, because that would fail to advance on those duplicates.

    return BoundaryMatch(
        contour_index=contour_index,
        point=(px, py),
        donor=(donor_x, donor_y),
        donor_distance=float(donor_distance),
        target_lab=target.astype(np.float32),
        delta_lab=delta,
        confidence=confidence,
        path=path,
    )


def _regularized_boundary_values(
    contour_length: int,
    matches: list[BoundaryMatch],
    radius: int,
) -> np.ndarray:
    """Interpolate missing correspondences, then smooth only along the contour."""

    indices = np.array([match.contour_index for match in matches], np.int32)
    values = np.stack([match.delta_lab for match in matches]).astype(np.float32)
    confidences = np.array([match.confidence for match in matches], np.float32)

    # Winsorise true outliers without replacing the local signal by one global
    # value. This removes a bad ray while preserving top/bottom differences.
    median = np.median(values, axis=0)
    mad = 1.4826 * np.median(np.abs(values - median), axis=0)
    span = np.maximum(mad * 3.5, [1.0, 0.7, 0.7])
    values = np.clip(values, median - span, median + span)

    order = np.argsort(indices)
    indices, values, confidences = indices[order], values[order], confidences[order]
    # Duplicate contour coordinates occasionally arise from raster contours.
    unique_indices, starts = np.unique(indices, return_index=True)
    values = values[starts]
    confidences = confidences[starts]

    full_index = np.arange(contour_length, dtype=np.float32)
    extended_index = np.concatenate(
        [unique_indices - contour_length, unique_indices, unique_indices + contour_length]
    )
    full = np.empty((contour_length, 3), np.float32)
    for channel in range(3):
        extended_values = np.tile(values[:, channel], 3)
        full[:, channel] = np.interp(full_index, extended_index, extended_values)

    if radius <= 0:
        return full
    smoothed = np.zeros_like(full)
    weights_sum = np.zeros((contour_length, 1), np.float32)
    for offset in range(-radius, radius + 1):
        weight = np.exp(-0.5 * (offset / max(1.0, radius * 0.65)) ** 2)
        smoothed += np.roll(full, offset, axis=0) * weight
        weights_sum += weight
    return smoothed / np.maximum(weights_sum, 1e-6)


def _harmonic_correction(
    domain: np.ndarray,
    inner_anchor: np.ndarray,
    inner_values: np.ndarray,
    guide_lab: np.ndarray,
    config: HarmonizationConfig,
) -> tuple[np.ndarray, int]:
    """Solve an edge-aware discrete Laplace problem by weighted Jacobi steps."""

    domain = domain.astype(bool)
    inner_anchor = inner_anchor.astype(bool)
    if not domain.any() or not inner_anchor.any():
        return np.zeros((*domain.shape, 3), np.float32), 0

    kernel = np.ones((3, 3), np.uint8)
    eroded = cv2.erode(domain.astype(np.uint8), kernel).astype(bool)
    outer_anchor = domain & ~eroded & ~inner_anchor
    anchors = inner_anchor | outer_anchor
    unknown = domain & ~anchors

    field = np.zeros((*domain.shape, 3), np.float32)
    field[inner_anchor] = inner_values[inner_anchor] * config.strength
    if not unknown.any():
        return field, 0

    neighbours: list[tuple[int, int, np.ndarray]] = []
    sigma2 = max(1e-4, 2.0 * config.edge_sigma * config.edge_sigma)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        neighbour_domain = _shift(domain.astype(np.float32), dy, dx)
        neighbour_guide = _shift(guide_lab, dy, dx)
        colour_distance = np.sum((guide_lab - neighbour_guide) ** 2, axis=2)
        weight = np.exp(-colour_distance / sigma2) * neighbour_domain
        # Never let a residual seam completely disconnect the linear system.
        weight = np.where(neighbour_domain > 0, np.maximum(weight, 0.08), 0.0)
        neighbours.append((dy, dx, weight.astype(np.float32)))

    iterations = 0
    for iterations in range(1, config.maximum_iterations + 1):
        numerator = np.zeros_like(field)
        denominator = np.zeros(domain.shape, np.float32)
        for dy, dx, weight in neighbours:
            numerator += _shift(field, dy, dx) * weight[..., None]
            denominator += weight
        updated = numerator / np.maximum(denominator[..., None], 1e-6)
        change = float(np.max(np.abs(updated[unknown] - field[unknown])))
        field[unknown] = updated[unknown]
        field[inner_anchor] = inner_values[inner_anchor] * config.strength
        field[outer_anchor] = 0.0
        if change <= config.convergence:
            break
    return field, iterations


def _fallback_blend(
    original: np.ndarray,
    healed: np.ndarray,
    repair: np.ndarray,
    face_scale: float,
) -> np.ndarray:
    feather = _odd(max(3, int(face_scale * 0.004)))
    alpha = cv2.GaussianBlur(repair.astype(np.float32), (feather, feather), 0)
    alpha = np.clip(alpha * 1.25, 0.0, 1.0)[..., None]
    return np.clip(
        original.astype(np.float32) * (1.0 - alpha)
        + healed.astype(np.float32) * alpha,
        0,
        255,
    ).astype(np.uint8)


def harmonize(
    original_rgb: np.ndarray,
    healed_rgb: np.ndarray,
    repair_mask: np.ndarray,
    allowed_skin: np.ndarray,
    suspicion: np.ndarray,
    face_scale: float,
    config: HarmonizationConfig | None = None,
) -> HarmonizationResult:
    """Directly match every repair component to confirmed local healthy skin."""

    config = config or HarmonizationConfig()
    repair = _binary(repair_mask)
    allowed = _binary(allowed_skin)
    suspicion = np.asarray(suspicion, np.float32)
    if not config.enabled or not repair.any():
        fallback = _fallback_blend(original_rgb, healed_rgb, repair, face_scale)
        return HarmonizationResult(
            fallback,
            repair.copy(),
            np.zeros((*repair.shape, 3), np.float32),
            {"enabled": False, "componentsMatched": 0},
        )

    original_lab = _lab_float(original_rgb)
    healed_lab = _lab_float(healed_rgb)
    sigma = max(1.2, float(config.colour_sigma))
    original_low = cv2.GaussianBlur(original_lab, (0, 0), sigmaX=sigma)
    healed_low = cv2.GaussianBlur(healed_lab, (0, 0), sigmaX=sigma)
    original_high = original_lab - original_low
    healed_high = healed_lab - healed_low

    result_lab = _lab_float(
        _fallback_blend(original_rgb, healed_rgb, repair, face_scale)
    )
    total_tone_mask = np.zeros(repair.shape, np.uint8)
    total_correction = np.zeros((*repair.shape, 3), np.float32)
    matched_components = 0
    rejected_components = 0
    total_matches = 0
    donor_distances: list[float] = []
    iterations: list[int] = []
    boundary_before: list[float] = []
    component_records: list[dict] = []
    successful_match_groups: list[tuple[dict, list[BoundaryMatch]]] = []

    other_repairs = cv2.dilate(
        repair, np.ones((_odd(max(3, int(face_scale * 0.012))),) * 2, np.uint8)
    )
    healthy = (
        (allowed > 0)
        & (suspicion <= config.healthy_confidence)
        & (other_repairs == 0)
    ).astype(np.uint8)
    maximum_search = max(5, int(round(face_scale * config.search_radius_ratio)))
    skin_clearance = cv2.distanceTransform(allowed, cv2.DIST_L2, 3)
    # OpenCV represents an all-foreground mask as near-FLT_MAX because there is
    # no zero pixel to measure against. Clamp that valid "unbounded clearance"
    # case to the image diagonal so diagnostics and medians remain finite.
    skin_clearance = np.minimum(
        skin_clearance, float(np.hypot(*allowed.shape))
    ).astype(np.float32)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(repair, 8)
    for component_index in range(1, count):
        component = (labels == component_index).astype(np.uint8)
        if stats[component_index, cv2.CC_STAT_AREA] < 2:
            continue
        contour, component_boundary = _boundary(component)
        boundary_pixels = component_boundary > 0
        minimum_clearance = (
            float(np.min(skin_clearance[boundary_pixels]))
            if boundary_pixels.any()
            else 0.0
        )
        median_clearance = (
            float(np.median(skin_clearance[boundary_pixels]))
            if boundary_pixels.any()
            else 0.0
        )
        if len(contour) < 4:
            rejected_components += 1
            component_records.append(
                {
                    "component": component_index,
                    "area": int(stats[component_index, cv2.CC_STAT_AREA]),
                    "status": "rejected-small-boundary",
                    "minimumSkinClearance": round(minimum_clearance, 3),
                    "medianSkinClearance": round(median_clearance, 3),
                }
            )
            continue
        nx, ny = _outward_normal_field(component)

        matches: list[BoundaryMatch] = []
        for contour_index, (x, y) in enumerate(contour):
            match = _trace_boundary_match(
                contour_index,
                (int(x), int(y)),
                (float(nx[y, x]), float(ny[y, x])),
                original_low,
                healed_low,
                healthy,
                maximum_search,
                config,
            )
            if match is not None:
                matches.append(match)

        coverage = len(matches) / max(1, len(contour))
        if coverage < config.minimum_coverage:
            rejected_components += 1
            component_records.append(
                {
                    "component": component_index,
                    "area": int(stats[component_index, cv2.CC_STAT_AREA]),
                    "status": "rejected-low-coverage",
                    "coverage": round(float(coverage), 4),
                    "matches": len(matches),
                    "minimumSkinClearance": round(minimum_clearance, 3),
                    "medianSkinClearance": round(median_clearance, 3),
                }
            )
            continue

        boundary_values = _regularized_boundary_values(
            len(contour), matches, config.boundary_smooth_radius
        )
        inner_values = np.zeros((*repair.shape, 3), np.float32)
        for contour_index, (x, y) in enumerate(contour):
            inner_values[y, x] = boundary_values[contour_index]

        domain = component.copy()
        for match in matches:
            for x, y in match.path:
                if allowed[y, x] > 0:
                    domain[y, x] = 1
        domain = cv2.morphologyEx(domain, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        domain &= allowed

        ys, xs = np.where(domain > 0)
        if len(xs) == 0:
            rejected_components += 1
            component_records.append(
                {
                    "component": component_index,
                    "area": int(stats[component_index, cv2.CC_STAT_AREA]),
                    "status": "rejected-empty-domain",
                    "minimumSkinClearance": round(minimum_clearance, 3),
                    "medianSkinClearance": round(median_clearance, 3),
                }
            )
            continue
        # A complete Gaussian support is retained around the component both for
        # recombination and for the automatic before/after quality gate below.
        pad = int(np.ceil(sigma * 4.0)) + 1
        x0, x1 = max(0, int(xs.min()) - pad), min(domain.shape[1], int(xs.max()) + pad + 1)
        y0, y1 = max(0, int(ys.min()) - pad), min(domain.shape[0], int(ys.max()) + pad + 1)
        local_domain = domain[y0:y1, x0:x1]
        local_boundary = component_boundary[y0:y1, x0:x1]
        local_values = inner_values[y0:y1, x0:x1]

        guide = original_low[y0:y1, x0:x1].copy()
        local_component = component[y0:y1, x0:x1] > 0
        guide[local_component] = healed_low[y0:y1, x0:x1][local_component]
        correction, used_iterations = _harmonic_correction(
            local_domain, local_boundary, local_values, guide, config
        )

        # Low-frequency colour is replaced directly; high-frequency texture
        # crosses the core edge through a deliberately tiny independent feather.
        low = original_low[y0:y1, x0:x1].copy()
        healed_low_patch = healed_low[y0:y1, x0:x1]
        low[local_component] = healed_low_patch[local_component]
        low += correction

        texture_radius = _odd(max(3, int(face_scale * config.texture_feather_ratio)))
        texture_alpha = cv2.GaussianBlur(
            local_component.astype(np.float32), (texture_radius, texture_radius), 0
        )
        texture_alpha = np.clip(texture_alpha * 1.4, 0.0, 1.0)[..., None]
        high = (
            original_high[y0:y1, x0:x1] * (1.0 - texture_alpha)
            + healed_high[y0:y1, x0:x1] * texture_alpha
        )
        candidate = low + high

        selected = local_domain > 0
        result_patch = result_lab[y0:y1, x0:x1]
        trial_patch = result_patch.copy()
        trial_patch[selected] = candidate[selected]
        trial_rgb = _rgb_u8(trial_patch)
        trial_low = cv2.GaussianBlur(_lab_float(trial_rgb), (0, 0), sigmaX=sigma)
        before_errors = [
            float(
                np.linalg.norm(
                    match.target_lab
                    - healed_low[match.point[1], match.point[0]]
                )
            )
            for match in matches
        ]
        after_errors = [
            float(
                np.linalg.norm(
                    match.target_lab
                    - trial_low[match.point[1] - y0, match.point[0] - x0]
                )
            )
            for match in matches
        ]
        mean_before = float(np.mean(before_errors))
        mean_after = float(np.mean(after_errors))
        # A direct matcher is allowed to decline.  Never replace the proven
        # fallback when the complete colour+texture recombination does not
        # measurably improve its own boundary correspondences.
        if mean_after >= mean_before * 0.97:
            rejected_components += 1
            component_records.append(
                {
                    "component": component_index,
                    "area": int(stats[component_index, cv2.CC_STAT_AREA]),
                    "status": "rejected-no-improvement",
                    "coverage": round(float(coverage), 4),
                    "matches": len(matches),
                    "meanBoundaryErrorBefore": round(mean_before, 4),
                    "trialBoundaryErrorAfter": round(mean_after, 4),
                    "minimumSkinClearance": round(minimum_clearance, 3),
                    "medianSkinClearance": round(median_clearance, 3),
                }
            )
            continue

        result_patch[selected] = candidate[selected]
        result_lab[y0:y1, x0:x1] = result_patch
        total_tone_mask[y0:y1, x0:x1] |= local_domain
        total_correction[y0:y1, x0:x1][selected] = correction[selected]
        matched_components += 1
        total_matches += len(matches)
        iterations.append(used_iterations)
        donor_distances.extend(match.donor_distance for match in matches)
        boundary_before.extend(before_errors)
        record = {
            "component": component_index,
            "area": int(stats[component_index, cv2.CC_STAT_AREA]),
            "status": "matched",
            "coverage": round(float(coverage), 4),
            "matches": len(matches),
            "tonePixels": int(local_domain.sum()),
            "meanDonorDistance": round(
                float(np.mean([match.donor_distance for match in matches])), 3
            ),
            "meanBoundaryErrorBefore": round(mean_before, 4),
            "trialBoundaryErrorAfter": round(mean_after, 4),
            "solverIterations": used_iterations,
            "minimumSkinClearance": round(minimum_clearance, 3),
            "medianSkinClearance": round(median_clearance, 3),
        }
        component_records.append(record)
        successful_match_groups.append((record, matches))

    output = _rgb_u8(result_lab)
    affected = (total_tone_mask > 0) | (repair > 0)
    output[~affected] = original_rgb[~affected]

    output_low = cv2.GaussianBlur(_lab_float(output), (0, 0), sigmaX=sigma)
    boundary_after: list[float] = []
    for record, matches in successful_match_groups:
        errors = [
            float(np.linalg.norm(match.target_lab - output_low[match.point[1], match.point[0]]))
            for match in matches
        ]
        boundary_after.extend(errors)
        record["meanBoundaryErrorAfter"] = round(float(np.mean(errors)), 4)

    metadata = {
        "enabled": True,
        "componentsMatched": matched_components,
        "componentsRejected": rejected_components,
        "boundaryMatches": total_matches,
        "tonePixels": int(total_tone_mask.sum()),
        "meanDonorDistance": round(float(np.mean(donor_distances)), 3)
        if donor_distances
        else 0.0,
        "meanBoundaryErrorBefore": round(float(np.mean(boundary_before)), 4)
        if boundary_before
        else 0.0,
        "meanBoundaryErrorAfter": round(float(np.mean(boundary_after)), 4)
        if boundary_after
        else 0.0,
        "maxCorrectionL": round(float(np.max(np.abs(total_correction[..., 0]))), 4),
        "maxCorrectionChroma": round(
            float(np.max(np.abs(total_correction[..., 1:]))), 4
        ),
        "meanSolverIterations": round(float(np.mean(iterations)), 1)
        if iterations
        else 0.0,
        "components": component_records,
    }
    return HarmonizationResult(output, total_tone_mask, total_correction, metadata)
