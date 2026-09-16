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
const npcWalker = { rec: { id: 'test_npc' }, area: 'town', root: root(1.5) };

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
      npc: npcWalker.root.position.y,
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
const runtimeDeps = { getCurrentArea: () => 'town', renderer, npcWalkers: [npcWalker] };

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
assert.equal(observed.npc, 1.5, 'NPC walker remains movement-owned when not in water');

assert.equal(normalCompanion.avatarRef.group.position.y, 1, 'companion Y restores after render');
assert.equal(normalCompanion.groundShadow.position.y, 0.01, 'companion shadow Y restores after render');
assert.equal(mount.avatarRef.group.position.y, 2, 'mount Y restores after render');
assert.equal(wild.avatarRef.group.position.y, 4, 'wild animal Y restores after render');
assert.equal(corpse.avatarRef.group.position.y, 6, 'corpse Y restores after render');
assert.equal(amphibiousFishCorpse.avatarRef.group.position.y, 6.5, 'amphibious fish corpse Y restores after render');
assert.equal(farmAnimal.avatarRef.group.position.y, 7, 'farm livestock Y restores after render');
assert.equal(npcWalker.root.position.y, 1.5, 'NPC movement-owned Y is unchanged after render');

let debug = context.window.HobunjiAnimalSubtleElevation.getDebug();
assert.equal(debug.appliedActors, 6, 'debug reports lifted animal actors');
assert.equal(debug.appliedRoots, 9, 'debug reports avatar + separate shadow roots');
assert.equal(debug.skippedShoulderPets, 1, 'debug reports shoulder-pet inheritance skip');
assert.equal(debug.skippedBandits, 1, 'debug reports humanoid skip');
assert.equal(debug.reason, 'temporary-render-lift');
assert.equal(context.window.HobunjiAnimalSubtleElevation.totalLiftAt(4.5, 7.5, 'town'), 0.35, 'public sampler matches player terrain + support composition');
assert.equal(context.window.HobunjiAnimalSubtleElevation.totalLiftAt(4.5, 7.5, 'farm'), 0.1, 'non-town areas do not incorrectly reuse town terrain map');

// Centroid regression: visible held equipment must not influence the player's
// body-rig centroid. This reproduces game.js's unnamed heldItemHolder directly
// under playerMesh while the body itself occupies y=0..2.
class FakeBox3 {
  constructor() { this.makeEmpty(); }
  makeEmpty() { this.min = { y: Infinity }; this.max = { y: -Infinity }; return this; }
  copy(box) { this.min = { y: box.min.y }; this.max = { y: box.max.y }; return this; }
  applyMatrix4(matrix) {
    const dy = Number(matrix?.dy) || 0;
    this.min.y += dy;
    this.max.y += dy;
    return this;
  }
  isEmpty() { return this.max.y < this.min.y; }
  union(box) {
    this.min.y = Math.min(this.min.y, box.min.y);
    this.max.y = Math.max(this.max.y, box.max.y);
    return this;
  }
}
class FakeVector3 { constructor() { this.y = 0; } }
const playerRoot = {
  name: 'player_root', type: 'Group', visible: true, position: { x: 0, y: 0, z: 0 }, children: [],
  updateMatrixWorld() {},
};
const bodyMesh = {
  name: 'player_avatar_plane', isMesh: true, visible: true, parent: playerRoot, children: [],
  geometry: { boundingBox: { min: { y: 0 }, max: { y: 2 } } }, matrixWorld: { dy: 0 },
};
const heldRoot = { name: '', type: 'Group', visible: true, parent: playerRoot, children: [] };
const heldMesh = {
  name: '', isMesh: true, visible: true, parent: heldRoot, children: [],
  geometry: { boundingBox: { min: { y: 8 }, max: { y: 10 } } }, matrixWorld: { dy: 0 },
};
heldRoot.children.push(heldMesh);
playerRoot.children.push(bodyMesh, heldRoot);
context.window.THREE = { Box3: FakeBox3, Vector3: FakeVector3 };
context.window.PlayerBodyTransformComposer = { getPlayerMesh: () => playerRoot };
assert.equal(context.window.HobunjiAnimalSubtleElevation.rigCentroidWorldY(playerRoot), 1,
  'held-item geometry is excluded from the player body-rig centroid');

// NPC-held equipment wraps the actual portrait body in a *_held_stance_body_yaw
// group. That pose wrapper must remain part of the body rig while the actual
// toolPlane sibling stays excluded.
const npcHeldRoot = {
  name: 'npc_walker_test', type: 'Group', visible: true, position: { x: 0, y: 0, z: 0 }, children: [],
  updateMatrixWorld() {},
};
const stanceWrapper = { name: 'test_npc_held_stance_body_yaw', type: 'Group', visible: true, parent: npcHeldRoot, children: [] };
const npcBodyMesh = {
  name: 'npc_portrait', isMesh: true, visible: true, parent: stanceWrapper, children: [],
  geometry: { boundingBox: { min: { y: 0 }, max: { y: 2 } } }, matrixWorld: { dy: 0 },
};
const npcFeetMesh = {
  name: 'test_npc_procedural_feet', isMesh: true, visible: true, parent: npcHeldRoot, children: [],
  geometry: { boundingBox: { min: { y: 0 }, max: { y: 0.2 } } }, matrixWorld: { dy: 0 },
};
const npcToolMesh = {
  name: 'axe_sprite', isMesh: true, visible: true, parent: npcHeldRoot, children: [], userData: { toolPlane: {} },
  geometry: { boundingBox: { min: { y: 8 }, max: { y: 10 } } }, matrixWorld: { dy: 0 },
};
stanceWrapper.children.push(npcBodyMesh);
npcHeldRoot.children.push(stanceWrapper, npcFeetMesh, npcToolMesh);
assert.equal(context.window.HobunjiAnimalSubtleElevation.rigCentroidWorldY(npcHeldRoot), 1,
  'held-stance wrapper keeps the NPC body in the centroid while toolPlane geometry is excluded');

// Water regression: the temporary correction must sink a swimmer until the
// water surface reaches the rig centroid, then restore movement-owned Y.
// canSwim deliberately stays true here: that flag exempts movement penalties,
// not the visual water-intersection rule.
normalCompanion.x = 4.5;
normalCompanion.y = 7.5;
normalCompanion.def = { canSwim: true };
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
assert.equal(observed.companion, 0, 'natural swimmer is render-sunk until its centroid touches the river surface');
assert.equal(observed.npc, 0, 'NPC registry path applies the same centroid rule without a scene traversal');
assert.equal(normalCompanion.avatarRef.group.position.y, 1, 'water sink restores the movement-owned companion Y after render');
assert.equal(npcWalker.root.position.y, 1.5, 'water sink restores the movement-owned NPC Y after render');
debug = context.window.HobunjiAnimalSubtleElevation.getDebug();
assert.equal(debug.waterActors >= 2, true, 'water diagnostics report corrected swimmer actors');
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
