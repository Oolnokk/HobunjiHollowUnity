// Regression: Guild invitation timing, refusal, membership Stone, trust cutscene, and key quest.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/delvers-guild-story.js', 'utf8');
const opening = fs.readFileSync('docs/js/opening-story-cutscene.js', 'utf8');
const artifact = fs.readFileSync('docs/js/artifact-collection.js', 'utf8');
const sites = fs.readFileSync('docs/js/ruin-sites.js', 'utf8');
const cave = fs.readFileSync('docs/js/cave-site-system.js', 'utf8');
const relics = fs.readFileSync('docs/js/harlyao-relics.js', 'utf8');
const tasks = fs.readFileSync('docs/js/tasks-panel.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

for (const [name, content] of Object.entries({ source, opening, artifact, sites, cave, relics, tasks })) {
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
  const profile = { worldId: 'test-world', characterId: 'test-character', isWorldOwner: true }; // Scoped to one world/character.
  const defs = {}, inventory = {}, inventoryItems = [], quest = {}; // Canonical inventory/task fixtures shared by all adapters.
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
  vm.runInNewContext(source, { window, document: { addEventListener() {} }, console });
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
  assert.equal(inventory.delversStone, 1);
  delete inventory.delversStone; // Simulate losing the physical amulet while the saved Guild license remains.
  assert.equal(api.isMember(), true);
  assert.equal(api.hasStone(), false, 'membership alone must never open a Harlyao ruin');
  assert.equal(api.restoreMembershipItem(), true);
  assert.equal(inventory.delversStone, 1);
  assert.equal(api.hasStone(), true, 'restoring the missing membership Stone must re-enable ruin access');
  assert.equal(defs.delversStone.quest, true);
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
  assert(inventoryItems.every(item => item.key === 'delversStone' || item.key === api.TALISMAN_KEY || api.KEY_STONES.some(key => key.id === item.key)));
  assert.equal(inventoryItems.length, 5); // The talisman is registered but never granted before handing in all three stones.
  assert.equal(inventory.harlyaoKeyTalisman || 0, 0);
  assert.equal(playedScenes.length, 3); // Declined intro, accepted intro, trusted enchant scene.

  inventory.azgarlu_key_stone = 1;
  api.syncQuest();
  assert(quest.delvers_three_key_stones.progress.objective.includes('Nanahi the Unsleeping'));
  assert(!quest.delvers_three_key_stones.progress.objective.includes('Azgarlu of the Flame'));
  assert(saved >= 3);
  console.log('Delver\'s Guild progression and source wiring: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
