// Regression: Guild invitation timing, refusal, membership Stone, trust cutscene, and key quest.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/delvers-guild-story.js', 'utf8');
const keyItemSource = fs.readFileSync('docs/js/key-item-system.js', 'utf8'); // Exercises the real world-key save implementation.
const opening = fs.readFileSync('docs/js/opening-story-cutscene.js', 'utf8');
const artifact = fs.readFileSync('docs/js/artifact-collection.js', 'utf8');
const sites = fs.readFileSync('docs/js/ruin-sites.js', 'utf8');
const cave = fs.readFileSync('docs/js/cave-site-system.js', 'utf8');
const relics = fs.readFileSync('docs/js/harlyao-relics.js', 'utf8');
const tasks = fs.readFileSync('docs/js/tasks-panel.js', 'utf8');
const index = require('./classic-script-group-index.js').expandClassicScriptGroups();

for (const [name, content] of Object.entries({ source, keyItemSource, opening, artifact, sites, cave, relics, tasks })) {
  new vm.Script(content, { filename: name }); // Every modified JavaScript entrypoint must remain syntactically valid.
}
assert(index.indexOf('js/delvers-guild-story.js') > -1 && index.indexOf('js/delvers-guild-story.js') < index.indexOf('<script src="game.js?v='));
assert(opening.includes('jubmirFeyCompletedAtHours: gameHours()'));
assert(artifact.includes('window.DelversGuild?.dialogueTree?.() || unlockDialogue()'));
assert(artifact.includes('window.DelversGuild?.onDialogueNode?.(node)'));
assert(sites.includes('if (!window.DelversGuild?.hasStone?.())'));
assert(cave.includes('if (!window.DelversGuild?.hasStone?.())'));
assert(relics.includes("window.DelversGuild && !window.DelversGuild.canEnchant()"));
assert(tasks.includes('window.DelversGuild?.syncQuest?.()'));

(async () => {
  let currentHours = 10; // Authoritative in-game time fixture used to test the one-day delay.
  let openingStory = { jubmirFeyComplete: true, jubmirFeyCompletedAtHours: 10, delversGuild: {} }; // World save fixture.
  let accept = false; // Controls whether the player finishes the affirmative final line in a scene.
  let saved = 0; // Counts canonical member-world save calls during rewards/quest updates.
  let callbacks = {}; // Captures registered doorstep providers and their exact queues.
  let playedScenes = []; // Tracks the map, authored actors and final Continue of each scene.
  let playerReady = null; // Captures the actual after-load migration callback to exercise imported legacy items.
  const profile = { worldId: 'test-world', characterId: 'test-character', isWorldOwner: true }; // Scoped to one world/character.
  const defs = {}, inventory = {}, inventoryItems = [], quest = {}; // Canonical inventory/task fixtures shared by all adapters.
  let meta = { characters: [{ id: profile.characterId, gearInventory: { keyItems: [] } }], worlds: [{ id: profile.worldId, keyItems: [] }, { id: 'other-world', keyItems: [] }] }; // Real save blob used by KeyItemSystem.
  let allowKeyWrites = true; // Simulates storage/quota failure during migration.
  const storage = { getItem: key => key === 'hobunjiSaveMeta' ? JSON.stringify(meta) : null, setItem: (key, value) => { if (!allowKeyWrites) throw Error('storage full'); if (key === 'hobunjiSaveMeta') meta = JSON.parse(value); } }; // Simulates persistent browser saves and write failures.
  const sceneRuntime = {
    async run(scene, options) {
      playedScenes.push(scene);
      assert.equal(scene.mapId, 'map_i_researchers_tent');
      assert(scene.actors.some(actor => actor.npcId === 'garanki_gabu' && actor.npcRecord?.id === 'garanki_gabu'));
      if (accept) options.onDialogueContinue(scene.stages.find(stage => stage.id === (scene.title.includes('Forbidden') ? 'trust_final' : 'guild_join_final')));
    },
  }; // Runs the same authored scenes but simulates Continue instead of rendering in Three.js.
  const window = {
    __hobunjiPlayerProfile: profile,
    localStorage: storage,
    __hobunjiGameStarted: true,
    CalendarSystem: { isInitialized: () => true, previewAfterHours: () => ({ day: Math.floor(currentHours / 24) + 1, time01: (currentHours % 24) / 24 }), getHour: fraction => fraction * 24 },
    OpeningStoryCutscene: {
      getStory: () => openingStory,
      updateStory: (_profile, changes) => { openingStory = { ...openingStory, ...changes }; return true; },
    },
    DoorstepVisits: { registerProvider: provider => { callbacks[provider.id] = provider; } },
    AuthoredCutsceneRuntime: sceneRuntime,
    LocalDBOverrides: { loadDatabase: async () => ({ npcs: [{ id: 'garanki_gabu', name: 'Garanki Gabu' }] }) },
    ArtifactCollection: { unlocked: id => id === 'base', value: () => 4, acknowledgeUnlocks() {} },
    TasksPanel: { render() {} },
    DevCompanion: { registerStateProvider() {} },
    setTimeout: callback => callback(),
    __farmLog() {},
  };
  const document = { addEventListener: (event, callback) => { if (event === 'hobunjiPlayerReady') playerReady = callback; } }; // Captures the same load-complete event game.js sends.
  vm.runInNewContext(keyItemSource, { window, document, console });
  vm.runInNewContext(source, { window, document, console });
  const api = window.DelversGuild;
  const inventoryDeps = { ITEM_DEFS: defs, inventoryItems, inventory, saveMemberWorldData: () => saved++, buildInventoryGrid() {}, showToast() {} }; // Reuses the ArtifactCollection adapter.
  api.bindInventoryDeps(inventoryDeps);
  api.bindQuestDeps({ getQuestProgress: () => quest });

  assert.equal(api.hasStone(), false);
  assert.equal(api.invitationReady(), false);
  currentHours = 33;
  assert.equal(api.invitationReady(), false);
  currentHours = 34;
  assert.equal(api.invitationReady(), true);
  assert.equal(api.nextInvitation().npcId, 'garanki_gabu');
  assert.equal(callbacks.garanki_delvers_invitation.onComplete(), true);
  assert.equal(openingStory.delversGuild.invited, true);
  assert.equal(api.dialogueTree().nodes[1].id, 'delvers_start_intro');

  accept = false;
  assert.equal(await api.playIntro(), false); // Declining / skipping must not grant a license.
  assert.equal(api.hasStone(), false);
  accept = true;
  assert.equal(await api.playIntro(), true);
  assert.equal(api.hasStone(), true);
  assert.equal(window.KeyItemSystem.has('delversStone'), true);
  assert.equal(window.KeyItemSystem.definitionFor('delversStone').scope, 'world');
  assert.equal(inventory.delversStone, undefined, 'Guild license must not occupy material Pack stacks');
  assert.equal(window.KeyItemSystem.revoke('delversStone').ok, true); // Simulate a missing saved key while the Guild membership still exists.
  assert.equal(api.isMember(), true);
  assert.equal(api.hasStone(), false, 'membership alone must never open a Harlyao ruin');
  assert.equal(api.restoreMembershipItem(), true);
  assert.equal(window.KeyItemSystem.has('delversStone'), true);
  assert.equal(api.hasStone(), true, 'restoring the missing key must re-enable licensed ruin access');
  assert.equal(window.KeyItemSystem.definitionFor('color_pools_key'), null, 'Banubu registers its own independent key');
  assert.equal(api.canEnchant(), false);
  assert.equal(api.dialogueTree().nodes[1].id, 'delvers_start_trust');

  assert.equal(await api.playTrust(), true);
  assert.equal(api.canEnchant(), true);
  assert.equal(quest.delvers_three_key_stones.status, 'active');
  assert.equal(quest.delvers_three_key_stones.progress.kind, 'story');
  assert(quest.delvers_three_key_stones.progress.objective.includes('Azgarlu of the Flame'));
  assert(quest.delvers_three_key_stones.progress.objective.includes('Nanahi the Unsleeping'));
  assert(quest.delvers_three_key_stones.progress.objective.includes('Imlao the Sightless'));
  assert.equal(api.KEY_STONES.length, 3);
  assert.equal(inventoryItems.length, 0, 'all five Guild quest keys belong in KeyItemSystem, not Pack');
  assert(api.KEY_STONES.every(key => window.KeyItemSystem.definitionFor(key.id).scope === 'world')); // Named lich stones share world ownership.
  assert.equal(inventory.harlyaoKeyTalisman || 0, 0);
  assert.equal(playedScenes.length, 3); // Declined intro, accepted intro, trusted enchant scene.

  inventory.azgarlu_key_stone = 1; // Legacy save: boss reward was an ordinary material stack.
  assert.equal(typeof playerReady, 'function');
  playerReady(); // Migration is deferred until the inventory actually finishes restoring.
  assert.equal(inventory.azgarlu_key_stone, undefined);
  assert.equal(window.KeyItemSystem.has('azgarlu_key_stone'), true);
  inventory.nanahi_key_stone = 1; // Another real legacy reward remains in the Pack before migration.
  allowKeyWrites = false;
  playerReady();
  assert.equal(inventory.nanahi_key_stone, 1, 'failed key persistence must not delete the original material-stack reward');
  assert.equal(window.KeyItemSystem.has('nanahi_key_stone'), false);
  allowKeyWrites = true;
  playerReady();
  assert.equal(inventory.nanahi_key_stone, undefined, 'a later successful save migrates the preserved reward');
  assert.equal(window.KeyItemSystem.has('nanahi_key_stone'), true);
  profile.worldId = 'other-world';
  assert.equal(window.KeyItemSystem.has('delversStone'), false, 'world-scoped keys cannot leak into other worlds');
  assert.equal(window.KeyItemSystem.has('azgarlu_key_stone'), false);
  profile.worldId = 'test-world';
  api.syncQuest();
  assert(quest.delvers_three_key_stones.progress.objective.includes('Imlao the Sightless'), 'the third missing key remains on the quest');
  assert(!quest.delvers_three_key_stones.progress.objective.includes('Nanahi the Unsleeping'), 'a migrated key no longer appears as missing');
  assert(!quest.delvers_three_key_stones.progress.objective.includes('Azgarlu of the Flame'));
  assert(saved >= 3);
  console.log('Delver\'s Guild progression and source wiring: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
