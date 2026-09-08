from smart_cleanup_agent.face_analysis import FaceRegion, SkinCandidate
from smart_cleanup_agent.face_semantics import candidate_in_region


def _candidate(center):
    return SkinCandidate(
        id="c", face_id="f", box=(0, 0, 1, 1), center=center,
        score=1.0, signal="light_mark",
    )


def test_candidate_region_mapping_protects_other_face_areas():
    face = FaceRegion(
        id="f", box=(100, 100, 300, 400), crop_box=(80, 70, 320, 440),
        landmarks=((150, 200), (250, 200), (200, 260), (160, 320), (240, 320)),
        confidence=1.0,
    )
    assert candidate_in_region(_candidate((180, 150)), face, "forehead")
    assert not candidate_in_region(_candidate((180, 150)), face, "chin")
    assert candidate_in_region(_candidate((200, 370)), face, "chin")
