#!/usr/bin/env node
'use strict';

// A settled wildlife corpse used to keep a full rig for the whole session: the
// wildlife LOD skipped anything with health <= 0, and corpses are not in
// hostileObjects so the per-creature LOD never saw them anyway. Settled corpses
// now stream like any far actor (data stays, rig released, pose restored when
// the player returns). Dying bodies, bandits and revivable skeletons never do.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// ---- wildlife LOD ----------------------------------------------------------
const lodWindow = { Combat: { telegraph: { isBusy: () => false }, animalAttacks: { isBusy: () => false } } };
const lodContext = vm.createContext({ window: lodWindow, performance: { now: () => 0 }, localStorage: { getItem: () => null, setItem() {} } });
vm.runInContext(read('docs/js/entity-distance-lod.js'), lodContext);
vm.runInContext(read('docs/js/wildlife-visual-lod.js'), lodContext);
const lod = lodWindow.WildlifeVisualLod;

const created = [], released = [];
lod.init({
  createVisuals: c => { created.push(c); c._wildlifeVisualsReleased = false; },
  releaseVisuals: c => { released.push(c); c._wildlifeVisualsReleased = true; },
});
const group = () => ({ visible: true });
const corpse = (extra = {}) => ({
  id: 'wolf', state: 'corpse', health: 0, streamVisuals: true, _wildlifeVisualsReleased: false,
  avatarRef: { group: group() }, groundShadow: { visible: true }, ...extra,
});

assert.equal(lod.isStreamableCorpse(corpse()), true, 'a settled wildlife corpse streams');
assert.equal(lod.canHide(corpse()), true, 'and can hide');
assert.equal(lod.canHide(corpse({ state: 'dying' })), false, 'a dying body keeps its rig for the fall');
assert.equal(lod.canHide(corpse({ isBandit: true })), false, 'bandit corpses keep their rig');
assert.equal(lod.canHide(corpse({ keepCorpseAfterLoot: true })), false, 'a skeleton that revives after looting keeps its rig');
assert.equal(lod.canHide(corpse({ streamVisuals: false })), false, 'only streamed wildlife is data-only capable');
assert.equal(lod.canHide({ health: 10, state: 'idle', streamVisuals: true }), true, 'living wildlife is unchanged');
assert.equal(lod.canHide({ health: 10, state: 'chase', streamVisuals: true }), false, 'a chasing animal still keeps its rig');

lod.beginFrame();
const far = corpse();
assert.equal(lod.update(far, 40), true, 'a far corpse hides');
assert.equal(released.length, 1, 'its rig is released once it is far away');
assert.equal(far._wildlifeVisualsReleased, true);

lod.beginFrame();
assert.equal(lod.update(far, 40), true, 'still far');
assert.equal(released.length, 1, 'a released corpse is not released twice');
lod.beginFrame();
lod.update(far, 4);
assert.equal(created.length, 1, 'walking back promotes it');
assert.equal(far._wildlifeVisualsReleased, false);

const dying = corpse({ state: 'dying' });
lod.beginFrame();
lod.update(dying, 60);
assert.equal(released.length, 1, 'a dying body is never released');

// ---- pose restore on the new rig ------------------------------------------
const deathWindow = { ResourceRings: { disposeRingHud() {} } };
const sampled = [], started = [];
deathWindow.ImpactRagdollPlayback = {
  startCreatureDeath: (c, direction) => { started.push(direction); return 0.7; },
  sampleCreatureDeath: (c, phase) => { sampled.push(phase); return true; },
};
vm.runInNewContext(read('docs/js/creature-death.js'), { window: deathWindow, Math, Date, console }, { filename: 'creature-death.js' });
const TILE = 64;
deathWindow.CreatureDeath.init({
  TILE, COLS: 50, ROWS: 50, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  getGrid: () => [[{}]], getCurrentArea: () => 'zone', corpseObjects: new Set(), canOccupyAt: () => true,
  tileSurfaceYInArea: () => 2, characterGroundShadowSurfaceOffset: () => 0.02,
});
const rig = () => ({
  group: { position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, rotation: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, scale: { y: 0 }, traverse() {} },
  frontPlane: { rotation: { y: 0 } }, backPlane: { rotation: { y: 0 } },
});
const restoring = (extra = {}) => ({
  state: 'corpse', health: 0, x: 3.5 * TILE, y: 4.5 * TILE, halfHeight: 0.5, areaId: 'zone', areaCols: 10, areaRows: 10,
  areaGrid: [[], [], [], [], [{}, {}, {}, {}, {}]].map((row, r) => (r === 4 ? row : [])),
  deathRecorded: true, deathDirection: 'back', deathCause: 'sharp',
  avatarRef: rig(), groundShadow: { position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } } }, ...extra,
});
const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({})));
const recordedBody = restoring({ areaGrid: grid, deathRestRotY: -1.1486 });
assert.equal(deathWindow.CreatureDeath.restoreSettledPose(recordedBody), true);
assert.deepEqual(started, ['back'], 'the recorded fall is rebuilt on the new rig');
assert.deepEqual(sampled, [1], 'and posed on its settled last frame');
assert.equal(recordedBody.avatarRef.group.position.x, 3.5, 'the body lies at its resting tile');
assert.equal(recordedBody.avatarRef.group.position.z, 4.5);
assert.equal(recordedBody.avatarRef.group.position.y, 2 + 0.5 * 0.82, 'recorded bodies rest at the recorded height');
assert.equal(recordedBody.groundShadow.position.y, 2 + 0.02, 'the ground shadow follows');
assert.equal(recordedBody.avatarRef.frontPlane.rotation.y, Math.PI / 2, 'cards are reset to the flat face');
assert.deepEqual([recordedBody.avatarRef.group.rotation.x, recordedBody.avatarRef.group.rotation.y, recordedBody.avatarRef.group.rotation.z], [0, -1.1486, 0], 'a recorded body keeps the facing it fell with (the new rig would otherwise start at yaw 0)');

const flatBody = restoring({ areaGrid: grid, deathRecorded: false, deathRestRotX: 0.1, deathRestRotY: 1.2, deathRestRotZ: Math.PI / 2 });
sampled.length = 0;
assert.equal(deathWindow.CreatureDeath.restoreSettledPose(flatBody), true);
assert.deepEqual(sampled, [], 'no recording means no sampling');
assert.equal(flatBody.avatarRef.group.position.y, 2 + 0.5 * 0.12, 'fallback bodies rest low');
assert.deepEqual([flatBody.avatarRef.group.rotation.x, flatBody.avatarRef.group.rotation.y, flatBody.avatarRef.group.rotation.z], [0.1, 1.2, Math.PI / 2], 'and keep their original resting rotation');
assert.equal(deathWindow.CreatureDeath.restoreSettledPose(restoring({ areaGrid: grid, state: 'dying' })), false, 'only settled corpses are restored');

// ---- wiring in game.js -----------------------------------------------------
const game = read('docs/game.js');
const release = game.slice(game.indexOf('function releaseCreatureVisuals(c)'), game.indexOf('function despawnCreature(c)'));
assert.match(release, /isStreamableCorpse\(c\)/, 'releaseCreatureVisuals lets settled corpses go');
assert.match(release, /_deathRecordedThrow = null/, 'and drops the released rig\'s pose state');
const create = game.slice(game.indexOf('function createCreatureVisuals(c)'), game.indexOf('function releaseCreatureVisuals(c)'));
assert.match(create, /restoreSettledPose/, 'promotion restores the corpse pose');
assert.equal((game.match(/^\s+tickCorpses\(dt\);/gm) || []).length, 2, 'both game-loop branches drive the corpse LOD');
const tick = game.slice(game.indexOf('function updateCorpseVisualLod('), game.indexOf('function tickCorpses(dt)'));
assert.match(tick, /c\.areaId !== currentArea[\s\S]{0,120}releaseCreatureVisuals\(c\)/, 'corpses in another area are released outright');

console.log('corpse visual streaming regression passed');
