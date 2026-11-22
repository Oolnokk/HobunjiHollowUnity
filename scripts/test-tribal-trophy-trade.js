'use strict';
// node scripts/test-tribal-trophy-trade.js
// Integration regression: actual NPC gifting/daily gate plus bandit corpse pickup,
// without a renderer or mutable account save. Mirrors the mobile action dispatcher.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8');

const definitions = { gift: { label: 'Gift', qualityStars: 5 }, herb: { label: 'Herb' }, fish: { label: 'Fish' }, meat: { label: 'Meat' } }; // Live bag registry shared by corpse and gift runtimes.
const itemCatalog = []; // Item wheel catalogue receives one entry per new trophy.
const inventory = { gift: 3, omgurkuHorn: 4, porakanekiQuill: 3 }; // Tracks spent and received items.
const states = new Map(); // Existing chief Favor and daily gift metadata.
const saves = []; // Save snapshots must include a spent token and any awarded reward together.
const toasts = []; // Visible feedback on mobile.
const recordedRewards = []; // Unique/trinket grants use the ordinary gift grant path.
let day = 1; // Civil game day drives the ordinary NPC Rapport gift limit.
let held = { kind: 'item', key: 'omgurkuHorn' }; // Current item in hand.
let distance = 1; // FurnitureTableSystem interaction distance in tiles.
let atChiefCamp = true; // Real runtime supplies this from the active seasonal chief camp.
let roll = 0.999; // Deterministic return-gift pool selector.
let rewardPools = { herbs: ['herb'], fish: ['fish'], meat: ['meat'], animals: [] }; // Existing regional pool definitions.
let qualityConsumes = 0; // Currency must not consume regular gifted-item quality buckets.
const modalLocks = { acquired: 0, released: 0 }; // Verifies the shared action-lock authority never leaks a modal lock.
const relation = id => { if (!states.has(id)) states.set(id, { favor: 0, memory: [] }); return states.get(id); };
const windowStub = {
  addEventListener() {}, __farmLog() {},
  SCRATCHBONES_CONFIG: { game: {} },
  CalendarSystem: { timeDebugSnapshot: () => ({ civilDay: day, rawDay: day, time01: 0.5 }) },
  DialogueContent: {
    getNpcDlgState: relation,
    adjustNpcFavor(id, amount) { relation(id).favor += amount; },
    npcRelationshipsSnapshot: () => Object.fromEntries(states),
    loadNpcRelationships() {},
  },
  ItemTraits: { computeItemTraits: key => key === 'gift' ? ['loved_trait'] : [], isTraitDiscovered: () => false },
  CookingSystem: { peekLowestQuality: key => key === 'gift' ? definitions.gift.qualityStars : null, consumeQuality() { qualityConsumes++; return false; } },
  FurnitureTableSystem: { npcDistance: () => distance },
  TribeCamps: { get: () => ({ isAtChiefCamp: () => atChiefCamp }) },
  InventoryStacks: { MAX_TOTAL: 999 },
  CharacterActionLocks: { acquire(options) {
    assert.deepEqual(options.participants[0].channels, ['movement', 'tools', 'actions'], 'the menu uses the shared gameplay action lock');
    modalLocks.acquired++;
    return { release() { modalLocks.released++; } };
  } },
  TrinketSystem: {
    DEFINITIONS: { engravedWhistle: { displayName: 'Engraved Whistle' } },
    grant(id) { recordedRewards.push(id); return id; },
  },
  FarmAnimals: { queueItemGenotype() {} },
  CreatureGenetics: { makeRareGiftGenotype: () => ({ trait: 'rare' }) },
};
const documentStub = { // Fake touch/controller DOM is intentionally minimal and exercises the real delegated tier selector.
  activeElement: { focus() {} },
  exitPointerLock() {},
  body: { last: null, append(node) { this.last = node; } },
  createElement() {
    const elements = {};
    return { style: {}, events: {}, setAttribute() {}, addEventListener(type, fn) { this.events[type] = fn; },
      querySelector(query) { return query === 'button:not([disabled])' ? { focus() {} } : (elements[query] ||= { innerHTML: '', textContent: '' }); } };
  },
};
const chooseTier = tier => documentStub.body.last.events.click({ stopPropagation() {}, target: { closest: () => ({
  disabled: false, hasAttribute: () => false, getAttribute: name => name === 'data-trophy-tier' ? String(tier) : null,
}) } });
const chooseCategory = (tier, category) => documentStub.body.last.events.click({ stopPropagation() {}, target: { closest: () => ({
  disabled: false, hasAttribute: () => false,
  getAttribute: name => name === 'data-trophy-tier' ? String(tier) : name === 'data-trophy-category' ? category : null,
}) } }); // Sends the live category button's attributes through the delegated click handler.
const context = vm.createContext({ window: windowStub, document: documentStub, console,
  fetch: () => Promise.resolve({ ok: false, text: () => Promise.resolve('') }) });
vm.runInContext(read('docs/js/npc-gifting.js'), context);
vm.runInContext(read('docs/js/favor-heart-balance.js'), context); // Real gift-star scaling wrapper.
windowStub.NpcGifting.init({
  getHeldGiftItem: () => held, getItemDefs: () => definitions, inventoryItems: itemCatalog, inventory,
  getPorakanekiRewardPools: () => rewardPools,
  getInventoryMax: () => 999, getNpcRecordById: () => ({ gifts: { loved: ['loved_trait'], liked: ['liked_trait'] } }), random: () => roll,
  saveMemberWorldData: () => saves.push({ ...inventory }),
  clampInventoryStack() {}, showToast(message) { toasts.push(message); },
  refreshItemScroll() {}, buildInventoryGrid() {}, refreshActionBar() {},
});
vm.runInContext(read('docs/js/npc-social-relationship-bridge-v2.js'), context);
const gifting = windowStub.NpcGifting;
const porakaneki = { rec: { id: 'porakaneki_hunter', species: 'porakaneki' }, isTribeHunter: true, tribeId: 'porakaneki', tribeCampKind: 'chief' };
const omgurku = { rec: { id: 'omgurku_hunter', species: 'omgurku' }, isTribeHunter: true, tribeId: 'omgurku', tribeCampKind: 'chief' };
const civilian = { rec: { id: 'town_npc', species: 'mao-ao' } };

assert.equal(definitions.omgurkuHorn.noGift, true);
assert.equal(definitions.porakanekiQuill.noGift, true);
assert.equal(definitions.omgurkuHorn.sellPrice, 0);
assert.equal(itemCatalog.filter(item => item.key === 'omgurkuHorn').length, 1);
gifting.registerTribalTrophyItems(); // A second initialization must not add duplicate wheel entries.
assert.equal(itemCatalog.filter(item => item.key === 'porakanekiQuill').length, 1);
assert.equal(gifting.getNpcGiftOfferAction(civilian), null, 'ordinary NPCs cannot accept trophy currency');


atChiefCamp = false;
assert.equal(gifting.getNpcGiftOfferAction(porakaneki), null, 'enemy trophies require the great camp');
assert.equal(gifting.offerGift(porakaneki), false);
atChiefCamp = true;
assert.match(gifting.getNpcGiftOfferAction(porakaneki).label, /choose tier/);
assert.equal(gifting.offerGift(porakaneki), true, 'tap opens a selection menu');
assert.equal(inventory.omgurkuHorn, 4, 'opening menu does not spend currency');
const tierHtml = documentStub.body.last.querySelector('[data-trophy-tiers]').innerHTML;
assert.match(tierHtml, /data-trophy-tier="1"/);
assert.match(tierHtml, /data-trophy-tier="2"/);
assert.match(tierHtml, /data-trophy-tier="3"/);
chooseTier(3);
assert.equal(inventory.omgurkuHorn, 1, 'large costs three trophies');
assert.equal(inventory.meat, 15);
assert.equal(gifting.lastTrophyTrade().spent, 3);
assert.equal(relation('porakaneki_chief').favor, 3);
assert.equal(relation('omgurku_chief').favor, -3);
assert.equal(qualityConsumes, 0);

inventory.omgurkuHorn = 2;
assert.equal(gifting.offerGift(porakaneki), true);
assert.match(documentStub.body.last.querySelector('[data-trophy-tiers]').innerHTML, /data-trophy-tier="3"[^>]*disabled/);
assert.equal(gifting.exchangeTribalTrophy(porakaneki, 3), false, 'insufficient trophies cannot buy higher tier');
chooseTier(2);
assert.equal(inventory.omgurkuHorn, 0, 'medium costs two trophies');
assert.equal(inventory.meat, 25, 'medium yields ten items');
assert.equal(relation('porakaneki_chief').favor, 5);
assert.equal(relation('omgurku_chief').favor, -5);
inventory.omgurkuHorn = 1;
assert.equal(gifting.offerGift(porakaneki), true);
chooseTier(1);
assert.equal(inventory.omgurkuHorn, 0, 'small costs one trophy');
assert.equal(inventory.meat, 30, 'small yields five items');
assert.equal(relation('porakaneki_chief').favor, 6);
assert.equal(relation('omgurku_chief').favor, -6);

held = { kind: 'item', key: 'porakanekiQuill' };
atChiefCamp = false;
assert.equal(gifting.offerGift(porakaneki), true, 'own tribe accepts trophies at small camps');
assert.equal(inventory.porakanekiQuill, 2);
assert.equal(inventory.meat, 30, 'own trophy yields no gift');
assert.equal(gifting.exchangeTribalTrophy(porakaneki, 2), false, 'own trophy cannot buy tier');
assert.equal(relation('porakaneki_chief').favor, 7);
assert.equal(relation('omgurku_chief').favor, -7);
assert.equal(qualityConsumes, 0, 'all trophy exchanges bypass the gift quality wrapper');

atChiefCamp = true;
held = { kind: 'item', key: 'gift', def: definitions.gift };
assert.equal(gifting.offerGift(porakaneki), true, 'ordinary 5-star gift still works');
assert.equal(inventory.meat, 45, '5-star loved gift yields large return gift');
assert.equal(windowStub.NpcRapport.canGiftToday('porakaneki_chief'), false);
assert.equal(gifting.offerGift(porakaneki), false, 'ordinary gift remains once daily');
inventory.omgurkuHorn = 1;
held = { kind: 'item', key: 'omgurkuHorn' };
assert.ok(gifting.getNpcGiftOfferAction(porakaneki), 'trades remain after the daily ordinary gift');
assert.equal(gifting.offerGift(porakaneki), true);
chooseTier(1);
assert.equal(windowStub.NpcRapport.canGiftToday('porakaneki_chief'), false);
assert.equal(qualityConsumes, 1, 'currency did not consume cooking-quality item');

definitions.gift.qualityStars = 1;
held = { kind: 'item', key: 'gift', def: definitions.gift };
const beforeSmallGift = inventory.meat;
assert.equal(gifting.offerGift(omgurku), true, 'other tribe may receive one ordinary gift on the same day');
assert.equal(inventory.meat, beforeSmallGift + 5, '1-star loved gift yields small return');
assert.equal(qualityConsumes, 2, 'only the two real gifts consumed quality units');

held = { kind: 'item', key: 'porakanekiQuill' };
assert.equal(gifting.offerGift(omgurku), true, 'Omgurku accepts enemy trophies symmetrically');
chooseTier(1);
assert.equal(inventory.porakanekiQuill, 1);
distance = 3;
assert.equal(gifting.getNpcGiftOfferAction(porakaneki), null);
assert.equal(gifting.exchangeTribalTrophy(porakaneki, 1), false, 'stale remote action cannot spend');
distance = 1;
inventory.porakanekiQuill = 0;
assert.equal(gifting.exchangeTribalTrophy(porakaneki, 1), false, 'depleted trophy cannot be spent twice');

inventory.omgurkuHorn = 1;
inventory.meat = 999;
inventory.herb = 999;
inventory.fish = 999;
held = { kind: 'item', key: 'omgurkuHorn' };
assert.equal(gifting.exchangeTribalTrophy(porakaneki, 1), false, 'full reward inventory prevents spending');
assert.equal(inventory.omgurkuHorn, 1);
assert.equal(gifting.lastTrophyTrade().receivingTribe, 'omgurku');

// Rank I–III progressively unlock specific pools, not higher random tiers.
const factionStanding = () => windowStub.NpcFavorBalance.factionPoints('faction:porakaneki'); // Canonical saved tribe reputation value.
const rank = () => gifting.trophyTradingRank('porakaneki'); // The same public getter used to render and authorize purchases.
inventory.omgurkuHorn = 12;
inventory.herb = inventory.fish = inventory.meat = 0;
held = { kind: 'item', key: 'omgurkuHorn' };
atChiefCamp = true;
assert.equal(rank(), 0, 'rank zero starts with random-only gifts');
assert.equal(gifting.exchangeTribalTrophy(porakaneki, 1, null, 'herbs'), false, 'unranked player cannot call targeted trade directly');
assert.equal(gifting.offerGift(porakaneki), true);
assert.equal(documentStub.body.last.querySelector('[data-trophy-tiers]').innerHTML.includes('data-trophy-category='), false, 'rank-zero menu hides locked targeted pools');
gifting.closeTrophyTradeMenu();
assert.equal(inventory.omgurkuHorn, 12, 'closing the menu cannot spend tokens');
assert.equal(modalLocks.acquired, modalLocks.released, 'explicit modal cancel releases the common player-action lock');

windowStub.DialogueContent.adjustNpcFavor('porakaneki_chief', 40 - factionStanding(), 'rank_test', false, true);
assert.equal(rank(), 1);
assert.equal(gifting.trophyPurchaseCost({ rank: 1, cost: 1 }, 'herbs'), 3, 'small pool costs one plus two trophies');
assert.equal(gifting.offerGift(porakaneki), true);
let html = documentStub.body.last.querySelector('[data-trophy-tiers]').innerHTML;
assert.match(html, /data-trophy-tier="1" data-trophy-category="herbs"/);
assert.equal(/data-trophy-tier="2" data-trophy-category=/.test(html), false, 'rank I cannot target medium pools');
assert.equal(/data-trophy-tier="3" data-trophy-category=/.test(html), false, 'rank I cannot target large pools');
assert.equal(gifting.exchangeTribalTrophy(porakaneki, 2, null, 'fish'), false, 'server-side rank check blocks premature medium targeting');
const firstFavor = relation('porakaneki_chief').favor, firstRival = relation('omgurku_chief').favor; // Tracks exact Favor cost without counting earlier gifts.
chooseCategory(1, 'herbs');
assert.equal(inventory.omgurkuHorn, 9);
assert.equal(inventory.herb, 5, 'selected herb pool is guaranteed');
assert.equal(relation('porakaneki_chief').favor, firstFavor + 3, 'rank multipliers cannot change the +1 Favor per trophy contract');
assert.equal(relation('omgurku_chief').favor, firstRival - 3);
assert.equal(gifting.lastTrophyTrade().category, 'herbs');
assert.equal(gifting.lastTrophyTrade().spent, 3);
inventory.herb = 999;
assert.equal(gifting.availableBarterCategories(0, held, 3).some(pool => pool.id === 'herbs'), false);
assert.equal(gifting.exchangeTribalTrophy(porakaneki, 1, null, 'herbs'), false, 'full chosen pool must not spend currency or give a different gift');
assert.equal(inventory.omgurkuHorn, 9);
inventory.herb = 0;

windowStub.DialogueContent.adjustNpcFavor('porakaneki_chief', 120 - factionStanding(), 'rank_test', false, true);
assert.equal(rank(), 2);
assert.equal(gifting.trophyPurchaseCost({ rank: 2, cost: 2 }, 'fish'), 5, 'medium pool costs two plus three trophies');
inventory.omgurkuHorn = 5;
assert.equal(gifting.offerGift(porakaneki), true);
html = documentStub.body.last.querySelector('[data-trophy-tiers]').innerHTML;
assert.match(html, /data-trophy-tier="2" data-trophy-category="fish"/);
assert.equal(/data-trophy-tier="3" data-trophy-category=/.test(html), false, 'rank II cannot target large pools');
chooseCategory(2, 'fish');
assert.equal(inventory.omgurkuHorn, 0);
assert.equal(inventory.fish, 10, 'selected medium fish pool guarantees ten fish');
assert.equal(gifting.lastTrophyTrade().spent, 5);

windowStub.DialogueContent.adjustNpcFavor('porakaneki_chief', 240 - factionStanding(), 'rank_test', false, true);
assert.equal(rank(), 3);
assert.equal(gifting.trophyPurchaseCost({ rank: 3, cost: 3 }, 'meat'), 7, 'large pool costs three plus four trophies');
inventory.omgurkuHorn = 7;
assert.equal(gifting.offerGift(porakaneki), true);
html = documentStub.body.last.querySelector('[data-trophy-tiers]').innerHTML;
assert.match(html, /data-trophy-tier="3" data-trophy-category="meat"/);
assert.match(html, /data-trophy-tier="3" data-trophy-category="unique"/, 'authored high-tier uniques form a targeted pool');
chooseCategory(3, 'meat');
assert.equal(inventory.omgurkuHorn, 0);
assert.equal(inventory.meat, 15);
assert.equal(gifting.lastTrophyTrade().spent, 7);
assert.equal(gifting.lastTrophyTrade().category, 'meat');

inventory.omgurkuHorn = 7;
const uniqueBefore = recordedRewards.length; // Verifies the existing unique-grant pathway is reused for a paid pool.
assert.equal(gifting.offerGift(porakaneki), true);
chooseCategory(3, 'unique');
assert.equal(inventory.omgurkuHorn, 0);
assert.equal(recordedRewards.length, uniqueBefore + 1);
assert.equal(recordedRewards.at(-1), 'engravedWhistle', 'high-tier specific rewards come from authored unique pool');

rewardPools.animals = [{ itemKey: 'baby', kind: 'moot' }];
definitions.baby = { label: 'Baby Moot' };
inventory.baby = 0;
inventory.omgurkuHorn = 7;
assert.equal(gifting.offerGift(porakaneki), true);
html = documentStub.body.last.querySelector('[data-trophy-tiers]').innerHTML;
assert.match(html, /data-trophy-tier="3" data-trophy-category="animals"/);
held = { kind: 'item', key: 'porakanekiQuill' };
chooseCategory(3, 'animals');
assert.equal(inventory.omgurkuHorn, 7, 'changing held trophy after opening the menu blocks spending');
held = { kind: 'item', key: 'omgurkuHorn' };
atChiefCamp = false;
chooseCategory(3, 'animals');
assert.equal(inventory.omgurkuHorn, 7, 'walking away from the great camp blocks stale menu purchases');
atChiefCamp = true;
chooseCategory(3, 'animals');
assert.equal(inventory.omgurkuHorn, 0);
assert.equal(inventory.baby, 1);
assert.equal(gifting.lastTrophyTrade().reward.rank, 3, 'chosen animal pool inherits the selected large-tier genetics rank');
assert.equal(qualityConsumes, 2, 'targeted currency never consumes gift cooking-quality data');
// Ordinary gifts at high faction rank must preflight the same rank multiplier applied to actual Favor.
day++;
inventory.gift = 1;
definitions.gift.qualityStars = 4;
held = { kind: 'item', key: 'gift', def: definitions.gift };
windowStub.ItemTraits.computeItemTraits = key => key === 'gift' ? ['liked_trait'] : [];
const beforeRankedReturn = inventory.meat;
assert.equal(gifting.offerGift(porakaneki), true, 'rank III can still receive normal gifts on the next day');
assert.equal(inventory.meat, beforeRankedReturn + 10, '4-star liked gift crosses medium reward threshold after existing faction multiplier');
held = { kind: 'item', key: 'omgurkuHorn' };
inventory.omgurkuHorn = 7;
assert.equal(gifting.exchangeTribalTrophy(omgurku, 3, null, 'animals'), false, 'recipient tribe rank must independently unlock targeted pools');
assert.equal(inventory.omgurkuHorn, 7);

// Validate the live great-camp guard with two different coordinate systems, not a mocked always-true camp.
const campSource = read('docs/js/porakaneki-camps-runtime.js'); // Source of the exported guard for both tribes.
const guardSource = campSource.match(/  function isAtChiefCamp\(walker\) \{[\s\S]*?\n  \}/)?.[0]; // Extract the small pure predicate without bootstrapping an entire biome.
assert.ok(guardSource, 'the camp still exports its seasonal great-camp predicate');
const chiefZone = 'map_test_tribe'; // Test map used for the chief camp and named chief.
const chiefSite = { x: 10, y: 12, w: 6, h: 5 }; // Exact tile-space camp footprint for geometry assertions.
const chiefState = { chiefZoneId: chiefZone, zones: new Map([[chiefZone, { chiefCamp: { zoneId: chiefZone, instance: { site: chiefSite } } }]]) }; // Runtime zone/camp state subset.
const atGreatCamp = new Function('state', 'cfg', 'CHIEF_ID', 'KEY', 'combatDeps', 'currentArea',
  guardSource + '\nreturn isAtChiefCamp;')(chiefState, {}, 'porakaneki_chief', 'porakaneki', { TILE: 32 }, () => chiefZone); // Execute the shipped predicate, not a copy.
assert.equal(atGreatCamp({ area: chiefZone, rec: { id: 'porakaneki_chief' }, root: { position: { x: 12 * 32, z: 14 * 32 } } }), true, 'named chief at world-unit coordinates is accepted');
assert.equal(atGreatCamp({ area: chiefZone, rec: { id: 'porakaneki_chief' }, root: { position: { x: 50 * 32, z: 14 * 32 } } }), false, 'named chief outside footprint is rejected');
assert.equal(atGreatCamp({ area: chiefZone, isTribeHunter: true, tribeId: 'porakaneki', tribeCampKind: 'chief' }), true, 'great-camp hunters use stamped camp identity');
assert.equal(atGreatCamp({ area: chiefZone, isTribeHunter: true, tribeId: 'porakaneki', tribeCampKind: 'small' }), false, 'small-camp hunters cannot sell return gifts');

// The same corpse interaction used by every humanoid must bypass ALL bandit loot for tribes.
let ordinaryRolls = 0; // Ensures neither coin, mastery, ammunition nor wardrobe reward paths run for trophies.
const despawned = [];
vm.runInContext(read('docs/js/bandit-camps.js'), context);
windowStub.BanditCamps.init({
  inventory, ITEM_DEFS: definitions, inventoryItems: itemCatalog, corpseObjects: new Set(),
  rollLootPool() { ordinaryRolls++; return { gold: 6 }; },
  itemIconForKey: key => definitions[key]?.icon || '?',
  clampInventoryStack() {}, refreshItemScroll() {}, buildInventoryGrid() {}, isMenuOpen: () => false,
  getPackClothing: () => [], scheduleLootMemberSave() {}, saveMemberWorldData() {},
  despawnCreature(c) { despawned.push(c); },
  debugLog() {},
});
for (const [tribeId, key] of [['omgurku', 'omgurkuHorn'], ['porakaneki', 'porakanekiQuill']]) {
  const corpse = { id: 'test_' + tribeId, name: tribeId, def: { label: tribeId, lootPool: 'bandit_grunt' }, isTribeHunter: true, tribeId };
  const object = windowStub.BanditCamps.makeCorpseWorldObject(corpse);
  assert.match(object.getButtons()[0].label, /Collect/);
  const before = inventory[key] || 0;
  assert.equal(object.onAction('obj_loot_corpse').ok, true);
  assert.equal(inventory[key], before + 1);
  assert.equal(object.onAction('obj_loot_corpse').ok, false, 'repeated button press must not mint a second trophy');
  assert.equal(inventory[key], before + 1);
}
inventory.omgurkuHorn = 999;
const fullCorpse = { id: 'full_pack', name: 'Full', def: { label: 'Omgurku', lootPool: 'bandit_grunt' }, isTribeHunter: true, tribeId: 'omgurku' };
const fullObject = windowStub.BanditCamps.makeCorpseWorldObject(fullCorpse);
assert.equal(fullObject.onAction('obj_loot_corpse').ok, false, 'full trophy stack must not silently discard a corpse reward');
assert.equal(fullCorpse.corpseLooted, undefined, 'full inventory leaves body lootable');
inventory.omgurkuHorn = 998;
assert.equal(fullObject.onAction('obj_loot_corpse').ok, true, 'the same body can be looted after making space');
assert.equal(inventory.omgurkuHorn, 999);
assert.equal(ordinaryRolls, 0, 'tribal corpses cannot roll bandit coin, scrap or mastery');
assert.equal(despawned.length, 3, 'existing corpse disposal still completes');
gifting.closeTrophyTradeMenu();
assert.equal(modalLocks.acquired, modalLocks.released, 'every modal open/close path releases gameplay actions');
assert.ok(saves.length >= 4, 'normal persistent inventory save path remains used');
console.log('Tribal trophies: rank I/II/III category unlocks; targeted 3/5/7 cost, base 1/2/3 cost, category rewards, Favor, distance/hold, quality and corpses passed.');
