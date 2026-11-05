#!/usr/bin/env node
'use strict';

// Wilderness scenes used to stay cached forever once built. Only the current
// zone plus the most recent inactive one(s) stay built now. This runs the real
// eviction block and the real persistence capture/restore out of game.js
// against fake zone state, so it covers the policy, not a copy of it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');

function slice(from, to) {
  const start = game.indexOf(from), end = game.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `found ${from}`);
  return game.slice(start, end);
}
const evictionBlock = slice('// ── Inactive wilderness zone cache', 'window.__zoneCacheDebug =');
const persistenceFns = slice('function _captureLivePreviewZonePersistence(mapId)', 'function _disposeTownSceneForLivePreview');

function makeWorld(config) {
  const timers = [], disposed = [], campfireReleases = [], logs = [];
  const persist = { reagents: new Map(), berries: new Map(), treasure: new Map(), felled: new Map(), mined: new Map() };
  const zoneScenes = new Map();
  const hostiles = new Set(), corpses = new Set(), npcs = [];
  const context = vm.createContext({
    window: { SCRATCHBONES_CONFIG: config, DevSpawner: { DEV_ARENA_ZONE_ID: 'map_dev_arena', WILDERNESS_LAB_ZONE_ID: 'map_wilderness_lab' },
      WildernessCampfire: { releaseVisualIfZone: id => campfireReleases.push(id) }, __farmLog: msg => logs.push(msg) },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    _zoneScenes: zoneScenes, hostileObjects: hostiles, corpseObjects: corpses, npcWalkers: npcs,
    _zoneReagentPersist: persist.reagents, _zoneBerryPersist: persist.berries, _zoneTreasurePersist: persist.treasure,
    _zoneFelledTreePersist: persist.felled, _zoneMinedRockPersist: persist.mined,
    currentArea: 'town', cutscenePreviewActive: false, _tothalShiftPromise: null,
    _isZoneArea: id => String(id).startsWith('map_'), normalizeNpcArea: id => String(id),
    releaseCreatureVisuals: c => { if (c.health <= 0 && c.state !== 'corpse') return; c._wildlifeVisualsReleased = true; c.avatarRef = { data: true }; }, // Same guard as the real one: a dying body keeps its rig.
    // Mirrors the real _disposeZoneScene: it drops the scene AND the saved zone state (written for terrain regeneration).
    _disposeZoneScene: id => { disposed.push(id); zoneScenes.delete(id); for (const m of Object.values(persist)) m.delete(id); },
  });
  vm.runInContext(`${persistenceFns}\n${evictionBlock}\nthis.api = { noteZoneVisited, trimZoneCache, scheduleZoneCacheTrim, zoneEvictionBlocker, evictZoneScene, rebindZoneResidents, order: _zoneVisitOrder };`, context, { filename: 'zone-cache.js' });
  const addZone = id => zoneScenes.set(id, { scene: { cleared: false, clear() { this.cleared = true; } }, grid: ['grid-' + id], cols: 200, rows: 200 });
  const visit = id => { addZone(id); context.currentArea = id; context.api.noteZoneVisited(id); };
  return { context, api: context.api, timers, disposed, campfireReleases, logs, persist, zoneScenes, hostiles, corpses, npcs, addZone, visit };
}

// ---- keeps the current zone and the most recent inactive one --------------
{
  const w = makeWorld({});
  w.visit('map_a'); w.visit('map_b'); w.visit('map_c');
  assert.deepEqual([...w.api.order], ['map_a', 'map_b', 'map_c']);
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, ['map_a'], 'the oldest inactive zone is evicted; current and the previous one stay');
  assert.deepEqual([...w.zoneScenes.keys()].sort(), ['map_b', 'map_c']);
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, ['map_a'], 'trimming again changes nothing');
  // Revisit: b becomes current, c the previous one; a is rebuilt by the normal enter path.
  w.visit('map_b');
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, ['map_a'], 'going back to the kept zone evicts nothing');
  assert.deepEqual([...w.api.order], ['map_a', 'map_c', 'map_b'], 'visit order tracks recency');
  w.visit('map_a');
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, ['map_a', 'map_c'], 'after a is rebuilt and entered, the older inactive zone (c) goes');
  assert.ok(w.zoneScenes.has('map_a') && w.zoneScenes.has('map_b') && !w.zoneScenes.has('map_c'), 'current and previous stay built');
}

// ---- config ---------------------------------------------------------------
{
  const w = makeWorld({ game: { zoneCache: { maxInactiveZones: 0 } } });
  w.visit('map_a'); w.visit('map_b');
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, ['map_a'], 'maxInactiveZones 0 keeps only the current zone');
  const roomy = makeWorld({ game: { zoneCache: { maxInactiveZones: 3 } } });
  roomy.visit('map_a'); roomy.visit('map_b'); roomy.visit('map_c'); roomy.visit('map_d');
  roomy.api.trimZoneCache();
  assert.deepEqual(roomy.disposed, [], 'a larger bound keeps more zones');
  const junk = makeWorld({ game: { zoneCache: { maxInactiveZones: -4 } } });
  junk.visit('map_a'); junk.visit('map_b'); junk.visit('map_c');
  junk.api.trimZoneCache();
  assert.deepEqual(junk.disposed, ['map_a'], 'an invalid bound falls back to the default of 1');
}

// ---- saved zone state survives eviction -----------------------------------
{
  const w = makeWorld({});
  w.visit('map_a'); w.visit('map_b'); w.visit('map_c');
  const saved = { reagents: { day: 4, placements: [{ col: 1, row: 2, harvested: true }] }, berries: { day: 4 }, treasure: { day: 4 }, felled: [{ col: 3, row: 4, feltDay: 2 }], mined: [{ col: 5, row: 6, minedDay: 3 }] };
  w.persist.reagents.set('map_a', saved.reagents); w.persist.berries.set('map_a', saved.berries); w.persist.treasure.set('map_a', saved.treasure);
  w.persist.felled.set('map_a', saved.felled); w.persist.mined.set('map_a', saved.mined);
  w.persist.felled.set('map_b', [{ col: 9, row: 9 }]);
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, ['map_a']);
  assert.equal(w.persist.reagents.get('map_a'), saved.reagents, 'harvested reagent placements survive');
  assert.equal(w.persist.berries.get('map_a'), saved.berries, 'berries survive');
  assert.equal(w.persist.treasure.get('map_a'), saved.treasure, 'treasure survives');
  assert.equal(w.persist.felled.get('map_a'), saved.felled, 'felled-tree timers survive');
  assert.equal(w.persist.mined.get('map_a'), saved.mined, 'mined-rock timers survive');
  assert.deepEqual(w.persist.felled.get('map_b'), [{ col: 9, row: 9 }], 'other zones are untouched');
}

// ---- pins -----------------------------------------------------------------
{
  const w = makeWorld({});
  w.visit('map_a'); w.visit('map_b'); w.visit('map_c');
  w.npcs.push({ area: 'map_a' });
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, [], 'a zone with an NPC in it is never evicted');
  assert.match(w.logs.join('\n'), /kept map_a: npc/);
  w.npcs.length = 0;

  const bandit = { areaId: 'map_a', isBandit: true, _wildlifeVisualsReleased: false };
  w.hostiles.add(bandit);
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, [], 'a resident that still owns a rig in the zone pins it');
  w.hostiles.delete(bandit);

  const dying = { areaId: 'map_a', state: 'dying', health: 0, streamVisuals: true, _wildlifeVisualsReleased: false };
  const streamed = { areaId: 'map_a', health: 10, streamVisuals: true, _wildlifeVisualsReleased: false };
  const dataOnly = { areaId: 'map_a', health: 10, streamVisuals: true, _wildlifeVisualsReleased: true };
  w.hostiles.add(streamed); w.hostiles.add(dataOnly);
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, ['map_a'], 'streamed wildlife is released to data and does not block eviction');
  assert.equal(streamed._wildlifeVisualsReleased, true, 'the streamed rig was released first');
  assert.equal(streamed.scene, null, 'and the creature no longer holds the old scene');
  assert.equal(streamed.areaGrid, null, 'or the old grid');
  assert.equal(dataOnly.scene, null);

  const w2 = makeWorld({});
  w2.visit('map_a'); w2.visit('map_b'); w2.visit('map_c');
  const dying2 = { ...dying };
  w2.corpses.add(dying2);
  w2.api.trimZoneCache();
  assert.deepEqual(w2.disposed, [], 'a dying body that still needs its rig pins the zone');
}

// ---- never the current zone, never dev zones ------------------------------
{
  const w = makeWorld({ game: { zoneCache: { maxInactiveZones: 0 } } });
  w.visit('map_a');
  w.addZone('map_dev_arena'); w.addZone('map_wilderness_lab');
  w.api.trimZoneCache();
  assert.deepEqual(w.disposed, [], 'the current zone and the dev zones are never evicted');
}

// ---- rebuild re-points residents ------------------------------------------
{
  const w = makeWorld({});
  w.visit('map_a');
  const wolf = { areaId: 'map_a', scene: null, areaGrid: null };
  const other = { areaId: 'map_b', scene: 'keep', areaGrid: 'keep' };
  w.hostiles.add(wolf); w.hostiles.add(other);
  const info = { scene: { id: 'new' }, grid: ['new-grid'], cols: 120, rows: 90 };
  w.api.rebindZoneResidents('map_a', info);
  assert.equal(wolf.scene, info.scene);
  assert.equal(wolf.areaGrid, info.grid);
  assert.deepEqual([wolf.areaCols, wolf.areaRows], [120, 90]);
  assert.equal(other.scene, 'keep', 'residents of other zones are untouched');
}

// ---- eviction details -----------------------------------------------------
{
  const w = makeWorld({});
  w.visit('map_a'); w.visit('map_b'); w.visit('map_c');
  const scene = w.zoneScenes.get('map_a').scene;
  w.api.trimZoneCache();
  assert.deepEqual(w.campfireReleases, ['map_a'], 'the saved campfire releases only its visual');
  assert.equal(scene.cleared, true, 'the old scene is emptied so no stale mesh can keep it reachable');
}

// ---- scheduling and wiring ------------------------------------------------
{
  const w = makeWorld({});
  w.visit('map_a'); w.visit('map_b'); w.visit('map_c');
  w.api.scheduleZoneCacheTrim(); w.api.scheduleZoneCacheTrim();
  assert.equal(w.timers.length, 1, 'trims are coalesced into one timer');
  w.timers[0]();
  assert.deepEqual(w.disposed, ['map_a'], 'the timer runs the trim');
  w.context.cutscenePreviewActive = true;
  w.visit('map_d'); w.api.scheduleZoneCacheTrim(); w.timers.at(-1)();
  assert.deepEqual(w.disposed, ['map_a'], 'nothing is evicted during a cutscene preview');
}
const trigger = game.slice(game.indexOf('function releasePreviousAreaCreatureTextures()'), game.indexOf('function updateWildlifeVisualLod'));
assert.match(trigger, /noteZoneVisited\(currentArea\)[\s\S]*scheduleZoneCacheTrim\(\)/, 'every area change records the visit and schedules a trim');
assert.match(game, /_zoneScenes\.set\(mapId, info\);\s*\n\s*rebindZoneResidents\(mapId, info\)/, 'a rebuilt zone re-points its residents');
assert.match(fs.readFileSync(path.join(root, 'docs/js/wilderness-campfire.js'), 'utf8'), /releaseVisualIfZone/, 'the campfire exposes the visual release');

console.log('zone cache eviction regression passed');
