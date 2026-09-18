'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let now = 1000;
let damageSeen = null;
let footingSeen = null;
const player = {
  lastAttackAttemptAt: 1000,
  lastAttackReceivedAt: -1e9,
  dodging: false,
  dodgeT: 0,
  invulnUntil: 0,
};
const gear = {
  clothing: { hat: null, hood: null, torso: null, overwear: null },
  clothingItems: [],
  dyeCollection: ['starter-red'],
};
const packClothing = [];
const shopCatalog = [
  { id: 'appearance::hat::basic_headband', label: 'Basic Headband', category: 'hat' },
  { id: 'appearance::hat::leather_headband', label: 'Leather Headband', category: 'hat' },
  { id: 'tankan_tunic', label: 'Tankan Tunic', category: 'torso' },
  { id: 'bandolier1', label: 'Bandolier', category: 'torso' },
  { id: 'fine_hood', label: 'Fine Hood', category: 'hood' },
  { id: 'rugged_poncho', label: 'Rugged Poncho', category: 'overwear' },
];

const classList = () => ({ add() {}, remove() {}, toggle() {}, contains() { return false; } });
const documentStub = {
  documentElement: { dataset: {} },
  body: { appendChild() {}, dataset: {} },
  head: { appendChild() {} },
  addEventListener() {},
  querySelectorAll() { return []; },
  getElementById() { return null; },
  createElement(tag) {
    if (tag === 'style') return { textContent: '' };
    return { style: {}, dataset: {}, classList: classList(), appendChild() {}, remove() {}, setAttribute() {}, getContext() { return null; } };
  },
};

const EquipmentPanel = {
  init(injected) { this.deps = injected; },
  applyGearClothingToPlayerData(data) {
    const ids = new Set(data.equippedCosmetics || []);
    const bodyColors = { ...(data.appearance?.bodyColors || {}) };
    for (const slot of ['hat', 'hood', 'torso', 'overwear']) {
      const item = gear.clothing[slot];
      if (!item) continue;
      ids.add(item.cosmeticId);
      if (slot === 'torso' && item.colorA) bodyColors.TORSO = { ...item.colorA };
    }
    return { ...data, equippedCosmetics: [...ids], appearance: { ...(data.appearance || {}), bodyColors } };
  },
  buildEquipmentSlots() {},
  clothingSpriteForCosmetic(id) { return `assets/${id}.png`; },
};
const ResourceSystem = {
  applyDamage(entity, amount) { damageSeen = amount; return amount; },
  spendFooting(entity, amount) { footingSeen = amount; return amount; },
};
const Combat = {
  deps: { player },
  getMovementSpeedMul() { return 1; },
  update() {},
};
const windowStub = {
  SCRATCHBONES_CONFIG: { game: { account: { shopCatalog }, input: { targeting: { orbitRadiusTiles: 0.62 } } } },
  EquipmentPanel,
  ResourceSystem,
  Combat,
  Mounts: { rideState: 'none', rideEntity: { id: 'stale-reference' } },
  DyeSystem: {
    ensureCollection() {},
    getCatalog() { return [{ id: 'starter-red', label: 'Starter Red', hex: '#aa0000' }]; },
    owns(id) { return gear.dyeCollection.includes(id); },
    getById(id) { return this.getCatalog().find(dye => dye.id === id) || null; },
    toClothingColor(dye) { return { dyeId: dye.id, label: dye.label, hex: dye.hex }; },
    ownedByHue() { return []; },
  },
  PatternLibrary: {
    listAvailable() { return []; },
    getById() { return null; },
  },
  PatternAuthoring: {},
  ActionPromptUI: { getLastInputDevice() { return 'desktop'; } },
  __hobunjiFurnitureDebug: { getCurrentArea() { return null; }, playerState: player, targetAimAngleDeg: 0 },
  setInterval() { return 1; },
  _imageForTint(img) { return img; },
  renderProfile: async () => {},
  renderPortraitProfile: async () => {},
};
const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  performance: { now: () => now },
  MutationObserver: class { observe() {} },
  Image: class {},
  URL,
  fetch: async () => ({ ok: false, json: async () => ({}) }),
  console,
});
vm.runInContext(fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8'), context, { filename: 'clothing-weaving-system.js' });

const api = windowStub.ClothingWeavingSystem;
assert(api, 'ClothingWeavingSystem exported');
assert.equal(api.isCraftableCloth({ slot: 'hat', cosmeticId: 'appearance::hat::basic_headband' }), true, 'basic non-leather headband is cloth-craftable');
assert.equal(api.isCraftableCloth({ slot: 'hat', cosmeticId: 'appearance::hat::leather_headband' }), false, 'other hats are excluded');
assert.equal(api.isCraftableCloth({ slot: 'torso', cosmeticId: 'bandolier1' }), false, 'bandolier is excluded');
assert.equal(api.isCraftableCloth({ slot: 'torso', cosmeticId: 'tankan_tunic' }), true, 'ordinary torso cloth is craftable');
assert.equal(api.standardWeightFor({ slot: 'hat', cosmeticId: 'appearance::hat::basic_headband' }), 1);
assert.equal(api.standardWeightFor({ slot: 'hood', cosmeticId: 'fine_hood' }), 2);
assert.equal(api.standardWeightFor({ slot: 'torso', cosmeticId: 'tankan_tunic' }), 3);
assert.equal(api.standardWeightFor({ slot: 'overwear', cosmeticId: 'rugged_poncho' }), 4);
assert.equal(api.itemWeightUnits({ slot: 'torso', cosmeticId: 'tankan_tunic' }), 3, 'legacy/current clothing gets standard middle weight automatically');
assert.equal(api.itemWeightUnits({ slot: 'torso', cosmeticId: 'tankan_tunic#loom:x', baseCosmeticId: 'tankan_tunic', weightUnits: 1.8 }), 1.8, 'crafted instance keeps explicit weight');
const ten = api.armorStats(10);
assert(Math.abs(ten.damageTakenMul - 0.75) < 1e-12);
assert(Math.abs(ten.footingTakenMul - 0.65) < 1e-12);
assert(Math.abs(ten.dodgeEfficacy - 0.75) < 1e-12);
assert(Math.abs(ten.combatMoveMul - 0.82) < 1e-12);

const equipmentDeps = {
  getGearInventory: () => gear,
  getPackClothing: () => packClothing,
  saveGearInventory() {},
  inventory: { lightWool: 10, puktukWool: 10 },
  refreshPlayerAvatar() {},
  buildInventoryGrid() {},
  saveMemberWorldData() {},
  clampInventoryStack() {},
  showToast() {},
};
windowStub.EquipmentPanel.init(equipmentDeps);
const lightTunic = {
  uid: 'woven-1',
  cosmeticId: 'tankan_tunic#loom:woven-1',
  baseCosmeticId: 'tankan_tunic',
  slot: 'torso',
  baseLabel: 'Tankan Tunic',
  label: 'Starter Red Tankan Tunic',
  colorA: { dyeId: 'starter-red', hex: '#aa0000' },
  colorC: { dyeId: 'starter-red', hex: '#aa0000' },
  weightUnits: 1.8,
  weaveMaterial: 'light',
  weaving: {
    layers: {
      __default: {
        pattern: { motifDataUrl: 'data:image/png;base64,AA==' },
        patternLabel: 'Custom',
      },
    },
  },
};
gear.clothingItems.push(lightTunic);
gear.clothing.torso = lightTunic;
windowStub.EquipmentPanel.buildEquipmentSlots();
const applied = windowStub.EquipmentPanel.applyGearClothingToPlayerData({ equippedCosmetics: [], appearance: { bodyColors: {} } });
assert(applied.equippedCosmetics.includes('tankan_tunic'), 'crafted cosmetic translates back to authored base for rendering');
assert(!applied.equippedCosmetics.includes(lightTunic.cosmeticId), 'unique crafted id never leaks into portrait cosmetic lookup');
assert.equal(applied.appearance.bodyColors.TORSO_C.dyeId, 'starter-red', 'woven color uses the third torso dye slot');
assert.equal(applied.appearance.bodyColors.__hobunjiWovenClothing[0].baseCosmeticId, 'tankan_tunic', 'pattern descriptor follows avatar render data only');
assert.equal(api.__test.weavingPatternForRole(lightTunic.weaving, null).motifDataUrl, 'data:image/png;base64,AA==', 'modern per-layer weaving resolves the default layer');
const legacyPattern = { motifDataUrl: 'data:image/png;base64,LEGACY==' }; // Used to keep pre-layer-save compatibility covered while the main fixture exercises the modern format.
assert.equal(api.__test.weavingPatternForRole({ pattern: legacyPattern }, 'anything'), legacyPattern, 'legacy single-pattern saves still resolve across every layer');
windowStub.PatternLibrary.getById = id => id === 'live-pattern' ? { motifDataUrl: 'data:image/png;base64,MIGRATED==' } : null;
const referenceOnlyWeaving = { weaving: { layers: { base: { patternLibraryId: 'live-pattern', patternLabel: 'Saved' } } } }; // Used to model a garment crafted by the short-lived reference-only implementation.
assert.equal(api.__test.materializeWeavingLibrarySnapshots(referenceOnlyWeaving), true, 'reference-only garment is upgraded while its library source still exists');
assert.equal(referenceOnlyWeaving.weaving.layers.base.pattern.motifDataUrl, 'data:image/png;base64,MIGRATED==', 'migration embeds the resolved source motif on the garment');
assert.equal(api.__test.materializeWeavingLibrarySnapshots(referenceOnlyWeaving), false, 'already snapshotted garment is not rewritten repeatedly');
windowStub.PatternLibrary.getById = () => null;
const deadLibraryOnlyWeaving = { layers: { base: { patternLibraryId: 'deleted-pattern', patternLabel: 'Deleted' } } }; // Used to ensure an unresolved source reference is not presented as visible weaving.
assert.equal(api.__test.weavingPatternForRole(deadLibraryOnlyWeaving, 'base'), null, 'deleted library-only references resolve to no pattern');
assert.equal(api.__test.weavingHasAnyPattern(deadLibraryOnlyWeaving), false, 'deleted library-only references do not keep the woven state alive');
assert.equal(api.__test.summarizeWeavingLabel(deadLibraryOnlyWeaving), null, 'deleted library-only references do not produce a misleading pattern label');
const bakedLibrarySnapshot = { layers: { base: { pattern: { motifDataUrl: 'data:image/png;base64,BAKED==' }, patternLibraryId: 'deleted-pattern', patternLabel: 'Diamond' } } }; // Used to model a crafted item after its source library entry has been removed.
assert.equal(api.__test.weavingPatternForRole(bakedLibrarySnapshot, 'base').motifDataUrl, 'data:image/png;base64,BAKED==', 'embedded garment snapshot survives deletion of its source library entry');
assert.equal(api.__test.weavingHasAnyPattern(bakedLibrarySnapshot), true, 'embedded garment snapshot remains visibly woven');
assert.equal(api.__test.summarizeWeavingLabel(bakedLibrarySnapshot), 'Diamond', 'embedded garment snapshot keeps its authored label');
const diamondBasis = api.__test.frameShapeFor('diamond').basis(100, 80); // Used to lock the edge-sharing diamond lattice that prevents uncovered corner gaps.
assert.equal(diamondBasis.u.x, 50);
assert.equal(diamondBasis.u.y, 40);
assert.equal(diamondBasis.v.x, 50);
assert.equal(diamondBasis.v.y, -40);
assert(gear.knownClothingBlueprints.some(bp => bp.baseCosmeticId === 'tankan_tunic'), 'obtaining cloth permanently learns its loom blueprint');

windowStub.ResourceSystem.applyDamage(player, 100, {});
assert(Math.abs(damageSeen - 95.5) < 1e-9, '1.8 units reduce damage by 4.5%');
windowStub.ResourceSystem.spendFooting(player, 100, 'test');
assert(Math.abs(footingSeen - 93.7) < 1e-9, '1.8 units reduce footing loss by 6.3%');
assert(Math.abs(windowStub.Combat.getMovementSpeedMul() - 0.9676) < 1e-9, 'recent combat applies only the weight movement penalty');
assert.equal(api.debugSnapshot().mounted, false, 'stale rideEntity reference alone does not count as mounted');

const banditRoster = {
  equippedCosmetics: ['tankan_bodywrap', 'fine_hood', 'bandolier1'],
  cosmeticSlots: { tankan_bodywrap: 'overwear', fine_hood: 'hood', bandolier1: 'torso' },
}; // Models a real rolled enemy outfit, including the deliberately weightless non-cloth bandolier.
const banditItems = api.outfitItemsFromRoster(banditRoster); // Shared roster conversion used by enemy spawn-time profiling.
assert.equal(api.totalOutfitWeight(banditItems), 6, 'enemy outfit totals use the same 4-unit overwear and 2-unit hood baselines as player gear');
const bandit = { isBandit: true, _usesOutfitWeight: true, outfitWeightUnits: 6, rosterRecord: banditRoster }; // Clothed combat NPC routed through shared armor hooks.
windowStub.ResourceSystem.applyDamage(bandit, 100, {});
assert(Math.abs(damageSeen - 85) < 1e-9, '6-unit enemy outfit reduces direct damage by the shared 15% defense');
windowStub.ResourceSystem.spendFooting(bandit, 100, 'test');
assert(Math.abs(footingSeen - 79) < 1e-9, '6-unit enemy outfit reduces Footing loss by the shared 21% resistance');
assert(Math.abs(api.armorStatsForEntity(bandit).combatMoveMul - 0.892) < 1e-9, 'enemy movement reads the same weight curve');

player.dodging = true;
player.dodgeT = 0.5;
player.invulnUntil = now + 380;
windowStub.Combat.update(0.016);
assert(Math.abs(player.dodgeT - 0.4775) < 1e-9, 'dodge duration/travel efficacy scales from clothing weight');
assert(Math.abs(player.invulnUntil - (now + 362.9)) < 1e-7, 'dodge iframe efficacy scales from clothing weight');

player.dodging = false;
player.lastAttackAttemptAt = -1e9;
player.lastAttackReceivedAt = -1e9;
now = 10000;
assert.equal(windowStub.Combat.getMovementSpeedMul(), 1, 'movement weight has no out-of-combat slowdown');

const source = fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8');
assert.match(source, /PatternLibrary\.listAvailable/, 'loom reuses shared pattern library');
assert.match(source, /PatternAuthoring\?\.openEditor/, 'loom reuses shared pattern authoring workflow');
assert.match(source, /HOOD_C/);
assert.match(source, /TORSO_C/);
assert.match(source, /CLOTH_C/);
assert.match(source, /puktukWool/);
assert.match(source, /lightWool/);
assert.match(source, /offloadCustomMotif:\s*false/, 'loom keeps custom motif pixels inside the crafted garment save');
assert.match(source, /const revision = \+\+previewRevision/, 'loom preview rejects stale async renders');
const patternAuthoringSource = fs.readFileSync('docs/js/pattern-authoring.js', 'utf8'); // Used to verify the generic editor honors weaving's no-offload persistence request.
assert.match(patternAuthoringSource, /options\.offloadCustomMotif === false/, 'pattern editor lets weaving opt out of origin-local motif offload');
const diamondLatticeSource = 'basis: (w, h) => ({ u: { x: w / 2, y: h / 2 }, v: { x: w / 2, y: -h / 2 } })'; // Used to ensure the three duplicated render/editor geometry tables cannot silently drift apart.
assert(patternAuthoringSource.includes(diamondLatticeSource), 'pattern authoring uses the corrected diamond lattice');
const metalRecolorSource = fs.readFileSync('docs/js/tool-metal-recolor.js', 'utf8'); // Used to verify mastered-tool pattern previews/rendering stay geometrically identical to weaving.
assert(metalRecolorSource.includes(diamondLatticeSource), 'metal recolor uses the corrected diamond lattice');
assert(source.includes(diamondLatticeSource), 'weaving uses the corrected diamond lattice');
assert.doesNotMatch(source, /clothingLoomInjected|syncLoomActionButton|targetedLoom/, 'weaving module no longer owns a parallel DOM/polling interaction path');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.match(gameSource, /if \(o\.key === 'loom'\) return makeLoomInteractable\(\)/, 'player-placed house loom is a normal interior furniture interactable');
assert.match(gameSource, /loomFurniture: \(\) => makeLoomInteractable\(\)/, 'map-authored loom uses the same core interactable factory');
assert.match(gameSource, /function makeLoomInteractable\(\)/, 'loom interaction is owned by the core furniture system');
console.log('clothing weaving system tests passed');
