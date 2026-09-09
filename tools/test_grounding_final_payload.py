"""Final-answer parsing must not turn model reasoning into repair candidates."""
import unittest
from evaluate_face_grounding import final_payload


class FinalPayloadTests(unittest.TestCase):
    def test_only_completed_final_answer_is_used(self):
        text='<think>{"marks":[{"label":"not a final answer"}]}</think>{"marks":[]}<|im_end|>'
        self.assertEqual(final_payload(text,thinking=True),{'marks':[]})

    def test_incomplete_thinking_is_not_empty_success(self):
        with self.assertRaises(ValueError):
            final_payload('<think>{"marks":[]}',thinking=True)

    def test_fenced_final_json(self):
        self.assertEqual(final_payload('```json\n{"marks":[]}\n```<|im_end|>'),{'marks':[]})

    def test_ambiguous_second_answer_is_rejected(self):
        with self.assertRaises(ValueError):
            final_payload('{"marks":[]} {"marks":[]}')

    def test_invalid_coordinates_are_rejected(self):
        for box in ('[-1,0,2,3]','[0,0,0,2]','[0,0,1001,3]','[true,0,2,3]','[0,0,NaN,3]'):
            with self.subTest(box=box), self.assertRaises(ValueError):
                final_payload('{"marks":[{"label":"mark","box":'+box+'}]}')


if __name__=='__main__':
    unittest.main()
