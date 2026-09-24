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
  currentScript: { src: 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/testsha/docs/js/clothing-weaving-system.js?v=test' },
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
const timeoutQueue = []; // Captures window.setTimeout calls so the avatar-refresh retry test can step them deterministically instead of racing real timers.
windowStub.setTimeout = (fn, ms) => { timeoutQueue.push({ fn, ms }); return timeoutQueue.length; };
function flushOneTimeout() {
  const next = timeoutQueue.shift();
  if (next) next.fn();
  return !!next;
}
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
vm.runInContext(fs.readFileSync('docs/js/scene-ready-poller.js', 'utf8'), context, { filename: 'scene-ready-poller.js' });
vm.runInContext(fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8'), context, { filename: 'clothing-weaving-system.js' });

const api = windowStub.ClothingWeavingSystem;
assert(api, 'ClothingWeavingSystem exported');
assert.equal(api.__test.docsRelativeUrl('config/cosmetics/index.json'), 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/testsha/docs/config/cosmetics/index.json', 'standalone tools resolve cosmetic config relative to docs/ instead of their own nested page');
assert.equal(api.__test.standaloneAssetUrl('./assets/cosmetics/clothes/overwear/portrait/poncho1_mao_m.png'), 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/testsha/docs/assets/cosmetics/clothes/overwear/portrait/poncho1_mao_m.png', 'standalone clothing preview preserves authored ./assets sprite paths under docs/');
assert.equal(api.__test.standaloneAssetUrl('cosmetics/clothes/overwear/portrait/poncho1_mao_m.png'), 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/testsha/docs/assets/cosmetics/clothes/overwear/portrait/poncho1_mao_m.png', 'standalone clothing preview reconstructs assets/ after game-path normalization');
assert.equal(api.__test.resolvedPatternMeshScale({ meshScale: 1 }), 0.25, 'normalized Pattern scale 1.00 renders at the former 0.25 mesh scale');
assert.equal(api.__test.resolvedPatternMeshScale({ meshScale: 0.4 }), 0.1, 'normalized lower bound 0.40 renders at the former 0.10 minimum');
assert.equal(api.__test.resolvedPatternMeshScale({ meshScale: 3.2 }), 0.8, 'normalized upper bound 3.20 renders at the former 0.80 maximum');
assert.equal(api.__test.resolvedPatternMeshScale({ meshScale: 0.1 }), 0.1, 'saved values below the normalized range clamp to the physical 0.10 minimum without migration');
assert.equal(api.__test.resolvedPatternMeshScale({ meshScale: 6 }), 0.8, 'saved values above the normalized range clamp to the physical 0.80 maximum without migration');
assert.equal(api.__test.scaledOutlineWidth(1, { motifScale: 0.1, frameScale: 0.1, meshScale: 0.4, usageScaleMultiplier: 0.1 }, 'woven-motif'), 1, 'scaled-down clothing motifs keep the same 1px woven outline');
assert.equal(api.__test.scaledOutlineWidth(1, { motifScale: 3, frameScale: 6, meshScale: 3.2, usageScaleMultiplier: 14 }, 'woven-motif'), 1, 'large usage scaling alone does not thicken clothing outlines');
assert.equal(api.__test.scaledOutlineWidth(1, { motifScale: 0.1, frameScale: 0.1, meshScale: 0.4, usageScaleMultiplier: 7 }, 'animal-surface-pattern'), 6, 'animal surface patterns use a fixed 6-unit outline even when motif geometry is scaled down');
assert.equal(api.__test.scaledOutlineWidth(1, { motifScale: 3, frameScale: 6, meshScale: 3.2, usageScaleMultiplier: 14 }, 'animal-surface-pattern'), 6, 'animal surface patterns keep the same fixed 6-unit outline when motif geometry is scaled up');
const outlineProbeSize = 96; // Used to verify the final raster dilation, not just the width selector.
const outlineProbeGarment = new Uint8Array(outlineProbeSize * outlineProbeSize).fill(1); // Used as an unrestricted patterned surface for the outline geometry probe.
const outlineProbeMotif = new Uint8Array(outlineProbeSize * outlineProbeSize); // Used as a large square motif whose straight edge makes inward/outward thickness measurable.
for (let y = 24; y <= 71; y++) for (let x = 24; x <= 71; x++) outlineProbeMotif[y * outlineProbeSize + x] = 1;
const threeUnitOutline = api.__test.buildPatternOutlineMask(outlineProbeMotif, outlineProbeGarment, outlineProbeSize, outlineProbeSize, 3);
const sixUnitOutline = api.__test.buildPatternOutlineMask(outlineProbeMotif, outlineProbeGarment, outlineProbeSize, outlineProbeSize, 6);
assert.equal(threeUnitOutline[48 * outlineProbeSize + 9], 0, 'the former 3-unit animal outline stops before 15 raster pixels outside a straight motif edge');
assert.equal(sixUnitOutline[48 * outlineProbeSize + 9], 1, 'the 6-unit animal outline reaches 15 raster pixels outside the same edge, confirming the actual raster band doubled');
assert.equal(sixUnitOutline[48 * outlineProbeSize + 8], 0, 'the doubled outline still stops immediately beyond its intended 15-pixel outward half-band');
assert.equal(api.__test.weavingSwapsPatternColorsForRole({ layers: { base: { pattern: {}, swapPatternColors: true }, trim: { pattern: {} } } }, 'base'), true, 'base layer can independently swap cloth and pattern colors');
assert.equal(api.__test.weavingSwapsPatternColorsForRole({ layers: { base: { pattern: {}, swapPatternColors: true }, trim: { pattern: {} } } }, 'trim'), false, 'trim layer keeps its own independent swap state');
assert.equal(api.__test.weavingSwapsPatternColorsForRole({ pattern: {} }, null), false, 'legacy single-pattern saves default to unswapped colors');
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
assert.equal(api.reweaveMaterialCost({ slot: 'hat' }), 1, 'half-cost reweaving keeps the minimum indivisible wool cost at one');
assert.equal(api.reweaveMaterialCost({ slot: 'hood' }), 1, 'hood reweaving costs half of two wool');
assert.equal(api.reweaveMaterialCost({ slot: 'torso' }), 2, 'odd torso half-cost rounds up to an integer wool stack');
assert.equal(api.reweaveMaterialCost({ slot: 'overwear' }), 2, 'overwear reweaving costs half of four wool');
const wovenKeyA = api.__test.wovenIconVisualKey({
  cosmeticId: 'tankan_tunic',
  colorA: { hex: '#aa0000' },
  colorC: { hex: '#ffffff' },
  weaving: { pattern: { meshScale: 1, motifDataUrl: 'data:image/png;base64,AA==' } },
});
const wovenKeyB = api.__test.wovenIconVisualKey({
  cosmeticId: 'tankan_tunic',
  colorA: { hex: '#aa0000' },
  colorC: { hex: '#ffffff' },
  weaving: { pattern: { meshScale: 2, motifDataUrl: 'data:image/png;base64,AA==' } },
});
assert.notEqual(wovenKeyA, wovenKeyB, 'inventory woven-icon cache key changes when the applied pattern changes');
const ten = api.armorStats(10);
assert(Math.abs(ten.damageTakenMul - 0.75) < 1e-12);
assert(Math.abs(ten.footingTakenMul - 0.65) < 1e-12);
assert(Math.abs(ten.dodgeEfficacy - 0.75) < 1e-12);
assert(Math.abs(ten.combatMoveMul - 0.82) < 1e-12);

// requestPlayerAvatarRefresh must retry until equipmentDeps is actually
// installed rather than silently no-op — the player's world avatar is a
// one-shot static bake, so a pattern that finishes building async while
// EquipmentPanel.init() hasn't run yet (character creation / very first
// avatar bake) has no other way back onto the model.
{
  let refreshCalls = 0;
  windowStub.EquipmentPanel.init(null); // Simulates the boot-order race: equipmentDeps not installed yet.
  api.__test.requestPlayerAvatarRefresh();
  assert.equal(timeoutQueue.length, 1, 'not-ready call queues a retry instead of silently giving up');
  assert(flushOneTimeout(), 'first retry fires');
  assert.equal(timeoutQueue.length, 1, 'still not ready: queues another retry');
  assert(flushOneTimeout(), 'second retry fires');
  assert.equal(timeoutQueue.length, 1, 'still not ready after two retries: keeps retrying');
  windowStub.EquipmentPanel.init({ refreshPlayerAvatar() { refreshCalls++; } }); // equipmentDeps becomes available mid-retry.
  assert(flushOneTimeout(), 'third retry fires');
  assert.equal(refreshCalls, 1, 'refresh finally runs once equipmentDeps is installed');
  assert.equal(timeoutQueue.length, 0, 'no further retry is queued once the refresh succeeds');
}

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
const legacyPattern = { motifDataUrl: 'data:image/png;base64,LEGACY==' }; // Keeps pre-layer-save compatibility covered while the main fixture exercises the modern format.
assert.equal(api.__test.weavingPatternForRole({ pattern: legacyPattern }, 'anything'), legacyPattern, 'legacy single-pattern saves still resolve across every layer');
const overpassPattern = { motifDataUrl: 'data:image/png;base64,OVERPASS==' }; // Second-slot fixture verifies the new stack shape without changing legacy primary resolution.
const dualWeaving = { layers: { base: { patterns: [legacyPattern, overpassPattern], patternLabel: 'Knot pair' } } }; // Models the future unlocked save shape the renderer already accepts.
assert.deepEqual(api.__test.weavingPatternsForRole(dualWeaving, 'base'), [legacyPattern, overpassPattern], 'weaving resolves at most the primary + overpass in authored order');
assert.equal(api.__test.weavingPatternForRole(dualWeaving, 'base'), legacyPattern, 'legacy primary-only helper still returns slot 1 from a dual stack');
assert.equal(api.__test.normalizePatternStack([legacyPattern, overpassPattern, { motifDataUrl: 'third' }]).length, 2, 'shared pattern stack hard-caps rendering at two motifs');
const forcedNpcPattern = { motifDataUrl: 'data:image/png;base64,NPC==' };
const giftedWithOwnOverpass = { patterns: [legacyPattern, overpassPattern], forcedOverpassPattern: forcedNpcPattern };
assert.deepEqual(api.__test.weavingPatternsForRole(giftedWithOwnOverpass, 'anything'), [legacyPattern, forcedNpcPattern], 'NPC forced overpass preserves gifted slot 1 and replaces only gifted slot 2');
assert.deepEqual(api.__test.weavingPatternsForRole({ layers: {}, forcedOverpassPattern: forcedNpcPattern }, 'poncho'), [forcedNpcPattern], 'forced NPC pattern can render on otherwise-unpatterned default clothing');
assert.equal(api.__test.weavingHasAnyPattern({ layers: {}, forcedOverpassPattern: forcedNpcPattern }), true, 'forced NPC overpass makes default clothing pattern-renderable without inventing permanent layer data');
const scopedGiftWeaving = {
  patterns: [legacyPattern, overpassPattern],
  forcedOverpassPattern: forcedNpcPattern,
  forcedOverpassRoles: ['poncho'],
};
assert.deepEqual(api.__test.weavingPatternsForRole(scopedGiftWeaving, 'poncho'), [legacyPattern, forcedNpcPattern], 'poncho-scoped NPC emblem preserves gifted slot 1 and replaces slot 2 on the poncho sprite');
assert.deepEqual(api.__test.weavingPatternsForRole(scopedGiftWeaving, 'wrap'), [legacyPattern, overpassPattern], 'poncho-scoped NPC emblem leaves the shoulder-wrap sprite original primary/overpass stack untouched');
assert.deepEqual(api.__test.weavingPatternsForRole({ forcedOverpassPattern: forcedNpcPattern, forcedOverpassRoles: ['poncho'] }, 'poncho'), [forcedNpcPattern], 'poncho-scoped emblem can render on an otherwise-unpatterned default poncho layer');
assert.deepEqual(api.__test.weavingPatternsForRole({ forcedOverpassPattern: forcedNpcPattern, forcedOverpassRoles: ['poncho'] }, 'wrap'), [], 'poncho-scoped emblem does not spill onto the rugged poncho wrap layer');
const npcAvatarData = api.decorateAvatarDataWithWovenItems({
  equippedCosmetics: ['rugged_poncho'],
  appearance: { bodyColors: { A: { h: 0 } } },
}, [{
  cosmeticId: 'rugged_poncho',
  slot: 'overwear',
  colorA: 'dye:CLOTH:test_primary',
  colorC: 'dye:CLOTH:test_pattern',
  weaving: { forcedOverpassPattern: forcedNpcPattern },
}]);
assert.equal(npcAvatarData.appearance.bodyColors.CLOTH_C.dyeId, 'dye:CLOTH:test_pattern', 'NPC string dye ids normalize through the same third pattern-color slot as player woven gear');
assert.equal(npcAvatarData.appearance.bodyColors.__hobunjiWovenClothing[0].colorA.dyeId, 'dye:CLOTH:test_primary', 'NPC default dye strings normalize for woven portrait color swapping');
assert.equal(npcAvatarData.appearance.bodyColors.__hobunjiWovenClothing[0].weaving.forcedOverpassPattern.motifDataUrl, forcedNpcPattern.motifDataUrl, 'NPC forced-overpass policy reaches the same portrait marker consumed by the shared renderer');
windowStub.PatternLibrary.getById = id => id === 'live-pattern' ? { motifDataUrl: 'data:image/png;base64,MIGRATED==' } : null;
const referenceOnlyItem = { weaving: { layers: { base: { patternLibraryId: 'live-pattern', patternLabel: 'Saved' } } } }; // Models a garment made by the short-lived reference-only implementation.
assert.equal(api.__test.materializeWeavingLibrarySnapshots(referenceOnlyItem), true, 'reference-only garment is upgraded while its source library entry still exists');
assert.equal(referenceOnlyItem.weaving.layers.base.pattern.motifDataUrl, 'data:image/png;base64,MIGRATED==', 'migration embeds the resolved source motif on the garment');
assert.equal(api.__test.materializeWeavingLibrarySnapshots(referenceOnlyItem), false, 'already snapshotted garment is not rewritten repeatedly');
windowStub.PatternLibrary.getById = () => null;
const deadLibraryOnlyWeaving = { layers: { base: { patternLibraryId: 'deleted-pattern', patternLabel: 'Deleted' } } };
assert.equal(api.__test.weavingPatternForRole(deadLibraryOnlyWeaving, 'base'), null, 'deleted library-only references resolve to no pattern');
assert.equal(api.__test.weavingHasAnyPattern(deadLibraryOnlyWeaving), false, 'deleted library-only references do not keep the woven state alive');
assert.equal(api.__test.summarizeWeavingLabel(deadLibraryOnlyWeaving), null, 'deleted library-only references do not produce a misleading pattern label');
const bakedLibrarySnapshot = { layers: { base: { pattern: { motifDataUrl: 'data:image/png;base64,BAKED==' }, patternLibraryId: 'deleted-pattern', patternLabel: 'Diamond' } } };
assert.equal(api.__test.weavingPatternForRole(bakedLibrarySnapshot, 'base').motifDataUrl, 'data:image/png;base64,BAKED==', 'embedded garment snapshot survives deletion of its source library entry');
assert.equal(api.__test.weavingHasAnyPattern(bakedLibrarySnapshot), true, 'embedded garment snapshot remains visibly woven');
assert.equal(api.__test.summarizeWeavingLabel(bakedLibrarySnapshot), 'Diamond', 'embedded garment snapshot keeps its authored label');
const diamondBasis = api.__test.frameShapeFor('diamond').basis(100, 80); // Locks the edge-sharing lattice that prevents uncovered corner gaps.
assert.deepEqual(diamondBasis, { u: { x: 50, y: 40 }, v: { x: 50, y: -40 } });
assert(gear.knownClothingBlueprints.some(bp => bp.baseCosmeticId === 'tankan_tunic'), 'obtaining cloth permanently learns its loom blueprint');
assert.equal(api.hasWovenPattern(lightTunic), true, 'woven item exposes its precomposited-icon status to EquipmentPanel');

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
const portraitSource = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Verifies woven portrait state is injected per render rather than shared across WorldPortraitLife's overlapping async NPC refreshes.
const colorFillSource = fs.readFileSync('docs/js/color-fill.js', 'utf8'); // Canonical source-art shading/value-fill math shared across rendered game assets.
const spriteRecolorSource = fs.readFileSync('docs/js/sprite-recolor.js', 'utf8'); // Compatibility wrapper used by authored item sprites and existing callers.
const creatureRendererSource = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'); // Verifies animal tinting uses the same canonical fill owner.
const pixelProbeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Keeps mobile-visible diagnostics wired to the shared fill module.
const patternAuthorSource = fs.readFileSync('docs/js/pattern-authoring.js', 'utf8'); // Used below to lock the normalized shared Pattern scale authoring range.
const metalPatternSource = fs.readFileSync('docs/js/tool-metal-recolor.js', 'utf8'); // Used below to prevent weaving-only scale normalization from shrinking existing verdigris patterns.
const equipmentPanelSource = fs.readFileSync('docs/js/equipment-panel.js', 'utf8'); // Guards the inventory icon handoff so woven composites are not tinted a second time.
const inventoryUiSource = fs.readFileSync('docs/js/inventory-ui.js', 'utf8'); // Guards the one-shot async Pack icon refresh path; no per-frame pattern compositing.
assert.doesNotMatch(source, /activePortraitPatternMap/, 'woven portraits no longer share one mutable descriptor map across overlapping async renders');
assert.doesNotMatch(source, /window\._imageForTint\s*=\s*function\s+clothingPatternImageForTint/, 'weaving no longer replaces the global tint resolver with render-scoped mutable state');
assert.match(source, /const patternMap = Array\.isArray\(descriptors\)[\s\S]*?buildPortraitPatternMap\(descriptors\)/, 'each woven portrait render builds its own descriptor map');
assert.match(source, /patternImageForTint\(patternMap, baseTintResolver, img, sourceKey, tint\)/, 'the woven tint resolver closes over that render-local descriptor map');
assert.match(portraitSource, /renderOptions\?\.imageForTint[\s\S]*?: _imageForTint/, 'portrait rendering accepts a per-render tint resolver with the canonical tint path as fallback');
assert.match(portraitSource, /drawPortraitLayerWarped\(ctx, img, resolveXform\(layer\)[\s\S]*?layer\.url, imageForTint\)/, 'breathing overwear layers use the same render-local tint resolver during WorldPortraitLife refreshes');

const colorFillWindow = { SCRATCHBONES_CONFIG: { game: { portrait: { tinting: {} } } } }; // Isolated runtime used to prove sample-mask and paint-mask shading behavior.
const colorFillContext = vm.createContext({ window: colorFillWindow, console });
vm.runInContext(colorFillSource, colorFillContext, { filename: 'color-fill.js' });
const shadowSource = new Uint8ClampedArray([
  14, 12, 10, 255,   // 30%-black shadow of the near-black flat cel below (max value 14 = 70% of 20).
  20, 17, 14, 255,   // Near-black authored flat cel; this must become the requested color exactly.
  255, 255, 255, 255, // Small white/light detail: must NOT become the shading reference.
]);
const shadowProbe = new Uint8ClampedArray(shadowSource);
colorFillWindow.ColorFill.shadeFillPixels(shadowProbe, [240, 220, 180], {
  sourceData: shadowSource,
  debugLabel: 'woven-motif',
  samplePredicate: () => true,
  applyPredicate: i => i === 0,
});
assert.deepEqual(Array.from(shadowProbe.slice(0, 3)), [169, 155, 127],
  'authored near-30%-black shadow preserves its perceptual luminance relationship to the requested color');
assert.deepEqual(Array.from(shadowProbe.slice(4, 12)), [20, 17, 14, 255, 255, 255, 255, 255],
  'shade-map inheritance paints only motif-selected pixels while sampling the whole source region');
const fillDebug = colorFillWindow.ColorFill.debugSnapshot().lastShadeFill;
assert.equal(fillDebug.sampledCount, 2, 'shared shade fill excludes white details from its source reference');
assert.equal(fillDebug.appliedCount, 1, 'shared shade fill paints only the motif mask');
assert.equal(fillDebug.separateSampleMask, true, 'diagnostics expose separate sample and application masks');
assert.equal(fillDebug.externalSource, true, 'diagnostics prove woven fill sampled the original untinted source raster');
assert.equal(fillDebug.baseValue, Number((((0.2126 * 20 + 0.7152 * 17 + 0.0722 * 14) / 255)).toFixed(4)),
  'white outlier does not hijack the near-black brightest-eligible luminance reference');
assert.equal(fillDebug.peak, fillDebug.baseValue,
  'Pixel Probe peak diagnostics report the same normalization anchor used by the fill');
const wovenDebug = colorFillWindow.ColorFill.debugSnapshot().shadeFillsByLabel['woven-motif'];
assert.equal(wovenDebug.sequence, fillDebug.sequence, 'named woven diagnostic retains the exact motif pass for Pixel Probe');
assert.equal(wovenDebug.appliedCount, 1, 'named woven diagnostic keeps motif-only paint count');

const mapProbe = new Uint8ClampedArray(shadowSource);
colorFillWindow.ColorFill.shadeFillPixels(mapProbe, [240, 220, 180], {
  sourceData: shadowSource,
  samplePredicate: () => true,
  applyPredicate: i => i < 8,
});
assert.deepEqual(Array.from(mapProbe.slice(0, 8)), [
  169, 155, 127, 255,
  240, 220, 180, 255,
], 'peak-anchored target fill preserves the authored perceptual shadow relationship');
const whiteDetailProbe = new Uint8ClampedArray([
  14, 12, 10, 255, 20, 17, 14, 255,
  255, 255, 255, 255, 248, 248, 248, 255, 250, 246, 220, 255,
]); // Verifies white details stay out of a dark fur reference while pale cream remains eligible.
const whiteReference = colorFillWindow.ColorFill.createShadeReference(whiteDetailProbe);
assert.equal(whiteReference.count, 3, 'white and near-white neutral details are excluded, while pale cream is retained');
colorFillWindow.ColorFill.shadeFillPixels(whiteDetailProbe, [240, 220, 180]);
assert.deepEqual(Array.from(whiteDetailProbe.slice(8, 16)), [255, 255, 255, 255, 248, 248, 248, 255],
  'authored white details remain unchanged by the shared fill');
const nuancedSource = new Uint8ClampedArray([
  8, 7, 6, 255,
  12, 10, 9, 255,
  16, 14, 12, 255,
  20, 17, 14, 255,
]);
const nuancedProbe = new Uint8ClampedArray(nuancedSource);
colorFillWindow.ColorFill.shadeFillPixels(nuancedProbe, [240, 220, 180]);
assert.deepEqual(Array.from(nuancedProbe), [
  98, 90, 74, 255,
  143, 131, 107, 255,
  197, 180, 148, 255,
  240, 220, 180, 255,
], 'body/animal recolors preserve all authored intermediate perceptual shades instead of flattening values above an inferred shadow cluster');
const grehlrDarkSource = new Uint8ClampedArray([
  8, 10, 12, 255,
  12, 15, 18, 255,
  16, 20, 24, 255,
  20, 25, 30, 255,
]);
const grehlrDarkProbe = new Uint8ClampedArray(grehlrDarkSource);
colorFillWindow.ColorFill.shadeFillPixels(grehlrDarkProbe, [79, 117, 125]);
assert.deepEqual(Array.from(grehlrDarkProbe), [
  32, 47, 50, 255,
  47, 70, 75, 255,
  63, 94, 100, 255,
  79, 117, 125, 255,
], 'dark blue-gray Grehlr-style source shading preserves the authored target hue and perceptual shade spacing');
assert.match(colorFillSource, /return relativeLuminance\(r, g, b\)/,
  'shared shade reference measures perceptual luminance rather than HSV max-channel value');
assert.match(colorFillSource, /peakValue = Math\.max\(peakValue, sourceValue/,
  'shared ColorFill derives its normalization anchor from the brightest eligible authored pixel');
assert.doesNotMatch(colorFillSource, /AUTHORED_SHADOW_VALUE_RATIO|histogramMass|bestScore/,
  'shared ColorFill no longer assumes a fixed flat-cel plus 30%-black-shadow palette');
assert.match(colorFillSource, /value \/ baseValue/,
  'final tint preserves source value proportion relative to the brightest eligible authored pixel');
assert.match(source, /shadingSource = null, debugLabel = 'woven-motif'/,
  'shared motif compositor accepts a caller-specific diagnostic label without changing its rendering inputs');
assert.match(colorFillSource, /function createShadeReference\(sourceData, predicate = null, options = \{\}\)/,
  'shared ColorFill owns the peak-derived shading reference');
assert.match(colorFillSource, /isAuthoredWhite\(sourceData\[i\], sourceData\[i \+ 1\], sourceData\[i \+ 2\]\)/,
  'shared fill excludes white details from source reference and recoloring');
assert.match(spriteRecolorSource, /colorFillApi\(\)\.shadeFillPixels\(data, targetRgb, predicateOrOptions\)/,
  'SpriteRecolor compatibility path delegates direct fills to ColorFill');
assert.match(creatureRendererSource, /window\.ColorFill\?\.shadeFillPixels/,
  'animals use the same ColorFill shade-fill implementation as weaving');
assert.match(metalPatternSource, /colorFillApi\(\)\.hsvValueFillPixels/,
  'tool metal and verdigris value-preserving fills use the same ColorFill module');
assert.match(source, /sourceData: shadeSourceData,[\s\S]*?debugLabel,[\s\S]*?samplePredicate:[\s\S]*?garmentMask[\s\S]*?applyPredicate:/,
  'woven motif color samples the whole authored cloth/body region separately from the motif paint mask');
assert.match(source, /applyPatternStackToTintedImage\(tinted, patterns, colorHex, prefix, img, 'woven-motif'\)/,
  'runtime woven portrait composition passes both optional pattern slots plus the original authored raster and clothing-only diagnostic label');
assert.match(source, /overpassOutlineWidth \* clearanceMultiplier/,
  'shared compositor punches the primary with the authored overpass clearance multiplier');
assert.equal(api.__test.overpassClearanceMultiplier({}), 3, 'missing overpass gap preserves the previous 3× behavior');
assert.equal(api.__test.overpassClearanceMultiplier({ overpassClearanceMultiplier: 2 }), 3, 'overpass gap cannot go below the previous 3× behavior');
assert.equal(api.__test.overpassClearanceMultiplier({ overpassClearanceMultiplier: 12 }), 12, 'overpass gap can reach four times the previous mask width');
assert.equal(api.__test.overpassClearanceMultiplier({ overpassClearanceMultiplier: 99 }), 12, 'overpass gap clamps at 12×');
assert.match(source, /async function applyPatternToTintedImage[\s\S]*?applyPatternStackToTintedImage\(imageOrCanvas, \[pattern\]/,
  'legacy single-pattern compositor API delegates to the new stack renderer');
assert.match(creatureRendererSource, /applyPatternStackToTintedImage/,
  'Color Pools animal painting uses the same dual-pattern stack compositor');
assert.match(metalPatternSource, /overpassOutlineWidth \* clearanceMultiplier/,
  'verdigris applies the same authored overpass clearance before its black outline pass');
assert.match(metalPatternSource, /OVERPASS_CLEARANCE_MIN = 3/, 'verdigris defaults legacy overpasses to the prior 3× gap');
assert.match(metalPatternSource, /OVERPASS_CLEARANCE_MAX = 12/, 'verdigris permits the authored maximum at four times the prior mask width');
assert.match(metalPatternSource, /function overpassClearanceMultiplier\(pattern\)/, 'verdigris clamps the same per-pattern overpass setting before rasterizing the gap');
assert.match(metalPatternSource, /normalizeAuthoredPatterns/,
  'verdigris accepts a legacy authoredPattern or a future two-slot authoredPatterns array through one normalization seam');
assert.match(pixelProbeSource, /Color fill: \$\{shadeText\}; \$\{hsvText\}/,
  'Pixel Probe exposes shared color-fill source/sample diagnostics on mobile');
assert.match(source, /PatternLibrary\.listAvailable/, 'loom reuses shared pattern library');
assert.match(source, /PatternAuthoring\?\.openEditor/, 'loom reuses shared pattern authoring workflow');
assert.match(source, /HOOD_C/);
assert.match(source, /TORSO_C/);
assert.match(source, /CLOTH_C/);
assert.match(source, /puktukWool/);
assert.match(source, /lightWool/);
assert.match(source, /offloadCustomMotif:\s*false/, 'loom keeps custom motif pixels inside the literal garment save');
assert.match(source, /previewRevision/, 'loom preview has a revision guard for stale asynchronous renders');
assert.match(source, /pattern: clone\(pattern\),[\s\S]*patternLibraryId: entry\.patternId/, 'library-backed garments retain provenance while embedding their own pattern snapshot');
assert.match(patternAuthorSource, /options\.offloadCustomMotif === false/, 'shared pattern authoring lets weaving opt out of auxiliary motif storage');
const diamondLatticeSource = 'basis: (w, h) => ({ u: { x: w / 2, y: h / 2 }, v: { x: w / 2, y: -h / 2 } })';
assert(source.includes(diamondLatticeSource), 'weaving uses the edge-sharing diamond lattice');
assert(patternAuthorSource.includes(diamondLatticeSource), 'pattern authoring uses the same diamond lattice');
assert(metalPatternSource.includes(diamondLatticeSource), 'metal pattern rendering uses the same diamond lattice');
assert.match(source, /wovenIconDataUrlPromises/, 'woven inventory icons use a visual-state cache instead of recompositing during UI refreshes');
assert.match(source, /renderClothingLayers\(id, \{/, 'woven icon cache is populated by the same per-layer dye + pattern renderer as the loom preview');
assert.match(source, /function reweaveFromLoom\(/, 'loom mutates a selected Gear garment through the dedicated reweave path');
assert.match(source, /Math\.ceil\(fullCost \/ 2\)/, 'reweaving charges half the authored craft cost while keeping integer wool stacks');
assert.match(source, /Reweave —/, 'loom operation selector exposes permanent Gear garments as reweave targets');
assert.match(equipmentPanelSource, /compositeIncludesFinalDyes = !!window\.ClothingWeavingSystem\?\.hasWovenPattern\?\.\(item\)/, 'EquipmentPanel recognizes woven composites as already fully dyed');
assert.match(equipmentPanelSource, /if \(!compositeIncludesFinalDyes\) tintClothingIcon/, 'woven icon pixels are not washed out by the legacy single-color tint pass');
assert.match(inventoryUiSource, /attributeFilter:\['src'\]/, 'Pack inventory observes the async icon src completion once instead of polling or compositing every frame');
assert.match(source, /Swap \$\{role \? layerLabel\(role\)\.toLowerCase\(\) : 'cloth'\} ↔ pattern colors/, 'loom exposes the per-layer color swap outside PatternAuthoring');
assert.match(source, /swapPatternColors/, 'garment weaving save data carries the per-layer swap flag separately from the pattern definition');
assert.match(patternAuthorSource, /const PATTERN_SCALE_MIN = 0\.4;/, 'shared Pattern scale authoring minimum is normalized from the former 0.10');
assert.match(patternAuthorSource, /const PATTERN_SCALE_MAX = 3\.2;/, 'shared Pattern scale authoring maximum is normalized from the former 0.80');
assert.match(patternAuthorSource, /meshScale: clamp\(Number\(cfg\.meshScale\) \|\| 1, PATTERN_SCALE_MIN, PATTERN_SCALE_MAX\)/, 'saved Pattern scale remains the normalized value and clamps only at authoring bounds');
assert.doesNotMatch(metalPatternSource, /PATTERN_SCALE_REFERENCE/, 'verdigris does not inherit weaving-only normalized mesh scaling');
assert.match(metalPatternSource, /const meshScale = Math\.max\(0\.05, Number\(patternDef\.meshScale\) \|\| 1\);/, 'verdigris keeps the pre-weaving raw physical mesh scale so existing tool patterns retain their visual size');
assert.match(metalPatternSource, /function scaledOutlineWidthForPattern\(defaultWidth, _rawPatternDef\)[\s\S]*return Math\.max\(1, Math\.round\(Number\(defaultWidth\) \|\| 0\)\);/, 'verdigris authored-pattern outline width stays fixed regardless of motif, frame, or mesh scale');
assert.doesNotMatch(source, /clothingLoomInjected|syncLoomActionButton|targetedLoom/, 'weaving module no longer owns a parallel DOM/polling interaction path');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.match(gameSource, /if \(o\.key === 'loom'\) return makeLoomInteractable\(\)/, 'player-placed house loom is a normal interior furniture interactable');
assert.match(gameSource, /loomFurniture: \(\) => makeLoomInteractable\(\)/, 'map-authored loom uses the same core interactable factory');
assert.match(gameSource, /function makeLoomInteractable\(\)/, 'loom interaction is owned by the core furniture system');
console.log('clothing weaving system tests passed');

assert.match(creatureRendererSource, /'gar-wolf':[\s\S]*?baseShadeReferenceHex: '#565047'/,
  'Gar-wolf base recolor uses its authored #565047 full-strength coat anchor');
assert.match(creatureRendererSource, /'dabinggi-hound':[\s\S]*?baseShadeReferenceHex: '#585E5D'/,
  'Dabingi-hound base recolor uses its authored #585E5D full-strength coat anchor');
assert.match(creatureRendererSource, /grehlr:[\s\S]*?baseShadeReferenceHex: '#424242'/,
  'Grehlr base recolor uses its authored #424242 full-strength coat anchor');
assert.match(creatureRendererSource, /recoloredBase\(baseUrl, baseColor, mask, fullBaseRecolor, spec\.baseShadeReferenceHex \|\| null, kind\)/,
  'runtime base recolor passes the species-authored anchor instead of rediscovering a peak from sprite pixels');
assert.match(creatureRendererSource, /shadeReference = \{[\s\S]*?baseValue: referenceValue,[\s\S]*?peakLuminance: referenceValue,[\s\S]*?referenceHex: sourceReferenceHex\.toUpperCase\(\)/,
  'fixed creature coat references override only the normalization anchor while keeping shared shade-fill math');

assert.match(creatureRendererSource, /drenkirra:[\s\S]*?baseShadeReferenceHex: '#68D127'/,
  'Drenkirra base recolor uses its authored #68D127 full-strength coat anchor');
assert.match(creatureRendererSource, /spec\.baseShadeReferenceHex \|\| null/,
  'species without an authored coat anchor keep the existing automatic peak-based fallback path');
