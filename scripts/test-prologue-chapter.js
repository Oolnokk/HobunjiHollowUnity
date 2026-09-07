const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..'); // Used to load the committed game/runtime files under test.
const source = fs.readFileSync(path.join(ROOT, 'docs/js/prologue-system.js'), 'utf8'); // Used by both static and VM runtime assertions below.
const chapter = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/cutscenes/prologue-chapter.json'), 'utf8')); // Used to validate both authored prologue scenes.

assert.match(source, /hobunjiPlayerReady[\s\S]{0,220}onPlayerReady[\s\S]{0,40}true/, 'prologue intercepts player-ready before game.js');
assert.match(source, /stopImmediatePropagation/, 'unfinished-world startup can be stopped before game.js sees it');
assert.match(source, /data-sl-world-join/, 'save-select Join World cards are owner-gated');
assert.match(source, /__prologueFreezeAccessor/, 'calendar freeze wraps the existing time01 accessor');
assert.match(source, /finished/, 'cutscene completion, not launch, advances the prologue');
assert.match(source, /metaEl && metaEl\.textContent !== desiredMeta/, 'world-card status text is idempotent under the save-select MutationObserver');
assert.match(source, /badge && badge\.textContent !== '🔒 Prologue'/, 'join-badge text is idempotent under the save-select MutationObserver');
assert.match(source, /playButton\.textContent !== '🔒 Owner must finish prologue'/, 'locked Play text is idempotent under the save-select MutationObserver');

assert.equal(chapter.schema, 'hobunji_prologue_chapter.v1');
const rescue = chapter.scenes.rescue; // Used to check the opening cutscene's generated Cloud Forest staging contract.
assert.equal(rescue.mapId, 'map_southern_cloud_forest');
assert.equal(rescue.wilderness, true);
assert(rescue.footprint.w <= 10 && rescue.footprint.h <= 10, 'rescue staging footprint stays a tiny square');
for (const actor of rescue.actors) {
  assert(actor.lc >= 0 && actor.lc <= rescue.footprint.w, `${actor.id} lc is inside rescue footprint`);
  assert(actor.lr >= 0 && actor.lr <= rescue.footprint.h, `${actor.id} lr is inside rescue footprint`);
}

function validateScene(scene) {
  const actorIds = new Set(scene.actors.map(actor => actor.id)); // Used to validate every actor reference in this scene.
  const stageIds = new Set(scene.stages.map(stage => stage.id)); // Used to validate every stage-to-stage branch in this scene.
  const nextExists = id => !id || id === '__next__' || id === '__end__' || stageIds.has(id); // Used for next/loss/choice branch validation.
  for (const stage of scene.stages) {
    if (stage.actorId) assert(actorIds.has(stage.actorId), `${stage.id} actor exists`);
    if (stage.speakerId) assert(actorIds.has(stage.speakerId), `${stage.id} speaker exists`);
    if (stage.targetActorId) assert(actorIds.has(stage.targetActorId), `${stage.id} target actor exists`);
    if ('next' in stage) assert(nextExists(stage.next), `${stage.id} next stage exists`);
    if ('lossNext' in stage) assert(nextExists(stage.lossNext), `${stage.id} loss stage exists`);
    for (const option of stage.options || []) assert(nextExists(option.next), `${stage.id} choice stage exists`);
    for (const participant of stage.participants || []) assert(actorIds.has(participant.actorId), `${stage.id} combat participant exists`);
    if (scene.wilderness && stage.type === 'move') {
      assert(stage.targetLocal, `${stage.id} uses targetLocal so generated-zone placement translates it with the actors`);
      assert(stage.targetLocal.c >= 0 && stage.targetLocal.c <= scene.footprint.w, `${stage.id} target c is inside footprint`);
      assert(stage.targetLocal.r >= 0 && stage.targetLocal.r <= scene.footprint.h, `${stage.id} target r is inside footprint`);
    }
  }
}

validateScene(rescue);
const room = chapter.scenes.hunundi_room; // Used to verify scene two is bound to the already-authored Hunundi bedroom interior.
assert.equal(room.mapId, 'map_i_temple_basement_hunundi');
assert(room.actors.some(actor => actor.npcId === 'father_hunundi_hodu'), 'Hunundi room cutscene uses Father Hunundi Hodu as a real NPC actor');
validateScene(room);

const store = new Map(); // Used as the VM's localStorage backing store for persistent-world state tests.
const listeners = new Map(); // Used to retain document listeners installed by the runtime under test.
const noClass = { contains: () => false }; // Used by inert fake DOM nodes when no save-select card is actually rendered.
function fakeElement() {
  return {
    id: '', style: {}, dataset: {}, classList: noClass, textContent: '', disabled: false,
    appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, click() {},
  };
}
const documentStub = {
  documentElement: {}, body: { appendChild() {} },
  addEventListener(type, fn) {
    const bucket = listeners.get(type) || []; // Used to retain all listeners registered for this event type.
    bucket.push(fn);
    listeners.set(type, bucket);
  },
  querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
  createElement() { return fakeElement(); },
};
class MutationObserverStub { constructor(callback) { this.callback = callback; } observe() {} }
const localStorageStub = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
};
const windowStub = {
  CSS: { escape: String },
  CutscenePreviewHelpers: { cutscenePreviewBanner() {} },
};
const context = {
  window: windowStub, document: documentStub, localStorage: localStorageStub,
  MutationObserver: MutationObserverStub, location: { reload() {} }, console,
  fetch: async () => { throw new Error('unexpected fetch in unit test'); },
  setTimeout() { return 1; }, clearTimeout() {}, Date, JSON, Map, Object, Array, String, Number, RegExp, Error, Math,
}; // Used as the browser-like VM environment for pure persistence/calendar gate tests.
vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-system.js' });
const prologue = windowStub.PrologueSystem; // Used as the public debug/runtime API being exercised below.
assert(prologue, 'PrologueSystem is exported');

localStorageStub.setItem('hobunjiSaveMeta', JSON.stringify({
  version: 1,
  characters: [{ id: 'owner' }, { id: 'other' }],
  worlds: [{ id: 'world_1', ownerCharacterId: 'owner' }],
}));
const state = prologue.ensureWorldPrologue('world_1', 'owner'); // Used to verify a newly-created world's persistent first stage.
assert.equal(state.stage, 'rescue');
assert.equal(state.completed, false);
assert.equal(prologue.canCharacterEnterWorld('world_1', 'owner'), true);
assert.equal(prologue.canCharacterEnterWorld('world_1', 'other'), false);

const calendar = { time01: 0.1 }; // Used to verify only natural frame writes freeze during an unfinished prologue.
windowStub.CalendarSystem = {
  init({ calendar }) {
    let value = calendar.time01; // Used as a minimal stand-in for CalendarSystem's own accessor backing value.
    Object.defineProperty(calendar, 'time01', {
      configurable: true, enumerable: true,
      get() { return value; }, set(next) { value = Number(next); },
    });
  },
};
windowStub.CalendarSystem.init({ calendar });
windowStub.__hobunjiGameStarted = true;
windowStub.__hobunjiPlayerProfile = { worldId: 'world_1', characterId: 'owner', isWorldOwner: true };
calendar.time01 += 0.001;
assert.equal(calendar.time01, 0.1, 'natural time is frozen during unfinished prologue');
calendar.time01 = 0.5;
assert.equal(calendar.time01, 0.5, 'explicit time changes still pass through the prologue freeze');

const savedMeta = JSON.parse(localStorageStub.getItem('hobunjiSaveMeta')); // Used to complete the same test world without reaching into private runtime state.
savedMeta.worlds[0].prologue.stage = 'complete';
savedMeta.worlds[0].prologue.completed = true;
localStorageStub.setItem('hobunjiSaveMeta', JSON.stringify(savedMeta));
calendar.time01 += 0.001;
assert.equal(calendar.time01, 0.501, 'natural time resumes after prologue completion');

console.log('prologue chapter tests passed');
