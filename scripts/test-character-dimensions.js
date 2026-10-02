'use strict';

// Executes docs/js/character-dimensions.js's transform composition against
// the real character-rig-scale module and a hand-computed expectation.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} !== ${expected}`);

const windowObject = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: {} },
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  __hobunjiCharacterDimensionsNoAutoMeasure: true,
  location: { pathname: '/game/' },
  setInterval() { return 1; },
  clearInterval() {},
  console,
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { worldModelWidth: 0.9, childScaleMultiplier: 0.5 } } } },
  PNGPlaneAvatar: {
    avatarScaleMultiplierFor: ({ speciesId }) => (speciesId === 'mashtzarr' ? 1.2 : 1),
    avatarPlacementRatioFor: ({ speciesId }) => (speciesId === 'mashtzarr' ? 0.75 : 0.5),
    isChildAvatar: () => false,
  },
};
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/character-rig-scale.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/character-dimensions.js', 'utf8'), context);
const D = windowObject.HobunjiCharacterDimensions;
assert.ok(D, 'module exposes window.HobunjiCharacterDimensions');

// Unmeasured identities report null rather than guessing.
assert.strictEqual(D.dimensionsFor('mashtzarr', 'male'), null);
assert.strictEqual(D.lengthForHeightPercent('mashtzarr', 'male', 50), null);

// Normalized portrait fractions (v=0 top). Head pivot is the neck hinge.
D._setMeasurement('mashtzarr', 'male', {
  body: { top: 0.3, bottom: 0.9, left: 0.2, right: 0.8, centroidU: 0.5, centroidV: 0.6 },
  head: { top: 0.1, bottom: 0.4, left: 0.35, right: 0.65, centroidU: 0.5, centroidV: 0.25, pivotU: 0.5, pivotV: 0.4 },
});
const rig = windowObject.HobunjiCharacterRigScale.scaleFor('mashtzarr', 'male'); // Authored defaults: x .955, y 1.255, head .9856, offsetY -.095
const mH = 0.9 * 1.2;
const rowY = v => mH * (0.5 + 0.75 - v);
const neckY = rig.y * (rowY(0.4) + rig.offsetY * mH);
const headTop = neckY + rig.head * (rowY(0.1) - rowY(0.4));
const bodyTop = rig.y * rowY(0.3);

const d = D.dimensionsFor('mashtzarr', 'male');
near(d.head.neckY, neckY, 'neck Y composes portrait scale, placement, rig Y and head offset');
near(d.head.top, headTop, 'head top scales around the neck by the head factor');
near(d.body.top, bodyTop, 'body top follows rig Y only');
near(d.height, Math.max(headTop, bodyTop), 'height is floor to crown');
near(d.head.height, rig.head * mH * 0.3, 'head height is head-scale times its portrait span');
near(d.width, rig.x * mH * 0.6, 'width is the widest silhouette extent');
near(d.factors.portraitYOffsetPercent, 25, 'portrait Y offset is reported in the authoring percent space');

// Percent helpers are exact inverses.
near(D.lengthForHeightPercent('mashtzarr', 'male', 40), d.height * 0.4, 'length for 40% height');
near(D.heightPercentForLength('mashtzarr', 'male', d.height * 0.4), 40, 'percent round-trip');

// Age hunch lowers the head only; explicit rig overrides replace live values.
const aged = D.dimensionsFor('mashtzarr', 'male', { age: 1 });
near(aged.head.neckY, neckY - rig.y * windowObject.HobunjiCharacterRigScale.maxAgeHunchFraction * mH, 'age hunch lowers the neck');
near(aged.body.top, bodyTop, 'age hunch leaves the body alone');
const doubled = D.dimensionsFor('mashtzarr', 'male', { rigScale: { y: rig.y * 2, head: rig.head * 2, offsetY: rig.offsetY } });
near(doubled.head.top, headTop * 2, 'doubling rig Y and head doubles the crown height');

// Child multiplier shrinks the whole portrait stack.
const child = D.dimensionsFor('mashtzarr', 'male', { child: true });
near(child.factors.portraitScale, 0.6, 'child multiplier is applied to portrait scale');
near(child.height, d.height * 0.5, 'child height is half (every layer is linear in model height)');

// Transform aliases fall back to their canonical species' measurement.
D._setMeasurement('kenkari', 'female', {
  body: { top: 0.5, bottom: 0.9, left: 0.3, right: 0.7, centroidU: 0.5, centroidV: 0.7 },
  head: { top: 0.2, bottom: 0.5, left: 0.4, right: 0.6, centroidU: 0.5, centroidV: 0.35, pivotU: 0.5, pivotV: 0.5 },
});
windowObject.hobunjiTransformSpeciesId = s => (s === 'rakakoan' ? 'kenkari' : s);
assert.ok(D.isMeasured('rakakoan', 'female'), 'rakakoan resolves to kenkari measurements');

// scanAlpha / headFromScan on a synthetic canvas.
const w = 10, h = 10, data = new Uint8ClampedArray(w * h * 4);
for (let y = 2; y <= 6; y++) for (let x = 3; x <= 6; x++) data[(y * w + x) * 4 + 3] = 255;
data[(8 * w + 4) * 4 + 3] = 255; // A lone stray pixel below the coherent bottom edge.
const canvas = { width: w, height: h, getContext: () => ({ getImageData: () => ({ data }) }) };
const scan = D._scanAlpha(canvas);
near(scan.top, 0.2, 'scan top'); near(scan.bottom, 0.9, 'scan bottom incl. stray'); near(scan.left, 0.3, 'scan left'); near(scan.right, 0.7, 'scan right');
const head = D._headFromScan(scan);
near(head.pivotV, 0.65, 'neck pivot ignores the stray row (matches detectHeadRigPixels)');

console.log('character-dimensions: ok');
