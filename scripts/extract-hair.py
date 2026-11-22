#!/usr/bin/env python3
"""Extract registered, manually masked hairstyle candidates from PNG images."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops


def extract(reference, source, mask, threshold):
    if source.size != reference.size or mask.size != reference.size:
        raise ValueError("Reference, source and mask must have identical canvas dimensions")
    reference = reference.convert("RGBA")
    source = source.convert("RGBA")
    mask = mask.convert("L")
    difference = ImageChops.difference(reference, source)
    channels = difference.split()
    changed = ImageChops.lighter(
        ImageChops.lighter(channels[0], channels[1]),
        ImageChops.lighter(channels[2], channels[3]),
    )
    changed = changed.point(lambda value: 255 if value > threshold else 0)
    alpha = ImageChops.multiply(ImageChops.multiply(source.getchannel("A"), mask), changed)
    source.putalpha(alpha)
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True, help="Registered bald PNG")
    parser.add_argument("--sources", type=Path, required=True, help="Directory containing style_NNN.png")
    parser.add_argument("--masks", type=Path, required=True, help="Directory containing manually reviewed mask_NNN.png")
    parser.add_argument("--output", type=Path, required=True, help="Output assets directory")
    parser.add_argument("--threshold", type=int, default=5, choices=range(256), metavar="0..255")
    args = parser.parse_args()

    reference = Image.open(args.reference)
    if reference.format != "PNG":
        raise ValueError("The registered reference must be a lossless PNG")
    sources = sorted(args.sources.glob("style_[0-9][0-9][0-9].png"))
    if not sources:
        raise ValueError("No style_NNN.png images found")
    pending = {}
    for path in sources:
        style = int(path.stem[-3:])
        if style == 0 or style > 170:
            raise ValueError(f"Expected hairstyle IDs 001 through 170, not {style:03d}")
        source = Image.open(path)
        mask_path = args.masks / f"mask_{style:03d}.png"
        if not mask_path.is_file():
            raise ValueError(f"Missing reviewed mask: {mask_path}")
        layer = extract(reference, source, Image.open(mask_path), args.threshold)
        if layer.getchannel("A").getbbox() is None:
            raise ValueError(f"Empty hair candidate for style {style:03d}")
        pending[style] = layer

    # Candidates require review before a manifest is deployed to the application.
    hair_output = args.output / "hair"
    hair_output.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", reference.size).save(hair_output / "hair_000.png")
    manifest = {"0": {"file": "hair_000.png", "name": "Bald"}}
    for style, layer in pending.items():
        name = f"hair_{style:03d}.png"
        layer.save(hair_output / name)
        manifest[str(style)] = {"file": name, "name": f"Style {style}"}
    (args.output / "hair_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {len(pending)} candidates and bald to {args.output}; review all candidates before use.")


if __name__ == "__main__":
    main()
