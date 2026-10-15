"""Preview output must preserve the edited frame's proportions."""
import ast
import io
from pathlib import Path
from types import SimpleNamespace
import unittest
from PIL import Image

from previews import _fit_size


class ProxyGeometryTests(unittest.TestCase):
    def proxy(self, edit, width=320):
        # Exercise the actual proxy function without starting the server or models.
        tree = ast.parse(Path(__file__).with_name('server.py').read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == '_render_proxy')
        source = Image.new('RGB', (900, 600), 'orange')
        namespace = {
            'Image': Image, 'io': io, '_fit_size': _fit_size,
            '_decode_small': lambda *args, **kwargs: (source.copy(), 900),
            '_photo_key': lambda path: path,
            'raw': SimpleNamespace(develop_of=lambda recipe: None),
            'render': SimpleNamespace(render=lambda image, *args, **kwargs: (edit(image), {})),
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'server.py', 'exec'), namespace)
        return Image.open(io.BytesIO(namespace['_render_proxy']('test.jpg', width, [{'tool': 'geometry'}]))).size

    def test_rotated_landscape_becomes_portrait(self):
        width, height = self.proxy(lambda image: image.transpose(Image.Transpose.ROTATE_270))
        self.assertEqual(height, 320)
        self.assertLessEqual(abs(width - height * 2 / 3), 1)

    def test_portrait_crop_keeps_its_ratio(self):
        self.assertEqual(self.proxy(lambda image: image.crop((0, 0, 200, 400))), (160, 320))

    def test_unchanged_landscape_keeps_its_ratio(self):
        width, height = self.proxy(lambda image: image)
        self.assertEqual(width, 320)
        self.assertLessEqual(abs(height - width * 2 / 3), 1)


if __name__ == '__main__':
    unittest.main()
