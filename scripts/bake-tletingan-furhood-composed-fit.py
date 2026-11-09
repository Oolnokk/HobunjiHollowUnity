#!/usr/bin/env python3
"""Bake the composed Tletingan fur-hood fit once from the unaltered PNGs.

Requires Pillow. Run from the repository root. Refuses to re-bake already modified
sprites; restore the pre-bake images before running with --write.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HOODS = ROOT / "docs/assets/cosmetics/clothes/hood"
REVERT_RECORD = ROOT / "scripts/records/tletingan-furhood-bake-2026-11-03.json"
# Effective transform: first fit followed by corrected-editor fit, around the image center.
SCALE_X = 0.835 * 1.105
SCALE_Y = 0.835 * 1.165
TRANSLATE_X = -3.5 * 1.105
TRANSLATE_Y = -11.25 * 1.165 + 11.75
CANVAS = (234, 173)


def git_blob_sha(data):
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def single_pass(source):
    """Nearest-neighbor inverse pixel-center lookup; never resample twice."""
    if source.size != CANVAS or source.mode != "RGBA":
        raise ValueError(f"Expected RGBA {CANVAS}, found {source.mode} {source.size}")
    width, height = CANVAS
    output = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    src, dst = source.load(), output.load()
    # x_indices/y_indices are used for deterministic source pixel lookup below.
    x_indices = [math.floor(((x + 0.5 - width / 2 - TRANSLATE_X) / SCALE_X)
                            + width / 2 - 0.5 + 0.5) for x in range(width)]
    y_indices = [math.floor(((y + 0.5 - height / 2 - TRANSLATE_Y) / SCALE_Y)
                            + height / 2 - 0.5 + 0.5) for y in range(height)]
    for y, src_y in enumerate(y_indices):
        if not 0 <= src_y < height:
            continue
        for x, src_x in enumerate(x_indices):
            if 0 <= src_x < width:
                dst[x, y] = src[src_x, src_y]
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Write the one-pass sprite replacements")
    args = parser.parse_args()
    record = json.loads(REVERT_RECORD.read_text())
    rendered = []
    for entry in record["files"]:
        path = HOODS / entry["file"]
        actual_sha = git_blob_sha(path.read_bytes())
        if actual_sha != entry["beforeGitBlob"]:
            raise SystemExit(f"Refusing to re-bake non-original art: {path} ({actual_sha})")
        with Image.open(path) as src:
            rendered.append((path, single_pass(src)))
    # Validate all inputs BEFORE touching any output, to avoid a half-baked batch.
    if args.write:
        for path, rendered_image in rendered:
            rendered_image.save(path, format="PNG")
        print(f"Baked {len(rendered)} sprites in one pass from the verified originals")
    else:
        print(f"Verified {len(rendered)} originals. Re-run with --write to bake")


if __name__ == "__main__":
    main()
