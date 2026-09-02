const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/farm-troughs.js', 'utf8');
const marker = '// Livestock Nursery integration lives beside the dynamic barn-interior';
const markerAt = source.indexOf(marker);
assert(markerAt >= 0, 'FarmTroughs includes the livestock Nursery integration');
const iifeAt = source.lastIndexOf('(() => {', markerAt);
assert(iifeAt >= 0, 'Nursery integration is wrapped in its own IIFE');
const nurserySource = source.slice(iifeAt);

const livestock = [
  { id: 'stasis1', kind: 'grehlr', name: 'Stasis Baby', barnId: null, troughIndex: null, heartLevel: 2, genotype: { sizeClass: 'small' } },
  { id: 'legacy1', kind: 'grehlr', name: 'Legacy Roamer', col: 9, row: 9, heartLevel: 2, genotype: { sizeClass: 'medium' } },
];
const buildings = [];
const animalObjects = new Set();
const worldObjects = new Map();
let breedingPairs = [];
let saveCount = 0;
const barnTiers = { small: { slots: 2, label: 'Small Barn' } };

const FarmAnimals = {
  init(deps) { this.deps = deps; },
  canSpawnAt() { return true; },
  addFromItem() {
    const entry = { id: 'newbaby', kind: 'grehlr', name: 'New Baby', barnId: null, troughIndex: null, heartLevel: 2, genotype: { sizeClass: 'medium' } };
    livestock.push(entry);
    return { ok: true, message: 'New Baby added to the farm. It is waiting in stasis until you assign it to a barn.', entry };
  },
  assignToBarn(id, barnId) {
    const entry = livestock.find(item => item.id === id);
    entry.barnId = barnId;
    entry.troughIndex = 0;
    return { ok: true, message: 'Assigned.' };
  },
  unassignFromBarn() { throw new Error('Nursery wrapper should own adult unassignment'); },
  respawnWorldLivestock() {},
  tickHearts() {
    for (const entry of livestock) if (entry.barnId) entry.heartLevel = (entry.heartLevel || 0) - 0.2;
  },
  tickResources() {
    for (const entry of livestock) if (entry.barnId) entry.resourceTicks = (entry.resourceTicks || 0) + 1;
  },
  tickBreedingProgress() {
    livestock.push({ id: 'born', kind: 'grehlr', name: 'Born', barnId: null, troughIndex: null, heartLevel: 2, genotype: { sizeClass: 'small' } });
  },
  resolveBreedingParent(ref) { return livestock.find(item => item.id === ref.id) || null; },
  updateAnimalMeshes() {},
  clearVatWorkerPose() {},
};

const FarmBuildings = {
  init(deps) { this.deps = deps; },
  canPlaceAt() { return true; },
  spawnEntry(entry) {
    entry._worldObj = {};
    if (!buildings.includes(entry)) buildings.push(entry);
  },
  clearFootprint() {},
  findOpenTileNear() { return { col: 3, row: 3 }; },
  demolish(id) {
    const index = buildings.findIndex(entry => entry.id === id);
    if (index >= 0) buildings.splice(index, 1);
    return { ok: true, message: 'Barn demolished — livestock back in stasis.' };
  },
};

const FarmTroughs = {
  init(deps) { this.deps = deps; },
  synthesizeBarnInteriorMapData() { return { name: 'Barn Interior' }; },
};

const context = {
  window: {
    FarmAnimals,
    FarmBuildings,
    FarmTroughs,
    CreatureGenetics: { creatureSizeScale() { return { x: 1, y: 1 }; } },
    SCRATCHBONES_CONFIG: { game: { livestock: { animalWidths: { grehlr: 1.7 } } } },
  },
  console,
  navigator: {},
  document: { getElementById() { return null; } },
  MutationObserver: undefined,
  queueMicrotask,
  Math,
  Number,
  Object,
  Array,
  Set,
  Map,
  Promise,
  String,
  RegExp,
  JSON,
  Date,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(nurserySource, context);

const animalDeps = {
  loadWorldLivestock: () => livestock,
  saveWorldLivestock: () => { saveCount++; },
  _loadWorldBreedingPairs: () => breedingPairs,
  _saveWorldBreedingPairs: value => { breedingPairs = value; },
  hasFarmPermission: () => true,
  animalObjects,
  worldObjects,
  getFarmBuildings: () => buildings,
  getCurrentArea: () => 'farm',
  player: { x: 0, y: 0 },
  TILE: 48,
  COLS: 60,
  ROWS: 50,
  CREATURE_DB: { grehlr: { spriteAspect: 0.75 } },
  showToast() {},
};
const buildingDeps = {
  getFarmBuildings: () => buildings,
  getBarnTiers: () => barnTiers,
  COLS: 60,
  ROWS: 50,
  saveFarmLayout() {},
  saveMemberWorldData() {},
  hasFarmPermission: () => true,
  enterBuilding() {},
  setFarmLivestockFocusBarnId() {},
  openMenu() {},
};

context.window.FarmAnimals.init(animalDeps);
context.window.FarmBuildings.init(buildingDeps);
context.window.FarmTroughs.init({});

let snapshot = context.window.LivestockNursery.debugSnapshot();
assert.equal(snapshot.babies.length, 1, 'explicit former-stasis records migrate to Nursery babies');
assert.equal(snapshot.adults.length, 1, 'legacy free-roaming records remain adults');

context.window.FarmAnimals.respawnWorldLivestock();
const nursery = buildings.find(entry => entry.id === 'farm_nursery');
assert(nursery, 'the free Nursery is seeded onto the farm');
assert.equal(nursery.stage, 'built', 'the free Nursery starts fully built');

const added = context.window.FarmAnimals.addFromItem('grehlrCrate');
assert.equal(added.entry.lifeStage, 'baby', 'new livestock enters the Nursery as a baby');
assert.equal(added.entry.barnId, null, 'new babies are not assigned to barns');

let grow = context.window.LivestockNursery.growBaby('newbaby');
assert.equal(grow.ok, false, 'Grow Up is blocked while adult count fills available barn capacity');

const barn = { id: 'barn1', kind: 'barn', tier: 'small', stage: 'built', col: 10, row: 10, w: 4, h: 3, _worldObj: {} };
buildings.push(barn);
grow = context.window.LivestockNursery.growBaby('newbaby');
assert.equal(grow.ok, true, 'Grow Up succeeds when total adult barn capacity has space');
assert.equal(added.entry.lifeStage, 'adult', 'Grow Up is a one-way life-stage transition');
assert.equal(added.entry.barnId, 'barn1', 'a grown adult moves into the first open regular barn');

const liveAnimal = { livestockId: 'newbaby', col: 4, row: 4, wx: 4.5, wz: 4.5, avatarRef: { group: { visible: true, position: { x: 4.5, z: 4.5 } } } };
animalObjects.add(liveAnimal);
worldObjects.set('4,4', liveAnimal);
const outdoors = context.window.FarmAnimals.unassignFromBarn('newbaby');
assert.equal(outdoors.ok, true, 'adult livestock can be unhoused');
assert.equal(added.entry.barnId, null, 'unhoused adults remain adults outdoors rather than re-entering Nursery storage');

const happinessBefore = added.entry.heartLevel;
context.window.FarmAnimals.tickHearts();
assert(added.entry.heartLevel < happinessBefore, 'unhoused adults lose happiness on the nightly heart tick');
assert.equal(added.entry.barnId, null, 'nightly outdoor tick never persists its temporary housing sentinel');

const resourceTicksBefore = added.entry.resourceTicks || 0;
context.window.FarmAnimals.tickResources();
assert((added.entry.resourceTicks || 0) > resourceTicksBefore, 'unhoused adults stay active instead of pausing resource progression like stasis');
assert.equal(added.entry.barnId, null, 'resource tick never persists its temporary housing sentinel');

const protectedResult = context.window.FarmBuildings.demolish(nursery.id);
assert.equal(protectedResult.ok, false, 'the free Nursery cannot be demolished');
assert(buildings.includes(nursery), 'failed Nursery demolition leaves the building in place');

added.entry.barnId = 'barn1';
const demolished = context.window.FarmBuildings.demolish('barn1');
assert.equal(demolished.ok, true, 'ordinary barns remain demolishable');
assert.equal(added.entry.barnId, null, 'demolishing a barn unhoused its adults instead of deleting them');

context.window.FarmAnimals.tickBreedingProgress(1);
assert.equal(livestock.find(entry => entry.id === 'born').lifeStage, 'baby', 'newborns immediately become Nursery babies');

snapshot = context.window.LivestockNursery.debugSnapshot();
assert.equal(snapshot.visibleLimit, 12, 'Nursery interior has a bounded visible swarm while storage stays unbounded');
assert.equal(context.window.LivestockNursery.BABY_SCALE, 0.25, 'Nursery baby visuals use 25% of adult species/size scale');
assert(saveCount > 0, 'Nursery transitions persist through the existing livestock save seam');

console.log('livestock Nursery regression tests passed');
