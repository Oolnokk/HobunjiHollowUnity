#!/usr/bin/env python3
"""Normalize Grehlr PNG canvases, preserving source pixels with nearest-neighbor sampling.

Use --check to report dimensions without edits; --write to resize mismatches.
--emit is an audited GitHub Actions transport for binary assets when only GitHub's
UTF-8 connector is available. It prints base64 chunks, never modifying the repo.
"""
import argparse
import base64
import hashlib
import io
from pathlib import Path

from PIL import Image

TARGET = (750, 562)  # Shared Grehlr sprite, eye and inherited-pattern canvas.
ROOT = Path("docs/assets/creaturesprites")  # Game source sprites to inspect.
CHUNK_SIZE = 12000  # Keeps GitHub Actions log lines below its truncation limit.


def candidates():
    # Only Grehlr art is eligible; unrelated creatures are never resampled.
    return sorted((*ROOT.glob("grehlr_*.png"), *ROOT.glob("patterns/grehlr_*.png")))


def process(path, mode):
    with Image.open(path) as image:
        image.load()
        width, height = image.size
        print(f"GREHLR_DIM {path} {width}x{height}", flush=True)
        if (width, height) == TARGET:
            return
        if width <= 0 or height <= 0:
            raise ValueError(f"Invalid PNG dimensions: {path}")
        # Pixel-art fidelity: nearest-neighbor, no blurring or invented intermediate colors.
        fixed = image.convert("RGBA").resize(TARGET, resample=Image.Resampling.NEAREST)
        data = io.BytesIO()
        fixed.save(data, format="PNG", optimize=True)
        result = data.getvalue()
        if mode == "write":
            path.write_bytes(result)
        elif mode == "emit":
            encoded = base64.b64encode(result).decode("ascii")
            parts = [encoded[i:i + CHUNK_SIZE] for i in range(0, len(encoded), CHUNK_SIZE)]
            print(f"GREHLR_BEGIN {path} {width}x{height} {len(parts)}", flush=True)
            for index, part in enumerate(parts):
                print(f"GREHLR_CHUNK {path} {index} {part}", flush=True)
            print(f"GREHLR_END {path} {hashlib.sha256(result).hexdigest()}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="Rewrite mismatched PNGs in place")
    mode.add_argument("--emit", action="store_true", help="Output base64 chunks to actions logs")
    args = parser.parse_args()
    assets = candidates()
    if not assets:
        raise RuntimeError("No Grehlr PNG assets found")
    for path in assets:
        process(path, "write" if args.write else "emit" if args.emit else "check")


if __name__ == "__main__":
    main()
