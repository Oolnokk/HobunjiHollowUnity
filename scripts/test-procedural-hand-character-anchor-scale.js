'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/procedural-hand-scale-free-world.js', 'utf8');

const hands = { attach() { return null; } };
const windowObject = {
  ProceduralHandAttachments: hands,
  location: { pathname: '/game/' },
  setInterval,
  clearInterval,
};
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(source, context, { filename: 'procedural-hand-scale-free-world.js' });

const space = context.HobunjiCharacterPortraitAnchorSpace;
assert(space, 'shared portrait-anchor coordinate space must install');
assert.strictEqual(space.coordinateSpace, 'character-portrait-pre-deadzone');

const left = { x: 0.19067248465844266, y: 0.6947557240731601, z: 0 };
const profile = {
  anatomy: { portraitScale: 1, portraitVerticalPlacementRatio: 0.95 },
  anchors: {
    posterior: { position: { x: 0, y: 0, z: 0 } },
    shoulderPerch: { position: { x: -0.2006533796199832, y: 0.6234902368619534, z: 0 } },
    leftHandShoulder: { position: { ...left } },
    rightHandShoulder: { position: { x: -0.28087406205430004, y: 0.6455541403639915, z: 0 } },
  },
  posteriorRule: {},
};

// Garanki Gabu is an ADULT Mao-ao. His current portrait scale is therefore the
// authored adult scale, not the 0.5 child multiplier. The known live Garanki
// shoulder/posterior values must be preserved exactly at this state.
const garankiAdult = { modelWidth: 0.9, modelHeight: 0.9, currentScale: 1, adultScale: 1, placementRatio: 0.95 };
space.ensureStoredBinding(profile, 'leftHandShoulder', garankiAdult);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(space.resolveAnchor(profile, 'leftHandShoulder', garankiAdult))),
  left,
  'adult Garanki-style portrait binding must preserve the point at the anatomy state it was authored against',
);

// Child scaling is a separate actor-state case. Gantami Ginju is the actual
// child example in the game; the coordinate-space layer itself remains generic
// and simply consumes PNGPlaneAvatar's rendered 0.5 actor scale.
const childActor = { modelWidth: 0.45, modelHeight: 0.45, currentScale: 0.5, adultScale: 1, placementRatio: 0.95 };
const childLeft = space.resolveAnchor(profile, 'leftHandShoulder', childActor);
assert.strictEqual(childLeft.x, left.x * 0.5);
assert.strictEqual(childLeft.y, left.y * 0.5);
assert.strictEqual(profile.anchors.leftHandShoulder.position.x, left.x, 'child preview must not rewrite adult profile X');
assert.strictEqual(profile.anchors.leftHandShoulder.position.y, left.y, 'child preview must not rewrite adult profile Y');

const largeAdult = { modelWidth: 1.08, modelHeight: 1.08, currentScale: 1.2, adultScale: 1.2, placementRatio: 0.95 };
const largeLeft = space.resolveAnchor(profile, 'leftHandShoulder', largeAdult);
assert(Math.abs(largeLeft.x - left.x * 1.2) < 1e-12);
assert(Math.abs(largeLeft.y - left.y * 1.2) < 1e-12);

const shiftedChild = { ...childActor, placementRatio: 1.05 };
const shiftedLeft = space.resolveAnchor(profile, 'leftHandShoulder', shiftedChild);
assert(Math.abs(shiftedLeft.x - childLeft.x) < 1e-12);
assert(Math.abs(shiftedLeft.y - (childLeft.y + childActor.modelHeight * 0.10)) < 1e-12);

const dragged = { x: shiftedLeft.x + 0.031, y: shiftedLeft.y - 0.047, z: 0.012 };
space.captureBindingFromDisplayed(profile, 'leftHandShoulder', dragged, shiftedChild);
const roundTrip = space.resolveAnchor(profile, 'leftHandShoulder', shiftedChild);
for (const axis of ['x', 'y', 'z']) assert(Math.abs(roundTrip[axis] - dragged[axis]) < 1e-12, `gizmo inverse must round-trip ${axis}`);

// The 0.1679 posterior came from the live ADULT Garanki dump. Migration must
// capture it at adult scale, not reinterpret it as a half-scale child point.
space.bindPosteriorFromDisplayed(profile, { x: 0, y: 0.1679, z: 0 }, garankiAdult);
const posteriorAdult = space.resolveAnchor(profile, 'posterior', garankiAdult);
assert(Math.abs(posteriorAdult.y - 0.1679) < 1e-12, 'adult Garanki posterior migration must be visually lossless');
const shiftedAdult = { ...garankiAdult, placementRatio: 1.05 };
const posteriorShifted = space.resolveAnchor(profile, 'posterior', shiftedAdult);
assert(Math.abs(posteriorShifted.y - (0.1679 + garankiAdult.modelHeight * 0.10)) < 1e-12, 'adult posterior must follow portrait Y after migration');
const posteriorChild = space.resolveAnchor(profile, 'posterior', childActor);
assert(Math.abs(posteriorChild.y - 0.1679 * 0.5) < 1e-12, 'a real child actor must derive its posterior from the same adult portrait binding at child scale');

assert.match(source, /portraitBindingPreservingNormalizer/, 'Animation Author imports must preserve portraitBinding');
assert.match(source, /portraitBoundHandleAnimationTransformChanged/, 'rig gizmo writes must use the inverse portrait transform');
assert.match(source, /dataset\?\.animationAuthorMode === 'rig'/,
  'portrait-binding inverse must never intercept ordinary multi\/single animation transforms');
assert.match(source, /applyCharacterPortraitPlacementV1530/, 'portrait Y edits must resync attachment anchors immediately');
assert.match(source, /transformOrder: 'portrait binding -> body\/child scale \+ portrait Y -> deadzone\/facing rotation -> world'/,
  'export metadata must explicitly keep deadzone rotation after portrait-bound attachment placement');

console.log('Portrait-bound character anchor transform guards passed');
