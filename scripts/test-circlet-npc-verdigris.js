'use strict';
const assert = require('node:assert/strict'); // Shared assertions for portrait assembly and item lifecycle.
const fs = require('node:fs'); // Loads production modules and cosmetic definitions.
const vm = require('node:vm'); // Runs browser modules without requiring WebGL.
const context = vm.createContext({ window: {}, console, Image: class {} }); // Isolated renderer and wardrobe environment.
for (const file of ['config/scratchbones-config.js', 'js/portrait-utils.js', 'js/metal-armor-system.js', 'js/npc-wardrobe.js']) {
  vm.runInContext(fs.readFileSync('docs/' + file, 'utf8'), context);
}
const armor = context.window.MetalArmorSystem; // Production smith state/descriptor authority.
const wardrobe = context.window.NpcWardrobe; // Production gift, storage and persistence authority.
const rec = { id: 'test', equippedCosmetics: ['tangedcirclet'], appearance: {} }; // Starts with a circlet to verify same-slot displacement.
const gear = { clothingItems: [] }; // Returned items must retain their original metal state.
wardrobe.init({ getNpcRecordById: () => rec, npcWalkers: [], getGearInventory: () => gear });
const item = armor.__test.makeCraftedItem('tangedcirclet', 'tinBronze'); // Real crafted identity includes the smith instance suffix.
item.temperXp = 300;
item.smithTreatment = { mode: 'pattern', pattern: { motifDataUrl: 'data:image/png;base64,test' } };
assert.equal(wardrobe.slotForCosmetic(item.cosmeticId), 'hat');
assert.equal(wardrobe.offerClothing(rec.id, item).worn, true);
assert.deepEqual(Array.from(rec.equippedCosmetics), [item.cosmeticId], 'gift replaces old circlet instead of adding another');
function checkMetalState() {
  const worn = wardrobe.wornClothingItemsForRecord(rec, true); // Same item list used by world and dialogue portraits.
  assert.equal(worn.length, 1);
  assert.equal(worn[0].temperXp, 300);
  assert.equal(worn[0].metalKey, 'tinBronze');
  assert.equal(worn[0].smithTreatment.pattern.motifDataUrl, item.smithTreatment.pattern.motifDataUrl);
  const descriptor = armor.metalArmorDescriptors(worn)[0]; // Confirms NPC rendering receives full verdigris instead of default zero XP.
  assert.equal(armor.verdigrisFraction(descriptor), 1);
}
async function main() {
  checkMetalState();
  const save = JSON.parse(JSON.stringify(wardrobe.serialize())); // Save/reload must retain worn instance metadata.
  wardrobe.restore(save);
  checkMetalState();
  await wardrobe.storeWornItem(rec.id, item.cosmeticId);
  const stored = wardrobe.getWardrobeContents(rec.id).stored.find(entry => entry.cosmeticId === item.cosmeticId); // Stored gifted instance, separate from displaced default.
  assert.equal(await wardrobe.wearStoredItem(rec.id, stored.uid), true);
  checkMetalState();
  const replacement = { ...item, temperXp: 150, smithTreatment: null }; // Same design/alloy with different patina is a real swap.
  assert.equal(wardrobe.offerClothing(rec.id, replacement).worn, true);
  assert.equal(wardrobe.wornClothingItemsForRecord(rec)[0].temperXp, 150);
  await wardrobe.storeWornItem(rec.id, replacement.cosmeticId);
  const returned = wardrobe.getWardrobeContents(rec.id).stored.find(entry => entry.cosmeticId === item.cosmeticId && entry.temperXp === 300); // Original fully oxidized article is still recoverable.
  assert.equal(wardrobe.takeFromWardrobe(rec.id, returned.uid), true);
  assert.equal(gear.clothingItems[0].temperXp, 300);

  const circlet = context.portraitOptionFromJson({ id: 'tangedcirclet' }, JSON.parse(fs.readFileSync('docs/config/cosmetics/clothes/hat/tangedcirclet.json', 'utf8'))); // Tests the actual compositor with authored layers.
  const hood = context.portraitOptionFromJson({ id: 'fine_hood' }, JSON.parse(fs.readFileSync('docs/config/cosmetics/fine_hood.json', 'utf8'))); // Normal hood layering must cover the rear band.
  const draws = []; // Records sprite submission order without rasterizing pixels.
  context.draws = draws;
  vm.runInContext(`loadImg = async url => ({ url }); drawPortraitLayer = (ctx, img) => draws.push(img.url);`, context);
  const canvas = { width: 200, height: 200, getContext: () => ({ clearRect() {}, save() {}, restore() {}, scale() {} }) }; // Canvas methods needed by the ordinary composition path.
  for (const withHood of [false, true]) {
    for (const view of ['front', 'behind']) {
      draws.length = 0;
      await context.renderProfile(canvas, { fighter: { speciesId: 'mao-ao', gender: 'male' }, hairFront: null, hat: circlet, hood: withHood ? hood : null }, { portraitView: view, forceEyesOpen: true });
      const hats = draws.filter(url => /headband|tangedcirclet/.test(url)); // One circlet sprite on the front, one replacement headband on the back.
      assert.equal(hats.length, 1, `${view}, hood=${withHood}: one headwear sprite`);
      assert(hats[0].includes(view === 'behind' ? 'headband' : 'tangedcirclet'));
      if (withHood) assert(draws.findIndex(url => url.includes('finehood')) > draws.indexOf(hats[0]), 'hood draws above circlet/headband');
    }
  }
  console.log('Circlet portrait replacement and NPC verdigris lifecycle passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
