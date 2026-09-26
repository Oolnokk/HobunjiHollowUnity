const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const cosmeticsIndex = json('docs/config/cosmetics/index.json');
assert(cosmeticsIndex.entries.some(entry => entry.id === 'rounded_pauldron' && entry.path === './clothes/pauldrons/rounded_pauldron.json'));
const shopPiece = json('docs/config/shops/shop-stock.json').shops.generalStoreWares.clothingRotation.pieces.find(piece => piece.id === 'rounded_pauldron');
assert(shopPiece && shopPiece.category === 'pauldron' && shopPiece.usesB === false);

const scratchbones = read('docs/config/scratchbones-config.js');
assert(scratchbones.includes('"rounded_pauldron": "assets/cosmetics/clothes/pauldrons/rounded_pauldron_m.png"'));
assert(scratchbones.includes('"id": "rounded_pauldron", "label": "Rounded Pauldrons", "price": 70, "category": "pauldron"'));

const equipment = read('docs/js/equipment-panel.js');
assert(equipment.includes("['hat', 'hood', 'pauldron', 'torso', 'overwear']"));
assert(equipment.includes("if (slot === 'pauldron') return ['PAULDRON'];"));
const saveGate = read('docs/js/save-startup-gate.js');
assert(saveGate.includes("pauldron: 'pauldron'"));
assert(saveGate.includes("if (slot === 'pauldron') return ['PAULDRON'];"));
const onboarding = read('docs/onboarding-core.js');
assert(onboarding.includes("category: 'pauldron'"));
assert(onboarding.includes("applyEquip('pauldron', 'pauldron',"));
assert(onboarding.includes("PAULDRON: clothDyeColor(clothDyeA)"));
assert(onboarding.includes("['hat', 'hood', 'pauldron', 'torso', 'overwear']"));
assert(read('docs/js/npc-avatar-preview-utils.js').includes("applyEquip('pauldron', 'pauldron',"));
const studio = read('docs/tools/character-studio/index.html');
assert(studio.includes("category: 'pauldron', tintKeys: ['PAULDRON']"));
assert(studio.includes("applyEquip('pauldron', 'pauldron',"));
const portrait = read('docs/js/portrait-utils.js');
assert(portrait.includes("option?.slot === 'pauldron') ? 'body' : 'head'"));
assert(portrait.includes("pauldron:      () => drawEmoteLayers(pauldronLayers)"));
const wardrobe = read('docs/js/npc-wardrobe.js');
assert(wardrobe.includes("pauldron: ['PAULDRON']"));
assert(wardrobe.includes("return 'pauldron';"));
assert(read('docs/js/item-traits.js').includes("['hat', 'hood', 'pauldron', 'torso', 'overwear']"));
assert.equal(json('docs/config/items/item-index.json')['cosmetic:rounded_pauldron']?.label, 'Rounded Pauldrons');

console.log('OK: rounded pauldron assets are wired through cosmetic loading, gear, portraits, authoring, shop stock, NPC wardrobe, and item indexing.');
