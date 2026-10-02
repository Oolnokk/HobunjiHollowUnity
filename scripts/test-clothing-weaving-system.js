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
let gear = {
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
const documentListeners = new Map();
const documentStub = {
  currentScript: { src: 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/testsha/docs/js/clothing-weaving-system.js?v=test' },
  documentElement: { dataset: {} },
  body: { appendChild() {}, dataset: {} },
  head: { appendChild() {} },
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(listener);
  },
  dispatchEvent(event) {
    for (const listener of documentListeners.get(event?.type) || []) listener(event);
  },
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
  ensureGearClothingCollection() {
    gear.clothingItems ||= [];
    for (const slot of ['hat', 'hood', 'torso', 'overwear']) {
      const worn = gear.clothing?.[slot];
      if (!worn) continue;
      const canonical = gear.clothingItems.find(item =>
        item && ((worn.uid && item.uid === worn.uid) || (!worn.uid && worn.cosmeticId && item.cosmeticId === worn.cosmeticId))
      );
      if (canonical) gear.clothing[slot] = canonical;
    }
    return gear.clothingItems;
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
  __hobunjiGameStarted: false,
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
const timeoutQueue = [];
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
assert.equal(api.__test.scaledOutlineWidth(1, { motifScale: 0.1, frameScale: 0.1, meshScale: 0.4, usageScaleMultiplier: 0.1 }, 'woven-motif', 831, 523), 1, 'scaled-down clothing motifs keep the same 1px woven outline regardless of source image dimensions');
assert.equal(api.__test.scaledOutlineWidth(1, { motifScale: 3, frameScale: 6, meshScale: 3.2, usageScaleMultiplier: 14 }, 'woven-motif', 3000, 2250), 1, 'large usage scaling alone does not thicken clothing outlines');
assert.equal(api.__test.scaledOutlineWidth(1, { motifScale: 0.1, frameScale: 0.1, meshScale: 0.4, usageScaleMultiplier: 7 }, 'animal-surface-pattern', 3000, 2250), 6, 'Grehlr-sized animal art preserves the current 6-unit Color Pools outline');
const drenkirraOutlineWidth = api.__test.scaledOutlineWidth(1, { motifScale: 3, frameScale: 6, meshScale: 3.2, usageScaleMultiplier: 14 }, 'animal-surface-pattern', 831, 523); // Used to verify Drenkirra inherits Grehlr's visual line-weight ratio instead of Grehlr's raw pixel width.
assert.ok(Math.abs(drenkirraOutlineWidth - (6 * 523 / 2250)) < 1e-12, 'Drenkirra animal outline scales from its 523px short side instead of staying fixed at 6 units');
assert.equal(api.__test.scaledOutlineWidth(1, {}, 'animal-surface-pattern'), 6, 'animal surface paint keeps the existing 6-unit fallback when a caller cannot provide source dimensions');
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
assert.equal(api.__test.weavingHasOptionalTrim({ trim: { enabled: true, dyeSlot: 'C' } }), true, 'trim metadata is recognized without fabricating a reusable pattern');
assert.equal(api.__test.weavingHasAnyDecoration({ trim: { enabled: true, dyeSlot: 'A' } }), true, 'trim-only garments enter the shared decorated render/save path');
assert.equal(api.hasWovenPattern({ weaving: { trim: { enabled: true, dyeSlot: 'B' } } }), true, 'trim-only inventory icons are treated as fully composited so legacy tinting cannot wash them out');
assert.equal(api.__test.normalizeTrimDyeSlot('a'), 'A', 'added trim can explicitly reuse dye A');
assert.equal(api.__test.normalizeTrimDyeSlot('C'), 'C', 'added trim can explicitly reuse dye C');
assert.equal(api.__test.normalizeTrimDyeSlot('invalid'), 'B', 'invalid/missing trim dye metadata safely falls back to dye B');
const authoredTrimProbe = api.__test.authoredTrimPatternFromManifest({ garments: { tankan_tunic: { variants: { 'mao-ao_male': { front: { motifPng: 'assets/patterns/clothing-trims/probe.png', settings: { tiling: true, meshScale: 1.25 } } } } } } }, 'tankan_tunic', 'mao-ao_male', 'front');
assert.equal(authoredTrimProbe.tiling, false, 'garment trim manifest records are forced non-tiling even if a hand-edited setting says otherwise');
assert.equal(authoredTrimProbe.meshScale, 1.25, 'garment trim keeps the normal authored placement/scale settings');
assert(authoredTrimProbe.motifUrl.endsWith('/docs/assets/patterns/clothing-trims/probe.png'), 'garment trim motif path resolves from the docs asset root');
const authoredTrimBehindFallback = api.__test.authoredTrimPatternFromManifest({ garments: { tankan_tunic: { variants: { 'mao-ao_male': { front: { motifPng: 'assets/patterns/clothing-trims/probe.png', settings: {} } } } } } }, 'tankan_tunic', 'mao-ao_male', 'behind');
assert.equal(authoredTrimBehindFallback.__garmentTrimView, 'front', 'rear rendering can intentionally reuse a variant front trim when no separate rear mask is authored');
const raggedHoodConfig = JSON.parse(fs.readFileSync('docs/config/cosmetics/ragged_hood.json', 'utf8')); // Real garment fixture verifies its authored front/back rasters remain one logical base cloth role.
const raggedHoodLayers = api.__test.resolveIconLayerUrls(raggedHoodConfig, 'mao-ao', 'male'); // Resolves the same species-specific layer descriptors consumed by loom and inventory previews.
assert.deepEqual(Array.from(api.__test.patternRolesForLayers(raggedHoodLayers), entry => [entry.role, entry.key]), [['base', 'base']], 'Ragged Hood front/back sprites expose one shared Base pattern control');
assert.equal(api.__test.layersUseSecondaryDye(raggedHoodLayers), false, 'Ragged Hood has no palette-B trim dye despite occupying the hood slot');
assert.deepEqual(Array.from(api.__test.iconLayersForView(raggedHoodLayers, 'front'), layer => layer.layerName), ['front'], 'Ragged Hood inventory/front preview excludes its authored rear sprite');
assert.deepEqual(Array.from(api.__test.iconLayersForView(raggedHoodLayers, 'behind'), layer => layer.layerName), ['back'], 'Ragged Hood behind preview uses its authored rear sprite by itself');
const fineHoodConfig = JSON.parse(fs.readFileSync('docs/config/cosmetics/fine_hood.json', 'utf8')); // Control fixture keeps the genuine base-plus-trim hood behavior.
const fineHoodLayers = api.__test.resolveIconLayerUrls(fineHoodConfig, 'mao-ao', 'male'); // Used to ensure the Ragged Hood fix does not collapse actual trim roles.
assert.deepEqual(Array.from(api.__test.patternRolesForLayers(fineHoodLayers), entry => entry.role), ['base', 'trim'], 'Fine Hood still exposes independent Base and Trim pattern roles');
assert.equal(api.__test.layersUseSecondaryDye(fineHoodLayers), true, 'Fine Hood still exposes its authored palette-B Trim dye');
const anuriPonchoConfig = JSON.parse(fs.readFileSync('docs/config/cosmetics/anuri_poncho.json', 'utf8')); // Non-hood control protects positional back/front sandwich layers from hood-facing semantics.
const anuriPonchoLayers = api.__test.resolveIconLayerUrls(anuriPonchoConfig, 'mao-ao', 'male'); // Falls back to the cosmetic's shared parts tree just like runtime resolution.
assert.equal(api.__test.iconLayersForView(anuriPonchoLayers, 'front').length, anuriPonchoLayers.length, 'non-hood back/front layers remain composited together instead of becoming alternate facing views');
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

let playerAvatarRefreshCalls = 0;
const equipmentDeps = {
  getGearInventory: () => gear,
  getPackClothing: () => packClothing,
  saveGearInventory() {},
  inventory: { lightWool: 10, puktukWool: 10 },
  refreshPlayerAvatar() { playerAvatarRefreshCalls++; },
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
        patternLibraryId: 'startup-pattern',
        patternLabel: 'Custom',
      },
    },
  },
};
const loadedGear = JSON.parse(JSON.stringify(gear));
loadedGear.clothingItems.push(lightTunic);
loadedGear.clothing.torso = JSON.parse(JSON.stringify(lightTunic)); // Real JSON save round-trip: worn and owned records are equal data but no longer the same object reference.
// Returning-session regression: EquipmentPanel.init captured a getter while Gear
// still pointed at its placeholder object. The player-ready event carries the
// selected save, game.js swaps the live Gear object synchronously, then its first
// real gear->profile pass can still be delayed by async portrait-cosmetic setup.
// The corrective rebuild must wait for that initial pass instead of merely one task.
windowStub.PatternLibrary.getById = id => id === 'startup-pattern'
  ? { motifDataUrl: 'data:image/png;base64,AA==' }
  : null;
const sessionBefore = api.debugSnapshot().portraitPatterns;
documentStub.dispatchEvent({ type: 'hobunjiPlayerReady', detail: { gearInventory: loadedGear } });
assert.equal(api.debugSnapshot().portraitPatterns.sessionReadyEvents, sessionBefore.sessionReadyEvents + 1, 'returning woven save is detected at the actual player-ready lifecycle boundary');
assert.equal(timeoutQueue.length, 1, 'woven returning save schedules the first post-player-ready readiness probe');
gear = loadedGear; // Models spawnPlayerAvatar replacing the placeholder Gear object before its first await.
assert(flushOneTimeout(), 'first post-player-ready readiness probe runs');
assert.equal(playerAvatarRefreshCalls, 0, 'corrective refresh does not run before the initial player portrait has consumed loaded Gear');
assert.equal(timeoutQueue.length, 1, 'early probe retries while the initial gear->profile pass is still pending');
const prepareBefore = api.debugSnapshot().portraitPatterns.gearPreparePasses;
const applied = windowStub.EquipmentPanel.applyGearClothingToPlayerData({ equippedCosmetics: [], appearance: { bodyColors: {} } }); // Models the delayed initial player portrait pass.
assert.equal(playerAvatarRefreshCalls, 0, 'initial portrait-data preparation itself does not trigger the extra corrective rebuild');
assert(flushOneTimeout(), 'retry probes again after the initial portrait-data pass');
assert.equal(playerAvatarRefreshCalls, 0, 'corrective rebuild still waits while spawnPlayerAvatar startup is unfinished');
assert.equal(timeoutQueue.length, 1, 'unfinished game startup keeps exactly one bounded retry queued');
windowStub.__hobunjiGameStarted = true;
assert(flushOneTimeout(), 'post-startup retry runs once the game has actually started');
assert.equal(playerAvatarRefreshCalls, 1, 'returning woven save performs exactly one rebuild after startup, matching manual re-equip timing');
assert.equal(timeoutQueue.length, 0, 'successful post-startup rebuild leaves no stale retry queued');
assert.equal(api.debugSnapshot().portraitPatterns.sessionRefreshes, sessionBefore.sessionRefreshes + 1, 'mobile-visible debug records the automatic returning-session rebuild');
assert.equal(api.debugSnapshot().portraitPatterns.gearPreparePasses, prepareBefore + 1, 'first returning-save portrait request prepares the newly loaded Gear object');
assert.strictEqual(gear.clothing.torso, lightTunic, 'cold-load portrait preparation reconnects the equipped slot to the canonical owned garment just like manual re-equip');
assert.equal(lightTunic.weaving.layers.__default.pattern.motifDataUrl, 'data:image/png;base64,AA==', 'owned returning-save record materializes a library-backed weave before rendering');
assert.equal(gear.clothing.torso.weaving.layers.__default.pattern.motifDataUrl, 'data:image/png;base64,AA==', 'detached worn save record is also hydrated before the first portrait render');
assert(applied.equippedCosmetics.includes('tankan_tunic'), 'crafted cosmetic translates back to authored base for rendering');
assert(!applied.equippedCosmetics.includes(lightTunic.cosmeticId), 'unique crafted id never leaks into portrait cosmetic lookup');
assert.equal(applied.appearance.bodyColors.TORSO_C.dyeId, 'starter-red', 'woven color uses the third torso dye slot');
assert.equal(applied.appearance.bodyColors.__hobunjiWovenClothing[0].baseCosmeticId, 'tankan_tunic', 'pattern descriptor follows avatar render data only');
assert.equal(api.__test.weavingPatternForRole(lightTunic.weaving, null).motifDataUrl, 'data:image/png;base64,AA==', 'modern per-layer weaving resolves the default layer');
windowStub.EquipmentPanel.buildEquipmentSlots(); // UI may build afterward, but it is no longer a prerequisite for the first woven portrait.
windowStub.PatternLibrary.getById = () => null;
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

const compatibilityRuntimeRegression = (async () => {
  const repairBefore = api.debugSnapshot().portraitPatterns.hookRepairs;
  windowStub.renderPortraitProfile = async () => true; // Simulates a later runtime wrapper replacing the initially woven global between load and first avatar bake.
  await api.renderProfileWithWovenPatterns(windowStub.renderPortraitProfile, {}, { bodyColors: {} }, {});
  assert(api.debugSnapshot().portraitPatterns.hookRepairs > repairBefore, 'stable portrait adapter repairs a replaced global hook on first use instead of waiting for an equipment action');

  const originalFetch = context.fetch; // Restored after the isolated portrait compatibility probe so later tests keep their original network stub.
  context.fetch = async url => {
    const value = String(url || '');
    if (value.includes('config/cosmetics/index.json')) {
      return { ok: true, json: async () => ({ entries: [{ id: 'runtime_probe_cloth', path: './runtime_probe_cloth.json' }] }) };
    }
    if (value.includes('runtime_probe_cloth.json')) {
      return {
        ok: true,
        json: async () => ({
          slot: 'torso',
          parts: { torso: { layers: { back: { image: { url: './assets/cosmetics/runtime_probe_cloth.png' } } } } },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const probeProfile = {
    bodyColors: {
      __hobunjiWovenClothing: [{
        uid: 'runtime-probe',
        slot: 'torso',
        baseCosmeticId: 'runtime_probe_cloth',
        weaving: { pattern: {} }, // Empty renderable payload exercises tint routing without needing DOM canvas/image decoding in Node.
        colorA: { hex: '#556677' },
        colorC: { hex: '#ddeeff' },
      }],
    },
  };
  const plainProfile = { bodyColors: {} }; // Ordinary portrait fixture used to prove non-woven refreshes still run concurrently with each other.
  const fakeImage = { naturalWidth: 1, naturalHeight: 1, width: 1, height: 1 }; // Minimal authored-image shape accepted by the tint/cache-key path.
  let activeOrdinary = 0;
  let maxActiveOrdinary = 0;
  let releaseOrdinary;
  const ordinaryHold = new Promise(resolve => { releaseOrdinary = resolve; });
  const ordinaryRenderer = async () => {
    activeOrdinary++;
    maxActiveOrdinary = Math.max(maxActiveOrdinary, activeOrdinary);
    await ordinaryHold;
    activeOrdinary--;
    return true;
  };
  const ordinaryA = api.renderProfileWithWovenPatterns(ordinaryRenderer, {}, plainProfile, {});
  const ordinaryB = api.renderProfileWithWovenPatterns(ordinaryRenderer, {}, plainProfile, {});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(maxActiveOrdinary, 2, 'ordinary portraits retain concurrent rendering when no woven compatibility writer is active');
  releaseOrdinary();
  await Promise.all([ordinaryA, ordinaryB]);

  let activeLegacyRenderers = 0; // Proves two woven requests never own the global compatibility map at the same time.
  let maxActiveLegacyRenderers = 0;
  let legacyTintCalls = 0;
  const rendererIgnoringRenderOptions = async () => {
    activeLegacyRenderers++;
    maxActiveLegacyRenderers = Math.max(maxActiveLegacyRenderers, activeLegacyRenderers);
    await Promise.resolve(); // Forces overlap if woven compatibility ownership is not exclusive.
    windowStub._imageForTint(fakeImage, 'cosmetics/runtime_probe_cloth.png', { mode: 'none' }); // Deliberately ignores renderOptions.imageForTint, reproducing the pre-#817-only rendering path.
    legacyTintCalls++;
    activeLegacyRenderers--;
    return true;
  };

  const before = api.debugSnapshot().portraitPatterns;
  await Promise.all([
    api.renderProfileWithWovenPatterns(rendererIgnoringRenderOptions, {}, probeProfile, {}),
    api.renderProfileWithWovenPatterns(rendererIgnoringRenderOptions, {}, probeProfile, {}),
  ]);
  const after = api.debugSnapshot().portraitPatterns;
  assert.equal(maxActiveLegacyRenderers, 1, 'concurrent woven portraits receive exclusive global tint ownership one at a time');
  assert(legacyTintCalls >= 2, 'legacy renderer that ignores renderOptions still executes for both woven portrait requests');
  assert(after.compatibilityTintCalls > before.compatibilityTintCalls, 'restored global tint interception is exercised by a renderer that ignores renderOptions.imageForTint');
  assert(after.patternedTintCalls > before.patternedTintCalls, 'global compatibility interception resolves the live clothing layer back to its woven descriptor');

  let wovenEnteredResolve;
  const wovenEntered = new Promise(resolve => { wovenEnteredResolve = resolve; });
  let releaseWoven;
  const wovenHold = new Promise(resolve => { releaseWoven = resolve; });
  let ordinaryEnteredDuringWoven = false;
  const heldWovenRenderer = async () => {
    wovenEnteredResolve();
    await wovenHold;
    windowStub._imageForTint(fakeImage, 'cosmetics/runtime_probe_cloth.png', { mode: 'none' });
    return true;
  };
  const blockedOrdinaryRenderer = async () => {
    ordinaryEnteredDuringWoven = true;
    return true;
  };
  const wovenJob = api.renderProfileWithWovenPatterns(heldWovenRenderer, {}, probeProfile, {});
  await wovenEntered;
  const ordinaryJob = api.renderProfileWithWovenPatterns(blockedOrdinaryRenderer, {}, plainProfile, {});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ordinaryEnteredDuringWoven, false, 'ordinary portrait cannot observe the global compatibility map while a woven portrait owns it');
  releaseWoven();
  await Promise.all([wovenJob, ordinaryJob]);
  assert.equal(ordinaryEnteredDuringWoven, true, 'blocked ordinary portrait resumes immediately after woven compatibility ownership is released');

  let releaseFirstWriter;
  const firstWriterHold = new Promise(resolve => { releaseFirstWriter = resolve; });
  let firstWriterEnteredResolve;
  const firstWriterEntered = new Promise(resolve => { firstWriterEnteredResolve = resolve; });
  const fairnessOrder = [];
  const firstWriter = api.renderProfileWithWovenPatterns(async () => {
    fairnessOrder.push('woven1');
    firstWriterEnteredResolve();
    await firstWriterHold;
    return true;
  }, {}, probeProfile, {});
  await firstWriterEntered;
  const secondWriter = api.renderProfileWithWovenPatterns(async () => {
    fairnessOrder.push('woven2');
    return true;
  }, {}, probeProfile, {});
  const queuedReader = api.renderProfileWithWovenPatterns(async () => {
    fairnessOrder.push('ordinary');
    return true;
  }, {}, plainProfile, {});
  await Promise.resolve();
  releaseFirstWriter();
  await Promise.all([firstWriter, secondWriter, queuedReader]);
  assert(fairnessOrder.indexOf('ordinary') < fairnessOrder.indexOf('woven2'), 'an ordinary batch waiting behind one woven writer runs before the next queued woven writer, preventing patterned-NPC writer convoys');
  const gateAfter = api.debugSnapshot().portraitPatterns;
  assert.equal(gateAfter.gateReaders, 0, 'portrait gate releases every ordinary reader after the regression probe');
  assert.equal(gateAfter.gateWriterActive, false, 'portrait gate releases woven exclusive ownership after the regression probe');

  context.fetch = originalFetch;
})().catch(error => {
  context.fetch = async () => ({ ok: false, json: async () => ({}) });
  console.error('woven runtime compatibility regression failed:', error);
  process.exitCode = 1;
});

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
assert.match(source, /scaledOutlineWidth\(PATTERN_OUTLINE_WIDTH, active\[1\]\?\.pattern, debugLabel, width, height\)/, 'overpass clearance uses the same image-relative animal outline width');
assert.match(source, /scaledOutlineWidth\(PATTERN_OUTLINE_WIDTH, active\[0\]\?\.pattern, debugLabel, width, height\)/, 'visible animal pattern outline receives the actual source image dimensions');
const portraitSource = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Verifies woven portrait state is injected per render rather than shared across WorldPortraitLife's overlapping async NPC refreshes.
const avatarPreviewSource = fs.readFileSync('docs/js/npc-avatar-preview-utils.js', 'utf8'); // Guards the live world-avatar adapter that survives later portrait-renderer replacement.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Guards the outer cache key so a commit-pinned build cannot reuse an older combat loader that points at stale weaving code.
const combatLoaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Guards the inner cache key for the weaving runtime itself.
const colorFillSource = fs.readFileSync('docs/js/color-fill.js', 'utf8'); // Canonical source-art shading/value-fill math shared across rendered game assets.
const spriteRecolorSource = fs.readFileSync('docs/js/sprite-recolor.js', 'utf8'); // Compatibility wrapper used by authored item sprites and existing callers.
const creatureRendererSource = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'); // Verifies animal tinting uses the same canonical fill owner.
const pixelProbeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Keeps mobile-visible diagnostics wired to the shared fill module.
const debugSource = fs.readFileSync('docs/debug.js', 'utf8'); // Keeps weaving session diagnostics visible in the mobile Debug > Rendering surface.
const debugCopySource = fs.readFileSync('docs/game.js', 'utf8'); // Copy button owns the full mobile report header/raw-log export and player-avatar commit diagnostics.
const patternAuthorSource = fs.readFileSync('docs/js/pattern-authoring.js', 'utf8'); // Used below to lock the normalized shared Pattern scale authoring range.
const patternEditorSource = fs.readFileSync('docs/tools/pattern-editor/index.html', 'utf8'); // Guards fixed garment-trim authoring, variant coverage, and export wiring.
const clothingTrimManifest = JSON.parse(fs.readFileSync('docs/config/patterns/clothing-trims.json', 'utf8')); // Empty is valid until an artist authors the first supported garment; schema is still regression-checked.
const metalPatternSource = fs.readFileSync('docs/js/tool-metal-recolor.js', 'utf8'); // Used below to prevent weaving-only scale normalization from shrinking existing verdigris patterns.
const equipmentPanelSource = fs.readFileSync('docs/js/equipment-panel.js', 'utf8'); // Guards the inventory icon handoff so woven composites are not tinted a second time.
const inventoryUiSource = fs.readFileSync('docs/js/inventory-ui.js', 'utf8'); // Guards the one-shot async Pack icon refresh path; no per-frame pattern compositing.
assert.match(source, /let activePortraitPatternMap = null/, 'global compatibility map exists only as an explicitly owned woven-render fallback');
assert.match(source, /let portraitGateReaders = 0/, 'ordinary portrait readers are tracked separately from woven exclusive ownership');
assert.match(source, /let portraitGateWriterActive = false/, 'woven compatibility ownership has an explicit exclusive-writer state');
assert.match(source, /portraitGateWaitingWriters/, 'waiting woven portraits block new ordinary readers so the compatibility writer cannot starve');
assert.match(source, /portraitGatePreferReaders = portraitGateReaderWaiters\.length > 0/, 'each woven writer yields to already-waiting ordinary portraits before another woven writer starts');
assert.match(source, /const compatibilityTint = function clothingPatternImageForTint/, 'the pre-817 global tint compatibility entry point is restored for portrait code that bypasses renderOptions.imageForTint');
assert.match(source, /if \(!map\) return portraitBaseTintResolver\(img, sourceKey, tint\)/, 'global tint behavior stays canonical outside an actively owned woven portrait render');
assert.match(source, /const patternMap = Array\.isArray\(descriptors\)[\s\S]*?buildPortraitPatternMap\(descriptors\)/, 'each woven portrait render builds its own descriptor map');
assert.match(source, /patternImageForTint\(patternMap, baseTintResolver, pending => pendingBuilds\.add\(pending\), img, sourceKey, tint\)/, 'the woven tint resolver closes over that render-local descriptor map and reports this render\'s cache misses');
assert.match(source, /await Promise\.allSettled\(\[\.\.\.pendingBuilds\]\)/, 'woven portrait renders wait for missing pattern composites before returning their canvas');
assert.match(source, /if \(!patternMap\?\.size\)[\s\S]*?acquirePortraitReadGate\(\)/, 'ordinary portraits acquire the shared side of the portrait gate');
assert.match(source, /const releaseWrite = await acquirePortraitWriteGate\(\)/, 'woven portraits acquire exclusive ownership before exposing the compatibility map');
assert.match(source, /activePortraitPatternMap = patternMap[\s\S]*?activePortraitPatternMap = previousMap[\s\S]*?releaseWrite\(\)/, 'woven render restores compatibility state before releasing exclusive ownership');
assert.match(source, /return renderer\(canvas, profile, renderOptions\); \/\/ Cache is warm/, 'a cache-miss portrait redraws the same canvas with the warmed pattern cache before callers can upload it');
assert.match(source, /activePortraitPendingBuilds\?\.add\(pending\)/, 'global compatibility tint cache misses join the owning render\'s pending set instead of scheduling a later unsynchronized refresh');
assert.match(source, /options\?\.imageForTint\?\.__clothingWeavingPattern/, 'nested portrait wrappers detect an inherited render-local weaving pass instead of compositing it twice');
assert.match(source, /imageForTint\.__clothingWeavingPattern = true/, 'the render-local tint resolver carries a weaving ownership marker through later wrapper chains');
assert.match(source, /renderProfileWithWovenPatterns, \/\/ Stable adapter used by NpcAvatarPreview/, 'the render-local weaving helper is exported for the stable world-avatar adapter');
assert.match(source, /clothingWeavingApplyGear[\s\S]*?ensureGearClothingCollection\?\.\(\)[\s\S]*?learnOwnedBlueprints\(\)[\s\S]*?installPortraitHooks\(\)/, 'every player portrait-data build canonicalizes loaded clothing, hydrates weave snapshots, and repairs hooks without relying on Equipment UI');
assert.match(source, /renderProfileWithWovenPatterns[\s\S]*?installPortraitHooks\(\)/, 'stable portrait rendering rechecks weaving hooks at the render boundary');
assert.match(source, /const liveBaseTint = liveTint\?\.__clothingWeavingPattern/, 'cold-start rendering can recover the canonical tint resolver even when the initial hook capture was not ready');
assert.match(avatarPreviewSource, /ClothingWeavingSystem[\s\S]*?renderProfileWithWovenPatterns\(renderer, canvas, profile, renderOptions\)/, 'NpcAvatarPreview reapplies weaving around the current live portrait renderer instead of trusting a one-time global wrapper');
assert.match(avatarPreviewSource, /await renderer\(canvas, profile, renderOptions\);/, 'NpcAvatarPreview still renders normally before the weaving system is available');
assert.match(source, /document\.addEventListener\('hobunjiPlayerReady'[\s\S]*?requestSessionReadyPlayerAvatarRefresh\(hintedGear\)/, 'woven player-ready lifecycle schedules an automatic post-load avatar rebuild instead of relying on a manual gear toggle');
assert.match(source, /window\.setTimeout\(attempt, 0\)/, 'session rebuild is deferred until every player-ready listener has installed the live save state');
assert.match(source, /const startupFinished = window\.__hobunjiGameStarted === true[\s\S]*?liveWoven && initialPortraitPrepared && startupFinished[\s\S]*?equipmentDeps\.refreshPlayerAvatar\(\)/, 'post-load rebuild waits for live woven Gear, the initial gear-to-profile pass, and fully completed game startup before refreshing');
assert.match(indexSource, /combat-config-loader\.js\?v=20260930directtrimpaint1/, 'index cache-busts the loader that owns the authored clothing trim runtime URL');
assert.match(combatLoaderSource, /clothing-weaving-system\.js\?v=20260930directtrimpaint1/, 'combat loader cache-busts the authored clothing trim runtime itself');
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
assert.match(source, /applyPatternStackToTintedImage\((?:tinted|decorated), patterns, colorHex, prefix, img, 'woven-motif'\)/,
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
assert.match(debugSource, /window\.__clothingWeavingDebug\?\.\(\)/,
  'Debug panel reads the live clothing-weaving snapshot without requiring desktop devtools');
assert.match(debugSource, /filter === 'all' \|\| filter === 'cat:render'/,
  'weaving session diagnostics appear in All and the Rendering debug category');
assert.match(debugSource, /session: readyEvents=/,
  'mobile rendering diagnostics expose the returning-session refresh counters');
assert.match(debugSource, /window\.__weavingRenderDiagnosticsText = \(\) => _weavingRenderDiagnosticsLines\(\)\.join/,
  'debug bootstrap exposes the same plain-text weaving snapshot used by the visible Rendering panel');
assert.match(debugCopySource, /window\.__weavingRenderDiagnosticsText\?\.\(\)/,
  'Copy includes the synthetic weaving Rendering snapshot instead of exporting only raw log entries');
assert.match(debugCopySource, /window\.__playerAvatarRefreshDebug = \(\) =>/,
  'game exposes which woven refresh actually committed to the live player avatar');
assert.match(debugSource, /playerCommit: started=/,
  'Rendering debug includes player-specific commit/generation/patterned-tint diagnostics');
assert.match(debugCopySource, /\.\.\.String\(weavingDiagnostics\)\.split\('\\n'\)/,
  'copied report emits every weaving diagnostic line before the raw log');
assert.match(indexSource, /debug\.js\?v=20260925weavesessiondebug4/,
  'index cache-busts the debug bootstrap that renders and exports the weaving session snapshot');
// game.js is re-bumped by nearly every merge; any key at or after #829's weavecommit2 still ships its diagnostics.
const gameCacheKey = indexSource.match(/"game\.js\?v=(\d{8}[a-z0-9-]*)/i)?.[1] || '';
assert(gameCacheKey >= '20260925', `index cache-busts game.js so player-avatar commit diagnostics match the weaving runtime under test (found ${gameCacheKey || 'none'})`);
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
assert.match(patternAuthorSource, /options\.forceTiling === false/, 'shared PatternAuthoring can lock garment-owned trim to one non-repeating overlay');
assert.equal(clothingTrimManifest.schema, 'hobunji_clothing_trim.v1', 'repo owns one stable authored garment-trim manifest');
assert.equal(clothingTrimManifest.garments?.ragged_hood?.variants?.['mao-ao_male']?.front?.motifPng, 'assets/patterns/clothing-trims/ragged_hood__mao-ao_male__front.png', 'supplied Ragged Hood Mao\'ao male front trim is the repo-authored master entry');
assert.equal(clothingTrimManifest.garments?.ragged_hood?.variants?.['mao-ao_male']?.front?.settings?.directMask, true, 'supplied Ragged Hood master remains an exact direct mask');
assert.equal(clothingTrimManifest.garments?.ragged_hood?.variants?.['mao-ao_male']?.front?.authorOps?.length, 19, 'recovered Ragged Hood Mao\'ao male source journal is persisted in the repo manifest');
assert.deepEqual(clothingTrimManifest.garments?.ragged_hood?.variants?.['mao-ao_male']?.front?.authorOps?.filter(op => op.type === 'expandInward').map(op => op.amount), [7, 10, 11, 12, 12], 'recovered source preserves the authored inward-expansion sequence');
assert.match(patternEditorSource, /function defaultTrimSourceVariant\(/, 'trim authoring has one shared authored-master selection helper');
assert.match(patternEditorSource, /authoredInManifest = variants\.find\(key => !!trimRecord\(garmentId, key, view\)\)/, 'manifest-authored variants are preferred over session drafts as replication masters');
assert.match(patternEditorSource, /preferredSource = defaultTrimSourceVariant/, 'variant selection automatically moves to an authored master when the previous selection is not authored');
assert.match(patternEditorSource, /function defaultTrimManifestSelection\(\)/, 'Pattern Editor has one startup-selection helper driven by authored trim manifest entries');
assert.match(patternEditorSource, /if \(views\?\.front\) return \{ garmentId, variantKey, view: 'front' \}/, 'startup selection prefers the authored front view when one exists');
assert.match(patternEditorSource, /const defaultSelection = defaultTrimManifestSelection\(\)[\s\S]*?select\.value = defaultSelection\.garmentId[\s\S]*?\$\('trimView'\)\.value = defaultSelection\.view[\s\S]*?refreshTrimVariantOptions\(\)[\s\S]*?\$\('trimVariant'\)\.value = defaultSelection\.variantKey/, 'startup applies authored garment, view, and variant before rendering the trim preview');
assert.match(patternEditorSource, /editableTrimMaskCanvasFor[\s\S]*?catch \(error\) \{[\s\S]*?return null;/, 'missing authored trim PNGs degrade to an empty editable mask instead of aborting trim-editor initialization');
assert.match(patternEditorSource, /missingTrimAsset = true;[\s\S]*?result = await renderWithTrim\(null\)/, 'trim preview retries the same garment without trim when an authored mask asset cannot be rendered');
assert.match(patternEditorSource, /Manifest entry exists but its trim PNG could not be loaded/, 'paint viewport reports missing manifest artwork while remaining usable');
assert.match(patternEditorSource, /Array\.isArray\(record\?\.authorOps\) && record\.authorOps\.length\) return null/, 'journal-backed trim records bypass motifPng as the editor preview source');
assert.match(patternEditorSource, /replayedMask = replayTrimAuthorOps\(record\.authorOps, baseCanvas\)/, 'normal trim preview reconstructs a saved operation journal directly against the selected variant');
assert.match(patternEditorSource, /motifDataUrl: replayedMask\.toDataURL\('image\/png'\)/, 'reconstructed journal masks feed the production compositor as an in-memory direct mask');
assert.match(patternEditorSource, /Trim preview reconstructed directly from this variant’s saved authoring operations/, 'journal-backed previews visibly report that no exported PNG is required');
assert.match(patternEditorSource, /authorOpsComplete && authorOps\.length[\s\S]*?replayTrimAuthorOps\(authorOps, baseCanvas\)[\s\S]*?: await editableTrimMaskCanvas/, 'paint-editor loading also prefers complete operation history over any old exported PNG');
assert.match(patternEditorSource, /const sourceMask = replayed \? null : await editableTrimMaskCanvasFor/, 'journal-backed replication does not fetch a missing or stale motif PNG before replay');
assert.match(patternEditorSource, /Authored trim entry found, but its PNG is missing\/unreadable\. Showing the base garment/, 'legacy PNG-only preview still has a safe base-garment fallback');
assert.match(patternEditorSource, /Garment trim authoring/, 'Pattern Editor exposes the dedicated garment trim workspace');
assert.match(patternEditorSource, /species\/gender variant/i, 'garment trim editor makes per-variant authoring explicit');
assert.match(patternEditorSource, /trimCoverageText/, 'garment trim editor reports missing species/gender coverage instead of relying on a hard-coded list');
assert.match(patternEditorSource, /Paint trim directly/, 'garment trim authoring opens an exact sprite-space paint workflow instead of the generic placement editor');
assert.match(patternEditorSource, /directMask:\s*true/, 'garment trim saves exact pixel placement as a direct mask rather than frame\/mesh transforms');
assert.match(patternEditorSource, /clipPaintToGarment/, 'loaded trim masks are clipped to the visible garment silhouette');
assert.match(patternEditorSource, /function stampBrush\(point\)/, 'outline trim brush edits deterministic native sprite pixels rather than anti-aliased vector paths');
assert.match(patternEditorSource, /function walkLinePixels\(from, to, callback\)/, 'outline trim brush interpolates every native pixel between pointer samples so fast strokes cannot leave gaps');
assert.doesNotMatch(patternEditorSource, /paintCtx\.lineWidth\s*=\s*brushSize/, 'outline trim brush no longer uses fractional canvas line rasterization');
assert.doesNotMatch(patternEditorSource, /data-trim-edge-thickness/, 'outline-first trim authoring no longer exposes a competing pre-thickened edge generator');
assert.match(patternEditorSource, /function buildInwardSilhouetteMap\(mask, width, height\)/, 'trim painter and replication share one silhouette contour and inward ownership map');
assert.match(patternEditorSource, /boundaryMask\[index\] = 1;[\s\S]*?owner\[index\] = index;[\s\S]*?distance\[index\] = 0;/, 'first non-black garment pixels touching black, transparency, or sprite bounds become one-pixel contour seeds');
assert.match(patternEditorSource, /else if \(silhouetteBoundaryMask\[index\]\)/, 'Outline Brush can paint only one-pixel silhouette contour sections');
assert.match(patternEditorSource, /Outline Brush always authors exactly one contour pixel/, 'outline reach changes selection reach rather than authored trim thickness');
assert.match(patternEditorSource, /function selectFullOutline\(\)/, 'full-outline shortcut selects the same one-pixel contour used by the brush');
assert.match(patternEditorSource, /data-trim-expand-amount/, 'trim painter exposes artist-controlled inward depth');
assert.match(patternEditorSource, /function expandExistingTrim\(amount\)/, 'trim painter expands selected contour sections toward the garment interior');
assert.match(patternEditorSource, /function distanceFromSelectedContour\(mask, boundaryMask, selectedBoundary, width, height\)/, 'inward expansion computes distance from the union of all actually selected contour sections');
assert.match(patternEditorSource, /boundaryMask\[neighbor\] && !selectedBoundary\[neighbor\]/, 'multi-source inward expansion treats unselected outline pixels as traversal barriers instead of creeping sideways along the silhouette');
assert.match(patternEditorSource, /const selectedDistance = distanceFromSelectedContour\(garmentMask, silhouetteBoundaryMask, selectedBoundary, width, height\)/, 'live Expand Inward uses the selected-contour distance field rather than a permanent nearest-owner assignment');
assert.match(patternEditorSource, /const selectedDistance = distanceFromSelectedContour\(geometry\.mask, inwardMap\.boundaryMask, selectedBoundary, geometry\.width, geometry\.height\)/, 'operation replay uses the same multi-source inward distance as live authoring');
assert.match(patternEditorSource, /selectedDistance\[index\] > layers \+ 0\.0001/, 'inward expansion stops at the requested distance from any selected contour section');
assert.match(patternEditorSource, /Any selected inner\/outer contour may claim this interior pixel/, 'replay explicitly allows selected inner and outer edges to meet without leaving Voronoi-owner wedges');
assert.match(patternEditorSource, /expandExistingBtn\.disabled = !inkPresent/, 'Expand Inward is disabled until the current mask contains trim paint');
assert.match(patternEditorSource, /Expand Inward needs painted pixels on the one-pixel garment outline/, 'Expand Inward explains when a mask has no valid contour seeds');
assert.match(patternEditorSource, /trimReplicateTarget/, 'garment trim authoring exposes a target variant picker for cross-species replication');
assert.match(patternEditorSource, /function trimableGarmentMaskFromRgba\(rgba\)/, 'one shared trim geometry helper excludes pure-black sprite outlines');
assert.match(patternEditorSource, /pureBlack = rgba\[offset\] === 0 && rgba\[offset \+ 1\] === 0 && rgba\[offset \+ 2\] === 0/, 'trim geometry identifies exact #000000 pixels independently from alpha');
assert.match(patternEditorSource, /opaque && !pureBlack \? 1 : 0/, 'trim geometry moves inward past black outline pixels to the first opaque non-black cloth pixels');
assert.match(patternEditorSource, /image\.data\[i \+ 3\] > 16 && garmentMask\[pixel\]/, 'loaded or replicated trim masks are normalized off pure-black line art as soon as they enter the paint editor');
assert.match(patternEditorSource, /Exact black \(#000000\) sprite line art is ignored/, 'trim painter explains the black-outline inset rule in the authoring UI');
assert.match(patternEditorSource, /function fitTrimMaskToGarment\(sourceMaskCanvas, sourceGarment, targetGarment\)/, 'trim replication uses one shared outline-first structural transfer helper');
assert.match(patternEditorSource, /const sourceMap = buildInwardSilhouetteMap\(sourceGeometry\.mask, sourceGeometry\.width, sourceGeometry\.height\)/, 'replication derives the same non-black outline and inward map used by manual authoring');
assert.match(patternEditorSource, /mappedSourceOwnerForTargetBoundary/, 'replication aligns destination outline pixels to source outline ownership before filling inward');
assert.match(patternEditorSource, /sourceMap\.boundaryMask\[index\]/, 'replication takes actually painted first-non-black outline pixels as authoritative source sections');
assert.match(patternEditorSource, /if \(!selectedBoundaryCount\)/, 'replication only infers outline ownership from interior paint as a compatibility fallback for older masks');
assert.match(patternEditorSource, /owner < 0 \|\| !selectedSourceBoundary\[owner\]/, 'interior paint cannot accidentally activate an unrelated source outline section near a corner');
assert.match(patternEditorSource, /const depthScale = targetScale \/ sourceScale/, 'replication transfers inward depth proportionally between differently scaled species variants');
assert.match(patternEditorSource, /structuralSource/, 'replication reconstructs the clean source outline-to-inward trim before identifying artist post edits');
assert.match(patternEditorSource, /postAdd/, 'replication tracks manual additions beyond the structural outline-to-inward trim');
assert.match(patternEditorSource, /postRemove/, 'replication tracks manual erasures from the structural outline-to-inward trim');
assert.match(patternEditorSource, /relativeMaskSample\(postRemove/, 'replication reapplies manual erasures in relative garment coordinates after structural transfer');
assert.match(patternEditorSource, /relativeMaskSample\(postAdd/, 'legacy replication fallback can reapply manual additions in relative garment coordinates after structural transfer');
assert.match(patternEditorSource, /function cloneTrimAuthorOps\(ops\)/, 'trim authoring owns a serializable operation journal helper');
assert.match(patternEditorSource, /function replayTrimAuthorOps\(authorOps, targetGarment\)/, 'replication can replay authored operations directly against a target garment');
assert.match(patternEditorSource, /op\.type === 'selectFullOutline'/, 'operation replay preserves full-outline selection as an authored step');
assert.match(patternEditorSource, /op\.type === 'expandInward'/, 'operation replay preserves exact Expand Inward operations');
assert.match(patternEditorSource, /op\.type !== 'stroke'/, 'operation replay handles recorded relative brush and eraser strokes');
assert.match(patternEditorSource, /sizeNorm:[\s\S]*?brushSize[\s\S]*?sourceScale/, 'stroke journals store brush reach\/eraser size relative to the source garment scale');
assert.match(patternEditorSource, /recordStrokePoint\(point\)/, 'pointer stroke samples are recorded in authoring order for replay');
assert.match(patternEditorSource, /authorOps = \[\{ type: 'selectFullOutline' \}\]/, 'Select Full Outline replaces the mask with a complete replayable journal baseline');
assert.match(patternEditorSource, /authorOps\.push\(\{ type: 'expandInward', amount \}\)/, 'each successful inward expansion records its exact authored amount');
assert.match(patternEditorSource, /authorOps = \[\{ type: 'clear' \}\]/, 'Clear establishes a fresh complete replayable history');
assert.match(patternEditorSource, /authorOpsComplete \? \{ authorOps: cloneTrimAuthorOps\(authorOps\) \} : \{\}/, 'saved trim manifest entries persist complete operation journals beside runtime settings');
assert.match(patternEditorSource, /snapshot\(\)[\s\S]*?authorOps: cloneTrimAuthorOps\(authorOps\)/, 'undo snapshots preserve operation history alongside mask pixels');
assert.match(patternEditorSource, /replayed \? replayTrimAuthorOps\(sourceOps, targetGarment\) : fitTrimMaskToGarment/, 'replication prefers operation replay and uses finished-mask inference only as legacy fallback');
assert.match(patternEditorSource, /authorOpsComplete: replayed/, 'replicated targets inherit replayable operation provenance');
assert.match(patternEditorSource, /Editor-only authorOps stay outside runtime pattern settings/, 'replication keeps authoring journals out of the production trim settings object');
assert.match(patternEditorSource, /blank canvas is a complete starting state/, 'missing legacy PNGs start a fresh complete operation history instead of poisoning future replication');
assert.match(patternEditorSource, /trimReplicateAllBtn[\s\S]*?filter\(key => key !== sourceVariant && !trimExists\(garmentId, key, view\)\)/, 'bulk trim replication fills only missing species\/gender variants and leaves authored targets untouched');
assert.match(patternEditorSource, /Replicate \+ edit target/, 'single-target trim replication explicitly continues into manual cleanup');
assert.match(patternEditorSource, /Rendered result/, 'direct trim painting keeps a production-compositor result preview beside the paint surface');
assert.match(patternEditorSource, /trimManifestBtn/, 'garment trim editor exports the shared manifest alongside authored PNG masks');
assert.match(source, /'clothing-trim'/, 'runtime applies fixed garment trim through its own compositor pass and diagnostic label');
assert.match(source, /patternDef\?\.directMask === true[\s\S]*?ctx\.drawImage\(motifImg, 0, 0, width, height\)/, 'direct garment trim maps its authored PNG straight into garment pixel coordinates before outlining');
assert.match(source, /trimPatternOverride/, 'production clothing renderer accepts an unsaved trim draft so the dev editor previews the exact runtime path');
assert.match(source, /weavingHasAnyDecoration/, 'trim-only clothing participates in rendering/session/cache plumbing without pretending to contain a reusable pattern');
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
assert.match(equipmentPanelSource, /hasSecondaryDyeForItem/, 'inventory redye asks the shared cosmetic-palette resolver whether a real Trim channel exists');
assert.match(source, /const hasSecondary = \(\) => layersUseSecondaryDye\(state\.layers\)/, 'loom Trim controls follow authored palette-B usage instead of the broad hood/overwear slot');
assert.match(source, /for \(const \{ role, key \} of patternRoles\(\)\)/, 'loom pattern controls deduplicate multiple raster sprites that share one logical cloth role');
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
compatibilityRuntimeRegression.then(() => {
  if (!process.exitCode) console.log('clothing weaving system tests passed');
});

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
