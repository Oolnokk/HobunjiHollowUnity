'use strict';

// Regression coverage for the Fey-knot quest's actual runtime modules.
// Run: node scripts/test-fey-armament-quest.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName; // Used to inspect real Garanki panel buttons and selects.
    this.children = []; // Collects controls created by the original render function.
    this.style = {}; // Matches the minimal style surface used by Garanki's rows.
    this.listeners = {}; // Allows the test to emulate player option changes.
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.disabled = false;
  }
  set innerHTML(value) { this._innerHTML = value; this.children = []; }
  get innerHTML() { return this._innerHTML || ''; }
  appendChild(child) {
    this.children.push(child);
    if (this.tagName === 'select' && child.selected) this.value = child.value;
    return child;
  }
  addEventListener(event, fn) { this.listeners[event] = fn; }
}

const list = new Element();
const goldDisplay = new Element();
const document = {
  addEventListener() {},
  createElement: tag => new Element(tag),
  getElementById(id) { return id === 'garankiEnchanterList' ? list : id === 'gkGoldDisplay' ? goldDisplay : null; },
};
const registered = { trees: {}, contexts: {}, nodes: {} };
const inventory = { gold: 30000 };
const gear = { tools: { sword: true }, harlyaoRelics: {}, toolMastery: {}, weaponEnchantments: {} };
const profile = { worldId: 'quest-test', questProgress: {} };
let txSaves = 0; // Counts combined character/member writes, separate from bound-item and dialogue member saves.
let saves = 0; // Verifies new weapon and quest persist together on first acquisition.
let failSave = false; // Simulates a canonical member-save rejection during grant and dialogue completion.
let gearSaves = 0; // Verifies enchanting uses the existing gear-save adapter.
const messages = [];
const enchantments = {
  BASE_LIMIT: 2,
  DEFINITIONS: {
    feyMist: { id: 'feyMist', alignment: 'Fey', type: 'Base', displayName: 'Fey Mist', description: 'An illusory mist.' },
    hroFlame: { id: 'hroFlame', alignment: 'Hronal', type: 'Base', displayName: 'Hro Flame', description: 'A fire spell.' },
    feyFeint: { id: 'feyFeint', alignment: 'Fey', type: 'Flourish', displayName: 'Fey Feint', description: 'A phantom feint.' },
  },
  cleanWeaponState: state => state,
  stateFor(key, create) {
    return gear.weaponEnchantments[key] || (create ? (gear.weaponEnchantments[key] = { base: [], flourishes: {} }) : { base: [], flourishes: {} });
  },
  addBase(key, id) { this.stateFor(key, true).base.push(id); return true; },
  equipBase(key, index, id) {
    const state = this.stateFor(key, true);
    if (id) state.base[index] = id;
    else state.base.splice(index, 1);
    return true;
  },
  setFlourish(key, slot, id) { this.stateFor(key, true).flourishes[slot] = id; return true; },
  flourishForSlot(slot, key) { return this.stateFor(key).flourishes[slot]; },
  isBaseUnlocked(id) { return !!this.DEFINITIONS[id]; },
  isFlourishUnlocked(id) { return !!this.DEFINITIONS[id]; },
  unlockFromState: state => [...state.base],
  unlockedOptions: () => ({ base: ['feyMist', 'hroFlame'], flourish: [{ id: 'feyFeint', slotId: 'tap1' }] }),
  getWeaponImmundanity: () => 0,
  getEnchantmentPowerMultiplier: () => 1,
  getMasteryPowerMultiplier: () => 1,
  logEvent() {},
};
const window = {
  __hobunjiPlayerProfile: profile,
  EnchantmentSystem: enchantments,
  DialogueContent: {
    registerTreeProvider(id, handler) { registered.trees[id] = handler; },
    registerContextProvider(id, handler) { registered.contexts[id] = handler; },
    registerNodeEnterHandler(id, handler) { registered.nodes[id] = handler; },
  },
  DelversGuild: { isMember: () => true, canEnchant: () => true, dialogueTree: () => null },
  WorldMetaStore: { loadArtifactCollection: () => ({ donated: [], pendingUnlocks: [] }), saveArtifactCollection: () => true },
  TasksPanel: { render() {} },
  CharacterMetaSave: { update(mutate) {
    if (failSave) return false;
    try { mutate({ id: 'test-character' }, { characters: [{ id: 'test-character' }] }); txSaves++; return true; }
    catch { return false; }
  } },
  setTimeout(fn) { fn(); },
};
const context = vm.createContext({ window, document, console, Date, Math, performance: { now: () => 0 } });
for (const path of ['docs/js/gear-member-transaction.js', 'docs/js/fey-armament-quest.js', 'docs/js/harlyao-relics.js', 'docs/js/artifact-collection.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
}
const deps = {
  inventory,
  ITEM_DEFS: {},
  inventoryItems: [],
  TOOL_ITEM_DEFS: { sword: { label: 'Sword', slots: ['weapon'] } },
  getGearInventory: () => gear,
  getQuestProgress: () => profile.questProgress,
  saveMemberWorldData() { saves++; return !failSave; },
  saveGearInventory() { gearSaves++; },
  showToast(message) { messages.push(message); },
  buildInventoryGrid() {},
  buildEquipmentSlots() {},
  tothalWorldId: () => profile.worldId,
};
const relics = window.HarlyaoRelics;
const quest = window.FeyArmamentQuest;
window.GearMemberTransaction.init({
  inventory, getGearInventory: () => gear, captureMemberWorldData: meta => meta,
  buildInventoryGrid() {}, buildEquipmentSlots() {}, showToast() {},
}); // The real combined-save module replaces separate gear/member saves for Garanki services.
relics.init(deps);
quest.bindQuestDeps(deps);
window.ArtifactCollection.init(deps);
window.ArtifactCollection = { unlocked: () => true, render() {} }; // Service tests bypass unrelated museum-donation milestones.

function treeForGaranki() { return registered.trees.garanki_gabu(); }
function finish(npcId, tree) {
  const last = tree.nodes[tree.nodes.length - 1]; // Exercises the same entered end node that the real dialogue renderer publishes.
  const before = profile.questProgress[quest.QUEST_ID]?.stage; // Node listeners update state, and Garanki's composed handler does not return a value.
  registered.nodes[npcId](last, { npc: { id: npcId }, tree });
  return profile.questProgress[quest.QUEST_ID]?.stage !== before;
}
function allElements(root) {
  return [root, ...root.children.flatMap(allElements)];
}

assert.equal(quest.maybeStart(), false, 'no quest from ordinary weapons');
assert.equal(relics.grantBoundRelic({ shape: 'longsword', origin: 'Fey', uid: 'wrong1', enchantments: { base: ['feyMist'], flourishes: {} } }), null, 'mismatched Fey origin and Harlyao shape is invalid');
assert.equal(relics.grantBoundRelic({ shape: 'dagger', origin: 'Harlyao', uid: 'wrong2', enchantments: { base: ['hroFlame'], flourishes: {} } }), null, 'mismatched Harlyao origin and Fey shape is invalid');
assert.equal(saves, 0, 'invalid relic payloads must not touch member saves');
const failedRelic = { shape: 'dagger', origin: 'Fey', uid: 'failed1', enchantments: { base: ['feyMist'], flourishes: {} } }; // Exercises an attempted first acquisition that cannot be saved.
const failedKey = relics.encodeBoundKey(failedRelic);
failSave = true;
assert.equal(relics.grantBoundRelic(failedRelic), null, 'rejected save must fail the weapon grant');
assert.equal(inventory[failedKey], undefined, 'failed grant leaves no phantom inventory item');
assert.equal(profile.questProgress[quest.QUEST_ID], undefined, 'failed grant also rolls back the first quest');
failSave = false;
const key = relics.grantBoundRelic({ shape: 'dagger', origin: 'Fey', uid: 'abc123', enchantments: { base: ['feyMist'], flourishes: {} } });
assert.match(key, /^feyBound_/);
assert.equal(profile.questProgress[quest.QUEST_ID].stage, 0);
assert.equal(saves, 2, 'the real acquisition saves weapon and quest together only once');
assert.equal(relics.unbindPrice({ base: ['feyMist'], flourishes: {} }), 160);
assert.equal(relics.unbindPrice({ base: ['feyMist'], flourishes: {} }, 'Fey'), 320);
assert.equal(relics.unbind(key).reason, 'quest', 'service is unavailable until the player persuades Garanki');

relics.render();
assert.equal(allElements(list).some(el => el.textContent.includes('Pretend to unbind')), false, 'Fey weapons are hidden before the quest reward');
assert.equal(allElements(list).filter(el => el.tagName === 'option').some(el => el.textContent.includes('Fey Mist')), false, 'Fey enchantments are hidden before the quest reward');

const first = treeForGaranki();
assert.equal(first.id, 'fey_knot_garanki_first', 'quest gets Garanki dialogue without replacing the Guild provider');
registered.nodes.garanki_gabu(first.nodes[0], { npc: { id: 'garanki_gabu' }, tree: first });
assert.equal(profile.questProgress[quest.QUEST_ID].stage, 0, 'opening or abandoning a conversation does not advance the quest');
failSave = true;
assert.equal(finish('garanki_gabu', first), false, 'a rejected quest save cannot advance the first conversation');
assert.equal(profile.questProgress[quest.QUEST_ID].stage, 0);
failSave = false;
assert.equal(finish('garanki_gabu', first), true);
assert.equal(profile.questProgress[quest.QUEST_ID].stage, 1);

const jubmir = registered.contexts[quest.QUEST_ID].treeFor({ id: 'jubmir' });
assert.equal(jubmir.id, 'fey_knot_jubmir');
assert.equal(jubmir.nodes.filter(node => node.type === 'choice').length, 2);
delete inventory[key];
assert.equal(quest.menuStatus().ready, false, 'Quest Log readiness updates when the weapon is lost');
assert.match(quest.menuStatus().objective, /Obtain another Fey-knotworked weapon/);
assert.match(quest.menuStatus().statusText, /Weapon missing/);
assert.equal(finish('jubmir', jubmir), false, 'cannot advance without a weapon');
assert.equal(profile.questProgress[quest.QUEST_ID].stage, 1);
assert.equal(quest.dialogueTreeFor('jubmir'), null);
inventory[key] = 1;
assert.equal(quest.menuStatus().ready, true, 'Quest Log readiness recovers as soon as another Fey weapon is owned');
assert.equal(finish('jubmir', jubmir), true);
assert.equal(profile.questProgress[quest.QUEST_ID].stage, 2);

const returning = treeForGaranki();
assert.equal(returning.id, 'fey_knot_garanki_return');
failSave = true;
assert.equal(finish('garanki_gabu', returning), false, 'failed final save cannot unlock Fey services');
assert.equal(quest.completed(), false);
assert.equal(relics.unbind(key).reason, 'quest', 'Fey unbinding remains locked until the final quest save succeeds');
failSave = false;
assert.equal(finish('garanki_gabu', returning), true);
assert.equal(quest.completed(), true);
assert.equal(quest.maybeStart(), false, 'completed quest cannot restart');
assert.equal(profile.questProgress[quest.QUEST_ID].status, 'complete');
assert.equal(quest.menuStatus().active, false, 'Completed quest no longer offers another handoff');
const savesAfterCompletion = saves; // A restored completed quest must never repeat its initial grant or mutate the save.
assert.equal(quest.syncFromInventory(), false);
assert.equal(saves, savesAfterCompletion);
assert.equal(finish('garanki_gabu', returning), false, 'Stale dialogue callbacks cannot complete the quest twice');

relics.render();
const itemsAfterQuest = allElements(list);
assert(itemsAfterQuest.some(el => el.textContent === 'Pretend to unbind (320g)'), 'Fey unbinding appears with doubled fee');
const basePick = itemsAfterQuest.find(el => el.tagName === 'select' && el.children.some(o => o.value === 'feyMist'));
assert(basePick, 'learned Fey Base enchantment becomes selectable');
basePick.value = 'feyMist';
basePick.listeners.change();
assert(itemsAfterQuest.some(el => el.textContent === 'Pretend to enchant (900g)'), 'Fey selected enchantment updates the button label and price');

const beforeUnbind = inventory.gold;
const unbound = relics.unbind(key);
assert.equal(unbound.ok, true);
assert.equal(unbound.price, 320);
assert.equal(inventory.gold, beforeUnbind - 320);
assert(gear.tools[unbound.toolKey], 'unbound Fey weapon goes to real gear inventory');

let before = inventory.gold;
assert.equal(relics.applyBase('sword', 0, 'feyMist').ok, true);
assert.equal(inventory.gold, before - 900, 'Fey Base enchantment costs double');
before = inventory.gold;
assert.equal(relics.clearSlot('sword', 'base', 0).ok, true);
assert.equal(inventory.gold, before - 80, 'Fey removal costs double');
before = inventory.gold;
assert.equal(relics.applyFlourish('sword', 'tap1', 'feyFeint').ok, true);
assert.equal(inventory.gold, before - 600, 'Fey Flourish enchanting costs double');
before = inventory.gold;
assert.equal(relics.clearSlot('sword', 'flourish', 'tap1').ok, true);
assert.equal(inventory.gold, before - 80, 'Fey Flourish removal also costs double');
before = inventory.gold;
assert.equal(relics.applyBase('sword', 0, 'hroFlame').ok, true);
assert.equal(inventory.gold, before - 450, 'Hronal enchanting keeps original price');
before = inventory.gold;
assert.equal(relics.clearSlot('sword', 'base', 0).ok, true);
assert.equal(inventory.gold, before - 40, 'Hronal removal keeps original price');

assert.equal(gearSaves, 0, 'enchanting does not trigger separate gear saves');
assert(txSaves >= 6, 'all Garanki enchant changes were saved as combined transactions');
assert.equal(quest.debugSnapshot().stage, 3, 'mobile diagnostics show the completed quest');
console.log('Fey Knotworked Armament: acquisition, dialogue, persistence, menu and fees passed.');
