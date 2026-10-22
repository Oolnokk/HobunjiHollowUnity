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


// Functional tier-zero commission: generator, offered -> accepted -> delivered,
// and quest reward all use the actual same market/labor quote.
const mockMath = Object.create(Math);
mockMath.random = () => 0.05;
const commissionProgress = {};
const commissionInventory = { gold: 0, pineLog: 10, chairFurniture: 0 };
let earnedFavor = 0;
let earnedMotes = 0;
const completionPopups = []; // Records the actual world-list categories emitted by a commission turn-in.
const furniture = { key: 'chairBlueprint', furnitureKey: 'chairFurniture', name: 'Wooden Chair', category: 'seating', craftCost: { wood: 4 } };
const commissionContext = {
  console, Math: mockMath, document: { getElementById: () => null },
  ProceduralTasks: {
    init() {}, isQuestEligibleNpc: () => true, isRequestGiver: () => false,
    friendshipTier: () => 0, maybeOfferFavor: () => null,
    favorAskLine: () => 'generic', turnInTask: () => ({ ok: false }),
    getTurnInReadyTaskForNpc: () => null, makeTaskId: () => 'craft-test',
  },
  CraftingPanel: { init() {}, render() {} },
  NpcGifting: { init() {} },
  DialogueContent: { adjustNpcFavor(_id, amount) { earnedFavor += amount; return amount; } },
  CraftingMasterySystem: {
    debugSnapshot: () => ({ worldId: 'world-test' }),
    getState: () => ({ motes: earnedMotes }),
    saveState(state) { earnedMotes = state.motes; },
    awardMotes(amount) { earnedMotes += amount; return amount; },
    renderPanel() {},
  },
  ClothingWeavingSystem: { woolCostForSlot: slot => ({ hat: 1, hood: 2, torso: 3, overwear: 4, pants: 2 })[slot] || 1 },
  WorldPopupText: { queueReward(kind, message) { completionPopups.push({ kind, message }); } },
};
commissionContext.window = commissionContext;
vm.createContext(commissionContext);
for (const [filename, source] of [
  ['generator', generatorSource], ['delivery', deliverySource], ['adapter', adapterSource],
]) vm.runInContext(source, commissionContext, { filename });
const taskDeps = {
  calendar: { day: 1 }, inventory: commissionInventory, getQuestProgress: () => commissionProgress,
  getNpcRecordById: id => ({ id, role: 'carpenter' }),
  setQuestStatus(id, status, progressPatch) {
    const prior = commissionProgress[id]?.progress || {};
    commissionProgress[id] = { status, progress: { ...prior, ...progressPatch } };
  },
  clampInventoryStack() {}, buildInventoryGrid() {}, saveMemberWorldData() {}, showToast() {},
};
commissionContext.CraftingPanel.init({
  FURNITURE_BLUEPRINT_CATALOG: [furniture],
  ITEM_DEFS: { pineLog: { sellPrice: 6 }, shadewoodLog: { sellPrice: 5 } },
});
commissionContext.ProceduralTasks.init(taskDeps);
const offered = commissionContext.ProceduralTasks.maybeOfferFavor({ id: 'carpenter', name: 'Carpenter', role: 'carpenter' });
assert(offered?.commission, 'crafting commissions must be offered even at friendship tier zero');
assert.equal(commissionContext.NpcCraftingCommissions.debugSnapshot().lastAttempt.generated, true);
const quote = commissionContext.NpcCraftingCommissionGenerator.rewardQuote(offered);
assert(quote.gold > 70 + (4 * 6 * 1.5), 'crafting income covers material opportunity cost and real labor');
assert(quote.favor >= 6, 'commission Favor is rewarded in the same 40-point-per-heart scale as gifts');
taskDeps.setQuestStatus(offered.id, 'available', {});
assert.equal(commissionInventory.chairBlueprint, 1, 'acceptance grants the required blueprint');
commissionInventory.chairFurniture = 1;
const result = commissionContext.ProceduralTasks.turnInTask(offered.id);
assert.equal(result.ok, true, 'commission consumes the freshly crafted piece');
assert.equal(commissionInventory.chairFurniture, 0);
assert.equal(commissionInventory.gold, quote.gold);
assert.equal(earnedFavor, quote.favor);
assert.equal(earnedMotes, quote.motes);
assert.equal(commissionProgress[offered.id].status, 'completed');
assert(completionPopups.some(entry => entry.kind === 'currency' && entry.message === '+' + quote.gold + 'g'), 'commission gold appears in the world reward list');
assert(completionPopups.some(entry => entry.kind === 'masteryXp' && entry.message.includes(quote.motes + ' Mote')), 'Craft Motes use a recognized mastery popup category');
assert(!completionPopups.some(entry => entry.kind === 'craft'), 'the unsupported craft popup category must not be used');
const legacyQuote = commissionContext.NpcCraftingCommissionGenerator.rewardQuote({
  ...offered, rewardGold: 80, rewardFriendship: 1, rewardMotes: 1,
});
assert(legacyQuote.gold >= quote.gold, 'an old saved commission also receives the new payout floor');

// A composite requirement must match a real dye the player has actually unlocked.
// Independently selecting a liked hue, saturation, and brightness used to produce impossible jobs.
const palette = [
  { id: 'red-hot-bright', traits: ['hueRed', 'hot', 'bright'] },
  { id: 'blue-muted-dark', traits: ['hueBlue', 'muted', 'dark'] },
];
const unlockedDyeIds = new Set(['red-hot-bright']); // Matches one character's currently unlocked loom swatches.
commissionContext.DyeSystem = {
  ensureCollection() {},
  getCatalog: () => palette,
  owns: id => unlockedDyeIds.has(id),
};
commissionContext.ItemTraits = {
  resolveHsv: dye => dye,
  colorTraitsForHsv: dye => dye.traits,
};
const feasible = commissionContext.NpcCraftingCommissionGenerator.__test.colorRequirement(['hueRed', 'hot', 'dark']);
assert(feasible?.includes('hueRed') && feasible.includes('hot'), 'must request the recipient’s preferred hue and saturation');
assert(!feasible.includes('dark'), 'cannot demand a dark swatch when the only unlocked red is bright');
assert(feasible.every(trait => palette[0].traits.includes(trait)), 'every AND-ed dye requirement must match a single unlocked swatch');
assert.equal(commissionContext.NpcCraftingCommissionGenerator.__test.colorRequirement(['hueBlue']), null, 'locked dyes never produce undeliverable commissions');
unlockedDyeIds.add('blue-muted-dark');
assert(commissionContext.NpcCraftingCommissionGenerator.__test.colorRequirement(['hueBlue', 'dark'])?.includes('dark'), 'unlocked dye traits become valid immediately');


// Both quest-log preview and ordinary task turn-in read this single method.
const regularPopups = []; // Captures regular task world-list rewards at the actual completion point.
const taskContext = {
  console,
  DialogueContent: { adjustNpcFavor(_id, reward) { return reward; } },
  WorldPopupText: { queueReward(kind, message) { regularPopups.push({ kind, message }); } },
};
taskContext.window = taskContext;
vm.createContext(taskContext);
vm.runInContext(read('docs/js/procedural-tasks.js'), taskContext);
const regularDeps = {
  calendar: { day: 3 }, ITEM_DEFS: { berry: { sellPrice: 3 } },
  inventory: { berry: 5, gold: 0 },
  getQuestProgress: () => ({ oldRequest: { status: 'available', progress: {
    kind: 'request', npcId: 'hreesh', npcName: 'Hreesh', domain: 'farming',
    items: [{ itemKey: 'berry', qty: 5 }], rewardGold: 15, rewardFriendship: 1.5,
    tier: 2, deadlineDay: 5, bonusMultiplier: 2,
  } } }),
  setQuestStatus() {}, clampInventoryStack() {}, showToast() {},
};
taskContext.ProceduralTasks.init(regularDeps);
const onTime = taskContext.ProceduralTasks.rewardPreview(regularDeps.getQuestProgress().oldRequest.progress);
assert(onTime.baseGold > 15 && onTime.gold === onTime.baseGold * 2, 'labor premium is doubled for an on-time request');
assert.equal(onTime.favor, 9);
regularDeps.calendar.day = 6;
const overdue = taskContext.ProceduralTasks.rewardPreview(regularDeps.getQuestProgress().oldRequest.progress);
assert.equal(overdue.gold, overdue.baseGold, 'expired requests pay the displayed base, not the expired bonus');
assert.equal(taskContext.ProceduralTasks.turnInTask('oldRequest').ok, true);
assert.equal(regularDeps.inventory.gold, overdue.gold, 'the task credits exactly the amount in its reward preview');
assert.equal(regularDeps.inventory.berry, 0, 'turn-in consumes the requested inventory');
assert(regularPopups.some(entry => entry.kind === 'currency' && entry.message === '+' + overdue.gold + 'g'), 'regular task money is included in the floating reward list');


console.log('npc crafting commissions regression: ok');
