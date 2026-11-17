// The animal color-fill fast path (typed-array masks, fused loops, per-call color cache)
// must produce byte-identical pixels to the original closure-per-pixel algorithm.
const assert = require('assert');
global.window = {};
global.document = { createElement: () => ({}) };
require('../docs/js/color-fill.js');
const CF = window.ColorFill;
assert(CF.version >= 8, 'ColorFill fast path version expected');

// Reference: the pre-optimisation algorithm, kept verbatim in spirit (closures, two passes).
function referenceFill(data, [tr, tg, tb], predicate, baseOverride) {
  const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const white = (r, g, b) => Math.min(r, g, b) >= 245;
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  let peak = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0 || (predicate && !predicate(i)) || white(data[i], data[i + 1], data[i + 2])) continue;
    peak = Math.max(peak, lum(data[i], data[i + 1], data[i + 2]));
  }
  const base = Math.max(1 / 255, baseOverride || (peak > 0 ? peak : 0.55));
  const src = data.slice();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0 || (predicate && !predicate(i)) || white(src[i], src[i + 1], src[i + 2])) continue;
    const shade = Math.max(0, Math.min(1, lum(src[i], src[i + 1], src[i + 2]) / base));
    data[i] = clamp(tr * shade); data[i + 1] = clamp(tg * shade); data[i + 2] = clamp(tb * shade);
  }
}

function makeSprite(seed, w, h, noisy) {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const palette = Array.from({ length: 12 }, () => [rnd() * 255 | 0, rnd() * 255 | 0, rnd() * 255 | 0]);
  palette.push([255, 255, 255], [250, 248, 247], [10, 10, 10]);
  for (let i = 0; i < d.length; i += 4) {
    const c = noisy ? [rnd() * 256 | 0, rnd() * 256 | 0, rnd() * 256 | 0] : palette[rnd() * palette.length | 0];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = rnd() < 0.2 ? 0 : (rnd() < 0.1 ? 128 : 255);
  }
  return d;
}

let checked = 0;
for (const noisy of [false, true]) for (const seed of [1, 2, 3]) {
  const src = makeSprite(seed, 96, 64, noisy);
  const flags = new Uint8Array(src.length >> 2).map((_, i) => ((i * 31 + seed) % 5) > 1 ? 1 : 0);
  const pred = i => flags[i >> 2];
  const mp = i => flags[i >> 2]; mp.mask = flags;
  for (const target of [[200, 120, 80], [255, 255, 255], [3, 90, 255], [0, 0, 0]]) {
    for (const base of [0, 0.7]) {
      const ref = Uint8ClampedArray.from(src); referenceFill(ref, target, pred, base);
      const shadeReference = base ? { baseValue: base, peakLuminance: base, count: 0, config: CF.shadeFillConfig() } : null;
      const viaPredicate = Uint8ClampedArray.from(src);
      CF.shadeFillPixels(viaPredicate, target, { applyPredicate: pred, samplePredicate: pred, shadeReference });
      const viaMask = Uint8ClampedArray.from(src);
      CF.shadeFillPixels(viaMask, target, { applyMask: flags, sampleMask: flags, shadeReference });
      assert.deepStrictEqual(viaPredicate, ref, `predicate path differs (seed ${seed}, noisy ${noisy})`);
      assert.deepStrictEqual(viaMask, ref, `mask path differs (seed ${seed}, noisy ${noisy})`);
      checked += 2;
    }
    const refAll = Uint8ClampedArray.from(src); referenceFill(refAll, target, null, 0);
    const all = Uint8ClampedArray.from(src); CF.shadeFillPixels(all, target, null);
    assert.deepStrictEqual(all, refAll, 'unmasked fill differs');
    checked++;
  }
}

// Keyed (hue-matched) fill through the creature renderer: compare against the original object-allocating HSV matcher.
require('../docs/js/creature-genetics-render.js');
const R = window.CreatureGeneticsRender;
if (R?.recolorKeyedPixels) {
  const key = { hex: '#7ac07a', hueTolerance: 25, minSaturationRatio: 0.4, minValue: 0.15 };
  for (const seed of [4, 5]) {
    const src = makeSprite(seed, 80, 80, seed === 5);
    const keyRgb = R.hexToRgb(key.hex), kh = CF.rgbToHsv(...keyRgb);
    const minSat = Math.max(0.04, kh.s * key.minSaturationRatio);
    const pred = i => { if (!src[i + 3]) return false; const h = CF.rgbToHsv(src[i], src[i + 1], src[i + 2]); return h.v >= key.minValue && h.s >= minSat && CF.hueDistance(h.h, kh.h) <= key.hueTolerance; };
    const ref = Uint8ClampedArray.from(src); referenceFill(ref, [180, 60, 200], pred, 0);
    const out = Uint8ClampedArray.from(src); R.recolorKeyedPixels(out, [180, 60, 200], key);
    assert.deepStrictEqual(out, ref, 'keyed fill differs from original HSV matcher');
    checked++;
  }
}
console.log(`color-fill fast path parity OK (${checked} comparisons)`);

// A cached sprite and mask authored at different resolutions must still recolor (nearest-neighbour mask fit).
const origImage = global.Image;
if (R?.recolorPixels) {
  // fitMaskToImage is internal; exercise it through the exported fill with a mask of half the resolution.
  const big = makeSprite(9, 40, 30, false);
  const small = { width: 20, height: 15, data: new Uint8Array(20 * 15).map((_, i) => (i % 3 ? 1 : 0)) };
  const grown = new Uint8Array(40 * 30);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) grown[y * 40 + x] = small.data[(y >> 1) * 20 + (x >> 1)];
  const ref = Uint8ClampedArray.from(big); referenceFill(ref, [90, 160, 40], i => grown[i >> 2], 0);
  const m = i => grown[i >> 2]; m.mask = grown;
  const out = Uint8ClampedArray.from(big); R.recolorPixels(out, [90, 160, 40], m);
  assert.deepStrictEqual(out, ref, 'typed-mask recolor through the creature renderer differs');
  console.log('creature renderer typed-mask recolor OK');
}
void origImage;
if (R?.fitMaskToImage) {
  const m = { width: 4, height: 2, data: Uint8Array.from([1, 0, 0, 1, 0, 1, 1, 0]) };
  assert.strictEqual(R.fitMaskToImage(m, 4, 2), m, 'matching size returns the same mask');
  const up = R.fitMaskToImage(m, 8, 4);
  assert.deepStrictEqual(Array.from(up.data.slice(0, 8)), [1, 1, 0, 0, 0, 0, 1, 1], 'upscaled mask repeats source cells');
  assert.strictEqual(R.fitMaskToImage(m, 8, 4), up, 'fitted mask is cached');
  const down = R.fitMaskToImage({ width: 8, height: 4, data: up.data }, 4, 2);
  assert.deepStrictEqual(Array.from(down.data), Array.from(m.data), 'round trip restores the mask');
  const other = R.fitMaskToImage(m, 3, 3);
  assert.strictEqual(other, m, 'different aspect ratio (different art) is left alone');
  console.log('mask fit OK');
}
