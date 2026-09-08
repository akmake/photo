"""Experimental automatic spot cleanup; not enabled in the product yet.

Local colour evidence selects repairs. Structure, permanent dark marks and
features are withheld. Texture donors are evaluated on each repair's support,
not on a rectangle whose size grows with all the blemishes on the face.
"""
from __future__ import annotations

import cv2
import numpy as np

import common
import masks
import pigment
import skinmodel


def protect_marks(crop, allowed, face_d):
    """Retain dark compact marks unless a surrounding inflamed halo is present."""
    protected = pigment.protected_spots(crop, allowed, face_d)
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
    reference = skinmodel.normalized_median(lab, allowed, max(9, int(face_d*.10)) | 1)
    red = lab[..., 1] - reference[..., 1]
    count, labels = cv2.connectedComponents(protected, 8)
    for i in range(1, count):
        comp = (labels == i).astype(np.uint8)
        ring = (cv2.dilate(comp, np.ones((9, 9), np.uint8)) > 0) & (comp == 0) & (allowed > .8)
        if ring.sum() >= 12 and (float(np.median(red[ring])) > 3 or
                                (float(np.median(red[comp > 0])) > 6 and float(np.median(red[ring])) > 1.5)):
            protected[comp > 0] = 0
    distance = cv2.distanceTransform(1-protected, cv2.DIST_L2, 5)
    fade = np.clip(distance / max(3, face_d*.012), 0, 1)
    return 1-fade*fade*(3-2*fade)


def even(crop, allowed, face_d):
    """Remove the blemish-frequency colour field while retaining pore detail."""
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
    fine = cv2.GaussianBlur(lab, (0, 0), max(.8, face_d*.002))
    reference = skinmodel.normalized_median(fine, allowed, max(9, int(face_d*.10)) | 1)
    excess = fine-reference
    red = excess[..., 1]
    dark = -excess[..., 0]
    crease = pigment.crease_map(crop, allowed, face_d)
    gate = np.maximum(np.clip((red-.4)/2, 0, 1), np.clip((dark-1)/4, 0, 1)*(1-crease))
    gate *= gate*(3-2*gate)
    gate *= allowed*(1-crease)
    delta = np.zeros_like(lab)
    delta[..., 1] = -np.maximum(excess[..., 1], 0)
    delta[..., 2] = -np.maximum(excess[..., 2], 0)
    delta[..., 0] = np.clip(dark, 0, 24)
    delta *= gate[..., None]
    reference_rgb = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.int16)
    shifted_rgb = cv2.cvtColor(np.clip(np.rint(lab+delta), 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.int16)
    corrected = np.clip(crop.astype(np.int16)+shifted_rgb-reference_rgb, 0, 255).astype(np.uint8)
    return corrected


def detect(crop, allowed, face_d):
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
    fine = cv2.GaussianBlur(lab, (0, 0), max(.65, face_d * .0015))
    reference = skinmodel.normalized_median(fine, allowed, max(9, int(face_d * .075)) | 1)
    red = fine[..., 1] - reference[..., 1]
    dark = reference[..., 0] - fine[..., 0]
    # Colour must corroborate darkness: pores and cast shadows alone do not
    # establish that a mark should be removed.
    extent = ((red > 1.0) & ((dark > 1.0) | (red > 2.5)) & (allowed > .8)).astype(np.uint8)
    seed = ((red > 3.0) | ((red > 1.8) & (dark > 5.0))) & (allowed > .8)
    extent = cv2.morphologyEx(extent, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(extent, 8)
    repair = np.zeros_like(extent)
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        comp = labels[y:y+h, x:x+w] == index
        if area < max(5, face_d**2 * .000025) or area > face_d**2 * .015:
            continue
        if not seed[y:y+h, x:x+w][comp].any():
            continue
        yy, xx = np.nonzero(comp)
        eigen = np.linalg.eigvalsh(np.cov(np.stack((xx, yy))))
        if eigen[-1] > max(1, eigen[0]) * 12:
            continue
        repair[y:y+h, x:x+w][comp] = 1
    repair = cv2.dilate(repair, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    repair[allowed < .8] = 0
    return repair


def restore(rgb, repair, allowed, face_d):
    """Diffused tone with real texture from locally compatible clean skin."""
    binary = (repair > 0).astype(np.uint8)
    if not binary.any():
        return rgb.copy(), {'donors': 0, 'rejected': 0}
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    sigma = max(.8, face_d * .003)
    low = cv2.GaussianBlur(lab, (0, 0), sigma)
    high = lab - low
    forbidden = cv2.dilate(binary, np.ones((5, 5), np.uint8))
    invalid = ((allowed < .8) | (forbidden > 0)).astype(np.float32)
    base = cv2.inpaint(rgb, binary * 255, 3, cv2.INPAINT_TELEA)
    base_lab = cv2.cvtColor(base, cv2.COLOR_RGB2LAB).astype(np.float32)
    output = rgb.copy()
    donors = rejected = 0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    for index in range(1, n):
        x, y, w, h, area = stats[index]
        margin = max(6, int(face_d * .012))
        x0, y0 = max(0, x-margin), max(0, y-margin)
        x1, y1 = min(rgb.shape[1], x+w+margin), min(rgb.shape[0], y+h+margin)
        component = (labels[y0:y1, x0:x1] == index).astype(np.uint8)
        support = cv2.dilate(component, np.ones((5, 5), np.uint8)).astype(np.float32)
        ring = (cv2.dilate(component, np.ones((11, 11), np.uint8)) > 0) & (component == 0) & (invalid[y0:y1, x0:x1] == 0)
        if ring.sum() < 12:
            rejected += 1
            continue
        ph, pw = component.shape
        radius = max(int(face_d * .25), ph*3, pw*3)
        sx0, sy0 = max(0, x0-radius), max(0, y0-radius)
        sx1, sy1 = min(rgb.shape[1], x1+radius), min(rgb.shape[0], y1+radius)
        bad = cv2.matchTemplate(invalid[sy0:sy1, sx0:sx1], support, cv2.TM_CCORR)
        valid = bad < .1
        if not valid.any():
            rejected += 1
            continue
        score = cv2.matchTemplate(low[sy0:sy1, sx0:sx1], low[y0:y1, x0:x1],
                                  cv2.TM_SQDIFF, mask=ring.astype(np.float32))
        score = score / max(1, int(ring.sum()))
        yy, xx = np.indices(score.shape)
        score += ((xx+sx0-x0)**2 + (yy+sy0-y0)**2) / max(1, face_d**2) * 20
        score[~valid] = np.inf
        dy, dx = np.unravel_index(np.argmin(score), score.shape)
        dy, dx = int(dy+sy0), int(dx+sx0)
        tex = high[dy:dy+ph, dx:dx+pw]
        target_amp = float(np.std(high[y0:y1, x0:x1, 0][ring]))
        donor_amp = float(np.std(tex[..., 0][component > 0]))
        gain = np.clip(target_amp / max(.1, donor_amp), .7, 1.4)
        candidate = cv2.cvtColor(np.clip(base_lab[y0:y1, x0:x1] + tex * gain, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
        alpha = cv2.GaussianBlur(component.astype(np.float32), (3, 3), 0)
        alpha = np.minimum(1, alpha*1.5) * component
        patch = rgb[y0:y1, x0:x1].astype(np.float32)
        blended = np.clip(patch*(1-alpha[..., None])+candidate*alpha[..., None], 0, 255).astype(np.uint8)
        output[y0:y1, x0:x1][component > 0] = blended[component > 0]
        donors += 1
    return output, {'donors': donors, 'rejected': rejected}


def apply(rgb, params=None):
    skin = masks.get_mask(rgb, 'face-skin')
    face_d = float(np.sqrt(skin.sum()))
    if face_d < 180:
        return rgb.copy(), {'faceTooSmall': 1}
    box = common.region_box(skin, int(face_d*.2), rgb.shape)
    if box is None:
        return rgb.copy(), {'faces': 0}
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]
    allowed = np.clip(skin - masks.get_mask(rgb, 'face-anatomy') - masks.get_mask(rgb, 'face-eye-region')
                      - masks.get_mask(rgb, 'hair'), 0, 1)
    allowed *= masks.get_mask(rgb, 'face-oval')
    allowed = allowed[y0:y1, x0:x1]
    allowed *= 1-protect_marks(crop, allowed, face_d)
    repair = detect(crop, allowed, face_d)
    staged = even(crop, allowed, face_d)
    meta = {}
    out_crop, repair_meta = restore(staged, repair, allowed, face_d)
    out = rgb.copy()
    out[y0:y1, x0:x1] = out_crop
    return out, {**meta, **repair_meta, 'repairPx': int(repair.sum())}
