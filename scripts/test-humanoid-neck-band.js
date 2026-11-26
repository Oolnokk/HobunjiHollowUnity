'use strict';
// Run: node scripts/run-tests.js humanoid-neck-band
// Regression: the physical neck pivot remains at each species' base-head bottom;
// the pre-merge broad visual blend is restored without increasing mesh density.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const avatar = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const editor = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');
const spine = fs.readFileSync('docs/js/character-spine.js', 'utf8');
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, cursor = open + 1;
  while (depth && cursor < source.length) {
    if (source[cursor] === '{') depth++;
    if (source[cursor] === '}') depth--;
    cursor++;
  }
  assert.equal(depth, 0, `unclosed ${name}`);
  return source.slice(start, cursor);
}
const context = vm.createContext({});
for (const name of [
  'smoothstep01', 'scanOpaquePixelMask', 'detectNeckPivotPx',
  'detectHeadRigPixels', 'neckBlendBand', 'neckBlendWeight',
  'neckBlendRows', 'headScaleGateAtPixel', 'headScaleWeightAt',
]) vm.runInContext(extract(avatar, name), context);

function headCanvas(bottom, w = 200, h = 200) {
  const data = new Uint8ClampedArray(w * h * 4); // Authoritative base-head pixels for one species in this test.
  for (let y = 18; y < bottom; y++) for (let x = 80; x < 120; x++) data[(y * w + x) * 4 + 3] = 255;
  data[(bottom * w + 100) * 4 + 3] = 255; // A single genuine last pixel must count, not be dropped by a coherent-row heuristic.
  return { width: w, height: h, getContext: () => ({ getImageData: () => ({ data }) }) };
}
const avatarCanvas = headCanvas(190); // Full-body artwork extends to the feet; it must not choose the neck.
for (const [species, headBottom] of [['mao-ao', 65], ['kenkari', 91], ['longoran', 116], ['mashtzarr', 142]]) {
  const detection = context.detectHeadRigPixels(headCanvas(headBottom), avatarCanvas, 12);
  assert.equal(detection.boundsPx.bottom, headBottom, `${species}: last base-head pixel retained`);
  assert.equal(detection.pivotPx.y, headBottom + .5, `${species}: neck pivot tracks real head end, not feet`);
  const modelHeight = 1.1; // A single shared model height proves image art, not model-size proportions, drives each bend.
  const neckY = modelHeight * (.5 - detection.pivotPx.y / 200);
  const band = context.neckBlendBand(neckY, modelHeight, 200);
  assert.ok(Math.abs(band.pivotPx - detection.pivotPx.y) < 1e-6, `${species}: physical pivot remains at lowest head pixel`);
  assert.ok(Math.abs(band.height / modelHeight - .30) < 1e-8, 'legacy broad falloff restored');
  const oldWeight = y => context.smoothstep01((y - (neckY - band.height * .55)) / band.height);
  for (const y of [neckY + .2, neckY, neckY - modelHeight * .08, neckY - modelHeight * .18])
    assert.ok(Math.abs(context.neckBlendWeight(y, neckY, band.height, modelHeight) - oldWeight(y)) < 1e-8, 'rotation matches pre-merge curve around new pivot');
  assert.ok(context.neckBlendWeight(neckY - modelHeight * .08, neckY, band.height, modelHeight) > 0, 'shoulders receive gradual rotation');
  assert.ok(context.headScaleWeightAt(neckY - modelHeight * .08, neckY, modelHeight, 100, detection.boundsPx, 0, band.height) > 0, 'wide head scale blends below chin');
  const rows = context.neckBlendRows(36, 200, band.topPx, band.bottomPx);
  assert.equal(rows.length, 37, `${species}: polygon count unchanged`);
  assert.equal(rows[0], 0);
  assert.equal(rows.at(-1), 200);
  assert.ok(Array.from(rows).every((pixel, i) => i === 0 || pixel > rows[i - 1]), `${species}: no inverted/degenerate faces`);
  assert.ok(Array.from(rows).some(pixel => Math.abs(pixel - band.topPx) < 1e-4), `${species}: bend top is a mesh row`);
  assert.ok(Array.from(rows).some(pixel => Math.abs(pixel - band.bottomPx) < 1e-4), `${species}: bend bottom is a mesh row`);
  assert.ok(Array.from(rows).some(pixel => Math.abs(pixel - (band.topPx + band.bottomPx) / 2) < 1e-4),
    `${species}: middle neck row preserves actual smooth deformation even on low-poly NPCs`);
}
assert.match(avatar, /neckBandPx: \{ top: band\.topPx, bottom: band\.bottomPx \}/, 'runtime geometry reports real pixel endpoints');
assert.match(avatar, /headScaleWeightAt\(y, neckLocal\.y, modelHeight, pixelX, headBoundsPx, turnWeight, blendHeight\)/,
  'head scaling and rotation share the actual geometry');
assert.match(avatar, /neckBlendWeight\(localPoint\.y, neckY, blendHeight, modelHeight\)/,
  'CPU pixel attachment landmarks sample the same blend as GPU');
assert.match(editor, /window\.PNGPlaneAvatar\.neckBlendBand\(neckLocal\.y, modelHeight, pixelHeight\)/,
  'Animation Author and game share the exact neck band');
assert.match(editor, /window\.PNGPlaneAvatar\.neckBlendRows\(segmentsY, pixelHeight, band\.topPx, band\.bottomPx\)/,
  'Animation Author allocates actual blend rows');
assert.match(editor, /pixelHeight: pxH/g, 'source pixel height is retained by editor rebuilds');
assert.match(editor, /uvs\[cursor \* 2 \+ 1\] = 1 - remappedPixelY \/ pixelHeight/,
  'remeshed editor vertices must keep UVs aligned to the unchanged base sprites');
assert.match(spine, /rig\.skinnedPlane\?\.geometry\?\.userData\?\.blendHeight/,
  'spine projections use the active GPU mesh band rather than a stale broad default');
assert.match(spine, /\(y - \(neckY - blend \* below\)\) \/ blend/,
  'spine projection follows broad turn falloff');
console.log('Species-specific pivots, restored blending, mesh rows, editor and spine contracts passed');

assert.match(editor, /window\.PNGPlaneAvatar\.detectHeadRigPixels\(headCanvas, avatarCanvas, 12\)/, 'editor and gameplay use the same horizontal and vertical base-head pivot');
