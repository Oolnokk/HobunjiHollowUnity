'use strict';

const assert = require('assert');
const fs = require('fs');

const bridge = fs.readFileSync('docs/js/procedural-hand-scale-free-world.js', 'utf8');
const bootstrap = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');

assert.match(bridge, /character-portrait-pre-deadzone/, 'character anchors must be portrait-bound before facing rotation');
assert.match(bridge, /\['posterior', 'shoulderPerch', 'leftHandShoulder', 'rightHandShoulder'\]/,
  'posterior, perch, and both shoulder targets must share the portrait-bound contract');
assert.match(bridge, /referencePortraitScale/, 'bindings must retain the body scale at authoring time');
assert.match(bridge, /referencePlacementRatio/, 'bindings must retain the portrait Y placement at authoring time');
assert.match(bridge, /currentScale.*referencePortraitScale/s, 'runtime positions must respond to body\/child scale');
assert.match(bridge, /placementDelta/, 'runtime positions must respond to portrait Y changes');
assert.match(bridge, /bindPosteriorFromDisplayed/, 'posterior migration must preserve the already-calibrated live position');
assert.match(bridge, /portraitBoundHandleAnimationTransformChanged/, 'rig gizmo edits must be inverted back into portrait space');
assert.match(bridge, /animationAuthorMode === 'rig'/, 'ordinary animation editing must remain outside the rig inverse');
assert.match(bridge, /portraitBindingPreservingNormalizer/, 'imports\/autosaves must preserve portrait bindings');
assert.match(bootstrap, /procedural-hand-scale-free-world\.js\?v=20260904posteriorlive1/,
  'stable game\/tool URLs must fetch the new portrait-bound bridge instead of a cached older child script');

console.log('Animation Author portrait-anchor integration guards passed');
