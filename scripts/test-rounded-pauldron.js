const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const json = rel => JSON.parse(read(rel));

const cosmetic = json('docs/config/cosmetics/clothes/pauldrons/rounded_pauldron.json');
assert.equal(cosmetic.slot, 'pauldron');
assert.equal(cosmetic.tintSlot, 'PAULDRON');
assert.equal(cosmetic.meta.name, 'Rounded Pauldrons');
assert.equal(cosmetic.portraitAssets, true, 'pauldron config explicitly marks its non-/portrait/ PNG folder as portrait art');

const expected = {
  'mao-ao_male': 'rounded_pauldron_m.png',
  'mao-ao_female': 'rounded_pauldron_f.png',
  'tletingan_male': 'rounded_pauldron_tl_m.png',
  'tletingan_female': 'rounded_pauldron_tl_f.png',
  'kenkari_male': 'rounded_pauldron_kenk_m.png',
  'kenkari_female': 'rounded_pauldron_kenk_f.png',
  'engh-sho_male': 'rounded_pauldron_engh_m.png',
  'engh-sho_female': 'rounded_pauldron_engh_f.png',
  'rakakoan_male': 'rounded_pauldron_kenk_m.png',
  'rakakoan_female': 'rounded_pauldron_kenk_f.png',
  'mashtzarr_male': 'rounded_pauldron_mashtz_m.png',
  'mashtzarr_female': 'rounded_pauldron_mashtz_f.png',
};
for (const [variant, filename] of Object.entries(expected)) {
  const url = cosmetic.speciesVariants?.[variant]?.parts?.torso?.layers?.front?.image?.url;
  assert.equal(url, './assets/cosmetics/clothes/pauldrons/' + filename);
  assert(fs.existsSync(path.join(root, 'docs/assets/cosmetics/clothes/pauldrons', filename)), filename + ' exists');
}

const portraitLoader = read('docs/js/portrait-utils.js');
assert(
  portraitLoader.includes("const allowNonPortraitAssets = json.portraitAssets === true"),
  'portrait loader honors explicit portraitAssets cosmetics outside a literal /portrait/ folder'
);
assert(
  portraitLoader.includes("(!allowNonPortraitAssets && !String(imgUrl).toLowerCase().includes('/portrait/'))"),
  'body portrait extraction bypasses the legacy folder-name gate only for explicitly opted-in cosmetics'
);
for (const [variant, variantData] of Object.entries(cosmetic.speciesVariants)) {
  const imageUrl = variantData?.parts?.torso?.layers?.front?.image?.url;
  assert(imageUrl, variant + ' has a drawable portrait layer');
  assert(
    cosmetic.portraitAssets === true || String(imageUrl).toLowerCase().includes('/portrait/'),
    variant + ' survives the portrait-body asset gate'
  );
}

const skillSystemSource = read('docs/js/skill-system.js');
const metalArmorSource = read('docs/js/metal-armor-system.js');
const windowStub = {};
const vmContext = {
  window: windowStub,
  document: { querySelector: () => null },
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
};
vm.runInNewContext(skillSystemSource, vmContext, { filename: 'skill-system.js' });
vm.runInNewContext(metalArmorSource, vmContext, { filename: 'metal-armor-system.js' });
const ps = windowStub.MetalArmorSystem;
assert(ps, 'MetalArmorSystem exports');
assert.deepEqual(Array.from(ps.TEMPER_XP_THRESHOLDS), [40, 90, 150, 220, 300], 'Temper uses Mastery-like five-rank pacing');
assert.equal(ps.__test.temperLevelForXp(39), 0);
assert.equal(ps.__test.temperLevelForXp(40), 1);
assert.equal(ps.__test.temperLevelForXp(299), 4);
assert.equal(ps.__test.temperLevelForXp(300), 5);
assert.equal(ps.KG_PER_WEIGHT_UNIT, 0.4, '4 ordinary-wool overwear units calibrate to ~1.6 kg');
assert.equal(ps.ARMOR_BLUEPRINTS.rounded_pauldron.sourceHex, '#7DC89A', 'the first metal-armor blueprint carries its authored source palette');
const copperWeight = ps.weightForBlueprintMetal('rounded_pauldron', 'nativeCopper');
const highTinWeight = ps.weightForBlueprintMetal('rounded_pauldron', 'highTinBronze');
assert(copperWeight.massKg > 1.3 && copperWeight.massKg < 1.4, 'single copper pauldron mass stays near the density-scaled historical reference');
assert(copperWeight.weightUnits > 3.3 && copperWeight.weightUnits < 3.5, 'copper pauldron lands a little above standard torso weight');
assert(highTinWeight.weightUnits < copperWeight.weightUnits, 'alloy density changes the physical outfit weight');
assert.equal(ps.visualOptions({ blueprintId:'rounded_pauldron', metalKey:'nativeCopper', temperXp:150, smithTreatment:null }).oxidationAmount, 0.5, 'Temper drives the same continuous verdigris fraction');
assert.equal(ps.visualOptions({ blueprintId:'rounded_pauldron', metalKey:'nativeCopper', temperXp:150, smithTreatment:null }).sourceHex, '#7DC89A', 'metal recolor options carry blueprint-specific source palettes into ToolMetalRecolor');
assert(metalArmorSource.includes("window.resolvePortraitAssetUrl?.(sourceUrl)"), 'metal armor resolves portrait-relative source art before ToolMetalRecolor reads its pixels');
assert.equal(ps.visualOptions({ blueprintId:'rounded_pauldron', metalKey:'nativeCopper', temperXp:300, smithTreatment:{ mode:'resistant', metalKey:'nativeCopper' } }).oxidationAmount, 0, 'resistant smith treatment suppresses verdigris');
assert.equal(ps.visualOptions({ blueprintId:'rounded_pauldron', metalKey:'nativeCopper', temperXp:300, smithTreatment:{ mode:'cosmetic', metalKey:'gold' } }).targetHex, '#D8AA2E', 'cosmetic plating switches to the treatment metal');

const wornPauldron = {
  uid: 'gcloth_smith_temper_regression',
  cosmeticId: 'rounded_pauldron#smith:temper_regression',
  baseCosmeticId: 'rounded_pauldron',
  slot: 'pauldron',
  materialKind: 'metal',
  metalKey: 'nativeCopper',
  temperXp: 0,
};
const gear = { clothingItems: [wornPauldron], clothing: { pauldron: wornPauldron } };
let gearSaveCount = 0;
ps.init({
  getGearInventory: () => gear,
  saveGearInventory: () => { gearSaveCount++; },
  getPlayerData: () => ({ appearance: { speciesId: 'mao-ao', gender: 'male' } }),
});
assert.equal(ps.debugSnapshot().skillXpListenerInstalled, true, 'Temper subscribes to the authoritative Skill XP event stream');
assert.equal(windowStub.SkillSystem.award('mining', 20, 'Temper integration regression', false), true, 'test Skill XP award succeeds');
assert.equal(wornPauldron.temperXp, 20, 'a real SkillSystem award advances equipped metal armor Temper');
assert.equal(ps.visualOptions(wornPauldron).oxidationAmount, 0.1, '20 Temper XP is already enough to render the first visible verdigris step');
assert(gearSaveCount >= 2, 'normalization and the XP award both persist the metal-armor state');

const scratchbones = read('docs/config/scratchbones-config.js');
assert.match(scratchbones, /"id": "rounded_pauldron"[^\n]*"smithOnly": true[^\n]*"dyeable": false/, 'catalog marks pauldrons smith-only and non-dyeable');
const shopPieces = json('docs/config/shops/shop-stock.json').shops.generalStoreWares.clothingRotation.pieces;
assert(!shopPieces.some(piece => piece.id === 'rounded_pauldron'), 'General Store no longer sells pauldrons');

const onboarding = read('docs/onboarding-core.js');
assert(onboarding.includes("{ key: 'pauldron', label: '🛡 Pauldrons'"), 'the pauldron slot remains an ordinary clothing category for future non-metal pieces');
assert(onboarding.includes('PAULDRON: clothDyeColor(clothDyeA)'), 'non-metal pauldrons retain the ordinary dye channel');
assert(onboarding.includes('clothing: { hat: null, hood: null, pauldron: null, torso: null, overwear: null }'), 'gear schema still owns a dedicated pauldron slot');
assert(onboarding.includes("catalog.filter(i => i.category === slot.category && !i.smithOnly)"), 'character creation can expose future non-metal pauldrons while hiding smith-only metal recipes');

const equipment = read('docs/js/equipment-panel.js');
assert(equipment.includes('MetalArmorSystem?.applyImageVisual'), 'gear icons use the shared metal/verdigris renderer');
assert(equipment.includes("item.baseCosmeticId || item.cosmeticId"), 'unique smith instance IDs resolve through the authored base cosmetic');
assert(equipment.includes("item?.dyeable !== false"), 'non-dyeable smith clothing suppresses Redye');

const portrait = read('docs/js/portrait-utils.js');
const npcPreview = read('docs/js/npc-avatar-preview-utils.js');
assert(portrait.includes('MetalArmorSystem.preparePortraitLayers'), 'portrait pixels run through the metal renderer');
assert(npcPreview.includes("applyEquip('pauldron', 'pauldron'"), 'live player/NPC profile builder carries the pauldron slot into portrait rendering');
assert(portrait.includes("json.portraitAssets === true"), 'portrait loader supports explicitly authored portrait assets outside a /portrait/ folder');
assert(portrait.includes("!allowNonPortraitAssets && !String(imgUrl).toLowerCase().includes('/portrait/')"), 'the path exception is opt-in rather than globally treating every cosmetic image as portrait art');
assert(portrait.includes("entry.tint = { mode: 'none' }"), 'finished metal pixels in any clothing group are not recolored again as cloth');
assert(portrait.includes('window.resolvePortraitAssetUrl = resolvePortraitAssetUrl'), 'portrait renderer exports its canonical asset-root resolver for material processors');
assert(portrait.includes("data:|blob:|https?:|file:"), 'portrait loader accepts recolored data/absolute URLs without prefixing the asset root');

const weaving = read('docs/js/clothing-weaving-system.js');
assert(weaving.includes("OUTFIT_WEIGHT_SLOTS = Object.freeze(['hat', 'hood', 'pauldron', 'torso', 'overwear'])"), 'pauldron weight contributes to outfit burden');
assert(weaving.includes('MetalArmorSystem?.isMetalArmor?.(itemOrBlueprint)'), 'loom craftability rejects literal metal armor regardless of clothing slot');
assert.match(weaving, /const explicit = Number\(item\?\.weightUnits\);[\s\S]*if \(Number\.isFinite\(explicit\)/, 'explicit smith weight is honored before cloth-only fallback');

const smith = read('docs/js/metal-craft-shop.js');
assert(smith.includes('MetalArmorSystem?.renderSmithySection?.(list)'), 'smithy renders the new metal-clothing section');
assert(smith.includes('MetalArmorSystem?.init?.'), 'smithy injects existing inventory/save/avatar adapters into the generic metal-armor module');

const game = read('docs/game.js');
assert(game.includes("MetalArmorSystem?.awardExperience?.(amount, 'tool/weapon Mastery XP', { save: false })"), 'tool/weapon Mastery XP contributes to every equipped metal armor article');
assert(skillSystemSource.includes('notifyAward(skillKey, gain, reason);'), 'SkillSystem emits from the authoritative award path used by both external and internal XP grants');
assert(metalArmorSource.includes('skillSystem.onAward'), 'ordinary SkillSystem XP reaches Temper through the authoritative award event');
assert(!metalArmorSource.includes('skillSystem.award = wrapped'), 'Temper no longer relies on a public-method monkey patch that misses internal SkillSystem awards');
assert(!metalArmorSource.includes('setToolReinforcement'), 'Temper unlocks cosmetic smith treatments, not stat-changing reinforcement');
assert(!metalArmorSource.includes("item.slot === 'pauldron'"), 'metal behavior is not inferred from the pauldron slot');
assert(!fs.existsSync(path.join(root, 'docs/js/pauldron-system.js')), 'the old pauldron-specific module filename is gone');
assert.equal(ps.isMetalArmor({ slot:'pauldron', cosmeticId:'cloth_pauldron', materialKind:'cloth' }), false, 'a non-metal pauldron stays ordinary clothing');
assert.equal(ps.isMetalArmor({ slot:'pauldron', cosmeticId:'rounded_pauldron', materialKind:'cloth' }), false, 'even a registered base cosmetic is not a metal inventory item without metal material metadata');

const studio = read('docs/tools/character-studio/index.html');
assert(studio.includes("category: 'pauldron', tintKeys: ['PAULDRON']"), 'Character Studio keeps the pauldron dye channel for future non-metal pauldrons');

const index = read('docs/index.html');
assert(index.indexOf('js/tool-metal-recolor.js?v=20260926metalarmor1') < index.indexOf('js/metal-armor-system.js?v=20260926metalarmor3'), 'shared tool metal renderer loads before generic armor material bridge');
assert(index.indexOf('js/metal-armor-system.js?v=20260926metalarmor3') < index.indexOf('onboarding.js?v=20260926metalarmor1'), 'generic metal-armor renderer loads before save/creator portraits');

const pixelProbe = read('docs/js/pixel-probe.js');
assert(pixelProbe.includes('MetalArmorSystem?.diagnosticsText?.()'), 'Pixel Probe exposes phone-copyable Temper/material/weight diagnostics');

console.log('OK: Metal armor is item/blueprint-driven across clothing slots; Rounded Pauldrons are the first smith recipe with cosmetic Temper, shared treatments, and density-derived weight.');

assert(index.includes('js/npc-avatar-preview-utils.js?v=20260926metalarmor1'), 'live avatar profile builder cache is bumped with the pauldron integration');
