#!/usr/bin/env node
'use strict';

// Executes CharacterVisuals.visibilityReport / captureVisibilityReport
// (js/character-visuals.js): for every character, including hidden ones,
// it names why a portrait part would not show (hidden ancestor, layers,
// non-finite position, transparent material, outside the frustum, absent
// from the main pass's draw list) and is quiet about healthy characters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { return this.set(v.x, v.y, v.z); } }
class Sphere { constructor(center = new Vector3(), radius = 1) { this.center = center; this.radius = radius; } clone() { return new Sphere(new Vector3().copy(this.center), this.radius); } applyMatrix4(m) { this.center.set(this.center.x + m.tx, this.center.y + m.ty, this.center.z + m.tz); return this; } }
class Matrix4 { constructor() { this.tx = 0; this.ty = 0; this.tz = 0; this.det = 1; } multiplyMatrices() { return this; } determinant() { return this.det; } }
class Frustum { setFromProjectionMatrix() { return this; } intersectsSphere(sphere) { return Math.abs(sphere.center.x) < 50; } } // "On screen" = |x| < 50.
const THREE = { Vector3, Matrix4, Frustum, Sphere };

let seq = 0;
function obj(name, props = {}) {
  return { name, uuid: 'u' + (++seq), visible: true, parent: null, children: [], layers: { mask: 1 }, userData: {}, ...props,
    add(child) { child.parent = this; this.children.push(child); return this; },
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); } };
}
function portrait(name, x, materialProps = {}) {
  const matrixWorld = new Matrix4(); matrixWorld.tx = x;
  const mesh = obj(name, { isMesh: true, matrixWorld, renderOrder: 0,
    material: { name: 'npc_avatar_skinned_body', map: { image: { width: 64 } }, opacity: 1, transparent: true, depthWrite: false, ...materialProps },
    geometry: { boundingSphere: new Sphere(new Vector3(), 1) },
    updateWorldMatrix() {}, getWorldPosition(target) { return target.set(matrixWorld.tx, 0, 0); } });
  return mesh;
}

const scene = obj('scene', { isScene: true });
const playerRoot = scene.add(obj('player_root')).children.at(-1);
const playerPortrait = portrait('player_portrait', 0); playerRoot.add(playerPortrait);
const npcRoot = scene.add(obj('npc_root')).children.at(-1);
const npcPortrait = portrait('npc_portrait', 3, { opacity: 0 }); npcRoot.add(npcPortrait);
const creatureGroup = scene.add(obj('drenkirra_group')).children.at(-1);
const front = portrait('drenkirra_front', 2); const back = portrait('drenkirra_back', 2);
creatureGroup.add(front); creatureGroup.add(back);
creatureGroup.visible = false; // The reported bug: an attacker that stopped showing.
const farRoot = scene.add(obj('far_root')).children.at(-1);
const farPortrait = portrait('far_portrait', 400); farRoot.add(farPortrait);
const layerRoot = scene.add(obj('layer_root')).children.at(-1);
const layerPortrait = portrait('layer_portrait', 4); layerPortrait.layers.mask = 0x100; layerRoot.add(layerPortrait);
// Wildlife hidden on purpose: far away is summarised, close to the player is suspicious.
const sleeperGroup = scene.add(obj('sleeper_group')).children.at(-1); sleeperGroup.visible = false;
const sleeperFront = portrait('sleeper_front', 200); sleeperGroup.add(sleeperFront);
const stuckGroup = scene.add(obj('stuck_group')).children.at(-1); stuckGroup.visible = false;
const stuckFront = portrait('stuck_front', 5); stuckGroup.add(stuckFront);
const nanRoot = scene.add(obj('nan_root')).children.at(-1);
const nanPortrait = portrait('nan_portrait', NaN); nanRoot.add(nanPortrait);

const camera = { position: new Vector3(0, 5, 10), projectionMatrix: {}, matrixWorldInverse: {}, updateMatrixWorld() {}, layers: { test: layers => (layers.mask & 1) !== 0 } };
const providerCalls = [];
let hook = null;
const win = {
  THREE,
  GridTileAccessors: { getCurrentArea: () => 'map_test', getActiveScene: () => scene },
  WorldRenderPipeline: { camera, currentPass: () => 'main', snapshot: () => ({ scopes: [{ id: 'npc-view-cull', errors: 2, lastError: 'boom' }, { id: 'ok', errors: 0 }] }) },
  RenderHooks: {
    register(spec) { hook = spec; return () => { hook = null; }; },
    getDebug: () => ({ hooks: [{ id: 'player-body-composer', errors: 1, lastError: 'before: x' }, { id: 'fine', errors: 0 }] }),
  },
  HeldObjectRenderOrder: { snapshot: () => ({ invariantRepairs: 3 }) },
};
win.window = win;
const context = vm.createContext({ window: win, THREE, console, Promise, performance: { now: () => 0 },
  requestAnimationFrame: cb => setImmediate(() => {
    // One world frame: the main pass draws the player, NPC, far and NaN portraits but not the layer one.
    hook?.afterRender?.({ camera, scene, depth: 0, renderer: { renderLists: { get: () => ({ opaque: [], transparent: [playerPortrait, npcPortrait, farPortrait, nanPortrait].map(object => ({ object })) }) } } });
    cb(0);
  }) });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/character-visuals.js'), 'utf8'), context, { filename: 'character-visuals.js' });
const CV = win.CharacterVisuals;
const K = CV.KINDS;
CV.registerProvider({ id: 'test', each(area, visit, options) {
  providerCalls.push(options?.includeHidden === true);
  const all = options?.includeHidden === true;
  visit(K.PLAYER, playerRoot, { name: 'Oobmir' });
  visit(K.NPC, npcRoot, { name: 'Faded' });
  if (all || creatureGroup.visible) visit(K.CREATURE, creatureGroup, { creatureKey: 'drenkirra', avatarRef: { group: creatureGroup, frontPlane: front, backPlane: back } });
  visit(K.NPC, farRoot, { name: 'Far' });
  if (all) visit(K.CREATURE, sleeperGroup, { creatureKey: 'sleeper', _wildlifeVisualLodHidden: true, avatarRef: { group: sleeperGroup, frontPlane: sleeperFront } });
  if (all) visit(K.CREATURE, stuckGroup, { creatureKey: 'stuck', _wildlifeVisualLodHidden: true, avatarRef: { group: stuckGroup, frontPlane: stuckFront } });
  visit(K.NPC, layerRoot, { name: 'Layered' });
  visit(K.NPC, nanRoot, { name: 'Broken' });
} });

(async () => {
  const report = await CV.captureVisibilityReport();
  assert.equal(providerCalls.at(-1), true, 'the report asks providers for hidden characters too');
  assert.equal(hook, null, 'the capture hook is removed');
  const byName = Object.fromEntries(report.characters.map(c => [c.name, c]));
  assert.deepEqual([...byName.Oobmir.issues], [], 'a healthy, drawn player has no issues');
  assert.equal(byName.Oobmir.parts[0].drawnLastFrame, true);
  assert.ok(byName.drenkirra, 'a hidden attacker is still listed');
  assert.deepEqual([...byName.drenkirra.issues], ['front: hidden by drenkirra_group', 'back: hidden by drenkirra_group']);
  assert.ok(byName.Faded.issues.includes('portrait: opacity 0'));
  assert.ok(byName.Far.issues.includes('portrait: outside camera frustum'));
  assert.ok(byName.Layered.issues.some(issue => /layers 0x100 not seen by camera/.test(issue)));
  assert.ok(byName.Layered.issues.includes('portrait: not in main-pass draw list'));
  assert.ok(byName.Broken.issues.includes('portrait: non-finite position'));
  assert.equal(report.hookErrors.length, 1);
  assert.equal(report.hookErrors[0].id, 'player-body-composer');
  assert.equal(report.scopeErrors[0].id, 'npc-view-cull');
  assert.equal(report.heldInvariantRepairs, 3);
  assert.match(report.text, /main pass captured true/);
  assert.match(report.text, /creature drenkirra \(2 tiles\): front: hidden by drenkirra_group/);
  assert.match(report.text, /player Oobmir \(0 tiles\): ok/);
  assert.equal(byName.sleeper.hiddenByDesign, true, 'far LOD-hidden wildlife is expected');
  assert.doesNotMatch(report.text, /creature sleeper/, 'and only summarised');
  assert.match(report.text, /hidden by design, far from the player: 1 far away \(wildlife visual LOD\)/);
  assert.equal(byName.stuck.hiddenByDesign, false, 'an LOD-hidden creature 5 tiles away is suspicious');
  assert.match(report.text, /creature stuck \(5 tiles\): front: hidden by stuck_group — flagged "far away \(wildlife visual LOD\)" yet close to the player/);
  // Without a captured frame the draw-list check is simply absent.
  const quick = CV.visibilityReport();
  assert.equal(quick.characters.find(c => c.name === 'Oobmir').parts[0].drawnLastFrame, null);
  console.log('character visibility report: hidden, transparent, off-layer, off-screen, non-finite and undrawn parts are named');
})().catch(error => { console.error(error); process.exit(1); });
