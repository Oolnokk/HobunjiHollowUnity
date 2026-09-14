'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const gear = { clothingItems: [] };
let saved = 0;
let traitKeySeen = null;
const wardrobeStored = [];
const ItemTraits = {
  computeItemTraits(key) { traitKeySeen = key; return ['clothing']; },
};
const NpcWardrobe = {
  init(deps) { this.deps = deps; },
  offerClothing(_npcId, instance) {
    wardrobeStored.push({ ...instance, uid: 'wardrobe-copy' });
    return { accepted: true };
  },
  getWardrobeContents() { return { stored: wardrobeStored.map(item => ({ ...item })) }; },
  takeFromWardrobe(_npcId, uid) {
    const index = wardrobeStored.findIndex(item => item.uid === uid);
    if (index < 0) return false;
    const [item] = wardrobeStored.splice(index, 1);
    gear.clothingItems.push({ ...item, uid: 'gear-returned' });
    return true;
  },
};
const windowStub = { ItemTraits, NpcWardrobe };
const context = vm.createContext({ window: windowStub, console });
vm.runInContext(fs.readFileSync('docs/js/clothing-weaving-npc-compat.js', 'utf8'), context, { filename: 'clothing-weaving-npc-compat.js' });

const compat = windowStub.ClothingWeavingNpcCompat;
assert(compat, 'compat API exported');
const woven = {
  uid: 'woven-player',
  cosmeticId: 'tankan_tunic#loom:woven-player',
  baseCosmeticId: 'tankan_tunic',
  slot: 'torso',
  weightUnits: 4.5,
  weaving: { pattern: { motifDataUrl: 'data:image/png;base64,AA==' } },
};
windowStub.ItemTraits.computeItemTraits(woven.cosmeticId, woven);
assert.equal(traitKeySeen, 'tankan_tunic', 'crafted copies inherit authored garment traits');

windowStub.NpcWardrobe.init({
  getGearInventory: () => gear,
  saveGearInventory: () => { saved++; },
});
const verdict = windowStub.NpcWardrobe.offerClothing('npc', woven);
assert.equal(verdict.accepted, true);
assert.equal(wardrobeStored[0].cosmeticId, 'tankan_tunic', 'NPC wardrobe stores/render-resolves the authored cosmetic id');
assert.equal(wardrobeStored[0].__loomPlayerCosmeticId, woven.cosmeticId, 'NPC storage preserves the unique player-side id for take-back');
assert.equal(wardrobeStored[0].weightUnits, 4.5, 'crafted weight metadata survives NPC storage');
assert(windowStub.NpcWardrobe.takeFromWardrobe('npc', 'wardrobe-copy'));
assert.equal(gear.clothingItems[0].cosmeticId, woven.cosmeticId, 'taking the garment back restores its unique player inventory id');
assert.equal(gear.clothingItems[0].__loomPlayerCosmeticId, undefined, 'temporary NPC compatibility marker is removed on return');
assert.equal(gear.clothingItems[0].weightUnits, 4.5, 'crafted weight metadata survives the round trip');
assert.equal(saved, 1, 'restored gear identity is persisted');

const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
assert.match(loader, /clothing-weaving-npc-compat\.js/, 'compat adapter is loaded after NPC wardrobe support');
assert(loader.indexOf('npc-wardrobe.js') < loader.indexOf('clothing-weaving-npc-compat.js'), 'compat adapter loads after NpcWardrobe is defined');
console.log('clothing weaving NPC compatibility tests passed');
