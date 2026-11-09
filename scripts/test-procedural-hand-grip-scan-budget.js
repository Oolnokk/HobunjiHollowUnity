'use strict';
// Exercises production hand-basis decisions and two-handed socket reuse.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'docs/js/procedural-hand-frame-driver.js'), 'utf8');
function extract(name, endMarker, globals) {
  const start = src.indexOf('  function ' + name + '(');
  const end = src.indexOf(endMarker, start);
  assert(start !== -1 && end > start, name + ' exists');
  return vm.runInNewContext('(' + src.slice(start, end).trim() + ')', globals);
}
class Q {
  constructor() { this.z = 0; this.w = 1; }
  identity() { this.z = 0; this.w = 1; return this; }
  setFromEuler(e) { this.z = Math.sin(e.z / 2); this.w = Math.cos(e.z / 2); return this; }
  multiply(q) {
    const z = this.w * q.z + this.z * q.w;
    this.w = this.w * q.w - this.z * q.z;
    this.z = z; return this;
  }
  invert() { this.z = -this.z; return this; }
  normalize() { const l = Math.hypot(this.z, this.w); this.z /= l; this.w /= l; return this; }
}
let editor = false;
let style = 'thrust';
let state = { activeSlot: 'weapon', combatAnim: 'thrust' };
let planeScans = 0;
const stats = { nonSweepSearchesAvoided: 0, visualPlaneSearches: 0, sharedSocketUses: 0 };
const getBasis = extract('visualGripBasisDelta', '\n  // In-game, WeaponToolStances applies', {
  handSyncPerf: stats,
  inAttackEditor: () => editor,
  global: { WeaponToolStances: { getRuntimeState: () => state } },
  document: { getElementById: () => ({ value: style }) },
  findToolVisualPlane: () => {
    planeScans++;
    return { rotation: { z: -Math.PI / 4, clone() { return { z: this.z }; } } };
  },
});
const record = { THREE: { MathUtils: {
  degToRad: d => d * Math.PI / 180, radToDeg: r => r * 180 / Math.PI,
} } };
const holder = { name: 'axe', quaternion: new Q() };
for (let i = 0; i < 60; i++) {
  const value = getBasis(record, holder);
  assert.equal(value.source, 'none');
  assert.equal(value.angleDeg, 0);
}
assert.equal(planeScans, 0, 'non-sweep attacks never traverse the tool hierarchy');
assert.equal(stats.nonSweepSearchesAvoided, 60);
state = { activeSlot: 'weapon', combatAnim: 'sweep', sweepPlaneNeutralCompensationDeg: 0 };
const gameSweep = getBasis(record, holder);
assert.equal(gameSweep.source, 'runtime-sweep-plane');
assert(Math.abs(gameSweep.angleDeg - 90) < 0.001, 'gameplay sweep keeps its baked correction');
assert.equal(planeScans, 1);
editor = true; style = 'thrust';
getBasis(record, holder);
assert.equal(planeScans, 1, 'non-sweep authoring poses also skip the scan');
style = 'sweep';
const editorSweep = getBasis(record, holder);
assert.equal(editorSweep.source, 'editor-sweep-plane');
assert(Math.abs(editorSweep.angleDeg - 45) < 0.001);
assert.equal(planeScans, 2);
holder.name = 'player_flute_mouth_mount';
getBasis(record, holder);
assert.equal(planeScans, 2, 'flute never borrows a sweep correction');

let computations = 0;
const shared = { quaternion: new Q(), source: 'none', angleDeg: 0 };
const received = [];
const handsPlaced = [];
let twoHands = true;
const primary = { position: { x: 1 } };
const secondary = { position: { x: 2 }, influence: 1 };
const sync = extract('syncRigToTool', '\n  const originalInstallGameRuntime', {
  syncing: false,
  global: { HobunjiHandGripModes: { currentModeKey: () => 'normal' } },
  playerKurrayaActive: () => false,
  freeRightHandFor: () => null,
  currentToolKey: () => 'axe',
  currentGripContext: () => 'melee',
  toolGrips: {
    primaryGripForTool: () => primary,
    secondaryGripForTool: () => twoHands ? secondary : null,
  },
  visualGripBasisDelta: () => { computations++; return shared; },
  toolSocketWorld: (_r, _h, grip, sharedBasis) => {
    received.push(sharedBasis);
    return { position: grip.position, quaternion: {}, visualBasis: sharedBasis };
  },
  handSocketAfterGripMode: (_r, socket) => ({ ...socket, mode: {} }),
  modelCalibrationForRecord: () => ({ modelKey: 'test' }),
  profiles: { data: { models: { test: { handFromTool: {} } } } },
  ensureFallbackState: r => r.fallback,
  applyFallbackSide: () => {},
  applyFallbackBoth: () => {},
});
const actor = {
  speciesId: 'mao-ao', gender: 'male', avatarRoot: { userData: {} },
  fallback: { owners: {}, overridden: {} },
  rig: {
    placePaperHandGuideWorld() {},
    placeHandWorld(side) { handsPlaced.push(side); },
  },
};
const weapon = { parent: {}, visible: true };
sync(actor, weapon);
assert.equal(computations, 1, 'two-handed grip computes one visual basis');
assert.equal(received.length, 2);
assert(received.every(value => value === shared), 'both hands use the identical basis');
assert.deepEqual(handsPlaced, ['right', 'left']);
assert.equal(actor.secondaryActive, true);
twoHands = false; received.length = 0;
sync(actor, weapon);
assert.equal(computations, 2);
assert.deepEqual(received, [shared]);
assert.equal(actor.secondaryActive, false);
weapon.visible = false; sync(actor, weapon);
assert.equal(computations, 2, 'hidden tools skip basis computation');

const chain = extract('hierarchyWorldQuaternion', '\n  function findToolVisualPlane(', {});
const top = { isObject3D: true, quaternion: new Q().setFromEuler({ z: Math.PI / 4 }), parent: null };
const child = { isObject3D: true, quaternion: new Q().setFromEuler({ z: Math.PI / 4 }), parent: top };
const ancestorRecord = {};
const composed = chain(ancestorRecord, child, new Q());
assert(Math.abs(composed.z - Math.SQRT1_2) < 0.0001);
const scratch = ancestorRecord._handHierarchyChain;
assert(Array.isArray(scratch) && scratch.length === 0, 'scratch does not retain nodes');
chain(ancestorRecord, top, new Q());
assert.strictEqual(ancestorRecord._handHierarchyChain, scratch);
assert.equal(scratch.length, 0);
console.log('Procedural hand grip scan-budget regression passed');
