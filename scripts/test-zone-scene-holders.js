#!/usr/bin/env node
'use strict';

// A heap snapshot of a game that had evicted a wilderness zone showed its old
// scene and grid still reachable through module-private registries:
//   - CratePiles.restoredScenes (scene), HeldObjectRenderOrder's SceneRegistry
//     instances (scene plus every registered mesh) and
//     PorakanekiCampPlacementPolicy.gridRefByZone (grid).
// Each now has a release the zone cache calls. This runs the real code.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function slice(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `found ${from}`);
  return source.slice(start, end);
}

// ---- HeldObjectRenderOrder: SceneRegistry.forgetScene ------------------------
{
  const source = read('docs/js/held-object-render-order.js');
  const registryClass = slice(source, 'class SceneRegistry {', 'const heldMeshes = new WeakSet();');
  const forgetFn = slice(source, 'function forgetScene(scene) {', 'window.HeldObjectRenderOrder = {');
  const context = vm.createContext({});
  vm.runInContext(`${registryClass}
    const heldRegistry = new SceneRegistry(), groundRegistry = new SceneRegistry(), topFaceGroundRegistry = new SceneRegistry(), waterRegistry = new SceneRegistry(),
      tintCoverRegistry = new SceneRegistry(), protectedCoverRegistry = new SceneRegistry(), waterOccludedRegistry = new SceneRegistry(), pngDepthRegistry = new SceneRegistry();
    const lastSceneScan = new WeakMap();
    ${forgetFn}
    this.api = { forgetScene, registries: { heldRegistry, groundRegistry, topFaceGroundRegistry, waterRegistry, tintCoverRegistry, protectedCoverRegistry, waterOccludedRegistry, pngDepthRegistry } };`, context);
  const { forgetScene, registries } = context.api;
  const scene = children => ({ children, traverse(fn) { children.forEach(fn); } });
  const meshesA = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], meshesB = [{ id: 'b1' }, { id: 'b2' }];
  const sceneA = scene(meshesA), sceneB = scene(meshesB);

  for (const registry of Object.values(registries)) {
    for (const m of meshesA.slice(0, 2)) { registry.add(m); registry.pending.delete(m); registry.place(m, sceneA); } // Found and bucketed under scene A.
    registry.add(meshesA[2]); // Added but not placed yet (still pending), also in scene A.
    for (const m of meshesB) { registry.add(m); registry.pending.delete(m); registry.place(m, sceneB); }
  }
  const removed = forgetScene(sceneA);
  assert.equal(removed, 3 * Object.keys(registries).length, 'every member of the scene leaves every registry');
  for (const [name, registry] of Object.entries(registries)) {
    for (const m of meshesA) {
      assert.equal(registry.all.has(m), false, `${name}: ${m.id} left the member set`);
      assert.equal(registry.pending.has(m), false, `${name}: ${m.id} left the pending set`);
      assert.equal(registry.sceneOf.has(m), false, `${name}: ${m.id} left sceneOf`);
    }
    assert.equal(registry.byScene.has(sceneA), false, `${name}: the old scene is no longer a key`);
    assert.equal(registry.byScene.get(sceneB)?.size, 2, `${name}: another scene's bucket is untouched`);
    assert.equal(registry.all.size, 2, `${name}: other scenes' members stay registered`);
    assert.equal(registry.sceneOf.get(meshesB[0]), sceneB);
  }
  assert.equal(forgetScene(sceneA), 0, 'forgetting twice is harmless');
  assert.equal(forgetScene(null), 0, 'a missing scene is ignored');
}

// ---- CratePiles.releaseZone ------------------------------------------------
{
  const source = read('docs/js/crate-piles.js');
  const releaseFn = slice(source, 'function releaseZone(mapId) {', 'function nearestInteractable');
  const removedGroups = [];
  const drop = (mapId, id) => ({ mapId, group: { id, parent: { remove: g => removedGroups.push(g.id) } } });
  const context = vm.createContext({});
  vm.runInContext(`
    const piles = new Map([['zoneA::p1', {}], ['zoneA::p2', {}], ['zoneB::p1', {}]]);
    const junk = new Map();
    const restoredScenes = new Map([['zoneA', 'sceneA'], ['zoneB', 'sceneB']]);
    const savedDrops = new Map([['zoneA::d1', { mapId: 'zoneA' }]]), savedCounts = new Map([['zoneA::p1', 4]]);
    ${releaseFn}
    this.api = { releaseZone, piles, junk, restoredScenes, savedDrops, savedCounts };`, context);
  const { api } = context;
  api.junk.set('zoneA::d1', drop('zoneA', 'dropA')); api.junk.set('zoneB::d1', drop('zoneB', 'dropB'));
  api.releaseZone('zoneA');
  assert.deepEqual([...api.piles.keys()], ['zoneB::p1'], 'the zone\'s piles are released');
  assert.deepEqual([...api.junk.keys()], ['zoneB::d1'], 'its uncollected drops are released');
  assert.deepEqual(removedGroups, ['dropA'], 'and taken out of the old scene');
  assert.deepEqual([...api.restoredScenes.keys()], ['zoneB'], 'the one-shot rehydration marker is dropped, so re-entry rehydrates');
  assert.equal(api.savedDrops.size, 1, 'saved drops persist across the rebuild');
  assert.equal(api.savedCounts.get('zoneA::p1'), 4, 'saved supply counts persist across the rebuild');
}

// ---- PorakanekiCampPlacementPolicy.forgetZone ------------------------------
{
  const grid = [[{}]];
  const window = { GridTileAccessors: { getCurrentArea: () => 'map_northern_cliffs', getActiveGrid: () => grid } };
  vm.runInNewContext(read('docs/js/porakaneki-camp-placement-policy.js'), { window, console, Object, Map, Set, Math, Number, String, Array, WeakMap });
  const policy = window.PorakanekiCampPlacementPolicy;
  policy.syncCurrentZoneClutter();
  assert.deepEqual([...policy.debugSnapshot().gridRememberedZones], ['map_northern_cliffs'], 'the zone grid is remembered while the zone is live');
  policy.forgetZone('map_northern_cliffs');
  assert.deepEqual([...policy.debugSnapshot().gridRememberedZones], [], 'forgetZone drops the reference');
  policy.syncCurrentZoneClutter();
  assert.deepEqual([...policy.debugSnapshot().gridRememberedZones], ['map_northern_cliffs'], 'and the next visit re-records it (treated as a rebuilt grid)');
}

// ---- Shattercasks.releaseZone ----------------------------------------------
{
  const releaseFn = slice(read('docs/js/shattercasks.js'), 'function releaseZone(mapId) {', 'function recordFor(mapId, targetScene) {');
  const context = vm.createContext({});
  vm.runInContext(`
    const records = new Map([['zoneA', { scene: 'sceneA' }], ['zoneB', { scene: 'sceneB' }]]);
    const placementCache = new Map([['zoneA', { scene: 'sceneA' }], ['zoneB', { scene: 'sceneB' }]]);
    ${releaseFn}
    this.api = { releaseZone, records, placementCache };`, context);
  context.api.releaseZone('zoneA');
  assert.deepEqual([...context.api.records.keys()], ['zoneB'], 'the zone\'s record (which holds its scene) is released');
  assert.deepEqual([...context.api.placementCache.keys()], ['zoneB'], 'and its placement cache');
  assert.match(read('docs/js/shattercasks.js'), /Object\.freeze\(\{\s*init,releaseZone,/, 'releaseZone is exported');
}

// ---- WorldPopupText.releaseScene -------------------------------------------
{
  const releaseFn = slice(read('docs/js/world-popup-text.js'), 'function releaseScene(scene) {', 'const api = {');
  const disposed = [];
  const context = vm.createContext({});
  const ev = (id, scene) => ({ id, scene });
  vm.runInContext(`
    const state = { active: [], pending: [], levelUpQueue: [], aimLabel: null };
    const disposed = this.disposed;
    function dispose(event) { disposed.push(event.id); }
    ${releaseFn}
    this.api = { releaseScene, state };`, Object.assign(context, { disposed }));
  const { api } = context;
  const A = { name: 'A' }, B = { name: 'B' };
  api.state.active.push(ev('popA1', A), ev('popB', B), ev('popA2', A));
  api.state.pending.push({ kind: 'favor', scene: A }, { kind: 'favor', scene: B });
  api.state.levelUpQueue.push({ text: 'x', scene: A }, { text: 'y', scene: B });
  api.state.aimLabel = ev('aimA', A);
  const released = api.releaseScene(A);
  assert.deepEqual(disposed.sort(), ['aimA', 'popA1', 'popA2'], 'popups and the aim label anchored in the scene are disposed');
  assert.deepEqual([...api.state.active.map(e => e.id)], ['popB'], 'other scenes\' popups stay');
  assert.equal(api.state.pending.length, 1);
  assert.equal(api.state.pending[0].scene, B, 'queued popups for the scene are dropped');
  assert.equal(api.state.levelUpQueue.length, 1);
  assert.equal(api.state.aimLabel, null);
  assert.equal(released, 5, 'everything released is counted (2 active, 1 pending, 1 level-up, the aim label)');
  api.state.aimLabel = ev('aimB', B);
  assert.equal(api.releaseScene(A), 0, 'nothing left for that scene');
  assert.equal(api.state.aimLabel.id, 'aimB', 'an aim label in another scene is untouched');
  assert.equal(api.releaseScene(null), 0, 'a missing scene is ignored');
}

console.log('zone scene holder release regression passed');
