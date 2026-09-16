const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-subtle-elevation-bridge.js', 'utf8');
new Function(source);

function root(y = 1) {
  return { position: { x: 4.5, y, z: 7.5 }, visible: true, parent: {} };
}

const normalCompanion = { id: 'companion', areaId: 'town', isCompanion: true, avatarRef: { group: root(1) }, groundShadow: root(0.01) };
const mount = { id: 'mount', areaId: 'town', isCompanion: true, stableRole: 'mount', avatarRef: { group: root(2) } };
const shoulderPet = { id: 'shoulder', areaId: 'town', isCompanion: true, stableRole: 'shoulderPet', avatarRef: { group: root(3) } };
const wild = { id: 'wild', areaId: 'town', creatureKey: 'wild', avatarRef: { group: root(4) } };
const bandit = { id: 'bandit', areaId: 'town', isBandit: true, avatarRef: { group: root(5) } };
const corpse = { id: 'corpse', areaId: 'town', creatureKey: 'wild', avatarRef: { group: root(6) }, groundShadow: root(0.02) };
const amphibiousFishCorpse = { id: 'fish-corpse', areaId: 'town', isBandit: true, isAmphibiousFishCorpse: true, creatureKey: 'fish', avatarRef: { group: root(6.5) } };
const farmAnimal = { id: 'farm', animalKey: 'uumkaoii', avatarRef: { group: root(7) }, groundShadow: root(0.03) };

let observed = null;
const renderer = {
  render() {
    observed = {
      companion: normalCompanion.avatarRef.group.position.y,
      companionShadow: normalCompanion.groundShadow.position.y,
      mount: mount.avatarRef.group.position.y,
      shoulder: shoulderPet.avatarRef.group.position.y,
      wild: wild.avatarRef.group.position.y,
      bandit: bandit.avatarRef.group.position.y,
      corpse: corpse.avatarRef.group.position.y,
      corpseShadow: corpse.groundShadow.position.y,
      amphibiousFishCorpse: amphibiousFishCorpse.avatarRef.group.position.y,
      farm: farmAnimal.avatarRef.group.position.y,
      farmShadow: farmAnimal.groundShadow.position.y,
    };
  },
};

const Combat = {
  _deps: null,
  init(deps) { this._deps = deps; },
  get deps() { return this._deps; },
};
const FarmAnimals = { init() {} };
const PixelProbe = { init() {} };
const combatDeps = {
  getCurrentArea: () => 'town',
  hostileObjects: new Set([wild, bandit]),
  companionObjects: new Set([normalCompanion, mount, shoulderPet]),
  corpseObjects: new Set([corpse, amphibiousFishCorpse]),
};
const farmDeps = { getCurrentArea: () => 'town', animalObjects: new Set([farmAnimal]) };
const runtimeDeps = { getCurrentArea: () => 'town', renderer };

const context = {
  console,
  Map,
  Set,
  WeakMap,
  Symbol,
  Promise,
  Math,
  Number,
  String,
  Object,
  Array,
  JSON,
  location: { search: '', pathname: '/docs/index.html' },
  document: { readyState: 'complete', getElementById() { return null; } },
  window: {
    HobunjiTownSubtleElevation: { sampleHeightAt() { return 0.25; } },
    HobunjiWalkableElevation: { surfaceLiftAt() { return 0.1; } },
    Combat,
    FarmAnimals,
    PixelProbe,
  },
};
context.window.window = context.window;
vm.runInNewContext(source, context, { filename: 'animal-subtle-elevation-bridge.js' });

context.window.Combat.init(combatDeps);
context.window.FarmAnimals.init(farmDeps);
context.window.PixelProbe.init(runtimeDeps);
renderer.render();

assert.ok(observed, 'renderer ran');
assert.equal(observed.companion, 1.35, 'companion receives town terrain + support lift');
assert.equal(observed.companionShadow, 0.36, 'companion shadow receives same temporary lift');
assert.equal(observed.mount, 2.35, 'mount receives shared animal lift');
assert.equal(observed.wild, 4.35, 'wild animal receives shared animal lift');
assert.equal(observed.corpse, 6.35, 'animal corpse receives shared animal lift');
assert.equal(observed.corpseShadow, 0.37, 'animal corpse shadow receives same temporary lift');
assert.equal(observed.amphibiousFishCorpse, 6.85, 'amphibious fish corpse keeps animal elevation despite its combat sentinel flag');
assert.equal(observed.farm, 7.35, 'farm livestock receives shared animal lift');
assert.equal(observed.farmShadow, 0.38, 'farm livestock shadow receives same temporary lift');
assert.equal(observed.shoulder, 3, 'shoulder pet is not double-lifted because it inherits player composition');
assert.equal(observed.bandit, 5, 'humanoid bandit is not routed through animal elevation');

assert.equal(normalCompanion.avatarRef.group.position.y, 1, 'companion Y restores after render');
assert.equal(normalCompanion.groundShadow.position.y, 0.01, 'companion shadow Y restores after render');
assert.equal(mount.avatarRef.group.position.y, 2, 'mount Y restores after render');
assert.equal(wild.avatarRef.group.position.y, 4, 'wild animal Y restores after render');
assert.equal(corpse.avatarRef.group.position.y, 6, 'corpse Y restores after render');
assert.equal(amphibiousFishCorpse.avatarRef.group.position.y, 6.5, 'amphibious fish corpse Y restores after render');
assert.equal(farmAnimal.avatarRef.group.position.y, 7, 'farm livestock Y restores after render');

let debug = context.window.HobunjiAnimalSubtleElevation.getDebug();
assert.equal(debug.appliedActors, 6, 'debug reports lifted animal actors');
assert.equal(debug.appliedRoots, 9, 'debug reports avatar + separate shadow roots');
assert.equal(debug.skippedShoulderPets, 1, 'debug reports shoulder-pet inheritance skip');
assert.equal(debug.skippedBandits, 1, 'debug reports humanoid skip');
assert.equal(debug.reason, 'temporary-render-lift');
assert.equal(context.window.HobunjiAnimalSubtleElevation.totalLiftAt(4.5, 7.5, 'town'), 0.35, 'public sampler matches player terrain + support composition');
assert.equal(context.window.HobunjiAnimalSubtleElevation.totalLiftAt(4.5, 7.5, 'farm'), 0.1, 'non-town areas do not incorrectly reuse town terrain map');

// Water regression: the temporary correction must sink a swimmer until the
// water surface reaches the rig centroid, then restore movement-owned Y.
normalCompanion.x = 4.5;
normalCompanion.y = 7.5;
normalCompanion.health = 100;
normalCompanion.maxHealth = 100;
normalCompanion.stamina = 100;
normalCompanion.maxStamina = 100;
normalCompanion.afflictions = { windedStamina: 0 };
combatDeps.TILE = 1;
combatDeps.worldSurfaceY = () => -0.5;
context.window.GridTileAccessors = {
  getActiveTileAt() { return { type: 'river', water: 3 }; },
};
renderer.render();
assert.equal(observed.companion, 0, 'swimming companion is render-sunk until its centroid touches the river surface');
assert.equal(normalCompanion.avatarRef.group.position.y, 1, 'water sink restores the movement-owned companion Y after render');
debug = context.window.HobunjiAnimalSubtleElevation.getDebug();
assert.equal(debug.waterActors >= 1, true, 'water diagnostics report at least one corrected swimmer');
assert.equal(debug.lastWaterSurfaceY, 0, 'water diagnostics report the computed river surface');

// Prone-water regression: ResourceSystem.tick stays authoritative for normal
// maintenance, then the shared bridge adds environmental Health damage and
// Winded Stamina to a prone actor in a river/stream.
const ResourceSystem = {
  tick() { return { ok: true }; },
  applyDamage(entity, amount) { entity.health -= amount; return amount; },
  addAffliction(entity, id, amount) { entity.afflictions[id] = (entity.afflictions[id] || 0) + amount; return amount; },
  enforceCaps() {},
};
context.window.ResourceSystem = ResourceSystem;
normalCompanion.prone = true;
context.window.ResourceSystem.tick(normalCompanion, 1, {});
assert.equal(normalCompanion.health, 96.5, 'one prone second in water deals 3.5% max Health damage');
assert.equal(normalCompanion.afflictions.windedStamina, 8, 'one prone second in water adds 8% max Stamina as Winded Stamina');
debug = context.window.HobunjiAnimalSubtleElevation.getDebug();
assert.equal(debug.proneWaterHazard.ticks, 1, 'hazard diagnostics count the prone-water tick');
assert.equal(debug.proneWaterHazard.lastActor, 'companion', 'hazard diagnostics identify the affected actor');

normalCompanion.prone = false;
context.window.ResourceSystem.tick(normalCompanion, 1, {});
assert.equal(normalCompanion.health, 96.5, 'non-prone swimmers take no water hazard damage');
assert.equal(normalCompanion.afflictions.windedStamina, 8, 'non-prone swimmers gain no extra Winded Stamina');

console.log('animal subtle elevation + swimmer centroid/prone-water regression checks passed');
