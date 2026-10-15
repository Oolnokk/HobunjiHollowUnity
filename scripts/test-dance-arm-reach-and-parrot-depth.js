'use strict';

const assert = require('node:assert/strict'); // Validates the rendered punch envelope and colorless depth replay.
const fs = require('node:fs'); // Loads the actual runtime implementations below.
const vm = require('node:vm'); // Runs pose calculations without needing a browser renderer.
const read = name => fs.readFileSync(`docs/js/${name}.js`, 'utf8'); // Shared source reader for these related regression fixtures.
function functionSource(source, name) {
  const start = source.indexOf(`  function ${name}(`); // Extracts a private function without changing production exports.
  assert(start >= 0, `missing runtime function ${name}`);
  const end = source.indexOf('\n  function ', start + 1); // All tested helpers are adjacent function declarations.
  return source.slice(start, end);
}

const handSource = read('procedural-hand-attachments'); // Includes the common per-side anatomical reach accessor.
const accessorStart = handSource.indexOf('      armLengthForSide(side) {'); // Locates the real rig API method for direct execution.
const accessorEnd = handSource.indexOf('\n      placeHandWorld,', accessorStart); // Excludes unrelated rig methods from the fixture.
const options = { avatarRoot: { userData: { armLengthBySide: { left: 0.17, right: 0.14 }, scaledArmLength: 0.155 } } }; // Models short Mashtzarr arms independently from its tall portrait plane.
const armLengthForSide = vm.runInNewContext(`({${handSource.slice(accessorStart, accessorEnd)}}).armLengthForSide`, { options, modelHeight: 1.062 }); // Uses the actual accessor with an asymmetric rig.
assert.equal(armLengthForSide('left'), 0.17);
assert.equal(armLengthForSide('right'), 0.14);
options.avatarRoot.userData.armLengthBySide.left = NaN;
assert.equal(armLengthForSide('left'), 1.062 * 0.29, 'invalid authored reach has a finite fallback');
options.avatarRoot.userData.armLengthBySide.left = 0.17;

class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  clone() { return new Vector(this.x, this.y, this.z); }
  copy(value) { Object.assign(this, value); return this; }
  distanceToSquared(value) { return (this.x - value.x) ** 2 + (this.y - value.y) ** 2 + (this.z - value.z) ** 2; }
}
class Quaternion {
  constructor(angle = 0) { this.angle = angle; }
  clone() { return new Quaternion(this.angle); }
  copy(value) { this.angle = value.angle; return this; }
  dot(value) { return Math.cos((this.angle - value.angle) / 2); }
}
function socket(side) {
  return {
    name: `${side}_hand_socket`, parent: {},
    position: new Vector(side === 'left' ? 0.2 : -0.2, 0.3, 0), quaternion: new Quaternion(),
    rotateX(angle) { this.quaternion.angle += angle; }, rotateZ(angle) { this.quaternion.angle += angle; },
  };
}
function near(actual, expected, message) { assert(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} != ${expected}`); }

for (const beat of [0, 0.25, 0.5, 0.75, -0.5]) {
  const left = socket('left'), right = socket('right'); // Each trial starts at the ordinary resting wrist pose.
  const rig = { armLengthForSide, group: { getObjectByName: name => name === left.name ? left : right } }; // Supplies identical anatomy to the player and NPC adapters.
  const walker = { root: {}, state: 'idle', avatarHeight: 1.062, avatarGroup: { userData: { proceduralHandRig: rig } }, rec: { id: 'mashtzarr' } }; // A large portrait must not enlarge the arm lift.
  const target = { socialDance: { armStyle: 'overhead-punch' } }; // Exercises the reported dance arm style.
  const entry = { walker, left, right, session: null, handPoseState: {} }; // Mirrors the NPC sentinel's per-dancer record.
  const state = { handBaseRefreshes: 0, handBaseReuses: 0, handApplications: 0 }; // Tracks idempotent repeated draw behavior.
  const npcSource = read('npc-dance-presentation-runtime'); // Tests the final NPC presentation owner.
  const helpers = ['arrivedForSocialPose', 'walkerDimensions', 'socketsFor', 'socketMatchesAppliedPose', 'baselineForSide', 'rememberAppliedPose', 'lateHandPose']; // Dependencies needed for a real late NPC hand update.
  const context = { state, global: { SocialRhythmClock: { dancerBeatAt: () => beat } }, nowMs: () => 0, entry, target }; // Keeps rhythm deterministic across repeated passes.
  vm.runInNewContext(helpers.map(name => functionSource(npcSource, name)).join('\n') + '\nlateHandPose(entry, target); lateHandPose(entry, target);', context);
  const expected = {}; // Reused below to compare both live adapters against the same envelope.
  for (const side of ['left', 'right']) {
    const phase = side === 'right' ? ((((beat % 1) + 1) % 1) + 0.5) % 1 : ((beat % 1) + 1) % 1; // Preserves the alternating punch rhythm.
    const punch = Math.pow(Math.max(0, Math.sin(Math.PI * phase)), 0.45); // Authored easing used by the live dance.
    expected[side] = 0.3 + armLengthForSide(side) * (1.12 + 0.88 * punch);
    near((side === 'left' ? left : right).position.y, expected[side], 'NPC punch uses actual arm reach without accumulating across passes');
    assert(expected[side] <= 0.3 + 2 * armLengthForSide(side) + 1e-10, 'full punch stays within two resting arm lengths');
  }
  near(left.position.y - 0.3, expected.left - 0.3, 'Mashtzarr lift is independent of portrait padding');
  left.position.y = right.position.y = 0.3;
  const playerState = { handRig: rig, handBase: null, handApplications: 0 }; // Uses the same rig with the player dance layer.
  const playerSource = read('social-action-dance-runtime'); // Tests the player sentinel's real pose function too.
  vm.runInNewContext(['captureHandBase', 'applyHandLayer'].map(name => functionSource(playerSource, name)).join('\n') + '\napplyHandLayer(); applyHandLayer();', {
    state: playerState, now: () => 0, clock: () => ({ beat, info: target.socialDance }), dimensions: () => ({ width: 0.9, height: 1.062 }),
  });
  near(left.position.y, expected.left, 'player left punch matches NPC reach');
  near(right.position.y, expected.right, 'player right punch matches NPC reach');
}

const windowObject = {}; // Hosts the real outline-occluder registry for a fake renderer.
vm.runInNewContext(read('png-plane-outline-occluder'), { window: windowObject, THREE: { LessEqualDepth: 3 } });
const api = windowObject.PngPlaneOutlineOccluder; // Public registration path used by the parrot GLB builder.
const scene = { isScene: true }; // A live scene keeps registered meshes from being pruned.
const material = { colorWrite: true, depthWrite: false, depthTest: false, depthFunc: 1 }; // Matches the body-colored parrot primitive before replay.
const originalMaterial = { ...material }; // All temporary depth flags must restore even on an exception.
const body = { isMesh: true, visible: true, parent: scene, userData: {}, material, layers: { mask: 3, enable(layer) { this.mask |= 1 << layer; } } }; // Retains shell layer 1 while joining depth layer 4.
const camera = { layers: { mask: 1, set(layer) { this.mask = 1 << layer; } } }; // Captures and restores the ordinary world camera layer.
let draws = 0; // Counts actual depth-only renders, including the exception path.
let throwOnDraw = false; // Tests renderer failure without leaking temporary material state.
api.registerDepthMesh(body);
api.registerDepthMesh(body);
assert.equal(api.snapshot().registered, 1, 'repeat registration must not duplicate depth participants');
assert(body.layers.mask & 2, 'body-colored hands keep their shell outline');
assert.equal(body.userData.noOutline, undefined, 'depth registration does not turn 3D hands into PNG planes');
api.init({ camera, renderer: { render() {
  draws++;
  assert.equal(camera.layers.mask, 16);
  assert.equal(material.colorWrite, false, 'parrot depth replay must never repaint a second body-only hand');
  assert.equal(material.depthWrite, true, 'exposed body geometry supplies depth for its shell');
  assert.equal(material.depthTest, true, 'portrait clothing still hides the wing continuation');
  if (throwOnDraw) throw new Error('render failed');
} } });
api.renderDepth(scene);
assert.deepEqual(material, originalMaterial);
assert.equal(camera.layers.mask, 1);
throwOnDraw = true;
assert.throws(() => api.renderDepth(scene), /render failed/);
assert.deepEqual(material, originalMaterial, 'failure restores original material state');
assert.equal(camera.layers.mask, 1);
assert.equal(draws, 2);
body.parent = null;
api.prune();
assert.equal(api.snapshot().registered, 0, 'removed hand visuals are pruned from the registry');

console.log('dance anatomical reach + colorless parrot hand depth replay PASS');
