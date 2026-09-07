const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..'); // Used to load the committed runtime/config files under test.
const source = fs.readFileSync(path.join(ROOT, 'docs/js/prologue-system.js'), 'utf8'); // Used by static and VM runtime assertions below.
const chapter = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/cutscenes/prologue-chapter.json'), 'utf8')); // Used to validate the new gameplay-cutscene contract and both map stages.
const bridge = fs.readFileSync(path.join(ROOT, 'docs/js/cutscene-preview-helpers.js'), 'utf8'); // Used to ensure the old Director helper remains a dev preview tool, not the prologue runtime.

assert.match(source, /hobunjiPlayerReady[\s\S]{0,220}onPlayerReady[\s\S]{0,40}true/, 'prologue listens before game.js so non-owner entry still has a lower-level gate');
assert.match(source, /owner startup is intentionally NOT prevented/, 'owner startup is allowed to initialize the real game before prologue map entry');
assert.match(source, /window\.__hobunjiGameStarted !== true/, 'prologue waits for ordinary game/calendar/season initialization before changing maps');
assert.match(source, /_runtimeDeps\.enterZone\(spec\.mapId/, 'wilderness prologue stages use the normal enterZone path');
assert.match(source, /_runtimeDeps\.enterBuilding\(spec\.mapId\)/, 'room prologue stages use the normal enterBuilding path');
assert.match(source, /CharacterActionLocks\?\.acquire/, 'gameplay cutscene stages lock player movement/tools/actions without repositioning the player');
assert.match(source, /data-sl-world-join/, 'save-select Join World cards remain owner-gated');
assert.match(source, /__prologueFreezeAccessor/, 'calendar freeze still wraps the existing time01 accessor');
assert.match(source, /Temporary real-map flow test/, 'temporary mobile-visible map-flow controls are present for this first pass');
assert.doesNotMatch(source, /hobunji_cutscene_preview_v1/, 'prologue no longer writes the Cutscene Director preview handoff');
assert.doesNotMatch(source, /buildPayload|onSceneFinished|handleCutsceneBanner/, 'preview-runner scene plumbing was removed from the prologue runtime');
assert.doesNotMatch(bridge, /PrologueSystem|prologue-system\.js/, 'CutscenePreviewHelpers no longer owns the prologue runtime');
assert.match(source, /metaEl && metaEl\.textContent !== desiredMeta/, 'world-card status text remains idempotent under the save-select MutationObserver');
assert.match(source, /badge && badge\.textContent !== '🔒 Prologue'/, 'join-badge text remains idempotent under the save-select MutationObserver');
assert.match(source, /playButton\.textContent !== '🔒 Owner must finish prologue'/, 'locked Play text remains idempotent under the save-select MutationObserver');

assert.equal(chapter.schema, 'hobunji_gameplay_cutscene_chapter.v2');
assert.equal(chapter.version, 2);
assert.equal(chapter.cutsceneModel.mapRuntime, 'normal-gameplay');
assert.equal(chapter.cutsceneModel.dialogueSurface, 'npcDialogue');
assert.equal(chapter.cutsceneModel.playerMovement, 'locked');
assert.equal(chapter.cutsceneModel.playerRepositioning, 'authored-only');
assert.equal(chapter.cutsceneModel.speakerSelection, 'automatic-per-line');
assert.equal(chapter.cutsceneModel.npcFacing, 'authored-per-beat');
assert.equal(chapter.cutsceneModel.npcHeadTracking, 'authored-per-beat');

const rescue = chapter.stages.rescue; // Used to verify scene one is now an ordinary fully initialized Cloud Forest zone.
assert.equal(rescue.kind, 'zone');
assert.equal(rescue.mapId, 'map_southern_cloud_forest');
assert.deepEqual(rescue.dialogue, []);
assert.equal(rescue.footprint, undefined, 'the detached 10x10 preview footprint is gone');

const room = chapter.stages.hunundi_room; // Used to verify scene two is the existing real Father Hunundi room.
assert.equal(room.kind, 'building');
assert.equal(room.mapId, 'map_i_temple_basement_hunundi');
assert.deepEqual(room.dialogue, []);

const store = new Map(); // Used as the VM localStorage backing store for persistence/calendar tests.
const listeners = new Map(); // Used to retain document listeners installed by the runtime under test.
const noClass = { contains: () => false }; // Used by inert fake DOM nodes when no save-select card is rendered.
function fakeElement() {
  return {
    id: '', type: '', style: {}, dataset: {}, classList: noClass, textContent: '', disabled: false,
    appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, click() {}, remove() {},
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
const windowStub = {};
const context = {
  window: windowStub, document: documentStub, localStorage: localStorageStub,
  MutationObserver: MutationObserverStub, location: { reload() {} }, console,
  fetch: async () => { throw new Error('config fetch intentionally unavailable in VM persistence test'); },
  setTimeout() { return 1; }, clearTimeout() {}, Date, JSON, Map, Object, Array, String, Number, RegExp, Error, Math, Promise,
}; // Used as the browser-like VM environment for pure persistence/calendar gate tests.
vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-system.js' });
const prologue = windowStub.PrologueSystem; // Used as the public runtime/debug API exercised below.
assert(prologue, 'PrologueSystem is exported');

localStorageStub.setItem('hobunjiSaveMeta', JSON.stringify({
  version: 1,
  characters: [{ id: 'owner' }, { id: 'other' }],
  worlds: [{ id: 'world_1', ownerCharacterId: 'owner' }],
}));
const state = prologue.ensureWorldPrologue('world_1', 'owner'); // Used to verify a new owned world starts at the first real-map stage.
assert.equal(state.version, 2);
assert.equal(state.stage, 'rescue');
assert.equal(state.completed, false);
assert.equal(prologue.canCharacterEnterWorld('world_1', 'owner'), true);
assert.equal(prologue.canCharacterEnterWorld('world_1', 'other'), false);

const calendar = { time01: 0.1 }; // Used to verify only natural frame writes freeze while the map-based prologue is incomplete.
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
assert.equal(calendar.time01, 0.1, 'natural time is frozen during unfinished real-map prologue');
calendar.time01 = 0.5;
assert.equal(calendar.time01, 0.5, 'explicit time changes still pass through the prologue freeze');

const savedMeta = JSON.parse(localStorageStub.getItem('hobunjiSaveMeta')); // Used to complete the same test world without reaching into private runtime state.
savedMeta.worlds[0].prologue.stage = 'complete';
savedMeta.worlds[0].prologue.completed = true;
localStorageStub.setItem('hobunjiSaveMeta', JSON.stringify(savedMeta));
calendar.time01 += 0.001;
assert.equal(calendar.time01, 0.501, 'natural time resumes after real-map prologue completion');

console.log('prologue gameplay-map tests passed');
