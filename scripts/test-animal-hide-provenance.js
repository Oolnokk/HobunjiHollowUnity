'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const window = {
  CreatureGenetics: {
    SPECIES_ALIAS: { 'gar-wolf-alpha': 'gar-wolf' },
    normalizeLegacyGenotype: (_kind, genotype) => genotype,
    sellValueFor(genotype, kind) {
      assert.equal(kind, 'gar-wolf', 'an alpha uses the base species genetics valuation');
      return genotype.colorpoint?.enabled
        ? { tier: 'Rare', amount: 450, comparison: 'A patterned coat', contrastScore: 90 }
        : { tier: 'Common', amount: 100, comparison: 'Plain specimen', contrastScore: 0 };
    },
    genotypeTraits(_kind, genotype) {
      return {
        colors: [{ id: 'base', label: 'Base coat', color: genotype.base.color }],
        patterns: [{ id: 'colorpoint', label: 'Colorpoint', color: genotype.colorpoint?.color, enabled: !!genotype.colorpoint?.enabled }],
      };
    },
  },
};
function load(modulePath) {
  vm.runInNewContext(fs.readFileSync(path.join(root, modulePath), 'utf8'), { window, console }, { filename: modulePath });
}
load('docs/js/animal-hides.js');
load('docs/js/inventory-stacks.js');

const H = window.AnimalHides;
const key = 'alphaGarWolfHide';
const rareGenes = {
  base: { color: '#a13d27' },
  colorpoint: { enabled: true, copies: 2, color: '#fef0d2' },
  colorPoolPaint: { layers: [{ color: '#112233', patterns: [{ id: 'myPaint' }] }] },
};
const rareCreature = { creatureKey: 'gar-wolf-alpha', genotype: rareGenes };
const rare = H.recordFromCreature(key, rareCreature, 2, 26);
assert.equal(rare.rarity.tier, 'Rare');
assert.equal(rare.stars, 4);
assert.equal(rare.rarity.animalValue, 450);
assert.equal(rare.sellPrice, 117, 'hide price inherits animal genetics value / common value × existing species base hide price');
assert.equal(rare.kind, 'gar-wolf');
assert.equal(rare.appearance.baseColor, '#a13d27');
assert.equal(rare.appearance.patterns[0].color, '#fef0d2');
assert.equal(rare.appearance.colorPoolPaint.layers[0].color, '#112233');
assert.equal(rare.genotype.colorpoint.copies, 2, 'full inherited genotype survives for future clothing');
rareCreature.genotype.base.color = '#000000';
assert.equal(H.groupsFor(key, 2)[0].hideRecord.genotype.base.color, '#a13d27', 'butchering snapshots the coat rather than sharing live genotype');
const plain = H.recordFromCreature(key, { creatureKey: 'gar-wolf-alpha', genotype: { base: { color: '#444444' }, colorpoint: { enabled: false, copies: 0 } } }, 1, 26);
assert.equal(plain.stars, 1);
assert.equal(plain.sellPrice, 26);
assert.equal(H.groupsFor(key, 3).length, 2, 'different fur variants are not combined merely because they share one item key');
const stacks = window.InventoryStacks.variants(key, 3);
assert.equal(stacks.reduce((sum, stack) => sum + stack.count, 0), 3);
assert.equal(stacks.length, 2, 'Pack shows one stack per exact coat identity');
assert.equal(stacks.find(stack => stack.stars === 4).count, 2);
assert.equal(H.quote(key, 2, 'pack', 26, 3).total, 143, 'mixed sales sum one common and one rare specimen without a second star multiplier');

const copy = JSON.parse(JSON.stringify(H.serialize()));
assert.equal(copy.pack[key].length, 3);
H.restore(copy, { [key]: 3 });
assert.equal(H.groupsFor(key, 3).length, 2);
assert.equal(H.groupsFor(key, 3).find(group => group.stars === 4).hideRecord.appearance.patterns[0].color, '#fef0d2');

const rareVariant = H.groupsFor(key, 3).find(group => group.stars === 4).variant;
const specific = H.consume(key, 1, 'pack', 26, 3, rareVariant);
assert.equal(specific.ok, true);
assert.equal(specific.total, 117);
assert.equal(H.groupsFor(key, 2).find(group => group.stars === 4).count, 1);
const moved = H.transfer(key, 1, 'pack', 'shipping', 2, 26);
assert.equal(moved.total, 26, 'sending hides ships lower-rarity stock first');
assert.equal(H.getDebug().shipping[key], 1, 'the shipped hide retains its exact plain-coat record until settlement');
assert.equal(H.groupsFor(key, 1).length, 1);
const remaining = H.groupsFor(key, 1)[0];
assert.equal(remaining.stars, 4, 'rare hide stays in the bag while cheaper one ships');
H.clearShipping();
assert.equal(H.getDebug().shipping[key], undefined);

const savedAfterSale = H.serialize();
H.restore(savedAfterSale, { [key]: 1 });
assert.equal(H.groupsFor(key, 1)[0].hideRecord.genotype.base.color, '#a13d27');
H.restore(savedAfterSale, { [key]: 0 });
assert.equal(H.groupsFor(key, 0).length, 0, 'restore prunes metadata for stacks no longer in the inventory');

H.restore(null, { [key]: 2 });
const legacy = H.groupsFor(key, 2);
assert.equal(legacy.length, 1);
assert.equal(legacy[0].variant, 'hide:generic');
assert.equal(legacy[0].count, 2);
assert.equal(H.quote(key, 2, 'pack', 26, 2).total, 52);
assert.equal(H.consume(key, 1, 'pack', 26, 2, 'hide:generic').total, 26);
assert.match(H.describe(null), /Legacy/);
assert.equal(H.isHide('garWolfHide'), true);
assert.equal(H.isHide('garWolfMeat'), false);


// Actual Shipping Box integration: a cheaper post-midnight deposit must never
// displace the valuable pre-cutoff hide that is already committed for collection.
const documentStub = { body: null, getElementById: () => null }; // Keeps the shipped FarmCrates test independent of the browser layout.
function vector(x = 0, y = 0, z = 0) {
  return { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; }, clone() { return vector(this.x, this.y, this.z); } };
}
class MeshStub {
  constructor() { this.position = vector(); this.userData = {}; this.children = []; }
  add(child) { this.children.push(child); }
}
const threeStub = { Mesh: MeshStub, BoxGeometry: class {}, MeshLambertMaterial: class {} }; // Fake meshes satisfy the real Shipping Box's fallback visual contract.
window.FarmPanel = {};
window.addEventListener = () => {};
window.setInterval = () => 1;
window.__climbDebug = { getCurrentArea: () => 'farm' };
window.ShippingPanel = { getShipPrice: () => 26 };
window.TownMine = { applySaleBonus: value => value };
load('docs/js/shipping-box-config.js');
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/farm-crates.js'), 'utf8'),
  { window, console, document: documentStub, THREE: threeStub }, { filename: 'farm-crates.js' });

const inventory = { [key]: 1, gold: 0 }; // The actual count inventory remains the sole authority for how many hides exist.
const calendar = { day: 1 }; // Increments drive the Shipping Box's existing midnight cutoff.
const deliveryLog = []; // Receives actual settlement events for verifying both the amount and sale date.
window.FarmCrates.init({
  inventory, calendar, BASE_PRICES: {}, TileType: { GRASS: 1 }, tileSurfaceY: () => 0,
  scene: { add() {}, remove() {} }, hasFarmPermission: () => true, clampInventoryStack() {},
  getDeliveryLog: () => deliveryLog, getMenuOpen: () => false, saveMemberWorldData() {},
  itemIconForKey: () => '🟫', showToast() {},
  getActiveInventoryItem: () => ({ key, label: 'Alpha Hide', icon: '🟫' }),
});
const shippingBox = window.FarmCrates.makeSellCrate(1, 1);
const newRareCreature = () => ({
  creatureKey: 'gar-wolf-alpha', genotype: {
    base: { color: '#a13d27' },
    colorpoint: { enabled: true, copies: 2, color: '#fef0d2' },
  },
});
const newCommonCreature = () => ({
  creatureKey: 'gar-wolf-alpha', genotype: {
    base: { color: '#444444' },
    colorpoint: { enabled: false, copies: 0, color: '#444444' },
  },
});
function startShipmentTest() {
  inventory[key] = 0;
  H.restore(null, inventory);
  shippingBox.reset();
}
startShipmentTest();
inventory[key] = 1;
H.recordFromCreature(key, newRareCreature(), 1, 26);
assert.equal(shippingBox.depositItem(key, 1), 1);
calendar.day = 2;
shippingBox.tick();
assert.equal(shippingBox.getPendingSaleCountFor(key), 1);
inventory[key] = 1;
H.recordFromCreature(key, newCommonCreature(), 1, 26);
assert.equal(shippingBox.depositItem(key, 1), 1);
assert.equal(shippingBox.getContents()[key], 2);
assert.equal(shippingBox.getPendingSaleCountFor(key), 1, 'late deposits do not become midnight-eligible immediately');
assert.equal(H.quote(key, 1, 'shipping', 26, 2, null, { eligibleCount: 1 }).total, 117);
assert.equal(H.quote(key, 1, 'shipping', 26, 2).total, 26, 'unrestricted cheap-first valuation differs from midnight-reserved inventory');
const settlement = window.FarmCrates.settlePendingShippingSale('test');
assert.equal(settlement.sold, 1);
assert.equal(settlement.earned, 117, 'only the valuable pre-midnight hide sells, not a later cheap substitute');
assert.equal(inventory.gold, 117);
assert.equal(shippingBox.getContents()[key], 1);
assert.equal(shippingBox.withdrawItem(key, 1), 1);
assert.equal(H.groupsFor(key, 1)[0].hideRecord.stars, 1, 'newer common coat is what remains after the cutoff sale');
assert.match(deliveryLog[0].text, /117g/);

// Withdrawing from a mixed box preferentially removes previously marked
// inventory; otherwise its count-only pending-sale counter would reference
// a different physical hide than the one returned to the player.
startShipmentTest();
inventory[key] = 1;
H.recordFromCreature(key, newRareCreature(), 1, 26);
assert.equal(shippingBox.depositItem(key, 1), 1);
calendar.day = 3;
shippingBox.tick();
inventory[key] = 1;
H.recordFromCreature(key, newCommonCreature(), 1, 26);
assert.equal(shippingBox.depositItem(key, 1), 1);
assert.equal(shippingBox.withdrawItem(key, 1), 1);
assert.equal(H.groupsFor(key, 1)[0].hideRecord.stars, 4, 'the pending rare specimen was actually withdrawn, not the new cheap specimen');
assert.equal(shippingBox.getPendingSaleCountFor(key), 0);
assert.equal(window.FarmCrates.settlePendingShippingSale('test').sold, 0, 'withdrawn pending stock must not get sold again');

// Legacy hides have no genotype: preserving an explicit null shipping slot
// keeps the earlier generic item distinct from a later rare specimen.
startShipmentTest();
inventory[key] = 1;
assert.equal(shippingBox.depositItem(key, 1), 1);
calendar.day = 4;
shippingBox.tick();
inventory[key] = 1;
H.recordFromCreature(key, newRareCreature(), 1, 26);
assert.equal(shippingBox.depositItem(key, 1), 1);
assert.equal(window.FarmCrates.settlePendingShippingSale('test').earned, 26, 'legacy pre-cutoff stock does not steal the later rare hide');
assert.equal(shippingBox.withdrawItem(key, 1), 1);
assert.equal(H.groupsFor(key, 1)[0].hideRecord.stars, 4);

console.log('Animal hide rarity, exact coat persistence, Shipping Box midnight/withdrawal, pricing, and legacy inventory: passed');