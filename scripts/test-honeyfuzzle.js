#!/usr/bin/env node
'use strict';

// Honeyfuzzle: swarm wing cycle/pose math and instanced avatar, hive-stump
// lifecycle (spawn, night return, hold harvest, collapse), the 1x1 Honeyfuzzle
// House (FarmProduction building, egg -> swarm), the fixed Medium size, and the
// "never a barn animal" gate. Every check runs the real modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(file, 'utf8');

function sandbox(extra = {}) {
  const context = { console, Math, Date, performance: { now: () => 0 }, setInterval: () => 1, clearInterval() {}, localStorage: { getItem: () => null, setItem() {} }, ...extra };
  context.window = context;
  context.InventoryStacks = require('./lib/inventory-stacks');
  vm.createContext(context);
  return context;
}
const load = (context, file) => vm.runInContext(read(file), context, { filename: file });

// Minimal THREE stand-in: enough for the swarm avatar's instanced mesh bookkeeping.
function fakeThree() {
  class Obj { constructor() { this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.rotation = { x: 0, y: 0, z: 0 }; this.children = []; }
    add(child) { this.children.push(child); child.parent = this; } remove(child) { this.children = this.children.filter(c => c !== child); } }
  return {
    DoubleSide: 2, DynamicDrawUsage: 35048,
    Group: class extends Obj {},
    PlaneGeometry: class { constructor() { this.attrs = {}; this.disposed = false; } setAttribute(name, attr) { this.attrs[name] = attr; } getAttribute(name) { return this.attrs[name]; } dispose() { this.disposed = true; } },
    InstancedBufferAttribute: class { constructor(array) { this.array = array; this.needsUpdate = false; } },
    MeshBasicMaterial: class { constructor(options) { Object.assign(this, options); this.disposed = false; } dispose() { this.disposed = true; } },
    CanvasTexture: class {},
    InstancedMesh: class extends Obj { constructor(geometry, material, count) { super(); this.geometry = geometry; this.material = material; this.count = count; this.instanceMatrix = { array: new Float32Array(count * 16), needsUpdate: false, setUsage() {} }; } dispose() {} },
  };
}

// ---- swarm: wing cycle ---------------------------------------------------------
{
  const context = sandbox();
  load(context, 'docs/js/honeyfuzzle-swarm.js');
  const S = context.HoneyfuzzleSwarm;
  assert.deepEqual(Array.from(S.WING_CYCLE), [0, 1, 2, 1], 'cycle is up -> mid -> down -> mid');
  for (let step = 0; step < 12; step++) {
    const frames = [0, 1, 2].map(member => S.memberFrame(member, step));
    assert.equal(new Set(frames).size >= 2, true, 'the three thirds are never all on the same frame');
    assert.deepEqual([3, 4, 5].map(member => S.memberFrame(member, step)), frames, 'members in the same third share a frame');
  }
  // Every member steps along the same cycle on the same tick; they differ only in where they started.
  for (let member = 0; member < 3; member++) {
    const sequence = Array.from({ length: 8 }, (_, step) => S.memberFrame(member, step));
    assert.deepEqual(sequence, [...sequence.slice(0, 4), ...sequence.slice(0, 4)], 'cycle repeats every four ticks');
    const order = [0, 1, 2, 1]; // up, mid, down, mid
    assert(order.some((_, shift) => sequence.slice(0, 4).every((frame, i) => frame === order[(i + shift) % 4])), 'each member walks the up/mid/down/mid cycle in order');
  }
  assert.equal(S.wingStep(0), 0); assert.equal(S.wingStep(S.WING_TICK_MS * 5 + 1), 5);

  // Deterministic pose: same inputs, same pose; different seeds, different swarms.
  const poseA = {}, poseB = {};
  S.memberPose(7, 2, 9, 1234, 0.4, 0.5, poseA); S.memberPose(7, 2, 9, 1234, 0.4, 0.5, poseB);
  assert.deepEqual({ ...poseA }, { ...poseB });
  S.memberPose(8, 2, 9, 1234, 0.4, 0.5, poseB);
  assert.notDeepEqual({ ...poseA }, { ...poseB });
  // Movement makes some members lead and others trail: -x is forward, so fast travel spreads their x.
  const xs = (speed) => Array.from({ length: 9 }, (_, i) => { const p = {}; S.memberPose(5, i, 9, 0, speed, 0.5, p); return p.x; });
  const hover = xs(0), run = xs(1);
  const spread = list => Math.max(...list) - Math.min(...list);
  assert(spread(run) > spread(hover), 'a moving swarm stretches out along its heading');
  const shifts = run.map((x, i) => x - hover[i]);
  assert(shifts.some(shift => shift < -0.01) && shifts.some(shift => shift > 0.01), 'some members lead (-x) while others trail (+x)');
  assert(Number.isFinite(S.hashUnit(1, 2)) && S.hashUnit(1, 2) >= 0 && S.hashUnit(1, 2) < 1);
}

// ---- swarm: instanced avatar (stub THREE) -------------------------------------------
{
  const THREE = fakeThree();
  const context = sandbox({ Image: class { set src(v) {} }, document: { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) } });
  load(context, 'docs/js/honeyfuzzle-swarm.js');
  const S = context.HoneyfuzzleSwarm;
  const avatar = S.buildAvatar(THREE, { name: 'swarm_test', modelWidth: 1.3, memberWidth: 0.4, count: 9 });
  assert.equal(avatar.swarm.count, 9, 'one instanced mesh holds the whole swarm');
  assert.equal(avatar.group.children[0], avatar.frontPlane, 'frontPlane is the yaw pivot the creature loop rotates');
  assert.equal(avatar.backPlane, null);
  avatar.update(0, 1000, 0.016, 150);
  const frameAttr = avatar.swarm.geometry.getAttribute('aFrame');
  const step = S.wingStep(1000);
  assert.deepEqual(Array.from(frameAttr.array), Array.from({ length: 9 }, (_, i) => S.memberFrame(i, step)), 'instance frames follow the shared tick');
  assert.equal(new Set(Array.from(frameAttr.array)).size >= 2, true, 'more than one wing frame is on screen at once');
  const m = avatar.swarm.instanceMatrix.array;
  assert(Array.from(m).every(Number.isFinite), 'instance matrices are finite');
  assert.equal(m[15], 1);
  // The same tick must not rewrite the frame attribute (no per-frame GPU upload churn).
  frameAttr.needsUpdate = false;
  avatar.update(0, 1001, 0.016, 150);
  assert.equal(frameAttr.needsUpdate, false);
  avatar.update(0, 1000 + S.WING_TICK_MS, 0.016, 150);
  assert.equal(frameAttr.needsUpdate, true, 'a new tick uploads the new frames once');
  avatar.dispose();
  assert.equal(avatar.swarm.geometry.disposed, true);
  assert.doesNotThrow(() => avatar.dispose());
}

// ---- fixed Medium size / companion role -------------------------------------------------
{
  const context = sandbox({ SCRATCHBONES_CONFIG: { game: { creatureGenetics: { palettes: {} }, livestock: {}, wildlife: {} } }, __farmLog() {}, addEventListener() {} });
  load(context, 'docs/js/creature-genetics.js');
  const CREATURE_DB = { honeyfuzzle: { label: 'Honeyfuzzle Swarm', defaultSizeClass: 'medium', fixedSizeClass: 'medium' }, drenkirra: { defaultSizeClass: 'large' } };
  context.CreatureGenetics.init({ clamp: (v, a, b) => Math.max(a, Math.min(b, v)), CREATURE_DB });
  for (const sizeClass of ['small', 'large', 'bogus', undefined]) {
    assert.equal(context.CreatureGenetics.stableEntryRole({ kind: 'honeyfuzzle', genotype: { sizeClass } }), 'companion', `honeyfuzzle is always a companion (${sizeClass})`);
  }
  assert.equal(context.CreatureGenetics.stableEntryRole({ kind: 'drenkirra', genotype: { sizeClass: 'small' } }), 'shoulderPet', 'other species keep their Size gene');
  assert.equal(context.CreatureGenetics.defaultLivestockName('honeyfuzzle'), 'Honeyfuzzle Swarm', 'worded as a swarm');
  assert.equal(context.CreatureGenetics.makeDefaultGenotype('honeyfuzzle'), null, 'no coat genes');
}

// ---- hive stumps ----------------------------------------------------------------------------
const TileType = { GRASS: 'grass', SHRUB: 'shrub' };
function hiveWorld({ night = false } = {}) {
  const context = sandbox();
  load(context, 'docs/js/honeyfuzzle-hives.js');
  const grid = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ type: TileType.GRASS })));
  grid[4][5] = { type: TileType.SHRUB, floraKind: 'beehive' };
  grid[8][2] = { type: TileType.SHRUB, floraKind: 'bush' };
  const tiles = [];
  grid.forEach((row, r) => row.forEach((tile, c) => tiles.push({ c, r, ...tile })));
  const state = { night, area: 'map_test', created: [], toasts: 0, removedVisual: 0, saves: 0, inventory: {}, felled: new Map(), calendar: { day: 3 }, hostile: new Set() };
  const player = { x: 5.5 * 40, y: 6.5 * 40 };
  context.HoneyfuzzleHives.init({
    TILE: 40, TileType, player, calendar: state.calendar, inventory: state.inventory, hostileObjects: state.hostile, rnd: () => 0.5,
    zoneLayouts: new Map([['map_test', { tiles }]]), felledPersist: state.felled,
    getCurrentArea: () => state.area, isZoneArea: id => id.startsWith('map_'), getGrid: () => grid,
    getVegetationGroup: () => ({ name: 'stump' }), isNightTime: () => state.night,
    makeCreatureEntity: (kind, x, y, opts) => { const c = { kind, x, y, health: 10, def: { moveSpeed: 100 }, avatarRef: { group: { visible: true } }, ...opts }; state.created.push(c); return c; },
    moveCreatureToward: (c, tx, ty, speed, dt) => { const d = Math.hypot(tx - c.x, ty - c.y); const s = Math.min(d, speed * dt); c.x += (tx - c.x) / d * s; c.y += (ty - c.y) / d * s; },
    updateCreatureMesh() {}, updateCreatureAnimFrame() {},
    removeZoneVegetationVisual: () => { state.removedVisual++; return true; },
    buildInventoryGrid() {}, refreshActionBar() {}, refreshItemScroll() {}, saveMemberWorldData() { state.saves++; },
  });
  return { H: context.HoneyfuzzleHives, grid, state, player, context };
}
{
  const { H, grid, state } = hiveWorld();
  assert.deepEqual(Array.from(H.hivesInLayout({ tiles: [{ c: 5, r: 4, floraKind: 'beehive' }, { c: 1, r: 1, floraKind: 'bush' }] }), h => `${h.col},${h.row}`), ['5,4'], 'only beehive stumps count');
  // A: by day, exactly one swarm comes out of the stump, near it, and it is not duplicated.
  H.ensureCurrentZone(); H.ensureCurrentZone();
  assert.equal(state.created.length, 1);
  const swarm = state.created[0];
  assert.equal(swarm.kind, 'honeyfuzzle'); assert.equal(swarm.hiveKey, 'map_test:hive:5,4');
  assert.equal(swarm.homeX, 5.5 * 40); assert.equal(swarm.homeY, 4.5 * 40);
  assert(Math.hypot(swarm.x - swarm.homeX, swarm.y - swarm.homeY) < 40 * 2);
  assert.equal(H.control(swarm, 0.1), false, 'by day the generic wildlife AI runs');
  // Dusk: it flies home, then tucks inside the stump and is hidden.
  state.night = true;
  swarm.x = swarm.homeX + 160; swarm.y = swarm.homeY;
  let guard = 0;
  while (!swarm._hiveTucked && guard++ < 400) assert.equal(H.control(swarm, 0.1), true, 'hive-controlled while returning');
  assert.equal(swarm._hiveTucked, true); assert.equal(swarm.avatarRef.group.visible, false);
  assert.equal(H.control(swarm, 0.1), true, 'tucked swarm stays frozen overnight');
  // Dawn: out it comes again.
  state.night = false;
  assert.equal(H.control(swarm, 0.1), false); assert.equal(swarm._hiveTucked, false); assert.equal(swarm.avatarRef.group.visible, true);
  // No spawns at night.
  const night = hiveWorld({ night: true }); night.H.ensureCurrentZone();
  assert.equal(night.state.created.length, 0);
  // Out of range: stumps far from the player stay empty.
  const far = hiveWorld(); far.player.x = 5000; far.player.y = 5000; far.H.ensureCurrentZone();
  assert.equal(far.state.created.length, 0);

  // B/C: aiming + the long hold target.
  assert.equal(H.getAimedHive(1, 1), null, 'plain grass is not a hive');
  assert.equal(H.getAimedHive(5, 5).col, 5, 'a reticle one tile off the stump still targets it');
  assert.equal(H.getAimedHive(5, 7), null, 'but not from two tiles away');
  const target = H.getHoldTarget(5, 4);
  assert(target && target.holdSeconds >= 4, 'harvesting is a long hold');
  assert.equal(H.getHoldTarget(8, 2), null, 'a bush is not a hive');
  state.calendar.day = 3;
  const result = target.onAction('obj_loot_corpse');
  assert.equal(result.ok, true, result.message);
  assert(result.eggs >= 1 && result.eggs <= 3, 'one to three fertile eggs');
  assert.equal(state.inventory.fertileHoneyfuzzleEgg, result.eggs);
  assert(state.inventory.honey >= H.HONEY_MIN && state.inventory.honey <= H.HONEY_MAX, 'honey arrives with the eggs');
  assert.equal(grid[4][5].type, TileType.GRASS, 'the stump collapses');
  assert.equal(grid[4][5].floraKind, 'beehive', 'the same stump is what regrows later');
  const entries = state.felled.get('map_test');
  assert.equal(entries.length, 1); assert.equal(entries[0].regrowDays, H.HIVE_REGROW_DAYS); assert(entries[0].regrowDays > 7, 'a hive regrows slower than a tree');
  assert.equal(state.removedVisual, 1);
  assert.equal(H.harvest('map_test', 5, 4).ok, false, 'a collapsed stump cannot be harvested twice');
  assert.equal(H.getHoldTarget(5, 4), null);
  assert.equal(swarm.hiveKey, null, 'its swarm is homeless');
  state.night = true; assert.equal(H.control(swarm, 0.1), false, 'a homeless swarm has no hive to return to');
}
{
  // rollHarvest stays inside the 1-3 egg range for every roll.
  const { H } = hiveWorld();
  for (let i = 0; i <= 100; i++) { const r = H.rollHarvest(() => i / 100 * 0.999999); assert(r.eggs >= 1 && r.eggs <= 3 && r.honey >= H.HONEY_MIN && r.honey <= H.HONEY_MAX); }
  // A full bag of eggs refuses rather than eating the stump.
  const full = hiveWorld(); full.state.inventory.fertileHoneyfuzzleEgg = full.context.InventoryStacks.MAX_TOTAL;
  assert.equal(full.H.harvest('map_test', 5, 4).ok, false); assert.equal(full.grid[4][5].type, TileType.SHRUB, 'a refused harvest leaves the stump standing');
}

// ---- Honeyfuzzle House (FarmProduction building) --------------------------------------------
{
  const values = new Map();
  const inventory = { fertileHoneyfuzzleEgg: 1, growthTonic: 1 };
  const calendar = { day: 1, time01: 0 };
  const objects = new Map();
  let livestock = [], saves = 0, allowed = true;
  const context = sandbox({ localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) } });
  context.AuthoredFurniture = { load: async () => ({ parts: [] }), buildGroup: () => ({ userData: {}, position: { set() {} }, traverse() {} }) };
  load(context, 'docs/config/farm-specializations.js');
  load(context, 'docs/js/item-processing.js');
  load(context, 'docs/js/farm-production.js');
  load(context, 'docs/js/honeyfuzzle-house.js');
  const def = context.FARM_SPECIALIZATIONS_CONFIG.buildings.honeyfuzzleHouse;
  assert.equal(def.w, 1); assert.equal(def.h, 1, 'a 1x1 building');
  assert(def.price > 0 && def.planItem === 'honeyfuzzleHousePlan', 'sold from the carpenter as a plan');
  context.FarmBuildings = { canPlaceAt: (col, row, w, h) => col >= 0 && row >= 0 && col + w <= 20 && row + h <= 20 && !objects.has(col + ',' + row), clearFootprint() {} };
  context.CreatureGenetics = { defaultLivestockName: () => 'Honeyfuzzle Swarm' };
  context.FarmPanel = { cancelBarnPlacement() {}, render() {} };
  context.FarmWorldSettings = { read: () => ({ meta: {}, world: null }), current: () => ({}) };
  const itemDefs = {};
  const shared = { calendar, inventory, ITEM_DEFS: itemDefs, cropData: {}, COLS: 20, ROWS: 20, TileType: {}, MAX_WATER: 3, scene: { add() {}, remove() {} }, worldObjects: objects,
    hasFarmPermission: () => allowed, isFarmOwner: () => allowed, showToast() {}, debugLog() {}, getGrid: () => [], saveFarmLayout: () => { saves++; return true; }, saveMemberWorldData() {},
    loadStorage: () => ({}), saveStorage() {}, consumeInput: () => 3, surfaceY: () => 0, markOutline() {} };
  context.ItemProcessing.init({ ITEM_DEFS: itemDefs, cropData: {}, getActiveInventoryItem: () => null });
  context.FarmProduction.init(shared);
  context.HoneyfuzzleHouse.init({ ...shared, THREE: null, getCamera: () => null, getCurrentArea: () => 'farm', loadWorldLivestock: () => livestock, saveWorldLivestock: list => { livestock = list; },
    surfaceY: () => 0, refreshInventory() {} });
  const house = context.HoneyfuzzleHouse;
  assert.equal(itemDefs.honeyfuzzleHousePlan.label, 'Honeyfuzzle House Plan');
  inventory.honeyfuzzleHousePlan = 1;
  context.FarmProduction.arm('honeyfuzzleHouse');
  assert.equal(context.FarmProduction.placeAt(3, 3).ok, true);
  assert.equal(inventory.honeyfuzzleHousePlan, 0, 'the plan is consumed');
  assert.equal(objects.get('3,3').type, 'farm_production');
  assert.equal(objects.get('3,3').getButtons()[0].label, 'Manage Honeyfuzzle House', 'managed from outside; there is no enter action');
  assert.equal(context.FarmProduction.placeAt(3, 3), null, 'placement mode ended');
  const entry = context.FarmProduction.entries()[0];
  assert.equal(house.phase(entry), 'empty');
  // Placing an egg takes it from the bag; hatching is exercised on fresh houses below.
  assert.equal(house.placeEgg(entry).ok, true);
  assert.equal(inventory.fertileHoneyfuzzleEgg, 0);
  assert.equal(house.phase(entry), 'egg');
  assert.equal(house.placeEgg(entry).ok, false, 'an occupied house takes no second egg');
}
{
  const inventory = { fertileHoneyfuzzleEgg: 2, growthTonic: 1 };
  const calendar = { day: 1, time01: 0 };
  let livestock = [], allowed = true;
  const context = sandbox();
  context.AuthoredFurniture = { load: async () => ({ parts: [] }), buildGroup: () => ({ userData: {}, position: { set() {} }, traverse() {} }) };
  load(context, 'docs/config/farm-specializations.js');
  load(context, 'docs/js/item-processing.js');
  load(context, 'docs/js/farm-production.js');
  load(context, 'docs/js/honeyfuzzle-swarm.js');
  load(context, 'docs/js/honeyfuzzle-house.js');
  context.Image = class { set src(v) {} }; context.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
  const objects = new Map();
  context.FarmBuildings = { canPlaceAt: (col, row) => !objects.has(col + ',' + row), clearFootprint() {} };
  context.CreatureGenetics = { defaultLivestockName: () => 'Honeyfuzzle Swarm' };
  context.FarmPanel = { cancelBarnPlacement() {}, render() {} };
  context.FarmWorldSettings = { read: () => ({ meta: {}, world: null }), current: () => ({}) };
  const shared = { calendar, inventory, ITEM_DEFS: {}, cropData: {}, COLS: 20, ROWS: 20, TileType: {}, MAX_WATER: 3, scene: { add() {}, remove() {} }, worldObjects: objects,
    hasFarmPermission: () => allowed, isFarmOwner: () => allowed, showToast() {}, debugLog() {}, getGrid: () => [], saveFarmLayout: () => true, saveMemberWorldData() {},
    loadStorage: () => ({}), saveStorage() {}, consumeInput: () => 3, surfaceY: () => 0, markOutline() {} };
  context.ItemProcessing.init({ ITEM_DEFS: shared.ITEM_DEFS, cropData: {}, getActiveInventoryItem: () => null });
  context.FarmProduction.init(shared);
  const added = [];
  context.HoneyfuzzleHouse.init({ ...shared, THREE: fakeThree(), scene: { add: o => added.push(o), remove() {} }, getCamera: () => null, getCurrentArea: () => 'farm', loadWorldLivestock: () => livestock, saveWorldLivestock: list => { livestock = list; }, surfaceY: () => 0, refreshInventory() {} });
  const house = context.HoneyfuzzleHouse;
  const save = [{ id: 'h1', key: 'honeyfuzzleHouse', col: 2, row: 2 }, { id: 'h2', key: 'honeyfuzzleHouse', col: 6, row: 2 }];
  context.FarmProduction.load(save);
  const [a, b] = context.FarmProduction.entries();
  // Timed hatch.
  assert.equal(house.placeEgg(a).ok, true);
  calendar.day = 2; context.FarmProduction.tick();
  assert.equal(house.phase(a), 'egg', 'not hatched before its time');
  calendar.day = 3; calendar.time01 = 0.5; context.FarmProduction.tick();
  assert.equal(house.phase(a), 'swarm', 'hatches after the wait');
  assert.equal(house.visualCount(), 1, 'a swarm hovers over the occupied house'); assert.equal(added.length, 1);
  assert.equal(livestock.length, 1);
  assert.equal(livestock[0].kind, 'honeyfuzzle'); assert.equal(livestock[0].houseId, 'h1'); assert.equal(livestock[0].barnId, null);
  assert.equal(livestock[0].lifeStage, 'adult', 'a hatched swarm is not mistaken for a Nursery baby');
  assert.equal(house.placeEgg(a).ok, false, 'the swarm fills the house');
  // The house survives a save/load round trip, keeping its swarm.
  const saved = JSON.parse(JSON.stringify(context.FarmProduction.serialize()));
  assert.equal(saved.find(r => r.id === 'h1').house.livestockId, livestock[0].id);
  context.FarmProduction.load(saved);
  const reloaded = context.FarmProduction.entries().find(e => e.id === 'h1');
  assert.equal(house.phase(reloaded), 'swarm');
  // Growth Tonic hatches an egg at once; it needs a tonic.
  assert.equal(house.useTonic(b).ok, false, 'nothing to hatch in an empty house');
  assert.equal(house.placeEgg(b).ok, true);
  inventory.growthTonic = 0;
  assert.equal(house.useTonic(b).ok, false, 'no tonic, no instant hatch');
  inventory.growthTonic = 1;
  assert.equal(house.useTonic(b).ok, true);
  assert.equal(inventory.growthTonic, 0); assert.equal(house.phase(b), 'swarm'); assert.equal(livestock.length, 2); assert.equal(house.visualCount(), 2);
  // Moving the swarm to the stable (record removed) empties the house again.
  livestock = livestock.filter(l => l.houseId !== 'h2');
  assert.equal(house.phase(b), 'empty');
  context.FarmProduction.tick();
  assert.equal(house.visualCount(), 1, 'h1 keeps its swarm while h2 (hatched by tonic) lost its record'); // h2's swarm visual is dropped by the tick sync
  // Permission gate.
  allowed = false; inventory.fertileHoneyfuzzleEgg = 1;
  assert.equal(house.placeEgg(b).ok, false);
}

// ---- never a barn animal ---------------------------------------------------------------------------
{
  const config = read('docs/config/scratchbones-config.js');
  const context = sandbox();
  vm.runInContext(config, context, { filename: 'scratchbones-config.js' });
  const livestockCfg = context.SCRATCHBONES_CONFIG.game.livestock;
  assert.equal(livestockCfg.housing.honeyfuzzle, 'honeyfuzzleHouse');
  assert.equal(livestockCfg.itemKinds.fertileHoneyfuzzleEgg, undefined, 'the egg is not an incubator/barn livestock item');

  const farm = sandbox({ SCRATCHBONES_CONFIG: context.SCRATCHBONES_CONFIG, __farmLog() {} });
  farm.CreatureGenetics = { defaultLivestockName: () => 'Honeyfuzzle Swarm' };
  farm.CreatureTextureCache = new Proxy({}, { get: () => () => new Proxy({}, { get: () => () => {} }) }); // Texture residency is irrelevant to housing rules.
  load(farm, 'docs/js/farm-animals.js');
  let list = [{ id: 'swarm1', kind: 'honeyfuzzle', barnId: null, name: 'Honeyfuzzle Swarm' }];
  farm.FarmAnimals.init({ hasFarmPermission: () => true, getFarmBuildings: () => [{ id: 'barn1', kind: 'barn', stage: 'built', tier: 'small' }], getBarnTiers: () => ({ small: { label: 'Little Barn', slots: 4 } }),
    loadWorldLivestock: () => list, saveWorldLivestock: v => { list = v; }, saveFarmLayout() {}, LIVESTOCK_RESOURCE_DEFS: {}, inventory: {}, ITEM_DEFS: {}, LIVESTOCK_ITEM_KINDS: {}, animalObjects: new Set(), worldObjects: new Map() });
  const result = farm.FarmAnimals.assignToBarn('swarm1', 'barn1');
  assert.equal(result.ok, false); assert.match(result.message, /Honeyfuzzle House/);
  assert.equal(list[0].barnId, null);
}

console.log('honeyfuzzle: ok');
