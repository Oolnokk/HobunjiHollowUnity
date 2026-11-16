#!/usr/bin/env node
'use strict';

// Integration coverage for the four decoupled game.js seams.
// Run: node scripts/test-fey-main-decoupling.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const records = new Map(); // Browser save contents for the real CharacterMetaSave helper.
  let writes = 0; // Single-write transaction verification.
  let rejectWrites = false; // Forces storage rejection after a validated Garanki mutation.
  let saveMemberCalls = 0; // Direct quest-save diagnostic counter.
  let inventoryGridUpdates = 0; // Rollback must immediately refresh the player's visible bag.
  const context = {
    console, Date, Math, JSON, Map, Set,
    document: { addEventListener() {} },
    addEventListener() {},
    localStorage: {
      getItem(key) { return records.get(key) ?? null; },
      setItem(key, value) {
        if (rejectWrites) throw new Error('Simulated full storage quota');
        records.set(key, value); writes++;
      },
    },
    __hobunjiPlayerProfile: { characterId: 'char-one', worldId: 'world-one' },
    setTimeout() {}, // A pending character patch remains queued until the transaction flushes it.
  };
  context.window = context; // All runtime modules share this classic-script global.
  context.globalThis = context;
  vm.createContext(context);
  const load = path => vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
  load('docs/js/menu-panel-renderers.js');
  load('docs/js/npc-dialogue-entry-router.js');
  load('docs/js/quest-progress-store.js');
  load('docs/js/character-meta-save.js');
  load('docs/js/gear-member-transaction.js');

  // 1. Menu: one render per dispatch, not two on opening a tab.
  let menuRenders = 0; // Counts actual UI handlers, independent of visibility changes.
  context.MenuPanelRenderers.init({ inventory() { menuRenders++; }, garankiEnchanter() { menuRenders++; } });
  assert.equal(context.MenuPanelRenderers.render('garankiEnchanter'), true);
  assert.equal(menuRenders, 1);
  assert.equal(context.MenuPanelRenderers.debugSnapshot().renderCounts.garankiEnchanter, 1);
  assert.equal(context.MenuPanelRenderers.render('unknown'), false);
  context.MenuPanelRenderers.register('broken', () => { throw new Error('panel failure'); });
  const originalError = console.error;
  console.error = () => {}; // An expected failed renderer logs in real gameplay; keep this test quiet.
  try { assert.equal(context.MenuPanelRenderers.render('broken'), false); }
  finally { console.error = originalError; }
  assert.match(context.MenuPanelRenderers.debugSnapshot().lastError, /panel failure/);

  // 2. Quest state: the same live map survives normal writes and is replaced on world swap.
  context.QuestProgressStore.init({
    canAccessContent: visibility => visibility !== 'owner',
    saveMemberWorldData() { saveMemberCalls++; return true; },
  });
  assert.equal(context.QuestProgressStore.setStatus('task-one', 'in_progress', { obtained: 2 }), true);
  assert.equal(context.QuestProgressStore.snapshot()['task-one'].progress.obtained, 2);
  assert.equal(context.QuestProgressStore.canAccess({ visibility: 'owner' }), false);
  assert.equal(context.QuestProgressStore.setStatus('task-one', 'completed'), true);
  assert.equal(typeof context.QuestProgressStore.getState('task-one').completedAt, 'number');
  assert.equal(saveMemberCalls, 2);
  context.QuestProgressStore.restore({ 'task-two': { status: 'active', progress: { kind: 'story' } } });
  assert.equal(context.QuestProgressStore.getState('task-one').status, 'not_started', 'world/character swap clears old quest progress');
  assert.equal(context.QuestProgressStore.getState('task-two').status, 'active');

  // 3. Dialogue: queued sequences win; an urgent Fey handoff beats Jubmir's Wares/Chat screen.
  const dialogue = [];
  let queued = false; // Simulates a higher-priority cinematic dialogue already waiting for this NPC.
  let turnIn = null; // Simulates a procedural hand-in offered when no urgent story is waiting.
  context.DialogueContent = {
    hasQueuedConversationTree: () => queued,
    beginNpcConversation: rec => dialogue.push('conversation:' + rec.id),
    beginSyntheticChoice: rec => dialogue.push('choice:' + rec.id),
    renderDlgNode: node => dialogue.push(node),
  };
  context.ProceduralTasks = {
    getTurnInReadyTaskForNpc: () => turnIn,
    async maybeProposeRequest() { return null; },
    maybeOfferFavor() { return null; },
  };
  context.NpcDialogueEntryRouter.init({
    ITEM_DEFS: { milk: { label: 'Milk' } },
    isGeneralStoreNpcOnDuty: walker => walker?.onDuty === true,
    generalStoreButtonConfig: () => ({ shopGreeting: 'Welcome to the shop.' }),
    isCarpenterNpcOnDuty: () => false,
    carpenterButtonConfig: () => ({}),
  });
  context.NpcDialogueEntryRouter.registerPriorityProvider('feyArmament', rec => rec?.id === 'jubmir' && rec?.needsFeyTalk === true);
  const trader = { id: 'jubmir', needsFeyTalk: true }; // Named trader with active authored quest priority.
  await context.NpcDialogueEntryRouter.route(trader, {});
  assert.equal(dialogue.at(-1), 'conversation:jubmir', 'urgent Fey story bypasses Wares/Chat');
  assert.equal(context.NpcDialogueEntryRouter.debugSnapshot().lastDecision, 'priority:feyArmament');
  queued = true;
  await context.NpcDialogueEntryRouter.route(trader, {});
  assert.equal(context.NpcDialogueEntryRouter.debugSnapshot().lastDecision, 'queued', 'queued cutscene outranks story');
  queued = false;
  trader.needsFeyTalk = false;
  await context.NpcDialogueEntryRouter.route(trader, {});
  assert(dialogue.some(d => typeof d === 'object' && d.choices?.some(c => c.label === 'See Wares')), 'normal Jubmir trading remains accessible');
  turnIn = { id: 'test-favor', items: [{ itemKey: 'milk', qty: 1 }] };
  await context.NpcDialogueEntryRouter.route({ id: 'villager' }, {});
  assert(dialogue.some(d => typeof d === 'object' && d.text?.includes('Milk')), 'existing task turn-ins still precede generic conversation');
  turnIn = null;
  await context.NpcDialogueEntryRouter.route({ id: 'shopkeeper' }, { onDuty: true });
  assert(dialogue.some(d => typeof d === 'object' && d.text === 'Welcome to the shop.'), 'ordinary merchant greeting still works');
  await context.NpcDialogueEntryRouter.route({ id: 'stranger' }, {});
  assert.equal(dialogue.at(-1), 'conversation:stranger', 'unknown NPC uses ordinary dialogue');

  // 4. Real CharacterMetaSave: combine queued character progression + gear + member inventory in one write.
  const initialMeta = {
    characters: [{ id: 'char-one', skillLevels: { combat: 1 }, gearInventory: {} }, { id: 'char-two', gearInventory: {} }],
    worlds: [{ id: 'world-one', members: { 'char-one': { nonGearInventory: { gold: 1200 } } } }],
  };
  records.set('hobunjiSaveMeta', JSON.stringify(initialMeta)); // Seed browser state without counting this setup as a game save.
  const inventory = { gold: 1200, feyBound_dagger: 1 }; // Active inventory whose mutated contents are captured with character gear.
  const gear = { tools: { sword: true }, weaponEnchantments: {} }; // Active character gear with a stable outer reference.
  context.GearMemberTransaction.init({
    inventory,
    getGearInventory: () => gear,
    captureMemberWorldData(meta) {
      meta.worlds[0].members['char-one'] = { nonGearInventory: { ...inventory }, questProgress: { ...context.QuestProgressStore.snapshot() } };
      return meta;
    },
    buildInventoryGrid() { inventoryGridUpdates++; },
    buildEquipmentSlots() {},
    showToast() {},
  });
  context.CharacterMetaSave.schedule({ skillLevels: { combat: 5 } });
  let result = context.GearMemberTransaction.run({
    inventoryKeys: ['feyBound_dagger'],
    mutate() {
      inventory.gold -= 300;
      delete inventory.feyBound_dagger;
      gear.tools.feyDagger = true;
      gear.weaponEnchantments.feyDagger = { base: ['feyPhantomWound'], flourishes: {} };
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(writes, 1, 'unbinding performs exactly one browser save, not a gear save plus a member save');
  let persisted = JSON.parse(records.get('hobunjiSaveMeta'));
  assert.equal(persisted.characters[0].gearInventory.tools.feyDagger, true);
  assert.equal(persisted.characters[0].skillLevels.combat, 5, 'queued character progression is retained by CharacterMetaSave');
  assert.equal(persisted.worlds[0].members['char-one'].nonGearInventory.gold, 900);
  assert.equal(persisted.worlds[0].members['char-one'].nonGearInventory.feyBound_dagger, undefined);
  assert.equal(persisted.characters[1].gearInventory.tools?.feyDagger, undefined, 'other character gear is untouched');

  // A failed save restores the in-memory gold, inventory keys and gear, and never writes a partial transaction.
  rejectWrites = true;
  result = context.GearMemberTransaction.run({
    mutate() { inventory.gold -= 150; gear.tools.hatchet = true; return { ok: true }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'save');
  assert.equal(inventory.gold, 900);
  assert.equal(gear.tools.hatchet, undefined);
  assert.equal(writes, 1);
  rejectWrites = false;
  result = context.GearMemberTransaction.run({
    mutate() { inventory.gold -= 50; gear.tools.bow = true; throw new Error('invalid enchantment payload'); },
  });
  assert.equal(result.reason, 'exception');
  assert.equal(inventory.gold, 900);
  assert.equal(gear.tools.bow, undefined);
  assert(inventoryGridUpdates >= 2, 'failed transactions refresh the mobile inventory display');
  assert.equal(context.GearMemberTransaction.debugSnapshot().rollbacks, 2);

  // 5. Wiring: game.js only orchestrates the separated systems.
  const game = fs.readFileSync('docs/game.js', 'utf8');
  const html = fs.readFileSync('docs/index.html', 'utf8');
  for (const owner of ['NpcDialogueEntryRouter', 'MenuPanelRenderers', 'QuestProgressStore', 'GearMemberTransaction']) {
    assert(game.includes('window.' + owner), 'game.js wires ' + owner);
  }
  assert(!game.includes('let questProgress = {}'), 'quest progress no longer lives in game.js');
  assert(!game.includes('const _turnInTask ='), 'NPC turn-in decision code no longer lives in game.js');
  assert(!game.includes("if (id === 'garankiEnchanter')"), 'per-panel render chain no longer lives in game.js');
  for (const path of ['npc-dialogue-entry-router.js', 'menu-panel-renderers.js', 'quest-progress-store.js', 'gear-member-transaction.js']) {
    assert(html.includes(path), 'script load order includes ' + path);
  }
  console.log('Fey main decoupling: dialogue priority, trader fallback, menu dispatch, member quest store and atomic save/rollback passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
