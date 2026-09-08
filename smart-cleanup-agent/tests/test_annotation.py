from pathlib import Path

from smart_cleanup_agent.annotation import annotator


def test_annotator_page_is_available():
    response = annotator()
    html = Path(response.path).read_text(encoding="utf-8")
    assert "סימון פגם שלם" in html
