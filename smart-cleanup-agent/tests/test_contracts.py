from smart_cleanup_agent.contracts import Diagnosis


def test_diagnosis_contract_accepts_a_grounded_problem():
    diagnosis = Diagnosis.model_validate({
        "width": 1200,
        "height": 800,
        "summary": "lint on jacket",
        "model": "test",
        "problems": [{
            "id": "p1",
            "kind": "clothing_lint",
            "label": "lint",
            "description": "small bright fiber",
            "box": {"x1": 100, "y1": 200, "x2": 130, "y2": 240},
            "confidence": 0.92,
            "severity": 0.2,
            "safe_to_auto_fix": True,
            "preserve_warning": None,
            "repair_strategy": "texture_inpaint",
        }],
    })
    assert diagnosis.problems[0].box.x2 == 130

