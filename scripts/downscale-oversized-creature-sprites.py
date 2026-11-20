#!/usr/bin/env python3
"""Downscale creature sprites authored far larger than they are ever shown.

CreatureTextureCache.fitGeneratedCanvas caps composed animal textures at 512-1024px
on the long edge, so pixels beyond 1024 only cost download, decode and (above all)
per-pixel ColorFill time. Every sprite and pattern layer of a species shares one
canvas size, so all layers are scaled together; pixel masks in
config/creature-base-masks.json are area-resampled to the new size.

Usage: python3 scripts/downscale-oversized-creature-sprites.py [--dry-run]
Idempotent: files already at or under MAX_EDGE are left alone.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image

MAX_EDGE = 1024
GREHLR_EDGE = 750  # User-authored mint Grehlr canvas; keeps body, eyes, patterns and masks registered.
ROOT = os.path.join(os.path.dirname(__file__), '..', 'docs')
SPRITES = os.path.join(ROOT, 'assets', 'creaturesprites')
MASKS = os.path.join(ROOT, 'config', 'creature-base-masks.json')
# Species whose art exceeds MAX_EDGE by enough to matter (>1.4x). Smaller overages
# (1375 / 1617 px) keep their authored size: they have pixel-coordinate rigs and masks.
PREFIXES = ('grehlr', 'voorg-ass')
dry = '--dry-run' in sys.argv

def new_size(w, h, edge=MAX_EDGE):
    s = edge / max(w, h)
    return max(1, round(w * s)), max(1, round(h * s))

def lum(a):
    return (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) / 255

def roundtrip(rgb, alpha):
    """What canvas getImageData returns for a drawn PNG: the browser stores premultiplied
    bytes, so faint pixels come back with coarse (often much brighter) RGB. ColorFill's
    auto-peak reads exactly these values. Round-then-round matches Chrome on 98.5% of all
    (color, alpha) pairs (rest are +/-1 at ties); verified against getImageData."""
    p = np.floor(rgb * alpha[..., None] / 255 + 0.5)
    return np.minimum(255, np.floor(p * 255 / np.maximum(alpha, 1)[..., None] + 0.5))

def eligible(rgb, alpha):  # Same selection ColorFill.createShadeReference uses: visible and not authored white.
    return (alpha > 0) & ~(rgb.min(-1) >= 245)

def peak(a):
    """Brightest eligible luminance as ColorFill sees it after the canvas round trip."""
    a = a.astype(np.float64)
    rgb = roundtrip(a[..., :3], a[..., 3])
    el = eligible(rgb, a[..., 3])
    return float(lum(rgb)[el].max()) if el.any() else 0.0

def keep_shade_anchor(out, old_peak):
    """Resampling blends hard-edged detail into many faint, semi-transparent edge pixels,
    and the canvas round trip inflates their RGB, so the auto-peak the recolor anchors on
    jumps and every tint of the layer comes out darker. Scale down any pixel whose
    round-tripped luminance would exceed the original layer's peak, so the anchor is unchanged."""
    a = np.asarray(out).astype(np.float64).copy()
    alpha = a[..., 3]
    def too_bright(rgb):
        r = roundtrip(rgb, alpha)
        return eligible(r, alpha) & (lum(r) > old_peak)
    bad = too_bright(a[..., :3]); n = int(bad.sum())
    base = a[..., :3].copy()
    for k in np.arange(0.95, -0.001, -0.05):
        if not bad.any(): break
        a[..., :3][bad] = np.floor(base[bad] * max(k, 0))
        bad = too_bright(a[..., :3])
    return Image.fromarray(a.astype(np.uint8), 'RGBA'), n

changed = {}
for path in sorted(glob.glob(os.path.join(SPRITES, '**', '*.png'), recursive=True)):
    if not os.path.basename(path).startswith(PREFIXES): continue
    im = Image.open(path)
    target_edge = GREHLR_EDGE if os.path.basename(path).startswith('grehlr') else MAX_EDGE  # All Grehlr layers follow the mint reference resolution.
    if max(im.size) <= target_edge: continue
    size = new_size(*im.size, target_edge)
    changed[os.path.basename(path)] = (im.size, size)
    if dry: continue
    src = im.convert('RGBA')
    out = src.resize(size, Image.LANCZOS)  # Pillow resamples RGBA with premultiplied alpha: no dark fringes.
    if os.sep + 'patterns' + os.sep in path:  # Pattern layers tint with an auto-detected peak (no fixed reference hex).
        p0 = peak(np.asarray(src))
        out, capped = keep_shade_anchor(out, p0)
        print('  anchor peak %.4f -> %.4f (%d edge pixels capped)' % (p0, peak(np.asarray(out)), capped))
    out.save(path, optimize=True)
    print('resized', os.path.relpath(path, ROOT), im.size, '->', size)

def decode(e):
    a = np.zeros(e['width'] * e['height'], np.uint8)
    r = e['runs']
    for i in range(0, len(r) - 1, 2): a[r[i]:r[i] + r[i + 1]] = 1
    return a.reshape(e['height'], e['width'])

def encode(a):
    flat = a.reshape(-1); d = np.diff(np.concatenate(([0], flat, [0])).astype(np.int8))
    starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
    runs = []
    for s, e in zip(starts, ends): runs += [int(s), int(e - s)]
    return runs

masks = json.load(open(MASKS))
for kind, frames in masks.items():
    if not kind.startswith(PREFIXES): continue
    for frame, e in frames.items():
        target_edge = GREHLR_EDGE if kind.startswith('grehlr') else MAX_EDGE  # Mask pixel indices must match the new native PNG dimensions.
        if max(e['width'], e['height']) <= target_edge: continue
        w, h = new_size(e['width'], e['height'], target_edge)
        print('mask', kind, frame, (e['width'], e['height']), '->', (w, h))
        if dry: continue
        cover = Image.fromarray(decode(e) * 255).resize((w, h), Image.BOX)  # Box = exact area coverage per new pixel.
        m = (np.asarray(cover) >= 128).astype(np.uint8)
        e['width'], e['height'] = w, h
        e['runs'] = encode(m)
        e['selectedPixels'] = int(m.sum())
if not dry:
    json.dump(masks, open(MASKS, 'w'), separators=(',', ':'))
print(len(changed), 'sprite files', 'would change' if dry else 'changed')
