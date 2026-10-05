'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const masterySource = read('docs/js/crafting-mastery-system.js');
const dyesSource = read('docs/js/dye-trait-labels.js');
const generatorSource = read('docs/js/npc-crafting-commission-generator.js');
const deliverySource = read('docs/js/npc-crafting-commission-delivery.js');
const adapterSource = read('docs/js/npc-crafting-commissions.js');
const craftingPanelSource = read('docs/js/crafting-panel.js');

// Static integration contract: catches accidental removal/renaming even when a
// DOM-heavy runtime test cannot cheaply boot the whole game.
assert.match(masterySource, /MASTERY_FIELD = 'craftingMastery'/, 'mastery persists directly on the world record');
assert.match(masterySource, /registerNode/, 'crafting mastery exposes an extensible perk-node registry');
assert.match(masterySource, /function rank\(perkId\)/, 'future crafting consumers have a PerkSystem-like rank query');
assert.match(masterySource, /TIER_THRESHOLDS/, 'crafting mastery supports broad-to-specific tier gating');
assert.match(masterySource, /requires:/, 'crafting mastery supports explicit perk prerequisites');
assert.match(masterySource, /Efficient Joinery/, 'generic starter crafting perk one exists');
assert.match(masterySource, /Tempered Crucible/, 'generic starter crafting perk two exists');
assert.match(masterySource, /shared by this world/, 'Crafting tab communicates world scope');

assert.match(generatorSource, /socialRelationships\?\.relationships/, 'gift recipients use authored family\/friend\/partner relations');
assert.match(generatorSource, /likedColors\(recipient\)/, 'clothing commissions use the recipient liked color traits');
assert.match(generatorSource, /SATURATION.*hot.*muted/, 'hot\/muted color categories are supported');
assert.match(generatorSource, /VALUE.*bright.*dark/, 'bright\/dark color categories are supported');
assert.match(generatorSource, /key: 'C'.*Pattern/, 'pattern color receives its own requirement');
assert.match(generatorSource, /filter\(record => record\.score > 0\)/, 'furniture commissions cannot fall back to role-irrelevant random pieces');

assert.match(deliverySource, /weavingHasAnyPattern/, 'delivery checks real woven pattern metadata');
assert.match(deliverySource, /startingOwned/, 'pre-existing furniture cannot satisfy a fresh commission');
assert.match(deliverySource, /inventory\[commission\.blueprintKey\] = Math\.max\(1, before\)/, 'furniture blueprint is granted free on acceptance');
assert.match(deliverySource, /serializeDiscoveredPrefs/, 'commission start teaches disclosed recipient color traits');
assert.match(deliverySource, /recordNpcMemory.*commission_color_preferences_shared/, 'recipient appears immediately in Relationships');
assert.match(deliverySource, /awardMotes\(moteReward, `commission:\$\{taskId\}`, \{ silent: true \}\)/, 'completion transaction writes world Motes before consuming the deliverable');
assert.match(deliverySource, /mastery\.saveState\(masteryBefore\)/, 'failed literal delivery rolls back the Mote award');

assert.match(adapterSource, /getTurnInReadyTaskForNpc = function npcCraftingCommissionTurnInReady/, 'commission readiness overrides the empty-items false positive');
assert.match(adapterSource, /__craftCommissionDebug/, 'mobile-friendly commission diagnostics exist');
assert.match(dyesSource, /colorTraitsForHsv/, 'dye labels reuse the gifting color classifier');
assert.match(dyesSource, /dye-trait-readout/, 'swatch menus have a visible mobile classification readout');
for (const required of ['crafting-mastery-system.js', 'dye-trait-labels.js', 'npc-crafting-commission-generator.js', 'npc-crafting-commission-delivery.js', 'npc-crafting-commissions.js']) {
  assert.ok(craftingPanelSource.includes(required), `${required} must be bootstrapped by CraftingPanel`);
}

// Functional world-scope + perk-backbone test. This executes the shipped
// mastery runtime with two worlds and verifies Motes/ranks never bleed between
// characters/worlds, while newly registered Tier-2 nodes obey the generic gate.
const storage = new Map();
storage.set('hobunjiSaveMeta', JSON.stringify({ worlds: [{ id: 'world-a' }, { id: 'world-b' }] }));
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
};
const document = {
  getElementById() { return null; },
  createElement() { return { style: {}, dataset: {}, appendChild() {}, addEventListener() {}, querySelector() { return null; } }; },
  head: { appendChild() {} },
};
const context = {
  console,
  localStorage,
  document,
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
};
context.window = context;
context.dispatchEvent = () => true;
context.__farmLog = () => {};
context.WorldPopupText = { queueReward() {} };
vm.createContext(context);
vm.runInContext(masterySource, context, { filename: 'crafting-mastery-system.js' });
const mastery = context.CraftingMasterySystem;
let worldId = 'world-a';
mastery.setWorldIdGetter(() => worldId);
assert.equal(mastery.awardMotes(30, 'test', { silent: true }), 30);
assert.equal(mastery.purchaseRank('efficientJoinery'), true);
assert.equal(mastery.rank('efficientJoinery'), 1);
assert.equal(mastery.getState().motes, 25);

worldId = 'world-b';
assert.equal(mastery.rank('efficientJoinery'), 0, 'perk rank is world-scoped');
assert.equal(mastery.getState().motes, 0, 'Mote balance is world-scoped');
mastery.awardMotes(30, 'test', { silent: true });
mastery.registerNode({ id: 'specificTest', name: 'Specific Test', tier: 2, maxRank: 1, cost: 2, desc: () => 'test' });
assert.equal(mastery.canPurchase('specificTest').ok, false, 'Tier 2 is locked before enough Motes are spent');
assert.equal(mastery.purchaseRank('efficientJoinery'), true); // 5 spent
assert.equal(mastery.purchaseRank('temperedCrucible'), true); // +6 = 11 spent, over Tier-2 threshold
assert.equal(mastery.canPurchase('specificTest').ok, true, 'Tier 2 unlocks from generic spent-Mote backbone');
assert.equal(mastery.purchaseRank('specificTest'), true);
assert.equal(mastery.rank('specificTest'), 1);

worldId = 'world-a';
assert.equal(mastery.rank('efficientJoinery'), 1, 'switching back restores world A progression');
assert.equal(mastery.rank('specificTest'), 0, 'newly registered specific perk remains isolated to the world that bought it');

console.log('npc crafting commissions regression: ok');
