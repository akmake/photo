import pytest
from smart_cleanup_agent.contracts import Box
from smart_cleanup_agent.vision import normalized_box_to_pixels


def test_normalized_coordinates_on_non_square_original():
    result=normalized_box_to_pixels(Box(x1=100,y1=200,x2=300,y2=400),5472,3648)
    assert result.model_dump()=={'x1':547,'y1':729,'x2':1642,'y2':1460}


def test_full_frame_and_tiny_edge_region_do_not_collapse():
    assert normalized_box_to_pixels(Box(x1=0,y1=0,x2=1000,y2=1000),461,624)==Box(x1=0,y1=0,x2=461,y2=624)
    assert normalized_box_to_pixels(Box(x1=999,y1=999,x2=1000,y2=1000),461,624)==Box(x1=460,y1=623,x2=461,y2=624)


def test_invalid_coordinates_are_not_silently_clamped():
    with pytest.raises(ValueError):
        normalized_box_to_pixels(Box(x1=900,y1=10,x2=1100,y2=20),100,100)
