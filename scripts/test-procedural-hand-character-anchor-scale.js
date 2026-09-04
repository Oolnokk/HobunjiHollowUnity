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

const adult = { modelWidth: 0.9, modelHeight: 0.9, currentScale: 1, adultScale: 1, placementRatio: 0.95 };
space.ensureStoredBinding(profile, 'leftHandShoulder', adult);

// Same adult anatomy: migration is visually lossless.
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(space.resolveAnchor(profile, 'leftHandShoulder', adult))),
  left,
  'initial portrait binding must preserve the point at the anatomy state it was authored against',
);

// Garanki: child scale changes the ACTOR position, not the shared Mao-ao profile.
const child = { modelWidth: 0.45, modelHeight: 0.45, currentScale: 0.5, adultScale: 1, placementRatio: 0.95 };
const childLeft = space.resolveAnchor(profile, 'leftHandShoulder', child);
assert.strictEqual(childLeft.x, left.x * 0.5);
assert.strictEqual(childLeft.y, left.y * 0.5);
assert.strictEqual(profile.anchors.leftHandShoulder.position.x, left.x, 'child preview must not rewrite adult profile X');
assert.strictEqual(profile.anchors.leftHandShoulder.position.y, left.y, 'child preview must not rewrite adult profile Y');

// Body scale follows the same pixel/portrait transform.
const largeAdult = { modelWidth: 1.08, modelHeight: 1.08, currentScale: 1.2, adultScale: 1.2, placementRatio: 0.95 };
const largeLeft = space.resolveAnchor(profile, 'leftHandShoulder', largeAdult);
assert(Math.abs(largeLeft.x - left.x * 1.2) < 1e-12);
assert(Math.abs(largeLeft.y - left.y * 1.2) < 1e-12);

// Portrait Y offset translates the point by the exact same model-height delta
// as the portrait assembly. It must not mutate the reference point.
const shiftedChild = { ...child, placementRatio: 1.05 };
const shiftedLeft = space.resolveAnchor(profile, 'leftHandShoulder', shiftedChild);
assert(Math.abs(shiftedLeft.x - childLeft.x) < 1e-12);
assert(Math.abs(shiftedLeft.y - (childLeft.y + child.modelHeight * 0.10)) < 1e-12);

// Gizmo edits are inverted back into portrait-reference space. Resolving that
// binding again at the same actor state must round-trip exactly.
const dragged = { x: shiftedLeft.x + 0.031, y: shiftedLeft.y - 0.047, z: 0.012 };
space.captureBindingFromDisplayed(profile, 'leftHandShoulder', dragged, shiftedChild);
const roundTrip = space.resolveAnchor(profile, 'leftHandShoulder', shiftedChild);
for (const axis of ['x', 'y', 'z']) assert(Math.abs(roundTrip[axis] - dragged[axis]) < 1e-12, `gizmo inverse must round-trip ${axis}`);

// Posterior migration is deliberately captured from the already-correct live
// displayed point. On Garanki, 0.1679 becomes a 0.3358 adult reference and then
// resolves right back to 0.1679 until scale/Y is intentionally changed.
space.bindPosteriorFromDisplayed(profile, { x: 0, y: 0.1679, z: 0 }, child);
const posteriorChild = space.resolveAnchor(profile, 'posterior', child);
assert(Math.abs(posteriorChild.y - 0.1679) < 1e-12, 'posterior migration must be visually lossless');
const posteriorShifted = space.resolveAnchor(profile, 'posterior', shiftedChild);
assert(Math.abs(posteriorShifted.y - (0.1679 + child.modelHeight * 0.10)) < 1e-12, 'posterior must follow portrait Y after migration');

// The integration layer must preserve the binding through the Animation Author
// normalizer/import path and apply an inverse before the old absolute-coordinate
// gizmo writer runs.
assert.match(source, /portraitBindingPreservingNormalizer/, 'Animation Author imports must preserve portraitBinding');
assert.match(source, /portraitBoundHandleAnimationTransformChanged/, 'rig gizmo writes must use the inverse portrait transform');
assert.match(source, /applyCharacterPortraitPlacementV1530/, 'portrait Y edits must resync attachment anchors immediately');
assert.match(source, /transformOrder: 'portrait binding -> body\/child scale \+ portrait Y -> deadzone\/facing rotation -> world'/,
  'export metadata must explicitly keep deadzone rotation after portrait-bound attachment placement');

console.log('Portrait-bound character anchor transform guards passed');
