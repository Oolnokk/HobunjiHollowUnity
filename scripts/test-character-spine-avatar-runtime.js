'use strict';
// The NPC avatar build binds each avatar's authored spine (appearance.aging.hunch / kyphosis) and curls its spline nodes. Runs the real rig-scale,
// spine and avatar-runtime modules together on a fake skinned avatar.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = { setInterval(fn) { fn(); return 1; }, clearInterval() {}, location: { pathname: '/game/' }, console };
window.window = window;
const context = vm.createContext(window);
for (const file of ['docs/config/character-rig-scale-defaults.js', 'docs/js/character-rig-scale.js', 'docs/js/character-spine.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const bone = (x = 0, y = 0) => ({ userData: {}, updateMatrix() {}, position: { x, y, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; } }, scale: { set() {} } });
function fakeAvatar() {
  const nodes = Array.from({ length: 7 }, (_, k) => bone(0, k === 0 ? -0.4 : 0.1)); // Bind pose: node 0 at the posterior, the rest chained 0.1 apart.
  const neckJoint = bone(), headScaleJoint = bone();
  return { userData: { portraitModelHeight: 0.9, portraitModelWidth: 0.9,
    neckRig: { available: true, neckJoint, headScaleJoint, splineNodes: nodes, neckLocal: { x: 0, y: 0.2 }, spineBase: { x: 0, y: 0.2 }, spinePosteriorY: -0.4 } } };
}
window.PNGPlaneAvatar = { buildSinglePlaneAvatarModel() { return fakeAvatar(); } };
vm.runInContext(fs.readFileSync('docs/js/character-rig-scale-avatar-runtime.js', 'utf8'), context, { filename: 'character-rig-scale-avatar-runtime.js' });
assert.ok(window.PNGPlaneAvatar.buildSinglePlaneAvatarModel.__hobunjiCharacterRigScaleAvatarHeadWrapped, 'the runtime wrapper installed');

const build = aging => window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(null, null, { profile: { appearance: { speciesId: 'mao-ao', gender: 'male' }, aging }, neckRig: true });
const neckZ = root => root.userData.hobunjiSpine.curve[6].z;

const upright = build(undefined);
assert.equal(upright.userData.hobunjiSpine, undefined, 'an NPC without an aging block gets no spine');
assert.ok(upright.userData.neckRig.splineNodes.every((node, k) => k === 0 || node.position.z === 0), 'and its spline stays at rest');

const authored = build({ hunch: 0.4, kyphosis: 0.4 });
const spine = authored.userData.hobunjiSpine;
assert.ok(spine, 'an NPC with an aging.hunch gets a spine bound on its avatar root');
assert.equal(spine.hunch, 0.4, 'with its authored hunch');
assert.equal(spine.kyphosis, 0.4, 'and its authored kyphosis (not the default)');
assert.ok(spine.curve && neckZ(authored) > 0, 'the spline is curled forward');
assert.ok(authored.userData.neckRig.splineNodes.slice(1).some(node => node.position.z !== 0), 'on the avatar\'s actual spline bones');

// Kyphosis is independent of hunch: same stoop, different forward hook; 0 is a pure stoop; unauthored means the default.
const flat = build({ hunch: 0.4, kyphosis: 0 }), hooked = build({ hunch: 0.4, kyphosis: 1 }), defaulted = build({ hunch: 0.4 });
assert.equal(neckZ(flat), 0, 'kyphosis 0 gives no forward curl');
assert.ok(neckZ(hooked) > neckZ(authored) && neckZ(authored) > neckZ(flat), 'more kyphosis hooks the neck further forward');
assert.equal(defaulted.userData.hobunjiSpine.kyphosis, 0.5, 'an unauthored kyphosis is the default');
for (const root of [flat, authored, hooked, defaulted]) assert.ok(Math.abs(root.userData.hobunjiSpine.curve[6].y - flat.userData.hobunjiSpine.curve[6].y) < 1e-9, 'kyphosis never changes how far it stoops');

// The shipped NPC database: the six authored elders carry exactly these values.
const db = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json', 'utf8'));
const found = {};
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.id && node.appearance && typeof node.appearance === 'object') found[node.id] = node.appearance.aging;
  for (const value of Object.values(node)) walk(value);
})(db);
const expected = { kinami_kunji: 0.5, kaboku_kunji: 0.5, leaf: 0.4, pahu: 0.4, father_hunundi_hodu: 0.3, teacup_unumanuk: 0.3 };
for (const [id, value] of Object.entries(expected)) {
  assert.ok(found[id], id + ' has an aging block');
  assert.equal(found[id].hunch, value, id + ' hunch');
  assert.equal(found[id].kyphosis, value, id + ' kyphosis');
}

console.log('character spine avatar runtime OK');
