const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const nurserySource = fs.readFileSync('docs/js/livestock-nursery.js', 'utf8');
assert(nurserySource.includes("const BABY_SCALE = 0.3125;"), 'baby scale is 31.25% of adult scale after the 25% size increase');
assert(nurserySource.includes("const BABY_SPEED_MULTIPLIER = 1.125;"), 'Nursery movement is 25% slower than the previous 1.5x multiplier');
assert(nurserySource.includes('GridTileAccessors?.getActiveScene?.()'), 'Nursery rendering uses the shared active-scene accessor');
assert(!nurserySource.includes('Combat.deps'), 'Nursery no longer reaches through Combat internals for its scene');
assert(nurserySource.includes('updateHeadRotation(pitchDeg, dt)'), 'baby heads track player elevation through the shared pitch seam');
assert(nurserySource.includes('updateHeadYaw(yawDeg, dt)'), 'baby heads track player direction through the shared yaw seam');
assert(nurserySource.includes("const names = ['idle', 'run1', 'run2'];"), 'baby swarm prepares authored run frames');

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
  clearVatWorkerPose() {},
};

const FarmBuildings = {
  BARN_PIECES: { small: { file: 'config/pieces/barn-small.json', w: 4, h: 3 } },
  init(deps) { this.deps = deps; },
  canPlaceAt() { return true; },
  spawnEntry(entry) {
    const def = this.BARN_PIECES[entry.tier] || this.BARN_PIECES.small;
    entry.w = def.w;
    entry.h = def.h;
    entry._worldObj = {};
  },
  clearFootprint() {},
  findOpenTileNear() { return { col: 3, row: 3 }; },
  demolish(id) {
    const index = buildings.findIndex(entry => entry.id === id);
    if (index >= 0) buildings.splice(index, 1);
    return { ok: true, message: 'Barn demolished.' };
  },
};

const FarmTroughs = {
  init(deps) { this.deps = deps; },
  synthesizeBarnInteriorMapData() { return { name: 'Barn Interior' }; },
};

const FarmPanel = {
  init(deps) { this.deps = deps; },
  render() {},
};

const context = {
  window: {
    FarmAnimals,
    FarmBuildings,
    FarmTroughs,
    FarmPanel,
    CreatureGenetics: { creatureSizeScale() { return { x: 1, y: 1 }; } },
    SCRATCHBONES_CONFIG: { game: { livestock: { animalWidths: { grehlr: 1.7 } } } },
  },
  console,
  navigator: {},
  document: {
    readyState: 'complete',
    body: null,
    getElementById() { return null; },
    addEventListener() {},
  },
  MutationObserver: undefined,
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {},
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
  getPlayerFaceTarget: () => ({ x: 1, z: 1, worldY: 1 }),
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
context.window.FarmPanel.init({});

let snapshot = context.window.LivestockNursery.debugSnapshot();
assert.equal(snapshot.babies.length, 1, 'explicit former-stasis records migrate to Nursery babies');
assert.equal(snapshot.adults, 1, 'legacy free-roaming records remain adults');

context.window.FarmAnimals.respawnWorldLivestock();
const nursery = buildings.find(entry => entry.id === 'farm_nursery');
assert(nursery, 'the free Nursery is seeded onto the farm');
assert.equal(nursery.stage, 'built', 'the free Nursery starts fully built');
assert.equal(nursery.tier, 'nursery', 'Nursery owns a dedicated non-adult-housing tier');
assert.equal(nursery.w, 3, 'Nursery is exactly three tiles wide');
assert.equal(nursery.h, 2, 'Nursery is exactly two tiles deep');
assert.equal(barnTiers.nursery.slots, 0, 'Nursery contributes no adult barn capacity');

const added = context.window.FarmAnimals.addFromItem('grehlrCrate');
assert.equal(added.entry.lifeStage, 'baby', 'new livestock enters the Nursery as a baby');
assert.equal(added.entry.barnId, null, 'new babies are not assigned to barns');

let grow = context.window.LivestockNursery.growBaby('newbaby');
assert.equal(grow.ok, false, 'Grow Up is blocked without adult barn capacity');

const barn = { id: 'barn1', kind: 'barn', tier: 'small', stage: 'built', col: 10, row: 10, w: 4, h: 3, _worldObj: {} };
buildings.push(barn);
grow = context.window.LivestockNursery.growBaby('newbaby');
assert.equal(grow.ok, true, 'Grow Up succeeds when total adult barn capacity has space');
assert.equal(added.entry.lifeStage, 'adult', 'Grow Up is a one-way life-stage transition');
assert.equal(added.entry.barnId, 'barn1', 'a grown adult moves into the first open regular barn');

const liveAnimal = { livestockId: 'newbaby', col: 4, row: 4, wx: 4.5, wz: 4.5, reset() {} };
animalObjects.add(liveAnimal);
worldObjects.set('4,4', liveAnimal);
const outdoors = context.window.FarmAnimals.unassignFromBarn('newbaby');
assert.equal(outdoors.ok, true, 'adult livestock can be unhoused');
assert.equal(added.entry.lifeStage, 'adult', 'unhoused livestock remains adult');
assert.equal(added.entry.barnId, null, 'unhoused adults live outdoors rather than re-entering Nursery storage');

const happinessBefore = added.entry.heartLevel;
context.window.FarmAnimals.tickHearts();
assert(added.entry.heartLevel < happinessBefore, 'unhoused adults lose happiness on the nightly heart tick');
assert.equal(added.entry.barnId, null, 'nightly outdoor tick never persists its temporary housing sentinel');

const resourceTicksBefore = added.entry.resourceTicks || 0;
context.window.FarmAnimals.tickResources();
assert((added.entry.resourceTicks || 0) > resourceTicksBefore, 'unhoused adults stay active instead of pausing resource progression');
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
assert.equal(snapshot.babyScale, 0.3125, 'debug snapshot reports the increased 31.25% baby scale');
assert.equal(snapshot.speedMultiplier, 1.125, 'debug snapshot reports the reduced 1.125x Nursery movement multiplier');
assert.equal(context.window.LivestockNursery.constants.NURSERY_VISIBLE_LIMIT, 12, 'public constants retain the 12-baby visual cap');
assert(saveCount > 0, 'Nursery transitions persist through the existing livestock save seam');

console.log('livestock Nursery regression tests passed');
