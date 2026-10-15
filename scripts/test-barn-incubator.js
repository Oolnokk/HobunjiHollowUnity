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

const nurseryChoices = B.nurseryIncubationChoices(); // Nursery selection offers actual free slots/troughs only.
assert(nurseryChoices.length > 0);
assert(nurseryChoices.every(choice => choice.troughIndex !== 0), 'occupied adult troughs never appear in the Nursery picker');
assert.equal(B.startFromNursery('baby_1', { ...nurseryChoices[0], troughIndex: 999 }).ok, false, 'stale destinations are rejected');
assert.equal(B.startFromNursery('missing_baby', nurseryChoices[0]).ok, false, 'stale baby selection changes no reservations');
const nurseryStart = B.startFromNursery('baby_1', nurseryChoices[0]);
assert.equal(nurseryStart.ok, true, 'Nursery card selection directly reserves a trough and starts maturation');
assert(!livestock.some(entry => entry.id === 'baby_1'), 'only the selected baby moves out of Nursery');
assert.equal(B.startFromNursery('baby_1', nurseryChoices[0]).ok, false, 'double activation cannot duplicate a baby');
assert.equal(B.cancelMaturation(nurseryChoices[0].additionId, nurseryChoices[0].slotIndex).ok, true, 'new Nursery action preserves the existing cancel lifecycle');
assert(livestock.some(entry => entry.id === 'baby_1'));

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
assert.equal(stock.price, 5000, 'incubator week-scale price is editable in shop-stock.json');
assert.equal(window.BARN_INCUBATOR_CONFIG.gameplay.slots, 3, 'slot count is config-driven');
assert.equal(window.BARN_INCUBATOR_CONFIG.gameplay.maturationDays, 2, 'maturation duration is config-driven');
assert.equal(window.BARN_INCUBATOR_CONFIG.addition.roofSpineHeightMultiplier, 0.75, 'roof spine multiplier is config-driven');

const anchors = furniture.stompAttachPoints.filter(point => point.enabled !== false);
assert.equal(anchors.length, 3, 'authored incubator crib exposes exactly three live animal attachment points');
assert.deepEqual(anchors.map(point => point.anchorName), ['incubatorBaby1', 'incubatorBaby2', 'incubatorBaby3'], 'each incubator slot maps to its own editable furniture anchor');
const roofSection = piece.roof.crossGableSections[0];
assert(Math.abs(roofSection.roofHeight - 1.19 * 0.75) < 1e-9, 'authored incubator roof spine rise is exactly 25% lower than the normal Highland barn rise');

assert.equal(B.removeIncubator(placed.addition.id,false).ok,true);
const plansBeforeStarter = JSON.stringify(inventory); // Completed starter addition must not consume a plan or material.
const starter = B.ensureStarterIncubator(barn.id,'small'); // Runs the actual free starter installation and normal wall validation.
assert.equal(starter.ok,true);
assert.equal(starter.addition.slots.length,1);
assert.equal(starter.addition.tier,'small');
assert.equal(JSON.stringify(inventory),plansBeforeStarter);
assert.equal(B.ensureStarterIncubator(barn.id,'small').addition.id,starter.addition.id,'retry preserves the existing starter addition');
assert.equal(B.getState().barns[barn.id].additions.length,1,'starter installation is idempotent');
// Exercise the real synthesis and grid adapter for every tier and wall orientation.
vm.runInContext(fs.readFileSync('docs/js/interior-furniture-grid.js', 'utf8'), context);
assert.equal(B.removeIncubator(starter.addition.id, false).ok, true);
barn.w = 5; barn.h = 5; // A larger test barn permits the large wing on all four walls.
for (const tier of ['small', 'medium', 'large']) {
  B.selectTier(tier);
  inventory[window.BARN_INCUBATOR_CONFIG.tiers[tier].planItem] = 1;
  const installed = B.placeIncubator(barn.id, B.candidatePlacementsForBarn(barn)[0]); // Real placement and plan consumption for this tier.
  assert.equal(installed.ok, true);
  for (const side of ['north', 'south', 'west', 'east']) {
    const candidate = B.candidatePlacementsForBarn(barn).find(entry => entry.side === side); // Existing placement authority validates each wall.
    assert(candidate, `${tier}: ${side} has a candidate`);
    assert.equal(B.moveIncubator(installed.addition.id, candidate).ok, true);
    const expanded = B.extendBarnInterior('map_i_barn_barn_test', window.FarmTroughs.synthesizeBarnInteriorMapData('map_i_barn_missing') || {
      cols: 8, rows: 6, floor: [], furniture: [], exits: [], colliders: [],
    }); // Fresh base avoids applying an expansion twice.
    const record = expanded.furniture[0]; // Actual generated furniture record.
    const rendered = window.InteriorFurnitureGrid.legacyRecordFor(record); // Actual runtime rotation/centering adaptation.
    const def = panelDeps.DECORATIVE_FURNITURE_DEFS[record.itemKey]; // Renderer lookup requires a matching itemKey.
    const addition = B.getState().barns[barn.id].additions[0]; // Persisted room footprint after moving.
    assert.equal(def.itemKey, record.itemKey);
    assert.equal(rendered.col + def.fw / 2 + rendered.postX,
      (addition.localCol + addition.w / 2) * 2 + expanded.farmBarnOriginShift.col, `${tier}/${side}: nest center X`);
    assert.equal(rendered.row + def.fd / 2 + rendered.postZ,
      (addition.localRow + addition.h / 2) * 2 + expanded.farmBarnOriginShift.row, `${tier}/${side}: nest center Z`);
    assert.equal(rendered.postSX, 1, 'rotation does not stretch the woven nests');
    assert.equal(rendered.postSZ, 1, 'rotation does not stretch the woven nests');
  }
  const authored = JSON.parse(fs.readFileSync(`docs/config/furniture-authored/${tier === 'medium' ? 'incubator' : 'incubator' + tier[0].toUpperCase() + tier.slice(1)}.json`, 'utf8')); // Runtime tier asset including sleeping anchors.
  assert.equal(authored.parts.length, installed.addition.slots.length * 2, 'one wild nest body and rim per slot');
  for (const anchor of authored.stompAttachPoints) {
    const parent = authored.parts.find(part => part.id === anchor.parentPartId); // Every sleeping anchor resolves to its own nest body.
    assert.equal(parent.kind, 'cup');
    assert.equal(anchor.position.x, 0);
    assert.equal(anchor.position.z, 0);
    assert(parent.transform.y + anchor.position.y < .19, 'baby rests inside the shallow nest');
    assert(Math.abs(parent.transform.x) + parent.transform.sx * .54 <= authored.footprint.w / 2);
    assert(Math.abs(parent.transform.z) + parent.transform.sz * .54 <= authored.footprint.d / 2);
  }
  assert.equal(B.removeIncubator(installed.addition.id, false).ok, true);
}

// A lightweight DOM exercises the Farm-tab button and existing slot manager.
const elements = new Map(); // Nodes resolved by the actual UI functions.
function element(tag = 'div') {
  const node = { tag, children: [], style: {}, listeners: {}, textContent: '',
    classList: { values: new Set(), add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); }, contains(value) { return this.values.has(value); } },
    appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); return child; },
    addEventListener(event, handler) { this.listeners[event] = handler; },
    setAttribute(name, value) { (this.attributes ||= {})[name] = String(value); },
    insertAdjacentElement(_, child) { elements.set(child.id, child); },
    querySelector(selector) { return elements.get(selector.slice(1)) || null; },
    remove() { elements.delete(this.id); },
  }; // Only the DOM operations used by the real manager and launcher.
  Object.defineProperty(node, 'innerHTML', { set(html) {
    this.children = [];
    for (const match of html.matchAll(/id="([^"]+)"/g)) { const child = element(); child.id = match[1]; elements.set(child.id, child); }
  } });
  return node;
}
const uiAddition = B.ensureStarterIncubator(barn.id, 'small'); // A real installed incubator for the Farm tab.
context.document = { getElementById: id => elements.get(id) || null, createElement: element, head: element(), body: element() };
elements.set('farmBuildingsList', element());
window.FarmPanel.render();
const launchers = elements.get('barnLayoutEditorLaunchers'); // Farm panel's actual decorated UI.
const card = launchers.children.find(node => node.className === 'incubator-slot'); // Direct status card, alongside the layout launcher.
assert(card.children.some(node => node.textContent.includes('Empty')));
card.children.find(node => node.textContent.includes('Manage Incubator')).listeners.click();
assert(elements.get('barnIncubatorManageModal').classList.contains('open'), 'Farm-tab Manage opens the existing manager directly');
assert.equal(elements.get('barnIncubatorSlots').children.length, uiAddition.addition.slots.length);
// Barn domain adapters reuse the existing validated placement/move rules.
let canEditLayout = true; // The same live permission can change while the editor remains open.
panelDeps.hasFarmPermission = () => canEditLayout;
const layout = B.createBarnLayoutAdapter(barn.id); // Real adapter supplied to the shared house renderer.
const layoutAddition = layout.getPieces().find(piece => piece.id === uiAddition.addition.id); // Installed incubator in farm coordinates.
assert.equal(layoutAddition.col, barn.col + uiAddition.addition.localCol);
assert.equal(layoutAddition.row, barn.row + uiAddition.addition.localRow);
assert.equal(layout.getPieces(), layout.getPieces(), 'render frames reuse the piece array');
assert.equal(layout.getViewPieces(), layout.getViewPieces(), 'render frames reuse view bounds');
const layoutPreview = layout.resolveMove(layoutAddition, barn.col, barn.row); // Snaps to an existing clear wall candidate.
assert(layoutPreview?.placement);
assert(layout.canMove(layoutAddition, barn.col, barn.row));
canEditLayout = false;
assert.equal(layout.canDrag(layoutAddition), false);
assert.equal(layout.move(layoutAddition, barn.col, barn.row).ok, false);
canEditLayout = true;
let openedLayout = null; // Opening a barn must pass its adapter to the actual FarmPanel entrypoint.
window.FarmPanel.openLayoutEditor = adapter => { openedLayout = adapter; };
assert.equal(B.openBarnEditor(barn.id).ok, true);
assert.equal(openedLayout.kind, 'barn');
assert.equal(elements.has('barnIncubatorLayoutModal'), false, 'legacy 2D modal is no longer created');
console.log('barn incubator tests passed');

// Move the live state to the world authority and prove the portable snapshot contains it.
localStorage.setItem('hobunjiSaveMeta', JSON.stringify({ characters: [], worlds: [{ id: 'world_test' }] }));
vm.runInContext(fs.readFileSync('docs/js/world-meta-store.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/save-snapshot-core.js', 'utf8'), context);
window.FarmBuildings.init(buildingDeps); // Reinitialization migrates the legacy browser sidecar.
assert.equal(localStorage.getItem('hobunji_barn_incubators_v1:world_test'), null);
const canonical = window.HobunjiSaveSnapshot.capture(); // Same boundary used by folder, cloud, and recovery saves.
assert.deepEqual(JSON.parse(JSON.stringify(canonical.meta.worlds[0].incubators)), window.BarnIncubator.getState());
const occupied = window.BarnIncubator.getState().barns[barn.id].additions[0]; // Give the remaining room an in-flight baby with full genetics.
const savedBaby = { id: 'saved_baby', name: 'Pebble', kind: 'grehlr', lifeStage: 'baby', genotype: { coat: 'blue' } };
occupied.slots[0].baby = savedBaby;
occupied.slots[0].daysRemaining = 2;
canonical.meta.worlds[0].incubators.barns[barn.id].additions[0] = occupied;
window.HobunjiSaveSnapshot.apply(canonical);
window.FarmBuildings.init(buildingDeps);
assert.equal(window.BarnIncubator.getState().barns[barn.id].additions[0].slots[0].baby.name, 'Pebble');
assert.equal(window.BarnIncubator.getState().barns[barn.id].additions[0].slots[0].daysRemaining, 2);
layout.refresh();
const maturingPiece = layout.getPieces().find(piece => piece.id === occupied.id); // Restored baby occupies this editor piece.
assert.equal(layout.canDrag(maturingPiece), false, 'maturing additions cannot start a drag');
assert.equal(B.moveIncubator(occupied.id, layoutPreview.placement).ok, false, 'movement authority itself protects maturing babies');
assert.equal(window.BarnIncubator.getState().barns[barn.id].additions[0].slots[0].baby.name, 'Pebble');
buildings.splice(0); // A replacement layout no longer has the original barn.
window.FarmPanel.render();
assert(elements.get('barnLayoutEditorLaunchers').children.some(node => node.textContent.includes('Detached incubator')));
assert.equal(window.BarnIncubator.cancelMaturation(occupied.id, 0).ok, true);
assert.equal(livestock.find(entry => entry.id === 'saved_baby').genotype.coat, 'blue');
console.log('Incubator canonical migration, snapshot restore, and detached layout recovery passed.');
