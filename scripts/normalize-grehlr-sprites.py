#!/usr/bin/env python3
"""Check or normalize authored Grehlr PNG canvases to 750x562.

Requires Pillow: python -m pip install Pillow
Preview dimensions with no file changes: python scripts/normalize-grehlr-sprites.py
Rewrite only mismatched canvases: python scripts/normalize-grehlr-sprites.py --write
"""
import argparse
from pathlib import Path

from PIL import Image

TARGET = (750, 562)  # Shared canvas used by Grehlr body poses, eyes and patterns.
ROOT = Path("docs/assets/creaturesprites")  # Restricts changes to the game's creature sprites.


def candidates():
    # Used by main to limit resizing to Grehlr; all other creature assets are untouched.
    return sorted((*ROOT.glob("grehlr_*.png"), *ROOT.glob("patterns/grehlr_*.png")))


def normalize(path, write):
    with Image.open(path) as source:
        source.load()
        size = source.size
        print(f"{path}: {size[0]}x{size[1]}")
        if size == TARGET:
            return False
        if not write:
            return True
        # Nearest-neighbor retains the actual painted palette without adding blended shades.
        resized = source.convert("RGBA").resize(TARGET, Image.Resampling.NEAREST)
    # Save after the source file handle has closed (safe on Windows as well as Linux).
    resized.save(path, format="PNG", optimize=True)
    print(f"  normalized to {TARGET[0]}x{TARGET[1]}")
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Normalize mismatched PNGs in place")
    args = parser.parse_args()
    assets = candidates()
    if not assets:
        parser.error("No Grehlr PNG assets found")
    mismatches = sum(normalize(path, args.write) for path in assets)
    if mismatches:
        print(f"{mismatches} mismatched PNG(s). Use --write to normalize.")
    return int(bool(mismatches))


if __name__ == "__main__":
    raise SystemExit(main())
