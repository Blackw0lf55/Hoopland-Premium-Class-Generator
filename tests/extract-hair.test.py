import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

path = Path(__file__).resolve().parents[1] / "scripts" / "extract-hair.py"
spec = importlib.util.spec_from_file_location("extract_hair", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractionTests(unittest.TestCase):
    def test_pilot_assets_share_canvas_and_include_temple_shading(self):
        assets = path.parents[1] / "assets"
        base = Image.open(assets / "player_base.png").convert("RGBA")
        bald = Image.open(assets / "hair" / "hair_000.png").convert("RGBA")
        hair = Image.open(assets / "hair" / "hair_001.png").convert("RGBA")
        self.assertEqual(base.size, hair.size)
        self.assertEqual(base.size, bald.size)
        self.assertIsNone(bald.getchannel("A").getbbox())
        self.assertGreater(hair.getpixel((158, 135))[3], 0)
        self.assertLess(hair.getpixel((158, 135))[3], 255)

    def test_mask_difference_and_origin(self):
        base = Image.new("RGBA", (4, 3), (0, 0, 0, 0))
        base.putpixel((1, 1), (200, 150, 100, 255))
        source = base.copy()
        source.putpixel((0, 0), (0, 0, 0, 255))
        source.putpixel((2, 1), (50, 50, 50, 128))
        source.putpixel((3, 2), (255, 0, 0, 255))
        mask = Image.new("L", base.size, 0)
        mask.putpixel((0, 0), 255)
        mask.putpixel((2, 1), 255)
        result = module.extract(base, source, mask, 5)
        self.assertEqual(result.size, base.size)
        self.assertEqual(result.getpixel((0, 0)), (0, 0, 0, 255))
        self.assertEqual(result.getpixel((2, 1)), (50, 50, 50, 128))
        self.assertEqual(result.getpixel((1, 1))[3], 0)
        self.assertEqual(result.getpixel((3, 2))[3], 0)

    def test_mismatched_canvas_fails(self):
        with self.assertRaisesRegex(ValueError, "identical canvas"):
            module.extract(Image.new("RGBA", (2, 2)), Image.new("RGBA", (1, 2)),
                           Image.new("L", (2, 2)), 5)

    def test_command_writes_aligned_candidates_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sources").mkdir()
            (root / "masks").mkdir()
            reference = Image.new("RGBA", (4, 3), (0, 0, 0, 0))
            reference.save(root / "bald.png")
            source = reference.copy()
            source.putpixel((1, 1), (10, 10, 10, 255))
            source.save(root / "sources" / "style_001.png")
            Image.new("L", reference.size, 255).save(root / "masks" / "mask_001.png")
            subprocess.run([sys.executable, str(path), "--reference", str(root / "bald.png"),
                            "--sources", str(root / "sources"), "--masks", str(root / "masks"),
                            "--output", str(root / "out")], check=True, capture_output=True)
            manifest = json.loads((root / "out" / "hair_manifest.json").read_text())
            self.assertEqual(manifest["1"]["file"], "hair_001.png")
            bald = Image.open(root / "out" / "hair" / "hair_000.png")
            hair = Image.open(root / "out" / "hair" / "hair_001.png")
            self.assertEqual(bald.size, reference.size)
            self.assertIsNone(bald.getchannel("A").getbbox())
            self.assertEqual(hair.size, reference.size)
            self.assertEqual(hair.getpixel((1, 1)), (10, 10, 10, 255))


if __name__ == "__main__":
    unittest.main()
