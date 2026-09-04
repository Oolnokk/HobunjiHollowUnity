'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/character-rig-scale.js', 'utf8');
const hands = { attach(_THREE, parent) { return { parent }; } };
const profile = { anatomy: { rigScale: 0.8 } };
const windowObject = {
  ProceduralHandAttachments: hands,
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'mao-ao::male': profile } },
  location: { pathname: '/game/' },
  setInterval(fn) { fn(); return 1; },
  clearInterval() {},
};
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(source, context, { filename: 'character-rig-scale.js' });

const api = context.HobunjiCharacterRigScale;
assert(api, 'whole-rig scale API must install');
assert.strictEqual(api.scaleFor('mao-ao', 'male'), 0.8);

const parent = {
  isObject3D: true,
  scale: {
    x: 1, y: 1, z: 1,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  },
  userData: {},
  updateMatrix() {},
  updateMatrixWorld() {},
};
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [0.8, 0.8, 0.8]);

// Changing the value must preserve the unscaled local assembly rather than
// multiplying the previous result cumulatively.
profile.anatomy.rigScale = 0.5;
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [0.5, 0.5, 0.5]);

// If another system recomputes the parent scale (body-scale preview), treat that
// as the new assembled base and reapply whole-rig scale exactly once.
parent.scale.set(1.2, 1.2, 1.2);
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [0.6, 0.6, 0.6]);

assert.match(source, /coordinateSpace: 'character-floor-parent'/);
assert.match(source, /Whole rig scale \(%\)/);
assert.match(source, /profile\.anatomy\.rigScale/);
assert.match(source, /runtime: true/);
assert.doesNotMatch(source, /anchor\.position\s*=|anchors\[[^\]]+\]\.position\s*=/,
  'whole-rig scale must not rewrite individual anchor positions');

console.log('Ground-relative whole character rig scale guards passed');
