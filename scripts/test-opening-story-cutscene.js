'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..'); // Resolves every runtime/config fixture from the repository root.
const storySource = fs.readFileSync(path.join(ROOT, 'docs/js/opening-story-cutscene.js'), 'utf8'); // Executes the authored scene builders without loading the browser game.
const gameSource = fs.readFileSync(path.join(ROOT, 'docs/game.js'), 'utf8'); // Verifies the monolith exposes the live wrapper/cleanup seams the story module calls.
const helperSource = fs.readFileSync(path.join(ROOT, 'docs/js/cutscene-preview-helpers.js'), 'utf8'); // Verifies seated cutscene actors reuse the normal NPC seat resolver.
const indexSource = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8'); // Verifies load ordering before onboarding emits hobunjiPlayerReady.
const npcDb = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/npcs/hobunji-starter-npc-database.json'), 'utf8')); // Supplies the exact canonical actor records embedded by the live sequence.
const hunundiRoom = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/maps/map_i_temple_basement_hunundi.json'), 'utf8')); // Verifies every seat referenced by the meeting really exists in the authored room.

const listeners = {}; // Captures the module's browser event registration without actually starting a cutscene.
const context = { // Minimal browser-like surface needed to evaluate the content-only module and reach its exported scene builders.
  window: {},
  document: {
    addEventListener(type, handler) { listeners[type] = handler; },
    getElementById() { return null; },
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  performance: { now() { return 0; } },
  requestAnimationFrame(callback) { callback(); },
  queueMicrotask() {},
  setTimeout,
  clearTimeout,
  fetch() { throw new Error('fetch should not run while building test scenes'); },
  console,
  Map,
  Object,
  String,
  Error,
};
context.window.window = context.window;
vm.runInNewContext(storySource, context, { filename: 'opening-story-cutscene.js' });

const api = context.window.OpeningStoryCutscene; // Uses the same public debug/authoring surface mobile runtime exposes.
assert(api, 'OpeningStoryCutscene must install');
assert.strictEqual(typeof api.buildRescueScene, 'function', 'opening story must expose the rescue scene builder');
assert.strictEqual(typeof api.buildHunundiMeetingScene, 'function', 'opening story must expose the Hunundi meeting scene builder');
assert.strictEqual(typeof listeners.hobunjiPlayerReady, 'function', 'opening story must arm from the canonical player-ready event');

const records = new Map(npcDb.npcs.map(record => [record.id, record])); // Mirrors loadNpcRecords() after LocalDBOverrides resolution.
const profile = { nickname: 'Test Farmer', characterId: 'char_test', worldId: 'world_test' }; // Gives the player stand-in a deterministic identity.
const rescue = api.buildRescueScene(records, profile); // Materializes the first scene without triggering runtime side effects.
const meeting = api.buildHunundiMeetingScene(records, profile); // Materializes the second scene against the same canonical NPC records.

assert.strictEqual(rescue.mapId, 'map_northern_cliffs', 'rescue must occur in the Northern Cliffs wilderness');
assert.strictEqual(rescue.wilderness, true, 'rescue must use generated-wilderness placement');
assert(rescue.actors.some(actor => actor.npcId === 'jubmir' && actor.npcRecord?.id === 'jubmir'), 'rescue must use the authored Jubmir NPC');
assert(rescue.actors.some(actor => actor.npcId === 'spearhead_unumanuk' && actor.npcRecord?.id === 'spearhead_unumanuk'), 'rescue must use the authored Spearhead NPC');
assert(rescue.actors.filter(actor => actor.creatureTypeId === 'gar-wolf').length === 3, 'rescue must retain the three Gar-wolf ambushers');
assert(rescue.actors.filter(actor => actor.creatureTypeId === 'dabinggi-hound').length === 2, 'rescue must retain Jubmir\'s two Dabinggi-hound rescuers');
assert(rescue.stages.some(stage => stage.type === 'combat'), 'rescue must retain a real combat card instead of faking the hound/wolf clash');

assert.strictEqual(meeting.mapId, 'map_i_temple_basement_hunundi', 'meeting must use Father Hunundi\'s authored bedroom/study map');
for (const id of ['father_hunundi_hodu', 'jubmir', 'spearhead_unumanuk', 'khannibarri_agent']) {
  assert(meeting.actors.some(actor => actor.npcId === id && actor.npcRecord?.id === id), 'meeting must embed canonical NPC ' + id);
}
const hark = records.get('khannibarri_agent'); // Verifies the existing company-agent identity was promoted in place instead of duplicated.
assert.strictEqual(hark.name, 'Surveyor Harkharash', 'existing khannibarri_agent must now be Surveyor Harkharash');
assert.strictEqual(hark.homeId, 'khannibarri_temporary_lodging', 'Harkharash must have a real temporary lodging identity without joining the inn household spillover circle');
assert.strictEqual(hark.scheduleHooks?.workBuildingId, 'khannibarri_temporary_office', 'Harkharash must not join the general-store coworker spillover circle merely because he uses it as a temporary office');
assert.strictEqual(hark.scheduleHooks?.defaultStationId, 'station_k7m3q', 'Harkharash must use the authored general-store station after Hunundi lets him remain in town');
assert(!hark.scheduleHooks?.defaultPosition, 'Harkharash must not fall back to the old town {0,0} placeholder spawn');

const seatedAtStart = meeting.actors.filter(actor => actor.pose === 'sit'); // Confirms the four-person questioning starts with everyone actually seated.
assert.strictEqual(seatedAtStart.length, 4, 'player, Hunundi, Jubmir, and Spearhead must begin seated');
assert(meeting.stages.some(stage => stage.id === 'meeting_hark_sit' && stage.resultPose === 'sit'), 'Hunundi must invite Harkharash to a real seated pose');
assert(meeting.stages.some(stage => stage.type === 'caption' && stage.text === 'Knock. Knock.'), 'door knock must be conveyed before Harkharash enters');
assert(meeting.stages.some(stage => /12th century/.test(stage.text || '')), 'Harkharash must make the authored twelfth-century insult');
assert(meeting.stages.some(stage => /ghost army/i.test(stage.text || '') && /Slagothim/.test(stage.text || '')), 'Harkharash must explain the Slagothim/ghost-army trade collapse');
assert(meeting.stages.some(stage => /bandit clans/i.test(stage.text || '') && /barbarian war/i.test(stage.text || '')), 'Harkharash must cite both bandit clans and the barbarian war');
assert(meeting.stages.some(stage => (stage.text || '') === "I lost my first home to a dragon. I'm sure as stone not losing this one to those bronze-hungry monsters."), 'Spearhead must end the company visit with the user-authored dragon/home line');
assert(meeting.stages.some(stage => /Nanjiri Farmstead/.test(stage.text || '')), 'Hunundi must offer the player Nanjiri Farmstead');

for (const seatId of ['f_tbhunundi_guest_chair_west', 'f_tbhunundi_guest_chair_near']) {
  assert(hunundiRoom.furniture.some(piece => piece.id === seatId && piece.itemKey === 'chairSimpleFurniture'), 'Hunundi room must contain cutscene seat ' + seatId);
}
assert.strictEqual(hunundiRoom.furniture.filter(piece => piece.itemKey === 'chairSimpleFurniture').length, 5, 'Hunundi room must provide five actual chairs for the full meeting');

assert(gameSource.includes('window.AuthoredCutsceneRuntime = Object.freeze({'), 'game must expose the gameplay-safe authored cutscene runtime');
assert(gameSource.includes("owner: 'authored-cutscene'"), 'live cutscenes must lock player movement/tools/actions');
assert(gameSource.includes("stage.type === 'caption'"), 'runtime must support non-character caption beats such as the door knock');
assert(gameSource.includes('seatTarget: a.seatTarget || null'), 'runtime state must preserve authored seat targets');
assert(gameSource.includes('entity?.root?.parent?.remove?.(entity.root)'), 'live cutscenes must remove temporary NPC/player stand-ins on completion');
assert(helperSource.includes("st.pose === 'sit' ? deps.npcSeatTransformForTarget?.(st.seatTarget)"), 'seated cutscene actors must reuse normal NPC seat transforms');
assert(helperSource.includes('entity.walker.legs.update(0, 0, false, seatedPose)'), 'seated cutscene actors must reuse procedural seated-leg solving');

const gameIndex = indexSource.indexOf('<script src="game.js?v=20261001quickdebuff2"></script>'); // Ensures the story listener installs after the live runtime exists.
const storyIndex = indexSource.indexOf('<script src="js/opening-story-cutscene.js?v=20261001harkharash1"></script>'); // Ensures the new orchestrator is actually shipped.
const onboardingIndex = indexSource.indexOf('<script>HobunjiOnboarding.init();</script>'); // Ensures the story listener exists before player-ready can fire.
assert(gameIndex >= 0 && storyIndex > gameIndex && onboardingIndex > storyIndex, 'opening story script must load after game.js but before HobunjiOnboarding.init()');

console.log('Opening story cutscene regression checks passed.');
