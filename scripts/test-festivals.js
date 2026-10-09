#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Exercises production modules and authored layouts.
const fs = require('node:fs'); // Loads the exact shipped files.
const vm = require('node:vm'); // Isolated calendar, inventory, and save state.
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json')); // Authored base and five complete variants.
const load = (context, name) => vm.runInContext(fs.readFileSync(`docs/js/${name}.js`, 'utf8'), context, { filename: name }); // Shared production loader.
let civilDay = 1, year = 1155, time = 100, area = 'town', blocked = false; // Deterministic world/civil calendar and action state.
let position = { c: 0, r: 0 }, saved = 0, dancing = false, duelQuest = null, costume = null; // Observable runtime boundaries.
const inventory = { meal: 3, keepsake: 2, gold: 500, forbidden: 1, wine: 0 }; // Inventory totals must agree with tracked quality.
const defs = { meal: { label: 'Feast dish', isCookedFood: true }, keepsake: { label: 'Carved stone' }, gold: { label: 'Gold' }, forbidden: { label: 'Quest item', isQuestItem: true }, wine: { label: 'Wine' } }; // Realistic narrow item metadata.
const buckets = { meal: { 1: 1, 3: 1, 5: 1 }, keepsake: { 2: 1, 5: 1 } }; // Exact mixed-quality stacks.
const npcs = [{ id: 'friend', name: 'Friend', homeId: 'inn' }, { id: 'newfriend', homeId: 'temple' }, { id: 'farfriend', homeId: 'elsewhere' }, { id: 'deadfriend', homeId: 'hatayap_clan_deceased' }, { id: 'spearhead_unumanuk', homeId: 'unumanuk_household' }, { id: 'father_hunundi_hodu', homeId: 'temple' }]; // Includes remote and unavailable records.
const favors = { friend: 120, newfriend: 119, farfriend: 160, deadfriend: 200 }; // Forty Favor per heart, matching NpcFavorBalance.
const deltas = []; // Records actual favor mutations, not UI promises.
const window = { InventoryStacks: { MAX_TOTAL: 9999 }, DialogueContent: { getNpcDlgState: id => ({ favor: favors[id] || 0 }), adjustNpcFavor: (id, amount, reason) => deltas.push({ id, amount, reason }) }, NpcGifting: { isItemGiftable: ({ key }) => !!defs[key] }, NpcWardrobe: { registerAppearanceDecorator: (id, fn) => { costume = fn; }, slotForCosmetic: id => id.includes('hood') ? 'hood' : 'body', refreshWalkerAppearance() {} }, NpcScheduling: { registerTargetOverride() {} }, EffectBuffBar: { registerProvider() {}, refresh() {} }, FestivalUI: { close() {}, update() {} }, SocialActionWheel: { startDance: () => (dancing = true), stopDance: () => { dancing = false; }, getDebug: () => ({ dancing }) }, MusicMinigame: { beginPlayerSession() {} }, HobunjiDrunkGameplayBridge: { isAlcoholDef: def => def.label === 'Wine' }, CombatTutorial: { active: () => false, start: quest => { duelQuest = quest; return true; } } }; // Public integrations; production festival logic itself is not mocked.
const context = vm.createContext({ window, document: { hidden: false }, performance: { now: () => time }, console }); // No browser or network needed.
load(context, 'festival-calendar'); load(context, 'map-layout-system');
window.CalendarSystem = { isInitialized: () => true, monthNumber: () => Math.floor((civilDay - 1) / 28) + 1, dayOfMonth: () => (civilDay - 1) % 28 + 1, aotYearNumber: () => year, getHour: () => 12, currentWeekdayName: () => 'Anan' }; // Assigned after MapLayoutSystem so its real civil bridge isn't installed around a stub.
window.CookingSystem = {
  registerCookedDefinition: (key, def) => { defs[key] = { ...def, isCookedFood: true }; },
  recordItemQuality: (key, stars, count) => { (buckets[key] ||= {})[stars] = (buckets[key]?.[stars] || 0) + count; },
  availableQualityEntries: key => Object.entries(buckets[key] || {}).filter(([, count]) => count > 0).map(([stars, count]) => ({ stars: Number(stars), count })),
  consumeQuality: (key, stars, count) => { if (!(buckets[key]?.[stars] >= count) || !(inventory[key] >= count)) return false; buckets[key][stars] -= count; inventory[key] -= count; return true; },
};
window.AlchemySystem = { RECIPE_DEFS: { healing: { id: 'healing', useMode: 'drink', traits: { drive: 'restore' } } }, ensureRecipeItemDef: (id, tier) => { const key = `${id}_${tier}`; defs[key] = { label: 'Potent healing' }; return key; } }; // Existing potion definition/grant contract.
load(context, 'festival-system');
const api = window.FestivalSystem, calendar = window.FestivalCalendar; // Production APIs under test.
api.init({ inventory, getItemDefs: () => defs, getNpcs: () => npcs, getWalkers: () => npcs.map(rec => ({ rec, area: 'town' })), getTownMap: () => town, getArea: () => area, getPlayerTile: () => position, getDecorSize: key => ({ fw: key === 'tableLong' ? 4 : key === 'rug' ? 2 : 1, fd: key === 'rug' ? 2 : 1 }), isBlocked: () => blocked, refresh() {}, save: () => { saved++; }, toast() {}, grantMask: () => true, tellStory: () => ({ ok: true }) });
function visit(id, type) {
  const def = calendar.get(id); // Move time and feet to the real authored interaction anchor.
  civilDay = calendar.ordinal(def.month, def.day);
  const prop = api.activityProps().find(p => p.activity.type === type);
  assert(prop, `${id} has working ${type} anchor`);
  position = { c: prop.col + (prop.key === 'tableLong' ? 2 : prop.key === 'rug' ? 1 : .5) + (prop.postX || 0), r: prop.row + (prop.key === 'rug' ? 1 : .5) + (prop.postZ || 0) };
  return prop;
}
function perform(prop, data = {}) { return api.perform(prop.activity.type, { propId: prop.id, ...data }); }
// Every festival has exactly seven days and a complete, automatically selected editable layout.
for (const festival of calendar.festivals) {
  const start = calendar.ordinal(festival.month, festival.day);
  for (let offset = 0; offset < 7; offset++) {
    assert.equal(calendar.forOrdinal(start + offset)?.id, festival.id);
    const active = window.MapLayoutSystem.getEffectiveMapData(town, { dateOrdinal: start + offset, minutes: 720, weekday: 'Anan' });
    assert.equal(active.activeLayoutId, `festival_${festival.id}`);
    for (const type of festival.activities) assert(active.decor.some(p => p.activity?.type === type), `${festival.id}/${type} missing`);
    assert.strictEqual(active.transitions, town.transitions, 'all exits stay unchanged');
    assert.strictEqual(active.buildings, town.buildings, 'all original buildings stay open');
    assert.strictEqual(active.routes, town.routes, 'all original roads stay unchanged');
  }
  assert.notEqual(calendar.forOrdinal(start - 1)?.id, festival.id);
  assert.notEqual(calendar.forOrdinal(start + 7)?.id, festival.id);
}
assert.equal(calendar.festivals.reduce((count, festival) => count + 7, 0), 35);
assert.equal(window.MapLayoutSystem.getEffectiveMapData(town, { dateOrdinal: 1 }).decor.length, 2, 'normal day restores base decor');
// Test the actual region/calendar conversion; visual months must not move regional seasons.
const actualCalendar = vm.createContext({ window: {}, THREE: { Color: class { setHSL() { return this; } } }, console });
load(actualCalendar, 'calendar-system');
const cs = actualCalendar.window.CalendarSystem;
assert.equal(cs.seasonForDay(calendar.ordinal(9, 14) - 84).name, 'Deadgrass');
assert.equal(cs.seasonForDay(calendar.ordinal(9, 15) - 84).name, 'Longpour');
assert.equal(cs.seasonForDay(calendar.ordinal(5, 8) - 84).name, 'Stormtide');
// Gift thresholds, remote friends, capacity rejection, exactly-once persistence, and annual renewal.
let prop = visit('mountaindawn', 'gifts');
assert.equal(api.giftMultiplier(), 2);
assert.equal(perform(prop, { npcId: 'newfriend' }).ok, false);
assert.equal(perform(prop, { npcId: 'deadfriend' }).ok, false);
inventory.healing_2 = 9998;
assert.equal(perform(prop, { npcId: 'friend' }).ok, false);
assert.equal(api.claimed('gift:friend'), false);
inventory.healing_2 = 0;
assert.equal(perform(prop, { npcId: 'friend' }).ok, true);
assert.equal(inventory.healing_2, 2);
assert.equal(perform(prop, { npcId: 'friend' }).ok, false);
assert.equal(perform(prop, { npcId: 'farfriend' }).ok, true, 'eligible friends outside town also have a gift');
const snapshot = api.serialize(); api.restore(snapshot);
assert.equal(perform(prop, { npcId: 'friend' }).ok, false, 'reload does not reset annual claims');
year++; assert.equal(perform(prop, { npcId: 'friend' }).ok, true, 'next year gives a new gift');
// Potluck consumes the selected quality, grants everyone the announced reward, and rejects stale/malformed choices.
prop = visit('gorkunash', 'potluck');
assert.equal(api.giftMultiplier(), 1);
assert.equal(perform(prop, { key: 'meal', stars: 4 }).ok, false);
assert.equal(inventory.meal, 3);
assert.equal(perform(prop, { key: 'meal', stars: 5 }).ok, true);
assert.equal(inventory.meal, 2); assert.equal(buckets.meal[1], 1); assert.equal(buckets.meal[5], 0);
assert.equal(deltas.filter(d => d.reason === 'festival_potluck').length, api.residents().length);
assert(deltas.filter(d => d.reason === 'festival_potluck').every(d => d.amount === 16));
assert.equal(perform(prop, { key: 'meal', stars: 1 }).ok, false);
// Offerings validate choice before consumption, persist exact quality, and expire after one full year.
prop = visit('tzizkhanash', 'offering');
assert(!api.qualityChoices('offering').some(entry => ['gold', 'forbidden'].includes(entry.key)));
assert.equal(perform(prop, { key: 'keepsake', stars: 5, stat: 'madeup' }).ok, false);
assert.equal(inventory.keepsake, 2);
assert.equal(perform(prop, { key: 'keepsake', stars: 5, stat: 'speed' }).ok, true);
assert.equal(inventory.keepsake, 1); assert.equal(api.blessingMultiplier('speed'), 1.1);
const blessingSave = api.serialize(); api.restore(blessingSave); assert.equal(api.blessingMultiplier('speed'), 1.1);
year++; civilDay--; assert.equal(api.blessingMultiplier('speed'), 1.1);
civilDay++; assert.equal(api.blessingMultiplier('speed'), 1);
api.restore({ blessing: { stat: 'speed', level: 'broken', expiresDay: Infinity } }); assert.equal(api.blessingMultiplier('speed'), 1);
// Masks stay a render copy; sweeets/masks cannot be farmed by repeating the menu.
prop = visit('hachutukara', 'masks');
const original = { id: 'friend', equippedCosmetics: ['old_hood', 'robe'], appearance: { speciesId: 'mao-ao' } };
const dressed = costume(original); assert.notStrictEqual(dressed, original); assert.deepEqual(original.equippedCosmetics, ['old_hood', 'robe']); assert(dressed.equippedCosmetics.some(id => id.startsWith('festivalmask_')));
assert.equal(perform(prop, { mask: 'gar-wolf' }).ok, true);
assert.equal(perform(prop, { mask: 'grehlr' }).ok, false);
prop = visit('hachutukara', 'sweets'); assert.equal(perform(prop, { npcId: 'friend' }).ok, true); assert.equal(inventory.festivalSweet, 1); assert.equal(perform(prop, { npcId: 'friend' }).ok, false);
prop = visit('hachutukara', 'duel'); assert.equal(perform(prop), true); assert(duelQuest.transient); assert.equal(duelQuest.practice.area, 'town'); assert(duelQuest.isAvailable());
civilDay += 7; assert.equal(duelQuest.isAvailable(), false);
// Real time spent dancing is required. Interruptions and stale/replayed actions never earn rewards.
prop = visit('five_blossoms', 'dance'); assert.equal(perform(prop).ok, true);
for (let i = 0; i < 99; i++) { time += 200; api.update(); }
assert.equal(api.claimed('dance'), false);
time += 400; api.update(); assert.equal(api.claimed('dance'), true);
const favorCount = deltas.length;
assert.equal(perform(prop).ok, true); position.c += 10; time += 200; api.update(); assert.equal(api.dance, null); assert.equal(deltas.length, favorCount);
assert.equal(perform(prop).ok, false, 'cannot activate distant prop via a stale menu');
area = 'farm'; assert.equal(api.actionButton(), null);
assert(saved >= 7);
console.log('Festival calendar, layouts, quality rewards, annual persistence, costumes, and dance checks passed.');
