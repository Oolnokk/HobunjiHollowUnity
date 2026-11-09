// Run: node scripts/test-town-magic-checkpoint.js
// Gate dialogue, legal registration, Garanki custody and interrupted-save recovery.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/town-magic-checkpoint.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const guildSource = fs.readFileSync('docs/js/delvers-guild-story.js', 'utf8');
const artifact = fs.readFileSync('docs/js/artifact-collection.js', 'utf8');
const relics = fs.readFileSync('docs/js/harlyao-relics.js', 'utf8');
for (const [name, code] of Object.entries({ source, guildSource, artifact, relics })) new vm.Script(code, { filename: name });
assert(index.includes('js/town-magic-checkpoint.js'));
assert(index.indexOf('js/town-magic-checkpoint.js') < index.indexOf('<script src="game.js'));
assert(game.includes('window.TownMagicCheckpoint?.onTownEntered?.({ fromArea, col, row })'));
assert(game.includes('getPackClothing: () => packClothing'));
assert(artifact.includes('window.TownMagicCheckpoint?.bindInventoryDeps?.(injected)'));
assert(relics.includes('window.TownMagicCheckpoint?.renderCustody?.(list,'));
assert(!guildSource.includes('It glows red and hums when you carry uncatalogued magical objects'));

(async () => {
  let story = { delversGuild: {} }; // In-memory portable-world opening story fixture.
  let member = false; // Toggles Delver license without changing the saved player inventory.
  let saves = 0; // Tracks the real two-store save callback being used.
  let allowWrite = true; // Simulates an unavailable world-save store safely.
  let allowMemberSave = true; // Simulates a failed player inventory save after escrow was recorded.
  let continueFinal = true; // Simulates quitting a conversation before the final Continue.
  const scenes = []; // Captures actual authored-stage payloads for every gate mode.
  const entryEvents = []; // Tracks supported document lifecycle callbacks.
  const inventory = { harlyaoBound_longsword_first_Ba_Fb: 1, delversStone: 1, gold: 500 };
  const itemDefs = { cursedOre: { label: 'Cursed Ore', magicalStatus: 'cursed' } }; // Exercises stackables that have no distinct instance ID.
  const pack = [{
    uid: 'circlet-uid', label: 'Cursed Circlet', cursed: { kind: 'circlet', dispelBy: 'garanki' },
    colorA: { hex: '#829abc' }, patterns: [{ kind: 'woven', frame: 2 }],
  }];
  const window = {
    __hobunjiPlayerProfile: { worldId: 'checkpoint-world', characterId: 'owner', nickname: 'Tala' },
    __hobunjiGameStarted: true,
    OpeningStoryCutscene: {
      getStory: () => story,
      updateStory: (_profile, fields) => { if (!allowWrite) return false; story = { ...story, ...fields }; return true; },
    },
    HarlyaoRelics: {
      isBoundKey: key => key.startsWith('harlyaoBound_'),
      ensureBoundItemDef() {}, render() {},
    },
    DelversGuild: { isMember: () => member },
    LocalDBOverrides: { loadDatabase: async () => ({ npcs: [
      { id: 'spearhead_unumanuk', name: 'Spearhead' },
      { id: 'oddclaw_unumanuk', name: 'Oddclaw' },
    ] }) },
    AuthoredCutsceneRuntime: {
      isActive: () => false,
      run: async (payload, hooks) => {
        scenes.push(payload);
        const ending = payload.stages.find(stage => ['magic_first_final', 'magic_repeat_final', 'magic_license', 'magic_repeat_license'].includes(stage.id));
        assert(ending, 'Every scene must provide a recognized conclusion');
        if (continueFinal) hooks.onDialogueContinue(ending);
      },
    },
    setTimeout: callback => callback(), // Schedules immediately while preserving the real API's asynchronous play flow.
    DevCompanion: { registerStateProvider() {} },
    __farmLog() {},
  };
  let area = 'town'; // Canonical area fixture; a scene must not start if the player has already left town.
  const document = { addEventListener: (name, handler) => entryEvents.push({ name, handler }) };
  vm.runInNewContext(source, { window, document, console, Date, fetch: async () => { throw Error('unexpected NPC network fallback'); } });
  const api = window.TownMagicCheckpoint;
  api.bindInventoryDeps({
    inventory, ITEM_DEFS: itemDefs, getPackClothing: () => pack, getCurrentArea: () => area,
    isExteriorArrival: from => from === 'farm' || from.startsWith('map_') && !from.startsWith('map_i_'),
    saveMemberWorldData: () => { saves++; return allowMemberSave; }, buildInventoryGrid() {}, buildPackClothingSection() {}, showToast() {},
  });
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  const custody = () => story.delversGuild.townMagicCheckpoint.members.owner.entries;
  assert.equal(api.pending().length, 2);
  assert.equal(api.onTownEntered({ fromArea: 'town', col: 8, row: 15 }), false);
  assert.equal(api.onTownEntered({ fromArea: 'map_i_temple', col: 8, row: 15 }), false, 'leaving a town interior is not a gate crossing');
  assert.equal(api.onTownEntered({ fromArea: 'map_i_smithy', col: 8, row: 15 }), false, 'leaving the smithy does not summon the watchmen');
  assert.equal(api.onTownEntered({ fromArea: 'farm', col: 8, row: 15 }), true);
  await flush();
  assert.equal(scenes.length, 1);
  assert.deepEqual(Array.from(scenes[0].actors, a => a.id), ['player', 'spearhead', 'oddclaw']);
  assert(scenes[0].stages.some(stage => stage.id === 'magic_what_thing'));
  assert.deepEqual(Array.from(scenes[0].stages.find(stage => stage.id === 'magic_item_choice').options, opt => opt.text), ['Yes.', "I don't know."]);
  assert.equal(custody().length, 2);
  assert.equal(pack.length, 0);
  assert.equal(inventory.harlyaoBound_longsword_first_Ba_Fb, undefined);
  assert.equal(inventory.delversStone, 1, 'Licensed Stone is never confiscated');

  // The four actual perimeter mouths have enough clearance for Spearhead to walk behind a correctly faced player.
  assert(scenes[0].stages.some(stage => stage.id === 'magic_watchmen_braced'), 'first encounter establishes the two armed guards');
  const gateCases = [
    { entry: [18, 49], stand: [18, 47], behind: [18, 48], facing: 180 }, // Farm gate, southern edge.
    { entry: [30, 1], stand: [30, 3], behind: [30, 2], facing: 0 }, // Northern Cliffs.
    { entry: [0, 25], stand: [2, 25], behind: [1, 25], facing: 90 }, // Western Slope.
    { entry: [59, 25], stand: [57, 25], behind: [58, 25], facing: 270 }, // Eastern Mire.
  ]; // Matches the authored town map's entry coordinates.
  for (const gate of gateCases) {
    const built = api.scene([{ id: 'spearhead_unumanuk' }, { id: 'oddclaw_unumanuk' }], ...gate.entry);
    assert.deepEqual([built.actors[0].worldC, built.actors[0].worldR], gate.stand);
    assert.equal(built.actors[0].rotation, gate.facing);
    const inspect = built.stages.find(stage => stage.id === 'magic_inspect_step');
    assert.deepEqual(Array.from([inspect.targetWorld.c, inspect.targetWorld.r]), gate.behind,
      'bag search must stage Spearhead behind the player, not through a boundary wall');
    assert(!built.stages.some(stage => stage.id === 'magic_watchmen_braced'), 'repeat encounters do not replay the armed-first-confrontation caption');
  }
  assert.equal(custody().find(e => e.kind === 'clothing').item.patterns[0].frame, 2);
  assert.equal(custody().find(e => e.kind === 'clothing').item.colorA.hex, '#829abc');

  // Repeat without a license offers the same two honest/uncertain answers and no exposition.
  inventory.harlyaoBound_longsword_second_Ba_Fb = 1;
  api.onTownEntered({ fromArea: 'farm', col: 8, row: 15 }); await flush();
  assert.equal(scenes.length, 2);
  assert(scenes[1].stages.some(stage => stage.id === 'magic_repeat_greeting'));
  assert.deepEqual(Array.from(scenes[1].actors, actor => actor.id), ['player', 'spearhead'], 'Oddclaw accompanies the initial armed interception, not routine repeat checks');
  assert(!scenes[1].stages.some(stage => stage.id === 'magic_explain_garanki'));
  assert.equal(custody().length, 3);

  // Newly licensed player must choose the license line once, then never answer again.
  member = true;
  inventory.harlyaoBound_longsword_third_Ba_Fb = 1;
  api.onTownEntered({ fromArea: 'farm', col: 8, row: 15 }); await flush();
  assert.equal(scenes.length, 3);
  assert.deepEqual(Array.from(scenes[2].stages.find(stage => stage.id === 'magic_license_choice').options, opt => opt.text), ['I have a license.']);
  inventory.harlyaoBound_longsword_fourth_Ba_Fb = 1;
  api.onTownEntered({ fromArea: 'farm', col: 8, row: 15 }); await flush();
  assert.equal(scenes.length, 4);
  assert(scenes[3].stages.some(stage => stage.id === 'magic_repeat_license'));
  assert(!scenes[3].stages.some(stage => stage.type === 'choice'));

  // Registration returns the original encoded magic and prevents future lawful contraband stops.
  assert.equal(api.registerAndReturn('inventory:harlyaoBound_longsword_first_Ba_Fb').ok, true);
  assert.equal(inventory.harlyaoBound_longsword_first_Ba_Fb, 1);
  assert(!api.pending().some(entry => entry.key === 'harlyaoBound_longsword_first_Ba_Fb'));
  assert.equal(api.registerAndReturn('clothing:circlet-uid').ok, true);
  assert.equal(pack[0].patterns[0].frame, 2, 'Garment instance survives custody and release intact');
  assert(!api.pending().some(entry => entry.id === 'clothing:circlet-uid'));

  // Soul-bound masks are held until their priest-only removal, not automatically legalized.
  pack.push({ uid: 'mask-uid', label: 'Soul Mask', cursed: { kind: 'mask', dispelBy: 'priest' } });
  api.onTownEntered({ fromArea: 'farm', col: 8, row: 15 }); await flush();
  assert.equal(api.registerAndReturn('clothing:mask-uid').reason, 'dangerous');
  assert(custody().some(entry => entry.id === 'clothing:mask-uid'));

  // An unregistered stack of a catalog-marked magical ingredient must not be conflated with one already held.
  inventory.cursedOre = 3;
  assert.equal(api.confiscate().ok, true);
  assert.equal(inventory.cursedOre, undefined);
  assert.equal(custody().find(entry => entry.id === 'inventory:cursedOre').count, 3);
  inventory.cursedOre = 2; // Collected another two after the first batch was confiscated.
  assert.equal(api.reconcileCustody(), false, 'recovering custody must never delete a genuinely new stack of the same key');
  assert.equal(inventory.cursedOre, 2);
  assert.equal(api.pending().find(entry => entry.key === 'cursedOre').count, 2);
  assert.equal(api.confiscate().ok, true);
  assert.equal(custody().find(entry => entry.id === 'inventory:cursedOre').count, 5, 'repeat confiscations merge stack amounts');
  assert.equal(inventory.cursedOre, undefined);
  assert.equal(api.registerAndReturn('inventory:cursedOre').ok, true);
  assert.equal(inventory.cursedOre, 5);
  assert(!api.pending().some(entry => entry.key === 'cursedOre'), 'registered carried quantity is allowed');
  inventory.cursedOre += 1; // Newly acquired stock beyond the registered amount is still contraband.
  assert.equal(api.pending().find(entry => entry.key === 'cursedOre').count, 1);
  assert.equal(api.confiscate().ok, true);
  assert.equal(inventory.cursedOre, 5, 'lawful stock remains in the pack when excess stock is confiscated');
  assert.equal(custody().find(entry => entry.id === 'inventory:cursedOre').count, 1);
  allowWrite = false;
  assert.equal(api.registerAndReturn('inventory:cursedOre').reason, 'save', 'a failed escrow write cannot release an item');
  assert.equal(inventory.cursedOre, 5);
  allowWrite = true;
  story.delversGuild.townMagicCheckpoint.members.owner.entries.find(entry => entry.id === 'inventory:cursedOre')
    .pendingRelease = { previous: 5, count: 1 }; // Simulates a crash after a returned stack was saved but before ledger finalization.
  inventory.cursedOre = 6;
  assert.equal(api.reconcileCustody(), true);
  assert.equal(inventory.cursedOre, 5, 'interrupted release reverts the extra stack, preserving the five already registered');
  assert.equal(custody().find(entry => entry.id === 'inventory:cursedOre').pendingRelease, undefined);

  // Failed physical-inventory saves preserve pending custody markers rather than silently completing a half-transfer.
  inventory.cursedOre = 7; // Five lawfully registered plus two new contraband.
  allowMemberSave = false;
  assert.equal(api.confiscate().reason, 'member-save');
  assert.equal(custody().find(entry => entry.id === 'inventory:cursedOre').pendingRemoval.count, 2);
  allowMemberSave = true;
  inventory.cursedOre = 7; // Old member inventory was still on disk when the write was rejected.
  assert.equal(api.reconcileCustody(), true);
  assert.equal(inventory.cursedOre, 5);
  assert.equal(custody().find(entry => entry.id === 'inventory:cursedOre').pendingRemoval, undefined);
  allowMemberSave = false;
  assert.equal(api.registerAndReturn('inventory:cursedOre').reason, 'member-save');
  assert.equal(inventory.cursedOre, 5, 'failed legal release returns the temporary new stack to custody');
  allowMemberSave = true;

  // A crash after writing the custody ledger but before character inventory save must not duplicate relics.
  inventory.harlyaoBound_longsword_fourth_Ba_Fb = 1;
  assert.equal(api.reconcileCustody(), true);
  assert.equal(inventory.harlyaoBound_longsword_fourth_Ba_Fb, undefined);

  // A failed world-store write cannot confiscate any currently carried item.
  inventory.harlyaoBound_longsword_fifth_Ba_Fb = 1;
  allowWrite = false;
  api.onTownEntered({ fromArea: 'farm', col: 8, row: 15 }); await flush();
  assert.equal(inventory.harlyaoBound_longsword_fifth_Ba_Fb, 1);
  allowWrite = true;
  continueFinal = false;
  api.onTownEntered({ fromArea: 'farm', col: 8, row: 15 }); await flush();
  assert.equal(inventory.harlyaoBound_longsword_fifth_Ba_Fb, 1, 'Skipped final dialogue never confiscates');
  continueFinal = true;

  area = 'farm';
  assert.equal(api.onTownEntered({ fromArea: 'farm', col: 8, row: 15 }), true);
  await flush();
  assert.equal(inventory.harlyaoBound_longsword_fifth_Ba_Fb, 1, 'Leaving town cancels queued checkpoint');

  // Two rapid exterior crossings must not play an old queued check at the previous gate's coordinates.
  area = 'town';
  const queuedTimers = []; // Collects deferred callbacks in order to test stale-generation cancellation.
  window.setTimeout = callback => { queuedTimers.push(callback); };
  const priorScenes = scenes.length;
  assert(api.onTownEntered({ fromArea: 'farm', col: 18, row: 49 }));
  assert(api.onTownEntered({ fromArea: 'map_western_slope', col: 0, row: 25 }));
  assert.equal(queuedTimers.length, 2);
  queuedTimers[0](); await flush();
  assert.equal(scenes.length, priorScenes, 'a previous entry timer must not interrupt the newer arrival');
  queuedTimers[1](); await flush();
  assert.equal(scenes.length, priorScenes + 1);
  assert.equal(scenes.at(-1).actors[0].worldC, 2, 'scene stages the latest western gate safely inward');

  assert(saves > 0);
  window.__hobunjiPlayerProfile.characterId = 'farmhand';
  assert.equal(api.debugSnapshot().custody.length, 0, 'other farmhands must not have access to the owner\'s confiscated inventory');
  window.__hobunjiPlayerProfile.characterId = 'owner';
  assert(entryEvents.some(e => e.name === 'hobunjiPlayerReady'));

  // Garanki must honor Spearhead's referral even before the unrelated Jubmir quest sends an invitation.
  let guildStory = { jubmirFeyComplete: false, delversGuild: {} }; // Independent new-world fixture for early confiscation.
  const guildInventory = {}; // No magic rewards or Delver's Stone should exist before joining.
  const guildWindow = {
    __hobunjiPlayerProfile: { worldId: 'early-referral', characterId: 'owner', nickname: 'Tala' },
    __hobunjiGameStarted: true,
    TownMagicCheckpoint: { hasCustody: () => true },
    OpeningStoryCutscene: {
      getStory: () => guildStory,
      updateStory: (_profile, fields) => { guildStory = { ...guildStory, ...fields }; return true; },
    },
    DoorstepVisits: { registerProvider() {} },
    LocalDBOverrides: { loadDatabase: async () => ({ npcs: [{ id: 'garanki_gabu', name: 'Garanki Gabu' }] }) },
    AuthoredCutsceneRuntime: {
      run: async (scene, hooks) => {
        assert(scene.stages.some(stage => stage.id === 'guild_intro_0' && stage.text.includes('Spearhead')),
          'Early Guild introduction must refer to the actual confiscation, not a Great Fey conversation that has not happened');
        hooks.onDialogueContinue(scene.stages.find(stage => stage.id === 'guild_join_final'));
      },
    },
    TasksPanel: { render() {} }, DevCompanion: { registerStateProvider() {} },
    setTimeout: callback => callback(), __farmLog() {},
  };
  vm.runInNewContext(guildSource, { window: guildWindow, document, console });
  guildWindow.DelversGuild.bindInventoryDeps({
    ITEM_DEFS: {}, inventoryItems: [], inventory: guildInventory,
    saveMemberWorldData() {}, buildInventoryGrid() {}, showToast() {},
  });
  assert.equal(guildWindow.DelversGuild.dialogueTree().id, 'garanki_intro_meeting', 'checkpoint referral unlocks Guild conversation');
  const garankiPrompt = guildWindow.DelversGuild.dialogueTree().nodes[0];
  assert.equal(garankiPrompt.type, 'choice');
  assert(garankiPrompt.choices.some(choice => choice.actions?.some(action => action.pool === 'garankiEnchanting')),
    'a nonmember can review confiscated belongings without being forced into the Guild introduction');
  assert.equal(await guildWindow.DelversGuild.playIntro(), true);
  assert.equal(guildWindow.DelversGuild.isMember(), true);
  assert.equal(guildInventory.delversStone, 1);
  assert.equal(guildStory.delversGuild.member, true);
  guildStory.delversGuild.trusted = true;
  Object.assign(guildInventory, {
    azgarlu_key_stone: 1, nanahi_key_stone: 1, imlao_key_stone: 1,
  });
  const keyTree = guildWindow.DelversGuild.dialogueTree();
  assert.equal(keyTree.id, 'garanki_talisman_handoff');
  assert(keyTree.nodes[0].choices.some(choice => choice.label.includes('confiscated belongings')),
    'the three-key-stones handoff cannot block Garanki custody access');
  guildStory.delversGuild.vaultPhase = 'report';
  guildInventory.harlyaoKeyTalisman = 1;
  const reportTree = guildWindow.DelversGuild.dialogueTree();
  assert.equal(reportTree.id, 'garanki_vault_report');
  assert(reportTree.nodes[0].choices.some(choice => choice.actions?.[0]?.pool === 'garankiEnchanting'),
    'the vault report cannot block Garanki custody access');

  console.log('Town magic checkpoint, Guild registration and Garanki custody: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
