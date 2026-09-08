import numpy as np

from smart_cleanup_agent.face_analysis import FaceRegion, FaceSkinAnalyzer


def test_candidate_coordinates_are_mapped_back_to_source(monkeypatch):
    analyzer = FaceSkinAnalyzer(max_candidates_per_face=5)
    crop = np.full((160, 160, 3), 150, dtype=np.uint8)
    crop[75:82, 80:87] = 245
    safe = np.ones((160, 160), dtype=np.uint8)
    face = FaceRegion(
        id="face-1", box=(110, 210, 220, 320), crop_box=(100, 200, 260, 360),
        landmarks=(), confidence=0.99,
    )
    candidates = analyzer.candidates(crop, safe, face)
    assert candidates
    assert any(175 <= item.center[0] <= 195 and 265 <= item.center[1] <= 295 for item in candidates)
    assert all(not item.safe_to_clean for item in candidates)
