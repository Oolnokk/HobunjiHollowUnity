#!/usr/bin/env node
'use strict';

// Integration regression: three-reagent Alchemy -> normal NPC gift transaction
// -> persistent spouse perfume -> dynamic 24-hour Beloved stat/HUD provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8'); // Loaded by the real scripts below.
const inventory = {}; // Shared brewing/gifting inventory so gifted bottles must genuinely be consumed.
const itemDefs = {}; // Shared dynamic alchemy item database, read by the ordinary NPC gifting path.
const toasts = []; // Captures player-visible acceptance and kiss effect messages.
const effects = {}; // Captures the same shared HUD providers the game registers.
const statProviders = []; // Captures the actual ResourceSystem stat multipliers.
let rawDay = 10; // Test calendar day, incremented to verify 24-hour expiry.
let hour = 8; // Test calendar hour, paired with rawDay for exact in-game timing.
let held = null; // Currently held bag item for the existing gifting action.
const player = { kind: 'player' }; // Resource provider must only buff this entity.
const spouseWalker = { rec: { id: 'spouse', name: 'Spouse', gifts: {}, relationship: {} }, area: 'farm' }; // Married recipient.
const strangerWalker = { rec: { id: 'stranger', name: 'Stranger', gifts: {}, relationship: {} }, area: 'farm' }; // Non-spouse gift recipient.
const w = {
  InventoryStacks: { MAX_TOTAL: 999 },
  SCRATCHBONES_CONFIG: { game: {} },
  SkillSystem: { level: () => 0, award() {}, XP_GAINS: { alchemyDiscovery: 18, alchemyBrew: 8, alchemyTarget: 5 } },
  CalendarSystem: { getHour: () => hour, timeDebugSnapshot: () => ({ rawDay }) },
  Combat: { deps: { player } },
  NpcFollowing: { init() {}, clear() {} },
  NpcRapport: { config: { rapportMax: 100 }, adjust() {}, markGiftedToday() {} },
  NpcScheduling: { registerTargetOverride() {} },
  DialogueContent: { registerActionHandler() {}, recordNpcMemory() {}, adjustNpcFavor() {} },
  HobunjiActivityEvents: { on() {}, emit() {} },
  RomanceFamily: { init() {}, restore() {}, commandOptionsFor: () => [], snapshot: () => null },
  RomanceWedding: { init() {}, tick() {} },
  EffectBuffBar: {
    registerProvider(id, fn) { effects[id] = fn; return true; },
    refresh() {},
  },
  InventoryCharacterEffects: { refresh() {} },
  ResourceSystem: { registerStatModifierProvider(fn) { statProviders.push(fn); } },
  ItemTraits: { computeItemTraits: () => [], isTraitDiscovered: () => false },
};
const fixture = vm.createContext({
  window: w,
  document: { dispatchEvent() {}, getElementById() { return null; } },
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  performance: { now: () => 1000 },
  setInterval: () => 1,
  console,
});
for (const path of ['docs/js/alchemy-system.js', 'docs/js/romance-system.js', 'docs/js/npc-gifting.js']) {
  const src = read(path); // Validate production sources as well as executing their shared public APIs.
  assert.doesNotThrow(() => new vm.Script(src, { filename: path }));
  vm.runInContext(src, fixture, { filename: path });
}

const alchemy = w.AlchemySystem; // Reaction catalog and bottle item identity.
const romance = w.RomanceSystem; // Sole owner of persistent spouse/perfume and the kiss buff.
const gifting = w.NpcGifting; // Ordinary held-item gift acceptance and inventory consumption.
alchemy.init({
  inventory, ITEM_DEFS: itemDefs,
  clampInventoryStack() {},
  showToast(message) { toasts.push(message); },
});
romance.init({
  npcWalkers: [spouseWalker, strangerWalker],
  getNpcRecord(id) { return id === 'spouse' ? spouseWalker.rec : strangerWalker.rec; },
  saveMemberWorldData() {},
  showToast(message) { toasts.push(message); },
});
gifting.init({
  inventory,
  getHeldGiftItem: () => held,
  getItemDefs: () => itemDefs,
  clampInventoryStack() {},
  showToast(message) { toasts.push(message); },
  refreshItemScroll() {},
  buildInventoryGrid() {},
  buildEquipmentSlots() {},
  refreshActionBar() {},
  saveMemberWorldData() {},
});
const recipes = [ // Unique three-source reactions, one per supported kiss stat channel.
  { id: 'perfumeOfBlossoms', keys: ['mistpetalBloom', 'graniteThistle', 'frostcapMoss'], stat: 'healthRegen' },
  { id: 'perfumeOfStone', keys: ['mistpetalBloom', 'graniteThistle', 'shalefrondFern'], stat: 'maxFooting' },
  { id: 'perfumeOfEmbers', keys: ['mistpetalBloom', 'graniteThistle', 'cinderveinBramble'], stat: 'maxStamina' },
  { id: 'perfumeOfZephyrs', keys: ['mistpetalBloom', 'cloudberryVine', 'silverfernFrond'], stat: 'footingRegen' },
];
for (const key of Object.keys(alchemy.REAGENT_DEFS)) inventory[key] = 8;
romance.completeWedding('spouse');
assert.equal(statProviders.length, 1, 'kiss bonus composes through one shared ResourceSystem provider');
assert.equal(romance.currentKissEffect().stat, 'staminaRegen', 'no perfume preserves the existing blessing');
assert.equal(romance.currentKissEffect().multiplier, 1.10);
romance.completeSpouseKiss('spouse');
assert.equal(romance.remainingKissHours(), 24, 'kiss duration is exactly one full in-game day');
assert.equal(statProviders[0](player, 'staminaRegen'), 1.10);
assert.equal(statProviders[0](strangerWalker, 'staminaRegen'), 1, 'NPCs do not inherit a player blessing');

for (const { id, keys, stat } of recipes) {
  const outcomes = alchemy.enumerateRecipes(keys); // The actual table must offer the reaction from three distinct live reagents.
  assert.ok(outcomes.some(outcome => outcome.recipeId === id), id + ' is reachable by normal alchemy');
  const made = alchemy.brewFrom(keys, { targetRecipeId: id, random: () => 0, alchemyLevel: 0 });
  assert.equal(made.ok, true);
  assert.equal(made.recipeId, id);
  assert.equal(made.batch, 1, 'one bottle per normal perfume brew');
  assert.equal(alchemy.RECIPE_DEFS[id].application, 'spousePerfume');
  assert.ok(itemDefs[made.itemKey].tags.includes('Perfume'), 'bottle has a visible perfume category');
  assert.equal(alchemy.perfumeFromItemKey(made.itemKey).stat, stat);
  assert.equal(alchemy.drinkPotion(made.itemKey).ok, false, 'perfume must not be drunk');
  const previous = romance.currentKissEffect();
  assert.equal(romance.acceptSpousePerfumeGift('stranger', made.itemKey), false, 'non-spouse gifts cannot change the kiss');
  assert.equal(romance.currentKissEffect().stat, previous.stat);
  held = { kind: 'item', key: made.itemKey, def: itemDefs[made.itemKey] };
  assert.ok(gifting.getNpcGiftOfferAction(spouseWalker)?.action === 'npc_offer_gift', 'existing NPC gift interaction recognizes the bottle');
  const before = inventory[held.key];
  assert.equal(gifting.offerGift(spouseWalker), true, 'ordinary gift transaction accepts perfume');
  assert.equal(inventory[held.key], before - 1, 'successful gift consumes one perfume');
  assert.equal(romance.currentKissEffect().stat, stat);
  assert.equal(romance.currentKissEffect().multiplier, 1.10);
  for (const channel of ['staminaRegen', 'healthRegen', 'maxFooting', 'maxStamina', 'footingRegen']) {
    assert.equal(statProviders[0](player, channel), channel === stat ? 1.10 : 1, 'only the selected perfume stat applies: ' + channel);
  }
  assert.equal(romance.remainingKissHours(), 24, 'switching perfume never extends an active kiss');
  const shown = effects['romance-spouse-kiss']()[0];
  assert.equal(shown.id, 'beloved');
  assert.ok(shown.label.includes(romance.currentKissEffect().effectLabel), 'HUD shows the current perfume effect');
  assert.ok(shown.sourceLabel.includes(itemDefs[made.itemKey].label.split(' · ')[0]), 'HUD identifies the gifted perfume');
}
assert.equal(romance.getSpouse().perfume.recipeId, 'perfumeOfZephyrs', 'last perfume replaces earlier ones');
const beforeOther = romance.getSpouse().perfume.recipeId;
const other = alchemy.ensureRecipeItemDef('perfumeOfBlossoms', 0);
inventory[other] = 2;
held = { kind: 'item', key: other, def: itemDefs[other] };
assert.equal(gifting.offerGift(strangerWalker), true, 'perfume remains an ordinary gift to other NPCs');
assert.equal(romance.getSpouse().perfume.recipeId, beforeOther, 'giving perfume to a stranger does not change the spouse');

const high = alchemy.ensureRecipeItemDef('perfumeOfEmbers', 4); // Higher-quality crafted perfume carries its existing alchemy potency tier.
inventory[high] = 1;
held = { kind: 'item', key: high, def: itemDefs[high] };
assert.equal(gifting.offerGift(spouseWalker), true);
assert.equal(romance.currentKissEffect().multiplier, 1.16, 'stored potency tier scales the kiss effect');
assert.equal(statProviders[0](player, 'maxStamina'), 1.16);
const saved = romance.serialize();
assert.equal(saved.spouse.perfume.potencyTier, 4);
romance.restore(saved);
assert.equal(romance.currentKissEffect().stat, 'maxStamina', 'perfume survives save and restore');
assert.equal(romance.currentKissEffect().multiplier, 1.16);
assert.equal(romance.remainingKissHours(), 24, 'restore preserves kiss expiry');
rawDay = 11; // One full day later; perfume remains on spouse but no stat bonus until another kiss.
assert.equal(romance.remainingKissHours(), 0);
assert.equal(statProviders[0](player, 'maxStamina'), 1);
romance.completeSpouseKiss('spouse');
assert.equal(statProviders[0](player, 'maxStamina'), 1.16, 'the next kiss reuses the worn perfume');
const tampered = romance.serialize();
tampered.spouse.perfume = { recipeId: 'potionOfStrength', potencyTier: 4 };
romance.restore(tampered);
assert.equal(romance.currentKissEffect().stat, 'staminaRegen', 'non-perfume save payloads cannot grant an arbitrary buff');
const legacy = romance.serialize();
delete legacy.spouse.perfume;
romance.restore(legacy);
assert.equal(statProviders[0](player, 'staminaRegen'), 1.10, 'old saves remain fully compatible');
romance.completeWedding('spouse');
assert.equal(romance.getSpouse().perfume, undefined, 'a new marriage starts without inherited perfume');
assert.ok(toasts.some(message => message.includes('Beloved')), 'kiss feedback remains visible');
console.log('spouse alchemy perfumes: brewing, gifting, replacement, potency, persistence and expiry passed');
