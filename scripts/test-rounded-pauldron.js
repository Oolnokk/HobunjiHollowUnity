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

const windowStub = {};
vm.runInNewContext(read('docs/js/pauldron-system.js'), {
  window: windowStub,
  document: {},
  console,
  setTimeout,
  clearTimeout,
}, { filename: 'pauldron-system.js' });
const ps = windowStub.PauldronSystem;
assert(ps, 'PauldronSystem exports');
assert.deepEqual(Array.from(ps.TEMPER_XP_THRESHOLDS), [40, 90, 150, 220, 300], 'Temper uses Mastery-like five-rank pacing');
assert.equal(ps.__test.temperLevelForXp(39), 0);
assert.equal(ps.__test.temperLevelForXp(40), 1);
assert.equal(ps.__test.temperLevelForXp(299), 4);
assert.equal(ps.__test.temperLevelForXp(300), 5);
assert.equal(ps.KG_PER_WEIGHT_UNIT, 0.4, '4 ordinary-wool overwear units calibrate to ~1.6 kg');
const copperWeight = ps.weightForMetal('nativeCopper');
const highTinWeight = ps.weightForMetal('highTinBronze');
assert(copperWeight.massKg > 1.3 && copperWeight.massKg < 1.4, 'single copper pauldron mass stays near the density-scaled historical reference');
assert(copperWeight.weightUnits > 3.3 && copperWeight.weightUnits < 3.5, 'copper pauldron lands a little above standard torso weight');
assert(highTinWeight.weightUnits < copperWeight.weightUnits, 'alloy density changes the physical outfit weight');
assert.equal(ps.visualOptions({ metalKey:'nativeCopper', temperXp:150, smithTreatment:null }).oxidationAmount, 0.5, 'Temper drives the same continuous verdigris fraction');
assert.equal(ps.visualOptions({ metalKey:'nativeCopper', temperXp:300, smithTreatment:{ mode:'resistant', metalKey:'nativeCopper' } }).oxidationAmount, 0, 'resistant smith treatment suppresses verdigris');
assert.equal(ps.visualOptions({ metalKey:'nativeCopper', temperXp:300, smithTreatment:{ mode:'cosmetic', metalKey:'gold' } }).targetHex, '#D8AA2E', 'cosmetic plating switches to the treatment metal');

const scratchbones = read('docs/config/scratchbones-config.js');
assert.match(scratchbones, /"id": "rounded_pauldron"[^\n]*"smithOnly": true[^\n]*"dyeable": false/, 'catalog marks pauldrons smith-only and non-dyeable');
const shopPieces = json('docs/config/shops/shop-stock.json').shops.generalStoreWares.clothingRotation.pieces;
assert(!shopPieces.some(piece => piece.id === 'rounded_pauldron'), 'General Store no longer sells pauldrons');

const onboarding = read('docs/onboarding-core.js');
assert(!onboarding.includes("{ key: 'pauldron', label: '🛡 Pauldrons'"), 'character creation does not offer smith-only pauldrons');
assert(!onboarding.includes('PAULDRON: clothDyeColor(clothDyeA)'), 'character creation never cloth-dyes pauldrons');
assert(onboarding.includes('clothing: { hat: null, hood: null, pauldron: null, torso: null, overwear: null }'), 'gear schema still owns a dedicated pauldron slot');

const equipment = read('docs/js/equipment-panel.js');
assert(equipment.includes('PauldronSystem?.applyImageVisual'), 'gear icons use the shared metal/verdigris renderer');
assert(equipment.includes("item.baseCosmeticId || item.cosmeticId"), 'unique smith instance IDs resolve through the authored base cosmetic');
assert(equipment.includes("item?.dyeable !== false"), 'non-dyeable smith clothing suppresses Redye');

const portrait = read('docs/js/portrait-utils.js');
assert(portrait.includes('PauldronSystem.preparePortraitLayers'), 'portrait pixels run through the metal renderer');
assert(portrait.includes("pauldronPixelsAreFinal ? { mode: 'none' }"), 'finished metal pixels are not recolored again as cloth');

const weaving = read('docs/js/clothing-weaving-system.js');
assert(weaving.includes("OUTFIT_WEIGHT_SLOTS = Object.freeze(['hat', 'hood', 'pauldron', 'torso', 'overwear'])"), 'pauldron weight contributes to outfit burden');
assert(weaving.includes("CLOTHING_SLOTS = Object.freeze(['hat', 'hood', 'torso', 'overwear'])"), 'pauldrons remain excluded from loom craftability');
assert.match(weaving, /const explicit = Number\(item\?\.weightUnits\);[\s\S]*if \(Number\.isFinite\(explicit\)/, 'explicit smith weight is honored before cloth-only fallback');

const smith = read('docs/js/metal-craft-shop.js');
assert(smith.includes('PauldronSystem?.renderSmithySection?.(list)'), 'smithy renders the new metal-clothing section');
assert(smith.includes('PauldronSystem?.init?.'), 'smithy injects existing inventory/save/avatar adapters into the pauldron module');

const game = read('docs/game.js');
assert(game.includes("PauldronSystem?.awardExperience?.(amount, 'tool/weapon Mastery XP', { save: false })"), 'tool/weapon Mastery XP contributes to worn pauldron Temper');
const pauldronSource = read('docs/js/pauldron-system.js');
assert(pauldronSource.includes('skillSystem.award = wrapped'), 'ordinary SkillSystem XP contributes to worn pauldron Temper');
assert(!pauldronSource.includes('setToolReinforcement'), 'Temper unlocks cosmetic smith treatments, not stat-changing reinforcement');

const studio = read('docs/tools/character-studio/index.html');
assert(studio.includes("category: 'pauldron', tintKeys: []"), 'Character Studio exposes the slot without cloth dyes');

const index = read('docs/index.html');
assert(index.indexOf('js/tool-metal-recolor.js?v=20260926pauldron1') < index.indexOf('js/pauldron-system.js?v=20260926pauldron1'));
assert(index.indexOf('js/pauldron-system.js?v=20260926pauldron1') < index.indexOf('onboarding.js?v=20260926pauldron1'), 'metal pauldron renderer loads before save/creator portraits');

const pixelProbe = read('docs/js/pixel-probe.js');
assert(pixelProbe.includes('PauldronSystem?.diagnosticsText?.()'), 'Pixel Probe exposes phone-copyable Temper/material/weight diagnostics');

console.log('OK: Rounded Pauldrons are smith-crafted non-dyeable metal clothing with cosmetic Temper, shared verdigris treatments, and density-derived outfit weight.');
