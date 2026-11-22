#!/usr/bin/env node
'use strict';

// Runs the real wilderness berry owner with minimal static-geometry stand-ins.
// Tests only harvesting rules; the real Three.js leaf/fruit renderer has its
// separate, already-established browser regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.HOBUNJI_TEST_ROOT || path.resolve(__dirname, '..'); // Production module root for this regression.
const zoneId = 'map_northern_cliffs'; // Authored home of native redberries.
const map = new Map(); // Live wild berry objects by their existing world-tile lookup key.
const zoneObjects = new Map(); // Same per-zone object map that a player aims at in production.
const zoneMeshes = new Map(); // Same per-zone mesh group that becomes stale after harvest.
const zonePersist = new Map(); // Saved berry placements, including day identity.
const zoneScenes = new Map(); // Only one real generated zone is needed for the pick-contract test.
const inventory = { redberries:999, redberrySeeds:999 }; // Full inventory exercises the non-consuming refusal branch.
const calendar = { day:10 }; // Monotonic calendar day shared by both wild forage owners.
let activeArea = zoneId; // Test moving away while a stale controller prompt remains open.
let refreshCount = 0; // Ensure failed/duplicate picks do not rebuild inventory UI.
let soundCount = 0; // Ensure rejected interactions do not play harvest sounds.

class FakeGroup {
  constructor() { this.children = []; this.userData = {}; this.position = { set() {} }; this.parent = null; }
  add(child) { this.children.push(child); }
}
class FakeMesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.name = ''; } }
class FakeMaterial { constructor(options) { this.options = options; } }
class FakeSphere {
  constructor() {
    this.attributes = {
      position: { array: new Float32Array([0,0,0,1,0,0,0,1,0]) },
      normal: { array: new Float32Array([0,1,0,0,1,0,0,1,0]) },
    };
    this.index = { array: new Uint16Array([0,1,2]) };
  }
}
class FakeBuffer {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  setIndex(index) { this.index = index; }
  computeBoundingSphere() {}
}
class FakeAttribute { constructor(array, size) { this.array = array; this.itemSize = size; } }
const THREE = {
  Mesh: FakeMesh, MeshLambertMaterial: FakeMaterial, SphereGeometry: FakeSphere,
  BufferGeometry: FakeBuffer, BufferAttribute: FakeAttribute,
}; // Minimal, dependency-free geometry objects used only by the production berry builder.
const scene = {
  add(mesh) { mesh.parent = this; },
  remove(mesh) { if (mesh.parent === this) mesh.parent = null; },
}; // Supports the real parent-removal semantics without requiring WebGL.
const grid = Array.from({ length:8 }, () => Array.from({ length:8 }, () => ({ type:'grass' }))); // Small static zone map.
zoneScenes.set(zoneId, { cols:8, rows:8, grid, scene });
const windowStub = {
  InventoryStacks:{MAX_TOTAL:999},
  FoliageGenerator:{ buildWildernessBushMesh:() => new FakeGroup() },
  AudioSystem:{
    playObjectSfx:() => { soundCount++; },
    objectSfxConfig:() => ({ harvest:'harvest' }),
    objectSfxSourceAt:() => ({})
  },
}; // Exactly the public APIs the production berry script consumes.
const deterministicMath = Object.create(Math);
deterministicMath.random = () => .1; // Forces the optional 20% wild berry seed roll in this fixture.
const context = vm.createContext({ window:windowStub, THREE, Math:deterministicMath, WildernessMapGenerator:{}, console });
vm.runInContext(fs.readFileSync(path.join(root,'docs/js/wild-berries.js'),'utf8'),context,{filename:'wild-berries.js'});
const berries = windowStub.WildBerries; // The actual public berry module: no copied harvest implementation.

berries.init({
  calendar, inventory, _zoneScenes:zoneScenes, _zoneBerryPersist:zonePersist,
  _zoneBerryMeshGroups:zoneMeshes, _zoneBerryObjects:zoneObjects,
  _zoneReagentPersist:new Map(), BERRY_COLORS:{redberries:0xAA3344},
  cropData:{redberries:{emoji:'🍓',seedKey:'redberrySeeds'}},
  ITEM_DEFS:{redberries:{label:'Red Berries'}},
  _mbRng:() => () => .5, _seedFromString:() => 1,
  findZoneFlatEmptyTiles:() => [{ col:3, row:4 }],
  tileSurfaceYInArea:() => 0, NORMAL_TOP:0,
  getCurrentArea:()=>activeArea, isZoneArea:id => id===zoneId,
  refreshItemScroll:()=>{refreshCount++;}, debugLog:()=>{},
}); // Real source-dependency contract, stripped to the needed static test inputs.

function liveBush() { return zoneObjects.get(zoneId)?.get('3,4'); } // Same tile-addressed object returned by world aiming.

berries.ensureZone(zoneId);
const first = liveBush();
assert(first && first.berryKey==='redberries', 'berry bush is built from its real generated-zone roster');
const refuseFull = first.onAction('obj_pick_berry');
assert.equal(refuseFull.ok,false,'a completely full fruit stack must not consume a berry bush');
assert.equal(zonePersist.get(zoneId).placements.length,1,'rejected bush remains in world-save placement history');
assert.equal(liveBush(),first,'rejected bush remains physically pickable');
assert.equal(refreshCount,0,'inventory UI is not refreshed for a failed pick');
assert.equal(soundCount,0,'a failed pick plays no harvest noise');

inventory.redberries = 998;
const nearFull = first.onAction('obj_pick_berry');
assert.equal(nearFull.ok,true,'one free fruit slot allows a real harvest');
assert.equal(inventory.redberries,999,'the fruit stack fills exactly its one available slot');
assert.equal(inventory.redberrySeeds,999,'an already-full seed stack does not overflow');
assert(!nearFull.message.includes('found a seed'),'pickup does not falsely claim it granted a capped seed');
assert.equal(liveBush(),undefined,'consumed bush is removed from the live aimable object roster');
assert.equal(zonePersist.get(zoneId).placements.length,0,'consumed bush is removed from saved daily placements');
assert.equal(first.onAction('obj_pick_berry').ok,false,'stale prompt cannot duplicate the berry after harvest');
assert.equal(refreshCount,1,'successful pick refreshes the inventory once');
assert.equal(soundCount,1,'successful pick plays one harvest sound');

calendar.day++;
berries.ensureZone(zoneId);
const second = liveBush();
assert(second && second !== first,'the next-day bush has a fresh interaction identity');
activeArea = 'map_eastern_mire';
assert.equal(second.onAction('obj_pick_berry').ok,false,'a cached prompt cannot pick another zone');
assert.equal(liveBush(),second,'cross-zone prompt refusal preserves the live bush');
activeArea = zoneId;
inventory.redberries = 0; inventory.redberrySeeds = 0;
const normal = second.onAction('obj_pick_berry');
assert.equal(normal.ok,true,'ordinary available-fruit harvest succeeds');
assert.equal(inventory.redberries,1,'ordinary pick grants one fruit');
assert.equal(inventory.redberrySeeds,1,'optional seed roll still works for a non-full seed stack');
assert(normal.message.includes('found a seed'),'granted bonus seed is accurately reported');

calendar.day++;
berries.ensureZone(zoneId);
assert.equal(berries.removeBerryBush(zoneId,3,4),true,'animal-foraging consumption retains its separate removeBerryBush path');
assert.equal(liveBush(),undefined,'animal consumption also removes the live berry object');
assert.equal(inventory.redberries,1,'animal consumption does not award a player berry');
console.log('PASS wild-berry-harvest-guards: full stack, partial stack, stale tap, cross-zone, optional seed, animal forage');
