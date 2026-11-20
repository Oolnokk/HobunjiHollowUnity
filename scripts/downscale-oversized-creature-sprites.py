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

# Grehlr coat paintover: highlights are pose-matched 375x281 bitmaps sampled
# from the human-authored 750x562 mint reference and its two programmatically
# transferred run frames. Original region-mask selection excludes eyes,
# white fur, muzzle, claws and outlines; the shared JS ColorFill handles genotypes.
import base64
import zlib

HIGHLIGHT_B85 = {
    "idle": "c-rllF^=3Y3`HfVP>MyAGR0tgg_K(a@KthzlqrJ9xtWgQBe-;7SfOOkjAs^0@h4aW3HaN2tNkKrlD07_l}e>jsZ=VJN~Kc$-*Oqk!wTX34B>G^XqyM<rkM3GL3o!S{0EjLEQ}8G@*eZ@K_42`zbdeJzd*Fbo;we<FVkUo#H=q^bA%eT=`rhX>E(?tid6tMd%*$LLpSvqnlYyy8jlHzqcfH*7<>P}pRm#V%%D$?TSZ`7z-I#Pa+ulC`<;OGF6P_@V^=!-n8TjMeg2t`xXqa>ua15`;-1Ij15RETGp^8wtJ*vo|9S<4ir>!je4*3-PTj#x$5(D4{o#Cm$s}^z{13bJ)bO%j_wwgM%S+A7a>)X}o9Ai6=WTZ7wQ0TL<@s=v%WMar5T>gco2S5cfO^x4=W>rZ@_3xi7kt;!o>oVEZBGa%#m5&o8~5S*M2Jo|kGQ0hh8vzRT(m17&P#5`C`i(+8Kfw`DdA?vMKgme@3>@USn>eG(UAwbWhcaa#ivf3rIAWF1;+bum!(Ab;DlH0D{iECEGKWRPZIZh!)Fm*SB4;~8C&sbD`O0wB}px#a;#O~*fc-Zq+ao<(K1dosY}UJ3IFSLGF~?gPk2u@xb<uQwoo?u62yYXNrVToOwW^vskyUuX2Wa0X2KG--_Erl$2w!Urg1jc$kc*d_?7x}#A}7I`2K$OZmZu?15UV?mXcY^*c0MZ19Y;N;!6#y6i>^RE$Nc{&Gg78r%z>-G@X0}AKGiupS?b`@W(AW^7!~-n*iPiD3A%l`4@4AeF*dz9<Z!{NsL$$Glbg=y}vry*g9-HV*I&oJmQZGbLmAhl2F<B|LwqFS@Kv7n6LWTPo+|+R4SE9rBeM({Q@>Q8A1",
    "run1": "c-rllJ8s-C5QfPR2pc1G=^|KO!$lDJC_ciLsUjsQax4?b0dfTazJP!<Dg=!wirl4kk<m=y!pZ!N3x7)u=fN3LDUnDd5{X12kw_#GiT-UFVBv0N;mydx+nz&f=vX`DneGPOP6G@7%Az&TjfQ8-2VTb9O3{eks+h_9$SYG`-C5T0r92OBd8SXi!;y7RtA=O#YufV48|7sHulF(=Si{<>1y+waG_3X*Sbj9hpb4Y5-@e%^oNZ9<5%lJAs&ES1=cl;%CWe5v-WU*=H$Ddh*Ryg^$FKox;IZ%xYFq<g>E+|UYuw^ET;S0b#2AzCxw56lD#<1Myq?7qJ$^g*${LSn?n2sXeSFA_WMAVN!j3I@yXEKIo-GN_#y8LSY!1U3$Z_pmxGl-_6K)2B<344dUX9T(INbEK(>RHm<!}5%i{tHZSO?b@vci71GBA1)K4pB?1xJJ07kB<BIC^?@#ht%0Jsl|rD7dot7eZr!scbboQt+WTQW1KLhwce3iV%zKoC<nd;z+PgQ6=?^7@L;h^%EWnPU#sM^5L|TF;x$ZPVql!xE&XK$hAV57W6_Qw%0}De|H-Gr1Rh}xZb$^sWZ_QLv&;e{c-|WDn6#S085N&v{>J*NB2aD(s!laulP)hQfUl?)y;J7X&oh~cWJcum}C0tA>f#<)D4o4_PmgNjwZN(j$hT=f`v3?#PgDbyWD5mK$=<0a}DN}>RwSgDK-fluBKgdr2bgpgbDoi>WRb<=hBQB;#?Z80!NyXc{uY8iFw&zUI;z!>ie08-}CSz4}XxCi?^+J;sTLKBoc{4B9TZW`akso_+hMI",
    "run2": "c-rllJ#O7F49BIYfHDMe#tuQ8V`K>6tMmvRI~0|AGabc1FQCzbYnGDz{PBX&<Pe}O_+Rsj9>s6j7?nz;QmIrbl}e>jss3*{5aG=v!n;9)hh9Qkh@zXyOmDL6rb&eV5YblVMkll7UY0QrS~RMERl?-`A}do_-FZ>_GOY{`GSf#{a}+gd)5%Q#NLxPmqOuH-&0gUE>qIy8Aeu2xooGBJksqCLWWw0vZ{M92&M_!21bTP9RWydW=PMq5h#`=p7Xt#*!RJ8Wb}|j@W7q+;@ObzMd)xw0>DA(&_qeBVxWdsE!WdWaX=h7MRZ>&&?L1E>I{tQQch<CY<`&ZL&Zn15B>O#XA)VN=T=(+t@ywQrFUEJj=-nLh9LQmwU9>IL^c8p6(Rf?4&(6kJ$PI0Jy=ldv++zqd9`e%#UzE<LmE+>$8=MSk{{|<!S6nM%(fF0qK)1ucF$T+qbGD2PXLa>fhIjB=f(J-p##u81Zx|R}U-9XJb7qD`lQ|i)mQ+T3>X^8%cy5_^13hMZY6#ooAxa7H=-<cfmD@3eYZ_;k+oMBYdI>&v%7GWuvNANh({06b#S<q=far{~f?7spU$XveMfzNWy5jkyWjxlPjwMo9B=6^=@7GPkBi<F9D5WOt@B#6N{gS}92SD*kK%ay}E-@81GhTc`_3GPYqpJzon-YD7(;sWw!2BIpEA@=WQhpr#wx&B)Mlz1Mmv&J12FKh>ku7_JXX17&I}95)-*3vBhy4xd#e(FM(?j)P%iq|e43|G2&hY2!5h6Q1$UerkWRJ13hxm=`lfftb$a2zD*-v#L9@W7rl}e>jsZ=VJO7-{Y57jvJqy",
}

def repaint_grehlr_mint():
    final_size = (750, 562)  # All three frames and all overlay assets use the authored canvas.
    highlight_grid = (375, 281)  # Half-scale contours avoid a large redundant full-resolution asset.
    dark_mint = np.array((107, 134, 107), np.float32)  # Shaded coat swatch used by genetic tint.
    light_mint = np.array((153, 191, 153), np.float32)  # Full-strength highlight and ColorFill shade anchor.
    for frame, encoded in HIGHLIGHT_B85.items():
        path = os.path.join(SPRITES, 'grehlr_' + frame + '.png')
        source = Image.open(path).convert('RGBA')
        if source.size != final_size:
            raise ValueError('Grehlr %s is %s, expected %s' % (frame, source.size, final_size))
        rgba = np.asarray(source).copy()
        rgb = rgba[..., :3].astype(np.float32)
        painted_green = (rgb[..., 1] > rgb[..., 0] + 10) & (rgb[..., 1] > rgb[..., 2] + 10) & (rgb[..., 1] > 100)
        if np.count_nonzero(painted_green) > 5000:
            print('already mint', os.path.basename(path))
            continue
        mask = decode(masks['grehlr'][frame]).astype(bool)
        if mask.shape != rgba.shape[:2]:
            raise ValueError('Grehlr mask resolution differs from %s PNG' % frame)
        packed = zlib.decompress(base64.b85decode(encoded))
        count = highlight_grid[0] * highlight_grid[1]  # Verify stored paintover mask before decoding.
        if len(packed) != (count + 7) // 8:
            raise ValueError('Corrupted Grehlr painted highlight data for %s' % frame)
        small = np.unpackbits(np.frombuffer(packed, np.uint8))[:count].reshape(highlight_grid[::-1])
        highlights = np.asarray(Image.fromarray(small * 255).resize(final_size, Image.Resampling.NEAREST)) > 0
        neutral = np.ptp(rgb, axis=-1) <= 3
        gray = rgb[..., 0]
        eligible = mask & (rgba[..., 3] > 0) & neutral & (gray >= 23) & (gray < 110)
        highlights &= eligible
        if eligible.sum() < 20000 or highlights.sum() < 1000:
            raise ValueError('Grehlr %s coat/highlight region is unexpectedly small' % frame)
        shade = np.where(highlights[..., None], light_mint, dark_mint)
        # Fade into black ink at anti-aliased fur edges without touching black outline pixels.
        strength = np.clip((gray - 23) / 17, 0, 1)[..., None]
        mixed = rgb * (1 - strength) + shade * strength
        rgba[..., :3][eligible] = np.rint(mixed[eligible]).astype(np.uint8)
        Image.fromarray(rgba, 'RGBA').save(path, optimize=True)
        print('repainted Grehlr', frame, int(eligible.sum()), 'fur', int(highlights.sum()), 'highlights')

if not dry:
    repaint_grehlr_mint()
