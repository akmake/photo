from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from .config import settings


@dataclass(frozen=True)
class FaceRegion:
    id: str
    box: tuple[int, int, int, int]
    crop_box: tuple[int, int, int, int]
    landmarks: tuple[tuple[int, int], ...]
    confidence: float


@dataclass(frozen=True)
class SkinCandidate:
    id: str
    face_id: str
    box: tuple[int, int, int, int]
    center: tuple[int, int]
    score: float
    signal: str
    safe_to_clean: bool = False


class FaceDetector:
    """Commercially usable, local YuNet face detector."""

    def __init__(self, max_side: int = 1600, confidence: float = 0.75) -> None:
        self.max_side = max_side
        self.confidence = confidence
        self.model_path = settings.model_dir / "face_detection_yunet_2023mar.onnx"

    def detect(self, image: Image.Image) -> list[FaceRegion]:
        if not self.model_path.exists():
            raise FileNotFoundError(f"Missing face detector: {self.model_path}")
        rgb = np.asarray(ImageOps.exif_transpose(image).convert("RGB"))
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        height, width = bgr.shape[:2]
        scale = min(1.0, self.max_side / max(width, height))
        work = cv2.resize(
            bgr, (round(width * scale), round(height * scale)),
            interpolation=cv2.INTER_AREA,
        ) if scale < 1 else bgr
        detector = cv2.FaceDetectorYN.create(
            str(self.model_path), "", (work.shape[1], work.shape[0]),
            self.confidence, 0.3, 5000,
        )
        _, rows = detector.detect(work)
        if rows is None:
            return []

        inverse = 1.0 / scale
        found: list[FaceRegion] = []
        for row in rows:
            x, y, box_width, box_height = [float(value) * inverse for value in row[:4]]
            x1, y1 = max(0, round(x)), max(0, round(y))
            x2, y2 = min(width, round(x + box_width)), min(height, round(y + box_height))
            # The larger crop retains forehead and chin while the semantic parser
            # removes hair, eyes, lips, clothing, and background later.
            pad_x = 0.32 * box_width
            pad_top = 0.38 * box_height
            pad_bottom = 0.30 * box_height
            crop_box = (
                max(0, round(x - pad_x)), max(0, round(y - pad_top)),
                min(width, round(x + box_width + pad_x)),
                min(height, round(y + box_height + pad_bottom)),
            )
            landmarks = tuple(
                (round(float(row[4 + 2 * index]) * inverse),
                 round(float(row[5 + 2 * index]) * inverse))
                for index in range(5)
            )
            found.append(FaceRegion(
                id="", box=(x1, y1, x2, y2), crop_box=crop_box,
                landmarks=landmarks, confidence=float(row[14]),
            ))
        found.sort(key=lambda face: face.box[0])
        return [FaceRegion(
            id=f"face-{index}", box=face.box, crop_box=face.crop_box,
            landmarks=face.landmarks, confidence=face.confidence,
        ) for index, face in enumerate(found, 1)]


class FaceSkinAnalyzer:
    """Finds high-recall visual anomalies only inside parsed facial skin."""

    SKIN_LABEL = 1

    def __init__(self, max_candidates_per_face: int = 12) -> None:
        self.max_candidates_per_face = max_candidates_per_face
        self.model_path = settings.model_dir / "face_parsing_resnet18.onnx"
        self._net = None

    def _load(self):
        if self._net is None:
            if not self.model_path.exists():
                raise FileNotFoundError(f"Missing face parser: {self.model_path}")
            self._net = cv2.dnn.readNetFromONNX(str(self.model_path))
        return self._net

    def skin_mask(self, crop_bgr: np.ndarray, face: FaceRegion) -> np.ndarray:
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        tensor = cv2.resize(rgb, (512, 512), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        tensor = (tensor - np.array([0.485, 0.456, 0.406], np.float32)) / np.array(
            [0.229, 0.224, 0.225], np.float32
        )
        tensor = np.transpose(tensor, (2, 0, 1))[None]
        net = self._load()
        net.setInput(tensor)
        labels = net.forward().argmax(1).squeeze(0).astype(np.uint8)
        labels = cv2.resize(
            labels, (crop_bgr.shape[1], crop_bgr.shape[0]),
            interpolation=cv2.INTER_NEAREST,
        )
        safe = (labels == self.SKIN_LABEL).astype(np.uint8)
        # Keep candidates away from semantic boundaries such as eyelashes,
        # lips, nostrils, hairline, and ears.
        radius = max(5, round(min(crop_bgr.shape[:2]) * 0.018))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
        safe = cv2.erode(safe, kernel)

        crop_x, crop_y, _, _ = face.crop_box
        face_width = face.box[2] - face.box[0]
        face_height = face.box[3] - face.box[1]
        protected = np.zeros_like(safe)
        # YuNet supplies two eye centers and two mouth corners. These broad
        # protected ellipses include eyelashes, eyelids, brows, teeth, and lips.
        for eye_x, eye_y in face.landmarks[:2]:
            cv2.ellipse(
                protected, (eye_x - crop_x, eye_y - crop_y),
                (round(face_width * 0.17), round(face_height * 0.14)),
                0, 0, 360, 1, -1,
            )
        mouth_left, mouth_right = face.landmarks[3], face.landmarks[4]
        mouth_center = (
            round((mouth_left[0] + mouth_right[0]) / 2) - crop_x,
            round((mouth_left[1] + mouth_right[1]) / 2) - crop_y,
        )
        cv2.ellipse(
            protected, mouth_center,
            (round(face_width * 0.20), round(face_height * 0.13)),
            0, 0, 360, 1, -1,
        )
        safe[protected > 0] = 0
        # A conservative inner face oval rejects the strong light/dark seam at
        # temples and hairlines, a major source of false blemish detections.
        oval = np.zeros_like(safe)
        face_center = (
            round((face.box[0] + face.box[2]) / 2) - crop_x,
            round(face.box[1] + face_height * 0.54) - crop_y,
        )
        cv2.ellipse(
            oval, face_center,
            (round(face_width * 0.47), round(face_height * 0.53)),
            0, 0, 360, 1, -1,
        )
        forehead = np.array([[
            (round(face.box[0] + face_width * 0.06) - crop_x,
             round(face.box[1] + face_height * 0.01) - crop_y),
            (round(face.box[2] - face_width * 0.06) - crop_x,
             round(face.box[1] + face_height * 0.01) - crop_y),
            (round(face.box[2] - face_width * 0.18) - crop_x,
             round(face.box[1] + face_height * 0.39) - crop_y),
            (round(face.box[0] + face_width * 0.18) - crop_x,
             round(face.box[1] + face_height * 0.39) - crop_y),
        ]], dtype=np.int32)
        cv2.fillPoly(oval, forehead, 1)
        safe &= oval
        return safe

    def candidates(
        self, crop_bgr: np.ndarray, safe_skin: np.ndarray, face: FaceRegion
    ) -> list[SkinCandidate]:
        lab = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        luminance, redness = lab[..., 0], lab[..., 1]
        short_side = min(crop_bgr.shape[:2])
        sigma_small = max(1.2, short_side / 260.0)
        sigma_large = max(5.0, short_side / 45.0)
        local_l = cv2.GaussianBlur(luminance, (0, 0), sigma_large)
        local_a = cv2.GaussianBlur(redness, (0, 0), sigma_large)
        light = cv2.GaussianBlur(np.maximum(luminance - local_l, 0), (0, 0), sigma_small)
        dark = cv2.GaussianBlur(np.maximum(local_l - luminance, 0), (0, 0), sigma_small)
        red = cv2.GaussianBlur(np.maximum(redness - local_a, 0), (0, 0), sigma_small)
        morphology_size = max(17, round(short_side * 0.075) | 1)
        morphology_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (morphology_size, morphology_size)
        )
        luminance_u8 = np.clip(luminance, 0, 255).astype(np.uint8)
        white_hat = cv2.morphologyEx(
            luminance_u8, cv2.MORPH_TOPHAT, morphology_kernel
        ).astype(np.float32)
        black_hat = cv2.morphologyEx(
            luminance_u8, cv2.MORPH_BLACKHAT, morphology_kernel
        ).astype(np.float32)
        score = np.maximum.reduce((
            light * 1.15, dark * 0.82, red * 1.05,
            white_hat * 1.08, black_hat * 0.78,
        ))

        valid = safe_skin.astype(bool)
        values = score[valid]
        if values.size < 100:
            return []
        median = float(np.median(values))
        mad = float(np.median(np.abs(values - median))) + 1e-4
        threshold = max(median + 5.0 * mad, float(np.quantile(values, 0.992)), 5.0)
        binary = ((score >= threshold) & valid).astype(np.uint8)
        # Subtle streaks can be locally obvious but globally weak. Tile-wise
        # thresholds preserve them for the semantic stage, which will later
        # discard candidates outside a diagnosed facial region.
        adaptive = np.zeros_like(binary)
        tile_size = max(72, round(short_side * 0.20))
        for top in range(0, score.shape[0], tile_size):
            for left in range(0, score.shape[1], tile_size):
                tile_valid = valid[top:top + tile_size, left:left + tile_size]
                tile_values = score[top:top + tile_size, left:left + tile_size][tile_valid]
                if tile_values.size < 120:
                    continue
                tile_median = float(np.median(tile_values))
                tile_mad = float(np.median(np.abs(tile_values - tile_median))) + 1e-4
                tile_threshold = max(
                    tile_median + 3.8 * tile_mad,
                    float(np.quantile(tile_values, 0.982)),
                    6.0,
                )
                tile_score = score[top:top + tile_size, left:left + tile_size]
                adaptive[top:top + tile_size, left:left + tile_size] = (
                    (tile_score >= tile_threshold) & tile_valid
                ).astype(np.uint8)
        binary |= adaptive
        binary = cv2.morphologyEx(
            binary, cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
        )

        count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, 8)
        crop_area = crop_bgr.shape[0] * crop_bgr.shape[1]
        ranked: list[tuple[float, int, tuple[int, int, int, int], tuple[int, int]]] = []
        for index in range(1, count):
            x, y, width, height, area = map(int, stats[index])
            if area < 3 or area > crop_area * 0.012:
                continue
            if width > crop_bgr.shape[1] * 0.28 or height > crop_bgr.shape[0] * 0.28:
                continue
            member = labels == index
            strength = float(np.quantile(score[member], 0.90))
            compactness = area / max(1, width * height)
            rank = strength * (0.7 + 0.3 * min(1.0, compactness * 2.0))
            center = tuple(round(float(value)) for value in centroids[index])
            ranked.append((rank, index, (x, y, x + width, y + height), center))

        crop_x, crop_y, _, _ = face.crop_box
        result: list[SkinCandidate] = []
        for candidate_index, (rank, component, box, center) in enumerate(
            sorted(ranked, reverse=True)[: self.max_candidates_per_face], 1
        ):
            member = labels == component
            signal_values = {
                "light_mark": float(np.mean(light[member])),
                "dark_mark": float(np.mean(dark[member])),
                "red_mark": float(np.mean(red[member])),
            }
            signal = max(signal_values, key=signal_values.get)
            x1, y1, x2, y2 = box
            pad = max(3, round(max(x2 - x1, y2 - y1) * 0.35))
            result.append(SkinCandidate(
                id=f"{face.id}-candidate-{candidate_index}", face_id=face.id,
                box=(
                    crop_x + max(0, x1 - pad), crop_y + max(0, y1 - pad),
                    crop_x + min(crop_bgr.shape[1], x2 + pad),
                    crop_y + min(crop_bgr.shape[0], y2 + pad),
                ),
                center=(crop_x + center[0], crop_y + center[1]),
                score=round(rank, 3), signal=signal,
            ))
        return result


def serializable(face: FaceRegion | SkinCandidate) -> dict:
    return asdict(face)
