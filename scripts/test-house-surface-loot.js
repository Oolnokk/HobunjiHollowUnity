'use strict';
const assert = require('assert'); // Exercises the shipped planner and configuration rather than source-text claims.
const fs = require('fs'); // Reads actual household/furniture authoring data.
const vm = require('vm'); // Loads the production loot authority without a browser.
const path = require('path'); // Resolves fixtures independently of the launch directory.
const root = path.resolve(__dirname, '..'); // Repository used by fixture readers.
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); // Actual authored fixture reader.
let seedOffset = 0; // Samples many deterministic worlds for the planner's weighted pools.
let forceEmpty = false; // Exercises the deliberate empty-slot path.
const window = { TownMine: { getTownValue: () => 0 }, WildernessMapGenerator: { makeRng(seed) {
  let state = seedOffset; // Repeatable seed-sensitive RNG exposes slot stability and weighted choices.
  for (const ch of seed) state = (Math.imul(state, 31) + ch.charCodeAt(0)) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return forceEmpty ? .999 : state / 4294967296; };
} } }; // Uses the gameplay service contract, with no inventory-dependent random calls.
const context = vm.createContext({ window, console, Math, Map, Set, WeakMap, JSON, document: { createElement: () => ({ getContext: () => ({ fillText() {} }), toDataURL: () => 'data:image/png;base64,placeholder' }) } }); // Icon placeholders avoid rasterizer dependencies.
vm.runInContext(fs.readFileSync(path.join(root, 'docs/js/surface-loot-system.js'), 'utf8'), context);
const api = window.SurfaceLootSystem; // The production API under test.
const keys = ['tableSmall', 'tableLong', 'tableRound', 'counter', 'desk', 'dresser', 'nightstand', 'candleTable', 'bookshelf', 'basicBed', 'doubleBed', 'bedroll', 'crateStack', 'chest']; // Furniture with explicit, usable household surfaces.
let total = 0; // Ensures real configurations produce populated rooms across sampled worlds.
for (const key of keys) {
  const data = readJson(`docs/config/furniture-authored/${key}.json`); // Actual geometry and surface slot data.
  assert(data.recognizedSurfaces.length > 0);
  for (const surface of data.recognizedSurfaces) {
    const part = data.parts.find(part => part.id === surface.partId); // Referenced visible primitive must exist.
    assert(part);
    assert.equal(surface.localCentroid[1], part.transform.sy / 2, 'surface must be on the real top, not halfway through the furniture');
    for (const slot of surface.lootSlots) {
      const radius = slot.maxSize / Math.sqrt(2); // Covers the full square sprite under the allowed small rotation.
      assert(slot.u - radius >= surface.bounds.minU && slot.u + radius <= surface.bounds.maxU, `${key}: depth containment`);
      assert(slot.v - radius >= surface.bounds.minV && slot.v + radius <= surface.bounds.maxV, `${key}: width containment`);
      if (part.kind === 'disc' && part.segments === 4) assert(Math.abs(slot.u) + Math.abs(slot.v) + slot.maxSize <= part.transform.sx * part.topScaleX / 2, 'round table slots must fit the actual diamond cap');
      if (key === 'candleTable') assert(Math.hypot(slot.u, slot.v) - radius > .111, 'keep clear of the candle base');
      if (key.endsWith('Bed')) assert(slot.u - radius > .06, 'linen belongs at the foot, clear of pillows');
    }
  }
  for (seedOffset = 0; seedOffset < 60; seedOffset++) {
    const options = { profile: 'house', id: `room:${key}:stable`, area: 'map_i_house', townValue: 0 }; // Stable furniture instance independent of location/rotation.
    const records = api.planFurnitureLoot(data, options); // Execute real slot planning.
    total += records.length;
    assert.equal(JSON.stringify(records), JSON.stringify(api.planFurnitureLoot(data, options)), 'rebuilds must preserve the plan');
    assert.equal(JSON.stringify(api.planFurnitureLoot(data, { ...options, profile: undefined })), '[]', 'unmarked maps and purchased furniture must not create loot');
    assert.equal(new Set(records.map(record => record.id)).size, records.length);
    for (const record of records) {
      assert.equal(record.ownerArea, options.area);
      assert(record.lootable);
      assert(record.itemKey !== 'alchemy_venomFlask_p0', 'inhabited houses do not scatter combat flasks');
      assert(!['lootSilverPendant', 'lootGoldBrooch'].includes(record.itemKey), 'town progression gates precious jewelry');
      if (record.lootPurpose === 'dining') assert.equal(record.itemKey, 'lootMetalCup');
      if (record.lootPurpose === 'linen') assert.equal(record.itemKey, 'lootFoldedCloth');
      if (record.placementPreset === 'flat') assert.equal(record.rotation.y, 0, 'flat rotation must not tip objects off the surface');
    }
    const occupied = { ...data, itemPlacements: data.recognizedSurfaces.map(surface => ({ surfaceId: surface.id, visible: true })) }; // Authored decoration has precedence over generated belongings.
    assert.equal(api.planFurnitureLoot(occupied, options).length, 0);
  }
}
assert(total > 200);
forceEmpty = true;
assert.equal(api.planFurnitureLoot(readJson('docs/config/furniture-authored/nightstand.json'), { profile: 'house', id: 'empty' }).length, 0);
forceEmpty = false;
const houseMaps = fs.readdirSync(path.join(root, 'docs/config/maps')).filter(file => file.startsWith('map_i_') && file.endsWith('.json')).map(file => readJson(`docs/config/maps/${file}`)); // Verify opt-in scope is actually shipped.
assert(houseMaps.filter(data => data.surfaceLootProfile === 'house').length >= 20);
assert(!readJson('docs/config/maps/map_i_smithy.json').surfaceLootProfile, 'workshops are not silently treated as homes');
assert(!readJson('docs/config/maps/map_i_general_store.json').surfaceLootProfile, 'shop stock is not household loot');
const group = { userData: {} }; // Renderer skips absent THREE in this harness; population ownership still executes.
const data = readJson('docs/config/furniture-authored/nightstand.json'); // A genuine residential furnishing.
api.populateFurniture(group, data, { profile: 'house', id: 'stable:id', area: 'map_i_house' });
assert.equal(group.userData.surfaceLootInstanceId, 'stable:id');
const first = group.userData.surfaceLootPlacements; // Duplicate population must not create extra or rerolled items.
api.populateFurniture(group, data, { profile: 'house', id: 'stable:id', area: 'map_i_house' });
assert.strictEqual(group.userData.surfaceLootPlacements, first);
assert.equal(api.diagnostics().takingHouseItemsIsCrime, false);
console.log('house surface loot: real authored surfaces, sensible pools, clearance, persistence IDs, residential opt-in, and no crime penalty passed');
