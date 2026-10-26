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
  const storage = new Map(); // Stateful so the per-world egg color queue persists inside one test world.
  const context = { console, Math, Date, performance: { now: () => 0 }, setInterval: () => 1, clearInterval() {}, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }, ...extra };
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
    MeshBasicMaterial: class { constructor(options) { Object.assign(this, options); this.userData = {}; this.disposed = false; } dispose() { this.disposed = true; } },
    CanvasTexture: class {},
    Color: class { constructor(value) { this.value = value; } set(value) { this.value = value; } },
    InstancedMesh: class extends Obj { constructor(geometry, material, count) { super(); this.geometry = geometry; this.material = material; this.count = count; this.instanceMatrix = { array: new Float32Array(count * 16), needsUpdate: false, setUsage() {} }; } dispose() {} },
  };
}

// ---- swarm: wing cycle ---------------------------------------------------------
{
  const context = sandbox();
  load(context, 'docs/js/honeyfuzzle-swarm.js');
  const S = context.HoneyfuzzleSwarm;
  assert.deepEqual(Array.from(S.WING_CYCLE), [0, 1, 2, 1], 'legacy wing-step helper stays compatible');
  assert.equal(S.ATLAS_COLS, 5);
  assert(S.FRAME_URLS.every((url, i) => url.endsWith('honeyfuzzle_fly' + (i + 1) + '.png')));
  assert(S.PATTERN_URLS.some(url => url.endsWith('honeyfuzzle_tailfeathers.png')));
  assert(S.PATTERN_URLS.some(url => url.endsWith('honeyfuzzle_spectacles.png')));
  assert.equal(S.appearanceColors('#123456', null).tailColor, '#123456', 'the default tail always uses body color one');
  assert.equal(S.appearanceColors('#123456', { tailfeathers: { color: '#abcdef', enabled: true, copies: 1 } }).tailColor, '#abcdef', 'an expressed tail allele uses body color two');
  assert.equal(S.appearanceColors('#123456', { tailfeathers: { color: '#abcdef', enabled: false, copies: 2 } }).tailColor, '#123456', 'disabled tail allele shows the default primary tint');
  assert.equal(S.appearanceColors('#123456', { spectacles: { color: '#fedcba', enabled: true, copies: 1 } }).spectaclesColor, '#fedcba');
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

  // Bee-style motion: a swarm of many small members, each a darting hoverer inside one tight cloud.
  assert(S.DEFAULT_MEMBER_COUNT >= 18 && S.DEFAULT_MEMBER_COUNT % 3 === 0, 'enough members to read as a swarm, in even wing-cycle thirds');
  const spreadR = 0.45, N = S.DEFAULT_MEMBER_COUNT;
  const track = member => Array.from({ length: 400 }, (_, step) => { const p = {}; S.memberPose(9, member, N, step * 16, 0, spreadR, p); return { x: p.x, y: p.y, flip: p.flip }; });
  for (let member = 0; member < N; member++) {
    const path = track(member);
    assert(path.every(p => Math.hypot(p.x, p.y) <= spreadR * 1.3), 'every member stays inside the cloud');
    const steps = path.slice(1).map((p, k) => Math.hypot(p.x - path[k].x, p.y - path[k].y));
    const still = steps.filter(d => d < 0.016).length, zipping = steps.filter(d => d > 0.03).length; // hovering is only the fast, tiny buzz
    assert(still > 150 && zipping > 10, `member ${member} alternates hovering and zipping (still ${still}, zipping ${zipping})`);
  }
  assert(track(0).some(p => p.flip === 1) && track(0).some(p => p.flip === -1), 'members turn to face the way they dart');
  // At any instant some members are mid-zip and others hovering, so the cloud never moves in lockstep.
  const instant = Array.from({ length: N }, (_, member) => { const a = {}, b = {}; S.memberPose(9, member, N, 5000, 0, spreadR, a); S.memberPose(9, member, N, 5016, 0, spreadR, b); return Math.hypot(b.x - a.x, b.y - a.y); });
  assert(instant.some(d => d > 0.03) && instant.some(d => d < 0.016), 'some members zip while others hover');
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
  assert.deepEqual(Array.from(frameAttr.array), Array.from({ length: 9 }, (_, i) => i % 3), 'wing phase stays fixed per member');
  assert.equal(new Set(Array.from(frameAttr.array)).size, 3, 'all three phases occur across the swarm');
  const m = avatar.swarm.instanceMatrix.array;
  assert(Array.from(m).every(Number.isFinite), 'instance matrices are finite');
  assert.equal(m[15], 1);
  // Smooth time advances without changing aFrame buffers or reallocating texture data.
  frameAttr.needsUpdate = false;
  const firstPhase = avatar.swarm.material.userData.honeyfuzzle.uWingPhase.value;
  avatar.update(0, 1001, 0.016, 150);
  assert.equal(frameAttr.needsUpdate, false);
  assert.notEqual(avatar.swarm.material.userData.honeyfuzzle.uWingPhase.value, firstPhase);
  avatar.update(0, 1000 + S.WING_TICK_MS, 0.016, 150);
  assert.equal(frameAttr.needsUpdate, false);
  // Body color: uncolored swarms keep the authored mint; a colored one gets its own uniforms and can be recolored.
  assert.equal(avatar.swarm.material.userData.honeyfuzzle.uUse.value, 0);
  const tinted = S.buildAvatar(THREE, { name: 'tinted', modelWidth: 1.3, color: '#0b0b0e' });
  assert.equal(tinted.swarm.material.userData.honeyfuzzle.uUse.value, 1); assert.equal(tinted.swarm.material.userData.honeyfuzzle.uBody.value.value, '#0b0b0e');
  assert.notEqual(tinted.swarm.material.userData.honeyfuzzle, avatar.swarm.material.userData.honeyfuzzle, 'swarms never share color uniforms');
  tinted.setColor('#ece8e0'); assert.equal(tinted.swarm.material.userData.honeyfuzzle.uBody.value.value, '#ece8e0');
  assert.equal(tinted.swarm.material.userData.honeyfuzzle.uTailColor.value.value, '#ece8e0');
  tinted.setGenotype({ tailfeathers: { color: '#abcdef', enabled: true, copies: 1 }, spectacles: { color: '#123456', enabled: true, copies: 2 } });
  assert.equal(tinted.swarm.material.userData.honeyfuzzle.uTailColor.value.value, '#abcdef');
  assert.equal(tinted.swarm.material.userData.honeyfuzzle.uSpectaclesColor.value.value, '#123456');
  assert.equal(tinted.swarm.material.userData.honeyfuzzle.uSpectaclesUse.value, 1);
  tinted.setGenotype(null);
  assert.equal(tinted.swarm.material.userData.honeyfuzzle.uTailColor.value.value, '#ece8e0');
  assert.equal(tinted.swarm.material.userData.honeyfuzzle.uSpectaclesUse.value, 0);
  assert.equal(tinted.group.children.length, 1, 'all overlay sprites share one instanced mesh');
  assert.equal(typeof S.debugSnapshot, 'function');
  assert.equal(S.DEFAULT_MEMBER_COUNT, tinted.memberCount, 'default swarm size');
  avatar.dispose();
  assert.equal(avatar.swarm.geometry.disposed, true);
  assert.doesNotThrow(() => avatar.dispose());
}

// ---- fixed Medium size / companion role -------------------------------------------------
{
  const context = sandbox({ SCRATCHBONES_CONFIG: { game: { creatureGenetics: { palettes: { default: [{ id: 'mint', name: 'Mint', hex: '#aabbcc', weight: 1 }, { id: 'gold', name: 'Gold', hex: '#aabb44', weight: 1 }] } }, livestock: {}, wildlife: {} } }, __farmLog() {}, addEventListener() {} });
  load(context, 'docs/js/creature-genetics.js');
  const CREATURE_DB = { honeyfuzzle: { label: 'Honeyfuzzle Swarm', defaultSizeClass: 'medium', fixedSizeClass: 'medium' }, drenkirra: { defaultSizeClass: 'large' } };
  context.CreatureGenetics.init({ clamp: (v, a, b) => Math.max(a, Math.min(b, v)), CREATURE_DB });
  for (const sizeClass of ['small', 'large', 'bogus', undefined]) {
    assert.equal(context.CreatureGenetics.stableEntryRole({ kind: 'honeyfuzzle', genotype: { sizeClass } }), 'companion', `honeyfuzzle is always a companion (${sizeClass})`);
  }
  assert.equal(context.CreatureGenetics.stableEntryRole({ kind: 'drenkirra', genotype: { sizeClass: 'small' } }), 'shoulderPet', 'other species keep their Size gene');
  assert.equal(context.CreatureGenetics.defaultLivestockName('honeyfuzzle'), 'Honeyfuzzle Swarm', 'worded as a swarm');
  const genes = context.CreatureGenetics.makeDefaultGenotype('honeyfuzzle');
  assert(genes?.base?.color && genes?.tailfeathers && genes?.spectacles, 'honeyfuzzle has inheritable markings');
  assert.equal(genes.sizeClass, 'medium');
}

// ---- colors by region ---------------------------------------------------------------------------
{
  const context = sandbox();
  load(context, 'docs/config/scratchbones-config.js');
  load(context, 'docs/js/honeyfuzzle-colors.js');
  const C = context.HoneyfuzzleColors;
  const regions = C.regionPalettes();
  const all = [...regions.temperate, ...regions.tropical, ...regions.ominous];
  assert.equal(new Set(all).size, all.length, 'a color belongs to exactly one region');
  // Every body color an existing species can have is somewhere in the master palette.
  const speciesHex = Object.values(context.SCRATCHBONES_CONFIG.game.creatureGenetics.palettes).flat().map(entry => entry.hex.toLowerCase());
  assert(speciesHex.length >= 40);
  for (const hex of speciesHex) assert(all.includes(hex), `species color ${hex} is available to honeyfuzzles`);
  for (const region of C.REGIONS) assert(regions[region].length >= 10, `${region} has a broad palette`);
  // Northern Cliffs: temperate. Cloud Forest: tropical. Eastern Mire: ominous. Everything else: all three.
  assert.deepEqual(Array.from(C.zonePalette('map_northern_cliffs')), Array.from(regions.temperate));
  assert.deepEqual(Array.from(C.zonePalette('map_southern_cloud_forest')), Array.from(regions.tropical));
  assert.deepEqual(Array.from(C.zonePalette('map_eastern_mire')), Array.from(regions.ominous));
  assert.equal(C.zonePalette('map_dev_arena').length, all.length);
  assert.equal(C.zonePalette('map_western_slope').length, 0, 'no honeyfuzzles on the Western Slope');
  assert.equal(C.pickForKey('map_western_slope', 'x'), null);
  const hsl = hex => C.hexToHsl(hex);
  // Tropical: vivid parrot colors, nothing dull. The whole Drenkirra palette lands here.
  for (const hex of regions.tropical) assert(hsl(hex).s >= 0.55 && hsl(hex).l > 0.3, `${hex} is a vivid tropical color`);
  for (const entry of context.SCRATCHBONES_CONFIG.game.creatureGenetics.palettes.drenkirra) assert(regions.tropical.includes(entry.hex.toLowerCase()), `${entry.hex} (Drenkirra) is tropical`);
  // Eastern Mire: blacks, greys, whites and the darkest greens through violets; no bright colors.
  for (const hex of regions.ominous) {
    const { h, s, l } = hsl(hex);
    assert(s < 0.12 || l > 0.85 || l < 0.32 && (h >= 75 && h <= 300 || l < 0.25), `${hex} is an ominous color`);
  }
  assert(regions.ominous.some(hex => hsl(hex).l < 0.1), 'includes true blacks');
  assert(regions.ominous.some(hex => hsl(hex).l > 0.85), 'includes whites');
  assert(regions.ominous.some(hex => hsl(hex).s < 0.12 && hsl(hex).l > 0.3 && hsl(hex).l < 0.7), 'includes greys');
  for (const [lo, hi] of [[75, 165], [165, 255], [255, 300]]) assert(regions.ominous.some(hex => { const c = hsl(hex); return c.s >= 0.12 && c.h >= lo && c.h <= hi && c.l < 0.32; }), `includes a darkest shade at hue ${lo}-${hi}`);
  // Temperate: muted, earthy and classic songbird colors, no blacks/whites and no tropical neons.
  for (const hex of regions.temperate) assert(hsl(hex).l >= 0.2 && hsl(hex).s >= 0.12 && !(hsl(hex).s >= 0.6 && hsl(hex).l >= 0.38 && hsl(hex).l <= 0.72 && !C.AUTHORED.temperate.includes(hex)), `${hex} is a temperate color`);
  // One stump, one color, always; and different stumps vary.
  assert.equal(C.pickForKey('map_northern_cliffs', 'a:hive:1,2'), C.pickForKey('map_northern_cliffs', 'a:hive:1,2'));
  const picked = new Set(Array.from({ length: 200 }, (_, i) => C.pickForKey('map_eastern_mire', `hive:${i}`)));
  assert(picked.size >= 8 && [...picked].every(hex => regions.ominous.includes(hex)), 'hives in one region vary within that region\'s palette');
  // Egg colors queue per world and survive in order.
  C.queueEggColors('w1', ['#111111', '#222222']); C.queueEggColors('w2', ['#333333']);
  assert.equal(C.takeEggColor('w1'), '#111111'); assert.equal(C.takeEggColor('w2'), '#333333'); assert.equal(C.takeEggColor('w1'), '#222222'); assert.equal(C.takeEggColor('w1'), null);
}

// ---- hive stumps ----------------------------------------------------------------------------
const TileType = { GRASS: 'grass', SHRUB: 'shrub' };
function hiveWorld({ night = false } = {}) {
  const context = sandbox();
  load(context, 'docs/config/scratchbones-config.js');
  load(context, 'docs/js/honeyfuzzle-colors.js');
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
    getCurrentArea: () => state.area, isZoneArea: id => id.startsWith('map_'), getGrid: () => grid, getWorldId: () => 'w1',
    getVegetationGroup: () => ({ name: 'stump' }), isNightTime: () => state.night,
    makeCreatureEntity: (kind, x, y, opts) => { const c = { kind, x, y, health: 10, def: { moveSpeed: 100 }, avatarRef: { group: { visible: true } }, ...opts }; state.created.push(c); return c; },
    // The stump tile is solid: movement toward its centre stops at its edge (0.6 tile out), like the real collision.
    moveCreatureToward: (c, tx, ty, speed, dt) => { const d = Math.hypot(tx - c.x, ty - c.y); const s = Math.max(0, Math.min(d - 0.6 * 40, speed * dt)); c.x += (tx - c.x) / d * s; c.y += (ty - c.y) / d * s; },
    updateCreatureMesh() {}, updateCreatureAnimFrame() {},
    removeZoneVegetationVisual: () => { state.removedVisual++; return true; },
    buildInventoryGrid() {}, refreshActionBar() {}, refreshItemScroll() {}, saveMemberWorldData() { state.saves++; },
  });
  return { H: context.HoneyfuzzleHives, grid, state, player, context };
}
{
  const { H, grid, state, context } = hiveWorld();
  assert.deepEqual(Array.from(H.hivesInLayout({ tiles: [{ c: 5, r: 4, floraKind: 'beehive' }, { c: 1, r: 1, floraKind: 'bush' }] }), h => `${h.col},${h.row}`), ['5,4'], 'only beehive stumps count');
  // A: by day, exactly one swarm comes out of the stump, near it, and it is not duplicated.
  H.ensureCurrentZone(); H.ensureCurrentZone();
  assert.equal(state.created.length, 1);
  const swarm = state.created[0];
  assert.equal(swarm.kind, 'honeyfuzzle'); assert.equal(swarm.hiveKey, 'map_test:hive:5,4');
  assert(H && context.HoneyfuzzleColors.zonePalette('map_test').includes(swarm.swarmColor), 'the swarm gets a color from its zone palette');
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
  const tuckedAt = [swarm.x, swarm.y];
  assert.equal(H.control(swarm, 0.1), false); assert.equal(swarm._hiveTucked, false); assert.equal(swarm.avatarRef.group.visible, true);
  assert.deepEqual([swarm.x, swarm.y], tuckedAt, 'it emerges where it tucked in (beside the solid stump), not inside it');
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
  const stumpColor = swarm.swarmColor;
  for (let i = 0; i < result.eggs; i++) assert.equal(context.HoneyfuzzleColors.takeEggColor('w1'), stumpColor, 'each egg carries its stump\'s color');
  assert.equal(context.HoneyfuzzleColors.takeEggColor('w1'), null, 'one queued color per egg');
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

{
  // No honeyfuzzles on the Western Slope: no swarm spawns and its stumps are not harvestable hives.
  const west = hiveWorld();
  west.state.area = 'map_western_slope';
  west.context.HoneyfuzzleHives.ensureCurrentZone();
  assert.equal(west.state.created.length, 0);
  assert.equal(west.context.HoneyfuzzleHives.getAimedHive(5, 4), null);
  assert.equal(west.context.HoneyfuzzleHives.getHoldTarget(5, 4), null);
  assert.equal(west.context.HoneyfuzzleColors.zonePalette('map_western_slope').length, 0);
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
  load(context, 'docs/config/scratchbones-config.js');
  load(context, 'docs/js/honeyfuzzle-colors.js');
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
  context.HoneyfuzzleHouse.init({ ...shared, getWorldId: () => 'w1', THREE: fakeThree(), scene: { add: o => added.push(o), remove() {} }, getCamera: () => null, getCurrentArea: () => 'farm', loadWorldLivestock: () => livestock, saveWorldLivestock: list => { livestock = list; }, surfaceY: () => 0, refreshInventory() {} });
  const house = context.HoneyfuzzleHouse;
  const save = [{ id: 'h1', key: 'honeyfuzzleHouse', col: 2, row: 2 }, { id: 'h2', key: 'honeyfuzzleHouse', col: 6, row: 2 }];
  context.FarmProduction.load(save);
  const [a, b] = context.FarmProduction.entries();
  // Timed hatch. The egg's color comes from the queue filled when its stump was harvested.
  context.HoneyfuzzleColors.queueEggColors('w1', ['#123a22']);
  assert.equal(house.placeEgg(a).ok, true);
  calendar.day = 2; context.FarmProduction.tick();
  assert.equal(house.phase(a), 'egg', 'not hatched before its time');
  calendar.day = 3; calendar.time01 = 0.5; context.FarmProduction.tick();
  assert.equal(house.phase(a), 'swarm', 'hatches after the wait');
  assert.equal(house.visualCount(), 1, 'a swarm hovers over the occupied house'); assert.equal(added.length, 1);
  assert.equal(livestock.length, 1);
  assert.equal(livestock[0].kind, 'honeyfuzzle'); assert.equal(livestock[0].houseId, 'h1'); assert.equal(livestock[0].barnId, null);
  assert.equal(livestock[0].lifeStage, 'adult', 'a hatched swarm is not mistaken for a Nursery baby');
  assert.equal(livestock[0].swarmColor, '#123a22', 'the hatched swarm keeps its egg\'s color');
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
  assert(context.HoneyfuzzleColors.regionPalettes().temperate.concat(context.HoneyfuzzleColors.regionPalettes().tropical, context.HoneyfuzzleColors.regionPalettes().ominous).includes(b.house.egg.color), 'an egg with no queued color rolls one from the master palette');
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
