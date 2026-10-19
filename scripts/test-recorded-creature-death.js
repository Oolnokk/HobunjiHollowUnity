// Regression test: real recorded knockdown bank drives cause-specific NPC death.
// Run from repo root: node scripts/test-recorded-creature-death.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(value) { return this.set(value.x, value.y, value.z); }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  copy(other) { Object.assign(this, { x: other.x, y: other.y, z: other.z, w: other.w }); return this; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  setFromAxisAngle() { return this; } // Test only records progress; the numerical renderer is Three.js's responsibility.
  slerp(other, t) { return this.copy(other); }
  multiply() { return this; }
  invert() { return this; }
  identity() { return this.copy(new Quaternion()); }
}
class Group {
  constructor() {
    this.isObject3D = true;
    this.children = []; this.position = new Vector3();
    this.quaternion = new Quaternion(); this.scale = { y: 1 };
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } };
  }
  add(node) { node.parent?.remove?.(node); node.parent = this; this.children.push(node); }
  remove(node) { this.children = this.children.filter(child => child !== node); node.parent = null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
class Color {
  constructor(value = 1) { this.value = value; }
  clone() { return new Color(this.value); }
  copy(other) { this.value = other.value; return this; }
  multiplyScalar(value) { this.value *= value; return this; }
}
class Material {
  constructor() { this.color = new Color(); }
  clone() { const material = new Material(); material.color = this.color.clone(); return material; }
  dispose() {}
}
class Geometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; }
  dispose() {}
}
class Points extends Group {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
const THREE = {
  Vector3, Quaternion, Group, BufferGeometry: Geometry,
  BufferAttribute: class { constructor(array) { this.array = array; } },
  Points, PointsMaterial: class { constructor(props) { Object.assign(this, props); } dispose() {} },
};
const source = path => fs.readFileSync(path, 'utf8');
const bank = JSON.parse(source('docs/config/animations/spinthrow-blend-v1.json')).clips;
const windowStub = {
  THREE,
  HOBUNJI_CONFIG: { resourceRings: { afflictionColors: {
    bleedingHealth: '#d11832', poisonedHealth: '#17a44b',
  } } },
  ImpactBlendLibrary: { getClip: (id, direction) => id === 'breakThrow' ? bank[direction]?.clip : null },
};
const context = { window: windowStub, THREE, Math, Date, Float32Array };
vm.runInNewContext(source('docs/js/combat/impact-ragdoll-playback.js'), context);
vm.runInNewContext(source('docs/js/creature-death.js'), context);
const corpses = new Set(); // The shared creature-death update drives this collection.
const grid = Array.from({ length: 10 }, () => Array(10).fill(1)); // Provides an unobstructed one-tile test area.
windowStub.CreatureDeath.init({
  TILE: 64, COLS: 10, ROWS: 10, corpseObjects: corpses, getGrid: () => grid,
  getCurrentArea: () => 'farm', tileSurfaceYInArea: () => 0,
  canOccupyAt: () => true, clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  characterGroundShadowSurfaceOffset: () => 0,
});
function makeActor(cause) {
  const scene = new Group(); const group = new Group(); scene.add(group);
  group.position.set(1.5, 0.5, 1.5);
  const frontPlane = new Group(), backPlane = new Group();
  const handsPivot = new Group(), legsPivot = new Group();
  for (const part of [frontPlane, backPlane, handsPivot, legsPivot]) group.add(part);
  const pieces = [frontPlane, handsPivot, legsPivot].map(parent => {
    const mesh = new Group(); mesh.isMesh = true; mesh.material = new Material();
    parent.add(mesh);
    return mesh;
  });
  const actor = {
    id: cause, x: 96, y: 96, areaId: 'farm', halfHeight: 0.5,
    health: 0, groupRot: 0, _lethalDamageCause: cause,
    avatarRef: { group, frontPlane, backPlane, handsPivot, legsPivot,
      legs: { applyRecordedLegPose() {} } },
  };
  return { actor, scene, pieces };
}

for (const [input, expected] of [
  ['blunt', 'blunt'], ['sharp', 'sharp'],
  ['bleedingHealth', 'sharp'], ['poisonedHealth', 'poison'],
  ['burningHealth', 'fire'], ['kindlingHealth', 'fire'], ['frost', 'frost'],
]) {
  const { actor, scene, pieces } = makeActor(input);
  const originalMaterials = pieces.map(mesh => mesh.material); // Compares shared asset safety after a scorch.
  const phases = []; // Records playback phases to verify blunt recoil is absent from non-blunt deaths.
  const originalSample = windowStub.ImpactRagdollPlayback.sampleCreatureDeath;
  windowStub.ImpactRagdollPlayback.sampleCreatureDeath = (entity, phase) => {
    phases.push(phase);
    return originalSample(entity, phase);
  };
  assert.equal(windowStub.CreatureDeath.begin(actor, 64, 96), true);
  assert.equal(actor.deathCause, expected);
  assert.equal(actor.deathRecorded, true);
  assert.equal(actor.avatarRef.handsPivot.parent, actor.avatarRef.impactPivot);
  assert.equal(actor.avatarRef.legsPivot.parent, actor.avatarRef.impactPivot);
  assert.ok(actor.deathDurationS < 1.0, 'no two-second sky-launch remains');
  const emission = scene.children.find(child => child instanceof Points);
  if (expected === 'sharp' || expected === 'poison' || expected === 'frost') {
    assert.ok(emission, 'blood/elemental spray begins with the fall');
    assert.equal(emission.material.color, expected === 'poison' ? '#17a44b'
      : expected === 'sharp' ? '#d11832' : '#89ecfa');
  } else assert.equal(emission, undefined, 'blunt/fire kills emit no blood');
  for (let i = 0; i < 40; i++) windowStub.CreatureDeath.updateCorpses(0.04);
  assert.equal(actor.state, 'corpse');
  assert.ok(Math.hypot(actor.x - 96, actor.y - 96) <= 64 * 1.5, 'ground slide remains short');
  assert.equal(scene.children.filter(child => child instanceof Points).length, 0, 'spray disposes after lifetime');
  const decreases = phases.some((p, index) => index && p < phases[index - 1] - 1e-6);
  assert.equal(decreases, expected === 'blunt', 'only blunt deaths have an authored-tail recoil');
  if (expected === 'fire') {
    for (let i = 0; i < pieces.length; i++) {
      assert.notEqual(pieces[i].material, originalMaterials[i], 'scorch isolates materials per actor');
      assert.ok(pieces[i].material.color.value <= 0.061, 'portrait, hands, and feet turn near-black');
      assert.equal(originalMaterials[i].color.value, 1, 'shared original material is not scorched');
    }
  }
  windowStub.ImpactRagdollPlayback.sampleCreatureDeath = originalSample;
}

// Fatal DoTs and other unforced deaths have no horizontal impulse, even if
// callers give the victim's current position as the default damage source.
const stationary = makeActor('poisonedHealth').actor;
stationary.x = 106; stationary.y = 99; // Non-centered coordinates catch accidental center snapping and sideways slides.
assert.equal(windowStub.CreatureDeath.begin(stationary, stationary.x, stationary.y), true);
assert.equal(stationary.deathHadImpulse, false);
assert.equal(stationary.deathTargetX, 106);
assert.equal(stationary.deathTargetY, 99);
for (let i = 0; i < 30; i++) windowStub.CreatureDeath.updateCorpses(0.04);
assert.equal(stationary.x, 106);
assert.equal(stationary.y, 99);
assert.equal(stationary.state, 'corpse');

// Scorch must clone sprite/hand/foot material state without keeping those
// clones alive forever after the owning corpse is butchered.
const burning = makeActor('burningHealth');
let baseDisposeCalled = false; // Confirms the owning avatar's original texture/rig disposal still runs.
const unscorchedMaterials = burning.pieces.map(mesh => mesh.material);
burning.actor.avatarRef.dispose = () => { baseDisposeCalled = true; };
assert.equal(windowStub.CreatureDeath.begin(burning.actor), true);
const charredMaterials = burning.pieces.map(mesh => mesh.material);
for (const mat of charredMaterials) mat.dispose = () => { mat.disposed = true; };
burning.actor.avatarRef.dispose();
assert.equal(baseDisposeCalled, true);
for (const mat of charredMaterials) assert.equal(mat.disposed, true);
for (let i = 0; i < unscorchedMaterials.length; i++) assert.notEqual(charredMaterials[i], unscorchedMaterials[i]);

// Asset-loading failure must still settle a lootable corpse, without flying.
windowStub.ImpactBlendLibrary.getClip = () => null;
const fallback = makeActor('untyped').actor;
assert.equal(windowStub.CreatureDeath.begin(fallback), true);
assert.equal(fallback.deathRecorded, false);
for (let i = 0; i < 24; i++) windowStub.CreatureDeath.updateCorpses(0.04);
assert.equal(fallback.state, 'corpse');
assert.equal(fallback.avatarRef.group.rotation.z, Math.PI / 2);
assert.ok(corpses.has(fallback));
assert.equal(windowStub.CreatureDeath.getDebug().activeSprays, 0);
console.log('Recorded creature death: causes, recoil, spray, scorch, loot and fallback passed');
