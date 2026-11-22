#!/usr/bin/env python3
"""Pack the reviewed appearance layers into a single lossless sprite atlas."""

import json
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parents[1]
assets = root / "assets"
width = 2048
items = []
empty = []
for manifest_name, directory in (("hair", "hair"), ("facial_hair", "facial_hair"),
                                 ("accessory", "accessories")):
    manifest = json.loads((assets / f"{manifest_name}_manifest.json").read_text())
    for entry in manifest.values():
        path = f"assets/{directory}/{entry['file']}"
        image = Image.open(root / path).convert("RGBA")
        if image.size != (256, 336):
            raise ValueError(f"Incorrect sprite dimensions: {path}")
        bounds = image.getchannel("A").getbbox()
        if bounds:
            items.append((path, image.crop(bounds), bounds))
        else:
            empty.append(path)

x = y = row_height = 0
positions = {path: [0, 0, 0, 0, 0, 0] for path in empty}
for path, image, bounds in items:
    if x + image.width > width:
        x = 0
        y += row_height
        row_height = 0
    positions[path] = [x, y, image.width, image.height, bounds[0], bounds[1]]
    x += image.width
    row_height = max(row_height, image.height)

atlas = Image.new("RGBA", (width, y + row_height))
for path, image, _ in items:
    x, y = positions[path][:2]
    atlas.paste(image, (x, y))
atlas.save(assets / "sprite_atlas.png", optimize=True)
(assets / "sprite_atlas.json").write_text(json.dumps(positions, separators=(",", ":")) + "\n")
