"""Mask-driven skin healing.

This module deliberately knows nothing about faces, pimples, or blemish
colours.  It receives an RGB image, an exact repair mask, and an optional
allowed donor region.  Detection and healing therefore remain independently
testable.

The main method uses nearby exemplar patches:

1. find a clean donor patch whose boundary resembles the target boundary;
2. reconstruct colour/illumination with classical inpainting;
3. transfer only the donor's high-frequency texture;
4. feather the result inside the supplied mask.

OpenCV's Telea and Navier-Stokes methods are exposed as baselines.
"""

from __future__ import annotations

import cv2
import numpy as np


def _binary(mask: np.ndarray) -> np.ndarray:
    if mask.ndim == 3:
        mask = mask.max(axis=2)
    return (mask > 0).astype(np.uint8)


def _odd(value: int) -> int:
    value = max(3, int(value))
    return value if value % 2 else value + 1


def _classical(rgb: np.ndarray, mask: np.ndarray, flag: int) -> np.ndarray:
    binary = _binary(mask)
    if not binary.any():
        return rgb.copy()
    radius = max(2.0, min(12.0, np.sqrt(float(binary.sum())) * 0.18))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    repaired = cv2.inpaint(bgr, binary * 255, radius, flag)
    return cv2.cvtColor(repaired, cv2.COLOR_BGR2RGB)


def telea(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return _classical(rgb, mask, cv2.INPAINT_TELEA)


def navier_stokes(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return _classical(rgb, mask, cv2.INPAINT_NS)


class _Context:
    """Whole-image derivatives, computed once and shared by every component.

    These used to be rebuilt inside the per-component search, which made a face
    with a hundred blemishes cost a hundred full-frame Lab conversions and Sobel
    passes. The blur is cached per (quantised) sigma so repeated components with
    similar geometry reuse it.
    """

    def __init__(self, rgb: np.ndarray):
        self.rgb = rgb
        self.lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        self.grad = cv2.magnitude(gx, gy)
        self._low: dict[float, np.ndarray] = {}

    def low(self, sigma: float) -> np.ndarray:
        key = round(max(1.5, float(sigma)) * 2.0) / 2.0
        cached = self._low.get(key)
        if cached is None:
            cached = cv2.GaussianBlur(self.lab, (0, 0), sigmaX=key)
            self._low[key] = cached
        return cached


def _component_patch(
    ctx: _Context,
    component: np.ndarray,
    allowed: np.ndarray,
    forbidden: np.ndarray,
) -> tuple[tuple[int, int, int, int], np.ndarray] | None:
    """Return the target patch bounds and the best same-sized donor patch."""
    ys, xs = np.where(component > 0)
    if len(xs) == 0:
        return None

    rgb = ctx.rgb
    h, w = rgb.shape[:2]
    lesion_w = int(xs.max() - xs.min() + 1)
    lesion_h = int(ys.max() - ys.min() + 1)
    margin = max(8, int(max(lesion_w, lesion_h) * 1.4))

    x0 = max(0, int(xs.min()) - margin)
    y0 = max(0, int(ys.min()) - margin)
    x1 = min(w, int(xs.max()) + margin + 1)
    y1 = min(h, int(ys.max()) + margin + 1)
    ph, pw = y1 - y0, x1 - x0
    if ph < 5 or pw < 5:
        return None

    target_component = component[y0:y1, x0:x1]
    ring_size = max(3, int(max(lesion_w, lesion_h) * 0.8))
    kernel = np.ones((_odd(ring_size), _odd(ring_size)), np.uint8)
    ring = cv2.dilate(target_component, kernel) - target_component
    ring = (ring > 0) & (allowed[y0:y1, x0:x1] > 0)
    support = cv2.dilate(target_component, kernel) > 0
    if ring.sum() < 12:
        return None

    low = ctx.low(margin * 0.22)
    grad = ctx.grad

    target_low = low[y0:y1, x0:x1]
    target_grad = grad[y0:y1, x0:x1]
    target_cx = (x0 + x1) * 0.5
    target_cy = (y0 + y1) * 0.5

    search_radius = max(ph, pw) * 4
    step = max(2, min(ph, pw) // 9)
    sx_min = max(0, int(target_cx - search_radius - pw / 2))
    sx_max = min(w - pw, int(target_cx + search_radius - pw / 2))
    sy_min = max(0, int(target_cy - search_radius - ph / 2))
    sy_max = min(h - ph, int(target_cy + search_radius - ph / 2))

    best_score = float("inf")
    best_patch = None
    for sy in range(sy_min, sy_max + 1, step):
        for sx in range(sx_min, sx_max + 1, step):
            donor_allowed = allowed[sy : sy + ph, sx : sx + pw] > 0
            donor_forbidden = forbidden[sy : sy + ph, sx : sx + pw] > 0
            if donor_allowed[ring].mean() < 0.97 or donor_forbidden[ring].any():
                continue
            if donor_allowed[support].mean() < 0.97:
                continue
            if forbidden[sy : sy + ph, sx : sx + pw].mean() > 0.01:
                continue

            donor_low = low[sy : sy + ph, sx : sx + pw]
            donor_grad = grad[sy : sy + ph, sx : sx + pw]
            colour_error = np.mean(np.abs(target_low[ring] - donor_low[ring]))
            texture_error = np.mean(np.abs(target_grad[ring] - donor_grad[ring]))
            distance = np.hypot(
                sx + pw * 0.5 - target_cx, sy + ph * 0.5 - target_cy
            )
            score = colour_error + texture_error * 0.10 + distance * 0.003
            if score < best_score:
                best_score = score
                best_patch = rgb[sy : sy + ph, sx : sx + pw].copy()

    if best_patch is None:
        return None
    return (x0, y0, x1, y1), best_patch


def patch_frequency(
    rgb: np.ndarray,
    mask: np.ndarray,
    allowed_region: np.ndarray | None = None,
) -> np.ndarray:
    """Heal a supplied mask using nearby clean texture and reconstructed tone."""
    binary = _binary(mask)
    if not binary.any():
        return rgb.copy()

    if allowed_region is None:
        allowed = np.ones(binary.shape, np.uint8)
    else:
        allowed = _binary(allowed_region)

    # Donors must not overlap a generous halo around any requested repair.
    halo_radius = _odd(max(7, int(np.sqrt(float(binary.sum())) * 0.35)))
    forbidden = cv2.dilate(
        binary, np.ones((halo_radius, halo_radius), np.uint8)
    )

    ctx = _Context(rgb)
    fallback = telea(rgb, binary)
    output = rgb.copy()
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)

    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] < 2:
            continue
        component = (labels == index).astype(np.uint8)
        found = _component_patch(ctx, component, allowed, forbidden)
        if found is None:
            output[component > 0] = fallback[component > 0]
            continue
        (x0, y0, x1, y1), donor = found
        ph, pw = y1 - y0, x1 - x0
        local_mask = component[y0:y1, x0:x1].astype(np.float32)

        # Transfer a complete clean donor patch.  Match its low-frequency tone
        # to the healthy ring around the target, while keeping donor texture.
        sigma = max(1.2, min(ph, pw) * 0.08)
        donor_lab = cv2.cvtColor(donor, cv2.COLOR_RGB2LAB).astype(np.float32)
        donor_low = cv2.GaussianBlur(donor_lab, (0, 0), sigmaX=sigma)
        donor_high = donor_lab - donor_low

        target_patch = rgb[y0:y1, x0:x1]
        target_lab = cv2.cvtColor(target_patch, cv2.COLOR_RGB2LAB).astype(np.float32)
        target_low = cv2.GaussianBlur(target_lab, (0, 0), sigmaX=sigma)
        ring_size = _odd(max(3, int(np.sqrt(float(local_mask.sum())) * 0.40)))
        ring = cv2.dilate(
            local_mask.astype(np.uint8),
            np.ones((ring_size, ring_size), np.uint8),
        ).astype(bool)
        ring &= ~local_mask.astype(bool)
        if ring.any():
            tone_delta = np.median(
                target_low[ring] - donor_low[ring], axis=0
            )
        else:
            tone_delta = np.zeros(3, np.float32)
        candidate_lab = np.clip(
            donor_low + tone_delta[None, None, :] + donor_high * 0.92,
            0,
            255,
        ).astype(np.uint8)
        candidate = cv2.cvtColor(candidate_lab, cv2.COLOR_LAB2RGB)

        feather = _odd(max(3, int(np.sqrt(float(local_mask.sum())) * 0.22)))
        alpha = cv2.GaussianBlur(local_mask, (feather, feather), 0)
        alpha = np.clip(alpha * 1.35, 0.0, 1.0)[..., None]
        current = output[y0:y1, x0:x1].astype(np.float32)
        mixed = current * (1.0 - alpha) + candidate.astype(np.float32) * alpha
        output[y0:y1, x0:x1] = np.clip(mixed, 0, 255).astype(np.uint8)

    return output


def inpaint_texture(
    rgb: np.ndarray,
    mask: np.ndarray,
    allowed_region: np.ndarray | None = None,
) -> np.ndarray:
    """Reconstruct tone by diffusion, then graft real pore texture on top.

    `patch_frequency` transplants a whole donor patch, so it imports the
    donor's *structure* too and can invent a crease that was never there.
    Here the low/mid frequencies come from classical inpainting — which is
    exactly what diffusion is good at, seamless tone that follows the
    surrounding illumination — and the donor contributes nothing but its
    high-frequency skin texture, which is what diffusion destroys.
    """
    binary = _binary(mask)
    if not binary.any():
        return rgb.copy()

    allowed = (
        np.ones(binary.shape, np.uint8)
        if allowed_region is None
        else _binary(allowed_region)
    )
    halo_radius = _odd(max(7, int(np.sqrt(float(binary.sum())) * 0.35)))
    forbidden = cv2.dilate(binary, np.ones((halo_radius, halo_radius), np.uint8))

    ctx = _Context(rgb)
    base = telea(rgb, binary)
    output = base.copy()
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)

    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] < 2:
            continue
        component = (labels == index).astype(np.uint8)
        found = _component_patch(ctx, component, allowed, forbidden)
        if found is None:
            continue  # tone-only repair is still a valid result
        (x0, y0, x1, y1), donor = found
        local_mask = component[y0:y1, x0:x1].astype(np.float32)

        # Pore-scale only. A larger sigma would drag donor structure back in.
        sigma = 1.5
        donor_lab = cv2.cvtColor(donor, cv2.COLOR_RGB2LAB).astype(np.float32)
        donor_high = donor_lab - cv2.GaussianBlur(donor_lab, (0, 0), sigmaX=sigma)

        base_patch = base[y0:y1, x0:x1]
        base_lab = cv2.cvtColor(base_patch, cv2.COLOR_RGB2LAB).astype(np.float32)

        # Match the grafted texture's amplitude to the skin ringing the repair,
        # so the patch is neither flatter nor noisier than its neighbourhood.
        ring_size = _odd(max(5, int(np.sqrt(float(local_mask.sum())) * 0.9)))
        ring = cv2.dilate(
            local_mask.astype(np.uint8), np.ones((ring_size, ring_size), np.uint8)
        ).astype(bool)
        ring &= ~local_mask.astype(bool)
        ring &= allowed[y0:y1, x0:x1] > 0
        gain = 1.0
        if ring.sum() > 24:
            source_lab = cv2.cvtColor(
                rgb[y0:y1, x0:x1], cv2.COLOR_RGB2LAB
            ).astype(np.float32)
            target_high = source_lab - cv2.GaussianBlur(source_lab, (0, 0), sigmaX=sigma)
            donor_amp = float(np.abs(donor_high[..., 0][ring]).mean())
            target_amp = float(np.abs(target_high[..., 0][ring]).mean())
            if donor_amp > 1e-3:
                gain = float(np.clip(target_amp / donor_amp, 0.5, 2.0))

        candidate_lab = np.clip(base_lab + donor_high * gain, 0, 255).astype(np.uint8)
        candidate = cv2.cvtColor(candidate_lab, cv2.COLOR_LAB2RGB).astype(np.float32)

        feather = _odd(max(3, int(np.sqrt(float(local_mask.sum())) * 0.22)))
        alpha = cv2.GaussianBlur(local_mask, (feather, feather), 0)
        alpha = np.clip(alpha * 1.35, 0.0, 1.0)[..., None]
        current = output[y0:y1, x0:x1].astype(np.float32)
        mixed = current * (1.0 - alpha) + candidate * alpha
        output[y0:y1, x0:x1] = np.clip(mixed, 0, 255).astype(np.uint8)

    return output


def symmetric_reconstruct(
    rgb: np.ndarray,
    mask: np.ndarray,
    mirrored_rgb: np.ndarray,
    donor_valid: np.ndarray,
    donor_suspect: np.ndarray,
    allowed_region: np.ndarray | None = None,
) -> tuple[np.ndarray, int]:
    """Prefer the anatomically matching point on the other side of the face.

    ``mirrored_rgb`` is already aligned to this face by the caller.  The
    opposite side is used only when the complete repair component maps to skin
    and does not overlap another suspected blemish.  Components that fail those
    checks retain the ordinary inpaint+texture result.

    A per-component Lab offset matches local illumination without removing the
    mirrored structure.  This is the useful part of facial symmetry: a real
    crease or contour on one side can survive a repair on the other.
    """
    binary = _binary(mask)
    if not binary.any():
        return rgb.copy(), 0

    allowed = (
        np.ones(binary.shape, np.uint8)
        if allowed_region is None
        else _binary(allowed_region)
    )
    valid = _binary(donor_valid)
    suspect = _binary(donor_suspect)

    # This is also the safe fallback for every component whose opposite side is
    # occluded, outside skin, or itself blemished.
    output = inpaint_texture(rgb, binary, allowed)
    source_lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    mirror_lab = cv2.cvtColor(mirrored_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)

    used = 0
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] < 2:
            continue
        component = labels == index
        if float(valid[component].mean()) < 0.98 or suspect[component].any():
            continue

        ys, xs = np.where(component)
        lesion_w = int(xs.max() - xs.min() + 1)
        lesion_h = int(ys.max() - ys.min() + 1)
        margin = max(5, int(max(lesion_w, lesion_h) * 0.9))
        x0 = max(0, int(xs.min()) - margin)
        y0 = max(0, int(ys.min()) - margin)
        x1 = min(rgb.shape[1], int(xs.max()) + margin + 1)
        y1 = min(rgb.shape[0], int(ys.max()) + margin + 1)

        local_mask = component[y0:y1, x0:x1].astype(np.uint8)
        ring_size = _odd(max(5, int(np.sqrt(float(local_mask.sum())) * 0.75)))
        ring = cv2.dilate(
            local_mask, np.ones((ring_size, ring_size), np.uint8)
        ).astype(bool)
        ring &= ~local_mask.astype(bool)
        ring &= allowed[y0:y1, x0:x1] > 0
        ring &= valid[y0:y1, x0:x1] > 0
        ring &= suspect[y0:y1, x0:x1] == 0
        if ring.sum() < 16:
            continue

        target_patch = source_lab[y0:y1, x0:x1]
        mirror_patch = mirror_lab[y0:y1, x0:x1]
        delta = np.median(target_patch[ring] - mirror_patch[ring], axis=0)
        # Luminance may legitimately differ across the face; chroma should not
        # jump enough to manufacture a differently coloured patch.
        delta = np.clip(delta, [-18.0, -8.0, -8.0], [18.0, 8.0, 8.0])
        candidate_lab = np.clip(mirror_patch + delta[None, None, :], 0, 255).astype(
            np.uint8
        )
        candidate = cv2.cvtColor(candidate_lab, cv2.COLOR_LAB2RGB).astype(np.float32)

        feather = _odd(max(3, int(np.sqrt(float(local_mask.sum())) * 0.22)))
        alpha = cv2.GaussianBlur(local_mask.astype(np.float32), (feather, feather), 0)
        alpha = np.clip(alpha * 1.35, 0.0, 1.0)[..., None]
        current = output[y0:y1, x0:x1].astype(np.float32)
        mixed = current * (1.0 - alpha) + candidate * alpha
        output[y0:y1, x0:x1] = np.clip(mixed, 0, 255).astype(np.uint8)
        used += 1

    return output, used


def consensus_texture(
    rgb: np.ndarray,
    mask: np.ndarray,
    allowed_region: np.ndarray | None = None,
    suspect_region: np.ndarray | None = None,
) -> tuple[np.ndarray, dict]:
    """Heal with a donor selected by agreement between many clean candidates.

    Averaging donor pixels would erase real pore texture.  Instead candidates
    vote through robust descriptors (tone, variation, gradient and texture
    energy); the most representative surviving patch contributes its genuine
    high-frequency texture while classical inpainting supplies local tone.
    """
    binary = _binary(mask)
    if not binary.any():
        return rgb.copy(), {"components": 0, "candidates": 0}

    allowed = (
        np.ones(binary.shape, np.uint8)
        if allowed_region is None
        else _binary(allowed_region)
    )
    suspect = (
        np.zeros(binary.shape, np.uint8)
        if suspect_region is None
        else _binary(suspect_region)
    )

    halo_radius = _odd(max(7, int(np.sqrt(float(binary.sum())) * 0.35)))
    forbidden = cv2.dilate(binary, np.ones((halo_radius, halo_radius), np.uint8))
    ctx = _Context(rgb)
    base = telea(rgb, binary)
    output = base.copy()
    base_lab_full = cv2.cvtColor(base, cv2.COLOR_RGB2LAB).astype(np.float32)
    source_lab = ctx.lab
    low = ctx.low(4.0)
    texture = source_lab - cv2.GaussianBlur(source_lab, (0, 0), sigmaX=1.5)

    used_components = 0
    total_candidates = 0
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] < 2:
            continue
        component = (labels == index).astype(np.uint8)
        ys, xs = np.where(component > 0)
        lesion_w = int(xs.max() - xs.min() + 1)
        lesion_h = int(ys.max() - ys.min() + 1)
        margin = max(8, int(max(lesion_w, lesion_h) * 1.4))
        x0 = max(0, int(xs.min()) - margin)
        y0 = max(0, int(ys.min()) - margin)
        x1 = min(rgb.shape[1], int(xs.max()) + margin + 1)
        y1 = min(rgb.shape[0], int(ys.max()) + margin + 1)
        ph, pw = y1 - y0, x1 - x0
        if ph < 7 or pw < 7:
            continue

        local_mask = component[y0:y1, x0:x1]
        ring_size = _odd(max(5, int(max(lesion_w, lesion_h) * 0.8)))
        kernel = np.ones((ring_size, ring_size), np.uint8)
        ring = cv2.dilate(local_mask, kernel).astype(bool)
        ring &= ~local_mask.astype(bool)
        ring &= allowed[y0:y1, x0:x1] > 0
        support = cv2.dilate(local_mask, kernel) > 0
        if ring.sum() < 16:
            continue

        target_low = low[y0:y1, x0:x1]
        target_grad = ctx.grad[y0:y1, x0:x1]
        target_cx = (x0 + x1) * 0.5
        target_cy = (y0 + y1) * 0.5
        search_radius = max(ph, pw) * 6
        step = max(2, min(ph, pw) // 10)
        sx_min = max(0, int(target_cx - search_radius - pw / 2))
        sx_max = min(rgb.shape[1] - pw, int(target_cx + search_radius - pw / 2))
        sy_min = max(0, int(target_cy - search_radius - ph / 2))
        sy_max = min(rgb.shape[0] - ph, int(target_cy + search_radius - ph / 2))

        candidates = []
        for sy in range(sy_min, sy_max + 1, step):
            for sx in range(sx_min, sx_max + 1, step):
                donor_allowed = allowed[sy : sy + ph, sx : sx + pw] > 0
                donor_forbidden = forbidden[sy : sy + ph, sx : sx + pw] > 0
                donor_suspect = suspect[sy : sy + ph, sx : sx + pw] > 0
                if donor_allowed[support].mean() < 0.98:
                    continue
                if donor_forbidden[support].any() or donor_suspect[support].any():
                    continue

                donor_low = low[sy : sy + ph, sx : sx + pw]
                donor_grad = ctx.grad[sy : sy + ph, sx : sx + pw]
                donor_texture = texture[sy : sy + ph, sx : sx + pw]
                colour_error = float(np.mean(np.abs(target_low[ring] - donor_low[ring])))
                gradient_error = float(
                    np.mean(np.abs(target_grad[ring] - donor_grad[ring]))
                )
                distance = float(
                    np.hypot(sx + pw * 0.5 - target_cx, sy + ph * 0.5 - target_cy)
                )
                boundary_score = colour_error + gradient_error * 0.10 + distance * 0.002

                lab_ring = source_lab[sy : sy + ph, sx : sx + pw][ring]
                tex_ring = donor_texture[ring]
                descriptor = np.concatenate(
                    [
                        np.mean(lab_ring, axis=0),
                        np.std(lab_ring, axis=0),
                        [float(np.mean(donor_grad[ring]))],
                        np.mean(np.abs(tex_ring), axis=0),
                    ]
                ).astype(np.float32)
                candidates.append((boundary_score, descriptor, sx, sy))

        if len(candidates) < 3:
            continue
        candidates.sort(key=lambda item: item[0])
        candidates = candidates[:32]
        total_candidates += len(candidates)

        descriptors = np.stack([item[1] for item in candidates])
        median = np.median(descriptors, axis=0)
        mad = 1.4826 * np.median(np.abs(descriptors - median), axis=0)
        robust_scale = np.maximum(mad, 0.35)
        consensus_distance = np.mean(
            np.abs(descriptors - median) / robust_scale, axis=1
        )
        # Boundary fit still matters, but a lone "perfect" patch loses to the
        # texture/tone pattern supported by the rest of the clean candidates.
        boundary = np.array([item[0] for item in candidates], np.float32)
        boundary = (boundary - np.median(boundary)) / max(
            0.5, 1.4826 * float(np.median(np.abs(boundary - np.median(boundary))))
        )
        winner = int(np.argmin(consensus_distance + np.maximum(boundary, 0) * 0.25))
        _, _, sx, sy = candidates[winner]

        donor_high = texture[sy : sy + ph, sx : sx + pw]
        base_patch = base_lab_full[y0:y1, x0:x1]
        ring_tex = texture[y0:y1, x0:x1][ring]
        # Measure what will actually land inside the hole. A donor can have
        # lively texture on the ring yet be unusually smooth at the component's
        # exact coordinates; measuring the ring repeated that smooth patch.
        donor_amp = float(
            np.mean(np.abs(donor_high[..., 0][local_mask.astype(bool)]))
        )
        target_amp = float(np.mean(np.abs(ring_tex[..., 0])))
        # Feathering attenuates the graft at the same time that it hides its
        # seam. Compensate before blending so the final repaired pixels, rather
        # than the unblended candidate, match the surrounding texture energy.
        gain = 1.0 if donor_amp < 1e-3 else float(
            np.clip((target_amp / donor_amp) * 1.18, 0.65, 2.1)
        )
        candidate_lab = np.clip(base_patch + donor_high * gain, 0, 255).astype(np.uint8)
        candidate = cv2.cvtColor(candidate_lab, cv2.COLOR_LAB2RGB).astype(np.float32)

        feather = _odd(max(3, int(np.sqrt(float(local_mask.sum())) * 0.22)))
        alpha = cv2.GaussianBlur(local_mask.astype(np.float32), (feather, feather), 0)
        alpha = np.clip(alpha * 1.35, 0.0, 1.0)[..., None]
        current = output[y0:y1, x0:x1].astype(np.float32)
        output[y0:y1, x0:x1] = np.clip(
            current * (1.0 - alpha) + candidate * alpha, 0, 255
        ).astype(np.uint8)
        used_components += 1

    return output, {
        "components": used_components,
        "candidates": total_candidates,
    }


def patch_poisson(
    rgb: np.ndarray,
    mask: np.ndarray,
    allowed_region: np.ndarray | None = None,
) -> np.ndarray:
    """Clone clean nearby skin into each component with Poisson blending."""
    binary = _binary(mask)
    if not binary.any():
        return rgb.copy()
    allowed = (
        np.ones(binary.shape, np.uint8)
        if allowed_region is None
        else _binary(allowed_region)
    )
    halo_radius = _odd(max(7, int(np.sqrt(float(binary.sum())) * 0.35)))
    forbidden = cv2.dilate(
        binary, np.ones((halo_radius, halo_radius), np.uint8)
    )
    ctx = _Context(rgb)
    fallback = telea(rgb, binary)
    output = rgb.copy()
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)

    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] < 2:
            continue
        component = (labels == index).astype(np.uint8)
        found = _component_patch(ctx, component, allowed, forbidden)
        if found is None:
            output[component > 0] = fallback[component > 0]
            continue
        (x0, y0, x1, y1), donor = found
        local_mask = component[y0:y1, x0:x1] * 255
        center = ((x0 + x1) // 2, (y0 + y1) // 2)
        cloned_bgr = cv2.seamlessClone(
            cv2.cvtColor(donor, cv2.COLOR_RGB2BGR),
            cv2.cvtColor(output, cv2.COLOR_RGB2BGR),
            local_mask,
            center,
            cv2.NORMAL_CLONE,
        )
        output = cv2.cvtColor(cloned_bgr, cv2.COLOR_BGR2RGB)

    return output


def apply(
    rgb: np.ndarray,
    mask: np.ndarray,
    allowed_region: np.ndarray | None = None,
    method: str = "inpaint-texture",
) -> np.ndarray:
    if method == "telea":
        return telea(rgb, mask)
    if method in {"navier-stokes", "ns"}:
        return navier_stokes(rgb, mask)
    if method == "inpaint-texture":
        return inpaint_texture(rgb, mask, allowed_region)
    if method == "patch-frequency":
        return patch_frequency(rgb, mask, allowed_region)
    if method == "patch-poisson":
        return patch_poisson(rgb, mask, allowed_region)
    raise ValueError(f"Unknown healing method: {method}")
