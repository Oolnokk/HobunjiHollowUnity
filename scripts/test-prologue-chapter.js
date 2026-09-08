const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..'); // Used to load the exact committed prologue/runtime/map files under test.
const prologueSource = fs.readFileSync(path.join(ROOT, 'docs/js/prologue-system.js'), 'utf8'); // Used for persistence/calendar and no-preview assertions.
const rescueRuntimeSource = fs.readFileSync(path.join(ROOT, 'docs/js/prologue-rescue-map-runtime.js'), 'utf8'); // Used to guard the authored-map/fog/loading adapter contract.
const rescueCompatSource = fs.readFileSync(path.join(ROOT, 'docs/js/prologue-rescue-zone-compat.js'), 'utf8'); // Used to guard deterministic expansion of the compact 25x25 rescue descriptor.
const characterLocksSource = fs.readFileSync(path.join(ROOT, 'docs/js/character-action-locks.js'), 'utf8'); // Used to verify rescue bootstrap loads before the main prologue controller.
const chapter = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/cutscenes/prologue-chapter.json'), 'utf8')); // Used to validate stage-to-real-map authoring semantics.
const rescueMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/maps/map_prologue_rescue.json'), 'utf8')); // Used to validate the compact authored rescue clearing descriptor.
const mapIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/maps/index.json'), 'utf8')); // Used to ensure the authored map is resolvable by game.js's indexed-map precedence.

// The prologue must remain a real gameplay-map flow, never the removed
// Cutscene Director preview/reload transport.
assert(!prologueSource.includes('hobunji_cutscene_preview_v1'), 'prologue must not write the Director preview handoff');
assert.match(prologueSource, /enterZone\(spec\.mapId/, 'zone stages use the normal enterZone gameplay path');
assert.match(prologueSource, /enterBuilding\(spec\.mapId/, 'building stages use the normal enterBuilding gameplay path');
assert.match(prologueSource, /CharacterActionLocks\?\.acquire/, 'gameplay cutscene locks player control through CharacterActionLocks');
assert.match(prologueSource, /__prologueFreezeAccessor/, 'calendar freeze wraps the existing natural-time accessor');

// The new cutscene contract stays gameplay-dialogue-shaped.
assert.equal(chapter.schema, 'hobunji_gameplay_cutscene_chapter.v2');
assert.equal(chapter.cutsceneModel.dialogueSurface, 'npcDialogue');
assert.equal(chapter.cutsceneModel.playerMovement, 'locked');
assert.equal(chapter.cutsceneModel.playerRepositioning, 'authored-only');
assert.equal(chapter.cutsceneModel.speakerSelection, 'automatic-per-line');
assert.equal(chapter.cutsceneModel.npcFacing, 'authored-per-beat');
assert.equal(chapter.cutsceneModel.npcHeadTracking, 'authored-per-beat');
assert.equal(chapter.stages.rescue.mapId, 'map_prologue_rescue');
assert.equal(chapter.stages.rescue.kind, 'zone');
assert.equal(chapter.stages.rescue.entryCol, 12);
assert.equal(chapter.stages.rescue.entryRow, 12);
assert.equal(chapter.stages.hunundi_room.mapId, 'map_i_temple_basement_hunundi');

// The rescue area's linear dimensions are exactly 2.5x the former 10x10 map.
assert.equal(rescueMap.schema, 'hobunji_map.v1');
assert.equal(rescueMap.id, 'map_prologue_rescue');
assert.equal(rescueMap.category, 'exterior');
assert.equal(rescueMap.cols, 25, 'rescue map width must be 2.5x the former 10 tiles');
assert.equal(rescueMap.rows, 25, 'rescue map height must be 2.5x the former 10 tiles');
assert.deepEqual(rescueMap.prologueRescue.walkableRect, { c: 5, r: 5, w: 15, h: 15 });
assert.deepEqual(rescueMap.prologueRescue.underbrushRing, { inset: 1, depth: 4 });
assert.equal(rescueMap.prologueRescue.fogProfile, 'southern_cloud_forest');
assert.equal(rescueMap.prologueRescue.noNaturalExits, true);
assert.equal(rescueMap.transitions.length, 0, 'rescue clearing has no ordinary map exit');
assert.equal(rescueMap.tiles.length, 0, 'rescue JSON stays compact; zone compat expands its deterministic repeated tile pattern');
assert.match(rescueCompatSource, /const RESCUE_COLS = 25/, 'transport compatibility uses the enlarged map width');
assert.match(rescueCompatSource, /const RESCUE_ROWS = 25/, 'transport compatibility uses the enlarged map height');
assert.match(rescueCompatSource, /const RESCUE_WALKABLE_SIZE = 15/, 'transport compatibility scales the clear center to 15x15');
assert.match(rescueCompatSource, /function buildRescueTiles\(\)/, 'transport compatibility expands the compact map descriptor before rendering');
assert.match(rescueCompatSource, /layout\.tiles = buildRescueTiles\(\)/, 'expanded tiles are written into the exact private layout consumed by buildZoneScene');

const rescueIndexEntry = mapIndex.maps.find(entry => entry.id === 'map_prologue_rescue');
assert(rescueIndexEntry, 'rescue map is present in config/maps/index.json');
assert.equal(rescueIndexEntry.file, 'config/maps/map_prologue_rescue.json');
assert.equal(rescueIndexEntry.category, 'exterior');

// Runtime registration/environment contract: append the indexed map to the
// workspace, reuse Cloud Forest environment systems, and keep ONE authoritative
// loading hold until map + scripted NPC WORLD ACTORS are ready. Dialogue/camera
// readiness is explicitly post-reveal and cannot pin the loading screen.
assert.match(rescueRuntimeSource, /augmentTownWorkspace/, 'rescue runtime injects the private authored exterior into the normal workspace load');
assert.match(rescueRuntimeSource, /LocalDBOverrides/, 'workspace injection composes with repo/local database source selection');
assert.match(rescueRuntimeSource, /CloudForestFog/, 'rescue map extends the existing Cloud Forest fog predicate');
assert.match(rescueRuntimeSource, /buildShadewoodMesh/, 'outer boundary reuses the real Cloud Forest Shadewood generator');
assert.match(rescueRuntimeSource, /RESCUE_FOG_DENSITY\s*=\s*0\.055/, 'rescue scene uses Southern Cloud Forest fog density');
assert.match(rescueRuntimeSource, /LoadingScreenRuntime\?\.show/, 'prologue can start the existing loading screen instead of a fake cover');
assert.match(rescueRuntimeSource, /MutationObserver/, 'authoritative loader hold intercepts premature hide attempts');
assert.match(rescueRuntimeSource, /requestAnimationFrame\(\(\) => requestAnimationFrame/, 'loader release waits two rendered frames after map+actor readiness');
assert.match(rescueRuntimeSource, /const cols = Number\(access\.getActiveCols\?\.\(\)\) \|\| grid\[0\]\?\.length \|\| 0/, 'loader size validation falls back to the actual rendered grid if dimension accessors are late');
assert.match(rescueRuntimeSource, /if \(cols !== RESCUE_COLS \|\| rows !== RESCUE_ROWS\) return false;/, 'loader release still requires the authored 25x25 map, not merely currentArea');
assert.match(rescueRuntimeSource, /PrologueDialogueRuntime\?\.isRescueActorsReady/, 'rescue reveal requires scripted NPC world actors to be staged');
assert.match(rescueRuntimeSource, /return rescueMapReady\(\) && rescueActorsReady\(\)/, 'dialogue/camera readiness is not part of the loader release gate');
assert.match(rescueRuntimeSource, /RESCUE_CENTER_ROW/, 'loader readiness probes the enlarged clearing center rather than an old 10x10 coordinate');
assert(!rescueRuntimeSource.includes('location.reload'), 'rescue map/loading adapter never reloads the page');

const rescueLoaderPos = characterLocksSource.indexOf('prologue-rescue-map-runtime.js');
const prologueLoaderPos = characterLocksSource.indexOf('prologue-system.js');
assert(rescueLoaderPos >= 0 && prologueLoaderPos > rescueLoaderPos, 'rescue map adapter loads before the prologue controller');

// Exercise the rescue runtime's pure workspace augmentation API in a small VM.
const rescueWindow = {};
const rescueDocument = {
  documentElement: {},
  addEventListener() {},
  getElementById() { return null; },
};
class RescueMutationObserver { observe() {} disconnect() {} }
const rescueContext = {
  window: rescueWindow,
  document: rescueDocument,
  localStorage: { getItem() { return null; } },
  MutationObserver: RescueMutationObserver,
  setInterval() { return 1; },
  requestAnimationFrame(callback) { callback(); },
  console,
};
vm.runInNewContext(rescueRuntimeSource, rescueContext, { filename: 'prologue-rescue-map-runtime.js' });
const rescueRuntime = rescueWindow.PrologueRescueMapRuntime;
assert(rescueRuntime, 'PrologueRescueMapRuntime is exported');
const workspaceOnce = rescueRuntime.augmentTownWorkspace({ maps: [{ id: 'map_hobunji_town' }] });
const workspaceTwice = rescueRuntime.augmentTownWorkspace(workspaceOnce);
const workspaceRescue = workspaceOnce.maps.find(map => map.id === 'map_prologue_rescue');
assert.equal(workspaceOnce.maps.filter(map => map.id === 'map_prologue_rescue').length, 1);
assert.equal(workspaceTwice.maps.filter(map => map.id === 'map_prologue_rescue').length, 1);
assert.equal(workspaceRescue.cols, 25);
assert.equal(workspaceRescue.rows, 25);

// Preserve the owner gate + calendar behavior from the previous pass.
const store = new Map();
const listeners = new Map();
const noClass = { contains: () => false };
function fakeElement() {
  return {
    id: '', style: {}, dataset: {}, classList: noClass, textContent: '', disabled: false,
    appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, click() {}, remove() {},
  };
}
const documentStub = {
  documentElement: {}, body: { appendChild() {} },
  addEventListener(type, fn) {
    const bucket = listeners.get(type) || [];
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
const windowStub = { CSS: { escape: String } };
const context = {
  window: windowStub, document: documentStub, localStorage: localStorageStub,
  MutationObserver: MutationObserverStub, location: { reload() {} }, console,
  fetch: async () => { throw new Error('unexpected fetch in unit test'); },
  setTimeout() { return 1; }, clearTimeout() {}, Date, JSON, Map, Object, Array, String, Number, RegExp, Error, Math,
};
vm.createContext(context);
vm.runInContext(prologueSource, context, { filename: 'prologue-system.js' });
const prologue = windowStub.PrologueSystem;
assert(prologue, 'PrologueSystem is exported');

localStorageStub.setItem('hobunjiSaveMeta', JSON.stringify({
  version: 1,
  characters: [{ id: 'owner' }, { id: 'other' }],
  worlds: [{ id: 'world_1', ownerCharacterId: 'owner' }],
}));
const state = prologue.ensureWorldPrologue('world_1', 'owner');
assert.equal(state.stage, 'rescue');
assert.equal(state.completed, false);
assert.equal(prologue.canCharacterEnterWorld('world_1', 'owner'), true);
assert.equal(prologue.canCharacterEnterWorld('world_1', 'other'), false);

const calendar = { time01: 0.1 };
windowStub.CalendarSystem = {
  init({ calendar }) {
    let value = calendar.time01;
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

const savedMeta = JSON.parse(localStorageStub.getItem('hobunjiSaveMeta'));
savedMeta.worlds[0].prologue.stage = 'complete';
savedMeta.worlds[0].prologue.completed = true;
localStorageStub.setItem('hobunjiSaveMeta', JSON.stringify(savedMeta));
calendar.time01 += 0.001;
assert.equal(calendar.time01, 0.501, 'natural time resumes after prologue completion');

console.log('prologue authored rescue-map tests passed');
