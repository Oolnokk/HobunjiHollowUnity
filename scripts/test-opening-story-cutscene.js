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

// Execute the game-owned fade stage against the boot cover, before any dialogue can wait for input.
const fadeEl = { style: { opacity: '1' } }; // Models showBootCover() hiding the newly loaded wilderness.
const fadeStart = gameSource.indexOf('        function runFade(stage) {'); // Reads the same stage handler the live runtime executes.
const fadeEnd = gameSource.indexOf('        function runZoom(stage) {', fadeStart); // Ends at the next stage handler rather than pinning source lines.
let fadeNext = null; // Records completion so the rescue cannot stop at its cover-release stage.
vm.runInNewContext(gameSource.slice(fadeStart, fadeEnd) + '\nrunFade(stage);', {
  window: { CutscenePreviewHelpers: { cutscenePreviewFadeEl: () => fadeEl } },
  stage: rescue.stages[0],
  requestAnimationFrame: callback => callback(),
  setTimeout: callback => callback(),
  getResolvedNext: () => rescue.stages[1].id,
  continueTo: next => { fadeNext = next; },
});
assert.strictEqual(rescue.stages[0].type, 'fade', 'rescue must release its startup cover before dialogue');
assert.strictEqual(fadeEl.style.opacity, '0', 'first rescue stage must reveal the wilderness');
assert.strictEqual(fadeNext, 'rescue_wolf1_growl', 'fade must advance to the rescue dialogue');

assert.strictEqual(rescue.mapId, 'map_opening_cloud_forest', 'rescue must occur in the Cloud Forest wilderness');
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
assert.strictEqual(hark.name, 'Surveyor Harkhanash', 'existing khannibarri_agent must now be Surveyor Harkhanash');
assert.strictEqual(hark.homeId, 'khannibarri_temporary_lodging', 'Harkhanash must have a real temporary lodging identity without joining the inn household spillover circle');
assert.strictEqual(hark.scheduleHooks?.workBuildingId, 'khannibarri_temporary_office', 'Harkhanash must not join the general-store coworker spillover circle merely because he uses it as a temporary office');
assert.strictEqual(hark.scheduleHooks?.defaultStationId, 'station_k7m3q', 'Harkhanash must use the authored general-store station after Hunundi lets him remain in town');
assert(!hark.scheduleHooks?.defaultPosition, 'Harkhanash must not fall back to the old town {0,0} placeholder spawn');

const seatedAtStart = meeting.actors.filter(actor => actor.pose === 'sit'); // Confirms the four-person questioning starts with everyone actually seated.
assert.strictEqual(seatedAtStart.length, 4, 'player, Hunundi, Jubmir, and Spearhead must begin seated');
assert(meeting.stages.some(stage => stage.id === 'meeting_hark_sit' && stage.resultPose === 'sit'), 'Hunundi must invite Harkhanash to a real seated pose');
assert(meeting.stages.some(stage => stage.type === 'caption' && stage.text === 'Knock. Knock.'), 'door knock must be conveyed before Harkhanash enters');
assert(meeting.stages.some(stage => /12th century/.test(stage.text || '')), 'Harkhanash must make the authored twelfth-century insult');
assert(meeting.stages.some(stage => /ghost army/i.test(stage.text || '') && /Slagothim/.test(stage.text || '')), 'Harkhanash must explain the Slagothim/ghost-army trade collapse');
assert(meeting.stages.some(stage => /bandit clans/i.test(stage.text || '') && /barbarian war/i.test(stage.text || '')), 'Harkhanash must cite both bandit clans and the barbarian war');
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
assert(helperSource.includes("deps.npcSeatTransformForTarget?.(st.seatTarget)"), 'seated cutscene actors must reuse normal NPC seat transforms');
assert(helperSource.includes('entity.walker.legs.update(dt > 0 ? dt : 1 / 60, 0, false, seatedPose)'), 'seated cutscene actors must reuse procedural seated-leg solving');

const gameIndex = indexSource.indexOf('<script src="game.js?v=20261002h960fd67"></script>'); // Ensures the story listener installs after the live runtime exists.
const storyIndex = indexSource.indexOf('<script src="js/opening-story-cutscene.js?v=20261002harkharash1"></script>'); // Ensures the new orchestrator is actually shipped.
const onboardingIndex = indexSource.indexOf('<script>HobunjiOnboarding.init();</script>'); // Ensures the story listener exists before player-ready can fire.
assert(gameIndex >= 0 && storyIndex > gameIndex && onboardingIndex > storyIndex, 'opening story script must load after game.js but before HobunjiOnboarding.init()');

async function checkWorldOpeningProgress() {
  function boot(initial = {}) {
    const saved = new Map(Object.entries(initial)); // Models durable world progress shared across character sessions.
    const queued = []; // Captures automatic startup jobs without starting them during eligibility assertions.
    const calls = []; // Captures both real scene payloads and the dialogue-completion callback supplied to the runtime.
    const events = {}; // Holds the fresh page's player-ready listener.
    let finishMeeting = null; // Keeps the scene running while checking that completion persists at the final Continue.
    const browser = {
      window: {
        __hobunjiGameStarted: true,
        LocalDBOverrides: { loadDatabase: async () => npcDb },
        AuthoredCutsceneRuntime: { run(scene, options) {
          calls.push({ scene, options });
          if (calls.length === 1) return Promise.resolve();
          return new Promise(resolve => { finishMeeting = resolve; });
        } },
      },
      document: { addEventListener: (type, handler) => { events[type] = handler; }, getElementById: () => null },
      localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
      queueMicrotask: callback => queued.push(callback),
      performance, setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), console,
    }; // Provides an isolated browser session for each owner/farmhand/completion case.
    vm.runInNewContext(storySource, browser);
    return { saved, queued, calls, events, api: browser.window.OpeningStoryCutscene, finish: () => finishMeeting() };
  }

  const owner = { ...profile, isWorldOwner: true }; // Uses the same role flag onboarding sets for new and existing worlds.
  const first = boot(); // An existing owner's world without progress must start even without creator-reload state.
  const key = first.api.stateKey(owner); // Names the one completion flag shared by every character in this world.
  assert.strictEqual(key, first.api.stateKey({ ...owner, characterId: 'another_character' }));
  assert.notStrictEqual(key, first.api.stateKey({ ...owner, worldId: 'another_world' }));
  first.events.hobunjiPlayerReady({ detail: owner });
  assert.strictEqual(first.queued.length, 1, 'unfinished existing world auto-starts for its owner');
  assert.strictEqual(first.saved.get(key), 'pending');
  const playback = first.queued[0](); // Starts the complete story orchestration against the controlled runtime.
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(first.calls.length, 2, 'owner gets rescue followed by Hunundi meeting');
  const finalStage = first.calls[1].scene.stages.find(stage => stage.id === 'meeting_hunundi_final'); // Identifies the actual authored final dialogue rather than assuming scene completion means success.
  first.calls[1].options.onDialogueContinue({ id: 'meeting_hunundi_farm' });
  assert.strictEqual(first.saved.get(key), 'pending', 'earlier dialogue cannot complete the opening');
  assert.strictEqual(first.saved.get(key), 'pending', 'merely reaching the final dialogue leaves it pending');
  first.calls[1].options.onDialogueContinue(finalStage);
  assert.strictEqual(first.saved.get(key), 'complete', 'final Continue persists completion before the closing fade ends');
  first.finish();
  assert.strictEqual(await playback, true);

  const completed = boot(Object.fromEntries(first.saved)); // Completion survives switching to another character in the same world.
  completed.events.hobunjiPlayerReady({ detail: { ...owner, characterId: 'another_character' } });
  assert.strictEqual(completed.queued.length, 0);
  completed.events.hobunjiPlayerReady({ detail: { ...owner, worldId: 'another_world' } });
  assert.strictEqual(completed.queued.length, 1, 'same character starts again in a new world');

  const farmhand = boot({ [key]: 'pending' }); // Even an interrupted world cannot auto-start its protagonist story for a farmhand.
  farmhand.events.hobunjiPlayerReady({ detail: { ...owner, isWorldOwner: false } });
  assert.strictEqual(farmhand.queued.length, 0);
  const legacy = boot({ ['hobunjiOpeningStory.v1:' + owner.characterId + ':' + owner.worldId]: 'complete' }); // Migrates already completed worlds from the previous storage format.
  legacy.events.hobunjiPlayerReady({ detail: owner });
  assert.strictEqual(legacy.queued.length, 0);
  assert.strictEqual(legacy.saved.get(key), 'complete');

  const interrupted = boot(); // A runtime that ends without final Continue must remain eligible on the next session.
  interrupted.events.hobunjiPlayerReady({ detail: owner });
  const interruptedPlayback = interrupted.queued[0](); // Resolves the scene without acknowledging its final dialogue.
  await new Promise(resolve => setImmediate(resolve));
  interrupted.finish();
  assert.strictEqual(await interruptedPlayback, false);
  assert.strictEqual(interrupted.saved.get(key), 'pending');

  const stageStart = gameSource.indexOf('        function runStage(stageId) {'); // Executes the real dialogue stage wiring that reports Continue to the story.
  const stageEnd = gameSource.indexOf('        function runMove(stage) {', stageStart); // Isolates this handler from unrelated movement dependencies.
  let continued = 0; // Counts milestone notifications from genuine Continue inputs only.
  const runtimeContext = {
    povShot: null, dialogueAddressedActorId: null, furniturePlayback: null, window: {},
    running: true, dialogueOpen: false, payload: meeting, runtimeOptions: { onDialogueContinue: () => { continued++; } },
    stagesById: new Map([[finalStage.id, finalStage]]), actorsById: new Map(), entities: new Map([[finalStage.speakerId, {}]]),
    report() {}, openLine() { runtimeContext.dialogueOpen = true; },
    getResolvedNext: () => '__end__', continueTo() { runtimeContext.running = false; },
  }; // Supplies only the runtime surfaces needed by an actual talk card.
  vm.runInNewContext(gameSource.slice(stageStart, stageEnd) + '\nrunStage("meeting_hunundi_final");', runtimeContext);
  assert.strictEqual(continued, 0, 'displaying final dialogue cannot report completion');
  runtimeContext.cutscenePreviewAdvance();
  assert.strictEqual(continued, 1, 'Continue reports the displayed dialogue milestone');
  runtimeContext.cutscenePreviewAdvance();
  assert.strictEqual(continued, 1, 'stale Continue cannot report completion twice');
}

checkWorldOpeningProgress().then(() => {
  console.log('Opening story cutscene regression checks passed.');
}).catch(error => { console.error(error); process.exitCode = 1; });
