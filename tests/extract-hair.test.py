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
    def test_atlas_contains_exact_reviewed_layers(self):
        assets = path.parents[1] / "assets"
        positions = json.loads((assets / "sprite_atlas.json").read_text())
        expected = set()
        for manifest, directory in (("hair", "hair"), ("facial_hair", "facial_hair"),
                                    ("accessory", "accessories")):
            entries = json.loads((assets / f"{manifest}_manifest.json").read_text())
            expected.update(f"assets/{directory}/{entry['file']}" for entry in entries.values())
        self.assertEqual(set(positions), expected)
        with Image.open(assets / "sprite_atlas.png") as atlas:
            for name, rect in positions.items():
                with self.subTest(name=name), Image.open(path.parents[1] / name) as source:
                    x, y, width, height, left, top = rect
                    source = source.convert("RGBA")
                    if not width or not height:
                        self.assertIsNone(source.getchannel("A").getbbox())
                        continue
                    self.assertLessEqual(x + width, atlas.width)
                    self.assertLessEqual(y + height, atlas.height)
                    cropped = source.crop((left, top, left + width, top + height))
                    self.assertEqual(cropped.tobytes(),
                                     atlas.crop((x, y, x + width, y + height)).tobytes())
                    self.assertEqual(source.getchannel("A").getbbox(),
                                     (left, top, left + width, top + height))

    def test_screenshot_artifacts_do_not_cover_face_or_beard(self):
        assets = path.parents[1] / "assets"
        for ident in (2, 3, 12, 19, 20, 21, 22, 23):
            with self.subTest(accessory=ident), Image.open(
                    assets / "accessories" / f"accessory_{ident:03}.png") as image:
                alpha = image.convert("RGBA").getchannel("A")
                self.assertIsNone(alpha.crop((84, 184, 158, 189)).getbbox())
                self.assertIsNone(alpha.crop((106, 144, 107, 164)).getbbox())
        with Image.open(assets / "accessories" / "accessory_023.png") as image:
            self.assertIsNone(image.getchannel("A").crop((172, 144, 173, 164)).getbbox())
            self.assertGreater(image.getchannel("A").getpixel((100, 115)), 0)
        for ident in (25, 26, 40, 57, 104, 123, 128, 138, 143, 167):
            with self.subTest(hair=ident), Image.open(
                    assets / "hair" / f"hair_{ident:03}.png") as image:
                alpha = image.convert("RGBA").getchannel("A")
                self.assertIsNone(alpha.crop((91, 147, 106, 157)).getbbox())
                self.assertIsNone(alpha.crop((121, 147, 143, 157)).getbbox())

    def test_earring_layer_has_no_stray_face_pixels(self):
        image_path = path.parents[1] / "assets" / "accessories" / "accessory_016.png"
        with Image.open(image_path) as image:
            self.assertEqual(image.convert("RGBA").getchannel("A").getbbox(), (158, 157, 165, 164))

    def test_refined_goggles_mask_and_monocle_stay_aligned(self):
        assets = path.parents[1] / "assets" / "accessories"
        with Image.open(assets / "accessory_005.png") as image:
            self.assertEqual(image.getchannel("A").getbbox(), (66, 147, 162, 174))
        with Image.open(assets / "accessory_008.png") as image:
            alpha = image.getchannel("A")
            self.assertEqual(alpha.getbbox(), (84, 119, 151, 174))
            self.assertFalse(any(alpha.getpixel((x, y)) for y in range(174, image.height)
                                 for x in range(image.width)))
            for x in (94, 135):
                self.assertTrue(all(alpha.getpixel((x, y)) == 0 for y in range(151, 171)))
        with Image.open(assets / "accessory_010.png") as image:
            alpha = image.getchannel("A")
            self.assertEqual(alpha.getbbox(), (123, 149, 151, 177))
            self.assertIn(128, alpha.get_flattened_data())
            self.assertIn(255, alpha.get_flattened_data())
            self.assertEqual(alpha.getpixel((123, 149)), 0)
            self.assertEqual(alpha.getpixel((136, 149)), 255)

    def test_hair_110_has_no_detached_eye_pixels(self):
        image_path = path.parents[1] / "assets" / "hair" / "hair_110.png"
        with Image.open(image_path) as image:
            alpha = image.getchannel("A")
            self.assertEqual(alpha.getbbox(), (76, 90, 173, 192))
            self.assertEqual(alpha.getpixel((98, 151)), 0)
            self.assertEqual(alpha.getpixel((130, 151)), 0)

    def test_facial_hair_position_on_base_canvas(self):
        assets = path.parents[1] / "assets" / "facial_hair"
        for filename, bounds in [
            ("facial_001.png", (99, 176, 135, 190)),
            ("facial_012.png", (80, 163, 162, 208)),
        ]:
            with self.subTest(filename=filename), Image.open(assets / filename) as image:
                self.assertEqual(image.getchannel("A").getbbox(), bounds)

    def test_detached_dark_facial_artifacts_are_removed(self):
        assets = path.parents[1] / "assets" / "facial_hair"
        for ident, point in [(1, (94, 190)), (9, (94, 190)), (13, (107, 190)),
                             (24, (107, 190)), (26, (135, 197)),
                             (28, (143, 190)), (31, (107, 190))]:
            with self.subTest(facial=ident), Image.open(assets / f"facial_{ident:03}.png") as image:
                self.assertEqual(image.getchannel("A").getpixel(point), 0)
        with Image.open(assets / "facial_003.png") as image:
            self.assertEqual(image.convert("RGBA").getpixel((87, 190)), (0, 0, 0, 255))

    def test_available_layers_have_the_canonical_canvas_and_manifest_ids(self):
        assets = path.parents[1] / "assets"
        with Image.open(assets / "player_base.png") as base:
            size = base.size
        categories = [
            ("hair", "hair", "hair"),
            ("facial_hair", "facial_hair", "facial"),
            ("accessory", "accessories", "accessory"),
        ]
        for manifest_name, directory, prefix in categories:
            manifest = json.loads((assets / f"{manifest_name}_manifest.json").read_text())
            if manifest_name == "hair":
                self.assertEqual(set(map(int, manifest)), set(range(171)))
            elif manifest_name == "accessory":
                self.assertEqual(set(map(int, manifest)), set(range(1, 26)))
            for ident, entry in manifest.items():
                with self.subTest(category=manifest_name, ident=ident):
                    self.assertEqual(entry["file"], f"{prefix}_{int(ident):03}.png")
                    with Image.open(assets / directory / entry["file"]) as image:
                        self.assertEqual(image.size, size)
                        alpha = image.convert("RGBA").getchannel("A")
                        if prefix == "hair" and ident == "0":
                            self.assertIsNone(alpha.getbbox())
                        else:
                            self.assertIsNotNone(alpha.getbbox())

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
