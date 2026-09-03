'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const configSource = fs.readFileSync('docs/config/barn-incubator-config.js', 'utf8');
const growthConfigSource = fs.readFileSync('docs/config/animal-growth-config.js', 'utf8');
const incubatorSource = fs.readFileSync('docs/js/barn-incubator.js', 'utf8');
const shopStock = JSON.parse(fs.readFileSync('docs/config/shops/shop-stock.json', 'utf8'));
const piece = JSON.parse(fs.readFileSync('docs/config/pieces/barn-incubator.json', 'utf8'));
const furniture = JSON.parse(fs.readFileSync('docs/config/furniture-authored/incubator.json', 'utf8'));

const inventory = { gold: 5000, growthTonic: 2, barnIncubatorPlan: 1 };
const itemDefs = {};
const barnTiers = { small: { label: 'Little Barn', slots: 4 } };
const barn = {
  id: 'barn_test', kind: 'barn', tier: 'small', stage: 'built',
  col: 10, row: 10, w: 4, h: 3,
  troughs: Array.from({ length: 4 }, () => ({ slots: Array(7).fill(null) })),
};
const buildings = [barn];
const livestock = [
  { id: 'baby_1', kind: 'grehlr', name: 'Mallow', genotype: {}, lifeStage: 'baby', barnId: null, troughIndex: null },
  { id: 'adult_1', kind: 'grehlr', name: 'Old Cat', genotype: {}, lifeStage: 'adult', barnId: 'barn_test', troughIndex: 0 },
];
let breedingPairs = [{ id: 'pair_1', parentA: { source: 'world', id: 'baby_1' }, parentB: { source: 'world', id: 'adult_1' } }];
const storage = new Map();
const worldObjects = new Map();

const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

function firstFreeTrough(barnId, ignoreId = null) {
  for (let i = 0; i < barn.troughs.length; i++) {
    if (!livestock.some(entry => entry.id !== ignoreId && entry.barnId === barnId && entry.troughIndex === i)) return i;
  }
  return -1;
}

const window = {
  __hobunjiPlayerProfile: { worldId: 'world_test' },
  setInterval() { return 1; },
  addEventListener() {},
  queueMicrotask,
  LootRolling: { getShopStock: () => shopStock.shops },
  ConditionRegistry: { entryEligible: () => true },
  LivestockNursery: { isBaby: entry => entry?.lifeStage === 'baby' },
  FarmBuildings: {
    init() {},
    canPlaceAt(col, row, w, h) {
      return col >= 0 && row >= 0 && col + w <= 60 && row + h <= 50;
    },
    spawnEntry() {},
    move(barnId, col, row) {
      const target = buildings.find(entry => entry.id === barnId);
      if (!target) return { ok: false, message: 'missing' };
      target.col = col; target.row = row;
      return { ok: true, message: 'moved' };
    },
    demolish() { return { ok: true, message: 'demolished' }; },
    clearAll() {},
  },
  FarmAnimals: {
    init() {},
    ensureBarnTroughs: target => target.troughs,
    assignToBarn(id, barnId) {
      const entry = livestock.find(item => item.id === id);
      const index = firstFreeTrough(barnId, id);
      if (!entry || index < 0) return { ok: false, message: 'No trough.' };
      entry.barnId = barnId;
      entry.troughIndex = index;
      return { ok: true, message: 'housed' };
    },
    assignToTrough(id, troughIndex) {
      const entry = livestock.find(item => item.id === id);
      if (!entry?.barnId) return { ok: false, message: 'not housed' };
      if (livestock.some(item => item.id !== id && item.barnId === entry.barnId && item.troughIndex === Number(troughIndex))) {
        return { ok: false, message: 'occupied' };
      }
      entry.troughIndex = Number(troughIndex);
      return { ok: true, message: 'assigned' };
    },
    tickHearts() { return 'tick'; },
  },
  FarmTroughs: {
    init() {},
    synthesizeBarnInteriorMapData(mapId) {
      if (mapId !== 'map_i_barn_barn_test') return null;
      const floor = [];
      for (let row = 0; row < 6; row++) for (let col = 0; col < 8; col++) floor.push([col, row]);
      return {
        schema: 'hobunji_building_interior.v1', id: mapId, name: 'Little Barn Interior', cols: 8, rows: 6,
        exits: [{ id: 'exit', tiles: [[3, 5], [4, 5]], spawnCol: 3, spawnRow: 4 }],
        floor, furniture: [], npcStations: [], colliders: [], vendorZones: [],
      };
    },
  },
  FarmPanel: { init() {}, render() {}, renderStablePanel() {} },
  CarpenterShop: { init() {}, render() {} },
};
window.window = window;

const context = vm.createContext({
  window,
  localStorage,
  console,
  queueMicrotask,
  setTimeout,
  clearTimeout,
});
vm.runInContext(growthConfigSource, context, { filename: 'animal-growth-config.js' });
vm.runInContext(configSource, context, { filename: 'barn-incubator-config.js' });
vm.runInContext(incubatorSource, context, { filename: 'barn-incubator.js' });

const buildingDeps = {
  getFarmBuildings: () => buildings,
  getBarnTiers: () => barnTiers,
  getPlayerData: () => ({ worldId: 'world_test' }),
  worldObjects,
  COLS: 60, ROWS: 50,
  scene: null,
  getHousePieceRects: () => [],
  saveMemberWorldData() {},
};
const animalDeps = {
  loadWorldLivestock: () => livestock,
  saveWorldLivestock(next) { livestock.splice(0, livestock.length, ...next); },
  _loadWorldBreedingPairs: () => breedingPairs,
  _saveWorldBreedingPairs(next) { breedingPairs = next; },
  CREATURE_DB: {},
  showToast() {},
};
const panelDeps = {
  inventory,
  ITEM_DEFS: itemDefs,
  DECORATIVE_FURNITURE_DEFS: {},
  clampInventoryStack() {},
  saveMemberWorldData() {},
  buildInventoryGrid() {},
  showToast() {},
};
const carpenterDeps = {
  inventory,
  ITEM_DEFS: itemDefs,
  clampInventoryStack() {},
  saveMemberWorldData() {},
  buildInventoryGrid() {},
  showToast() {},
  lootShopWorldState: () => ({}),
};

window.BarnIncubator.install();
window.FarmBuildings.init(buildingDeps);
window.FarmAnimals.init(animalDeps);
window.FarmTroughs.init({ getCurrentArea: () => null });
window.FarmPanel.init(panelDeps);
window.CarpenterShop.init(carpenterDeps);

const B = window.BarnIncubator;
const candidates = B.candidatePlacementsForBarn(barn);
assert(candidates.some(entry => entry.w === 3 && entry.h === 1 && ['north', 'south'].includes(entry.side)), 'north/south wall placements must keep the 3×1 canonical footprint');
assert(candidates.some(entry => entry.w === 1 && entry.h === 3 && ['east', 'west'].includes(entry.side)), 'east/west wall placements must rotate to 1×3 so the long side stays against the wall');

const north = candidates.find(entry => entry.side === 'north');
assert(north, 'test barn must expose a north incubator position');
const placed = B.placeIncubator(barn.id, north);
assert.equal(placed.ok, true, 'purchased incubator plan must place on a clear barn wall');
assert.equal(inventory.barnIncubatorPlan, 0, 'placement consumes exactly one purchased incubator plan');
assert.equal(placed.addition.slots.length, 3, 'incubator has exactly three independent maturation slots');

let available = B.availableTroughsForSlot(placed.addition.id, 0);
assert(!available.some(entry => entry.troughIndex === 0), 'already assigned adult trough is not reservable');
assert(available.some(entry => entry.troughIndex === 1), 'unused trough is reservable');

const reserved = B.reserveTrough(placed.addition.id, 0, barn.id, 1);
assert.equal(reserved.ok, true, 'unused trough can be reserved ahead of maturation');
assert(B.debugSnapshot().reservedTroughs.includes('barn_test:1'), 'reservation is visible in mobile debug state');

const tonicBefore = inventory.growthTonic;
const started = B.startMaturation(placed.addition.id, 0, 'baby_1');
assert.equal(started.ok, true, 'Nursery baby can enter a configured incubator slot');
assert(!livestock.some(entry => entry.id === 'baby_1'), 'incubating baby leaves the ordinary Nursery/world roster while physically inside the incubator');
assert.equal(breedingPairs.length, 0, 'incubating baby is removed from any active breeding pair');
assert.equal(B.debugSnapshot().barns[0].additions[0].slots[0].daysRemaining, 2, 'new incubation starts at the configured two-day duration');
assert.equal(inventory.growthTonic, tonicBefore, 'starting incubation never consumes a Growth Tonic');

const ordinary = { id: 'adult_2', kind: 'grehlr', name: 'Other Adult', genotype: {}, lifeStage: 'adult', barnId: null, troughIndex: null };
livestock.push(ordinary);
const ordinaryHousing = window.FarmAnimals.assignToBarn('adult_2', barn.id);
assert.equal(ordinaryHousing.ok, true, 'ordinary livestock can still be housed while a trough is reserved');
assert.notEqual(ordinary.troughIndex, 1, 'ordinary housing must not steal the incubator-reserved trough');

window.FarmAnimals.tickHearts();
assert.equal(B.debugSnapshot().barns[0].additions[0].slots[0].daysRemaining, 1, 'first daily livestock tick advances incubation by one day');
assert(!livestock.some(entry => entry.id === 'baby_1'), 'baby remains inside incubator after the first day');

window.FarmAnimals.tickHearts();
const adult = livestock.find(entry => entry.id === 'baby_1');
assert(adult, 'second daily livestock tick reinserts the matured animal into farm livestock');
assert.equal(adult.lifeStage, 'adult', 'incubator completion matures the baby without a tonic');
assert.equal(adult.barnId, barn.id, 'matured animal is housed in the reserved barn');
assert.equal(adult.troughIndex, 1, 'matured animal receives the exact trough reserved before incubation');
assert.equal(inventory.growthTonic, tonicBefore, 'two-day incubator completion consumes no Growth Tonic');
assert(!B.debugSnapshot().reservedTroughs.includes('barn_test:1'), 'reservation clears after the adult occupies that trough');

const map = window.FarmTroughs.synthesizeBarnInteriorMapData('map_i_barn_barn_test');
assert(map.cols >= 8 && map.rows > 6, 'north incubator expands the synthesized barn interior beyond the base barn rectangle');
assert(map.furniture.some(entry => entry.itemKey === 'incubatorFurniture' && entry.incubatorId === placed.addition.id), 'expanded barn interior contains the authored incubator furniture');

const stock = shopStock.shops.carpenterBarnPlans.additions.incubator;
assert.equal(stock.planItem, 'barnIncubatorPlan', 'carpenter stock owns the incubator plan item ID');
assert.equal(stock.price, 1000, 'incubator default price is editable in shop-stock.json');
assert.equal(window.BARN_INCUBATOR_CONFIG.gameplay.slots, 3, 'slot count is config-driven');
assert.equal(window.BARN_INCUBATOR_CONFIG.gameplay.maturationDays, 2, 'maturation duration is config-driven');
assert.equal(window.BARN_INCUBATOR_CONFIG.addition.roofSpineHeightMultiplier, 0.75, 'roof spine multiplier is config-driven');

const anchors = furniture.stompAttachPoints.filter(point => point.enabled !== false);
assert.equal(anchors.length, 3, 'authored incubator crib exposes exactly three live animal attachment points');
assert.deepEqual(anchors.map(point => point.anchorName), ['incubatorBaby1', 'incubatorBaby2', 'incubatorBaby3'], 'each incubator slot maps to its own editable furniture anchor');
const roofSection = piece.roof.crossGableSections[0];
assert(Math.abs(roofSection.roofHeight - 1.19 * 0.75) < 1e-9, 'authored incubator roof spine rise is exactly 25% lower than the normal Highland barn rise');

console.log('barn incubator tests passed');
