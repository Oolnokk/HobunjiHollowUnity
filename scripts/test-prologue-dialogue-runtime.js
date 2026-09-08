'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-dialogue-runtime.js', 'utf8'); // Runtime under test: normal-dialogue automatic speaker retargeting.
const chapter = JSON.parse(fs.readFileSync('docs/config/cutscenes/prologue-chapter.json', 'utf8')); // Authored speaker/actor sequence used by the runtime.

function classList() {
  const values = new Set(); // Used as the fake DOM class backing store for dialogue-shell assertions.
  return {
    add(...items) { items.forEach(item => values.add(item)); },
    remove(...items) { items.forEach(item => values.delete(item)); },
    contains(item) { return values.has(item); },
  };
}
function element(id) {
  return {
    id, textContent: '', classList: classList(), attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    closest(selector) { return selector.split(',').some(part => part.trim() === `#${this.id}`) ? this : null; },
  };
}
const elements = Object.fromEntries([
  'npcDialogue', 'arcContainer', 'npcDialogueName', 'npcDialogueText', 'npcDialogueHearts',
  'npcDialogueContinue', 'npcDialogueLeave', 'prologueMapFlowContinue',
].map(id => [id, element(id)]));
const documentListeners = new Map(); // Captures click listeners so the runtime can be validated without a browser.
const documentStub = {
  getElementById(id) { return elements[id] || null; },
  addEventListener(type, handler) {
    const list = documentListeners.get(type) || [];
    list.push(handler);
    documentListeners.set(type, list);
  },
};

function root(name) {
  return {
    name,
    parent: null,
    position: {
      x: 0, y: 0, z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
    rotation: { y: 0 },
  };
}
function parent(name) {
  return {
    name,
    children: [],
    add(child) {
      if (child.parent?.children) child.parent.children = child.parent.children.filter(entry => entry !== child);
      child.parent = this;
      if (!this.children.includes(child)) this.children.push(child);
    },
    remove(child) {
      this.children = this.children.filter(entry => entry !== child);
      if (child.parent === this) child.parent = null;
    },
  };
}
const ordinaryScene = parent('ordinary-scene'); // Original parent used to verify staging restoration.
const rescueScene = parent('rescue-scene'); // Real active rescue scene receiving the staged NPC roots.
const jubmirRoot = root('jubmir-root');
const spearheadRoot = root('spearhead-root');
ordinaryScene.add(jubmirRoot);
ordinaryScene.add(spearheadRoot);
jubmirRoot.position.set(2, 0.1, 3);
spearheadRoot.position.set(4, 0.2, 5);

const jubmir = {
  rec: { id: 'jubmir', name: 'Jubmir', relationship: null },
  profile: { fighter: { id: 'jubmir-profile' } },
  root: jubmirRoot,
  area: 'town', state: 'walking', pause: 0, path: [{ c: 1, r: 1 }], currentScheduleTarget: { c: 2, r: 2 },
};
const spearhead = {
  rec: { id: 'spearhead_unumanuk', name: 'Spearhead Unumanuk', relationship: null },
  profile: { fighter: { id: 'spearhead-profile' } },
  root: spearheadRoot,
  area: 'town', state: 'walking', pause: 0, path: [{ c: 3, r: 3 }], currentScheduleTarget: { c: 4, r: 4 },
};
const npcWalkers = [jubmir, spearhead];

let npcSchedulingDeps = null; // Captures the original init call to prove the wrapper is transparent.
let farmAnimalDeps = null; // Captures the original FarmAnimals init call for the same reason.
let dialogueInjectedDeps = null; // Captures the prologue-aware getters passed through DialogueContent.init.
const cameraTargets = []; // Records every automatic speaker camera retarget.
const cameraModes = []; // Records dialogue mode entry/restoration.
let portraitRenders = 0; // Counts shared DialogueContent portrait rendering requests.
let dialogueResetCount = 0; // Ensures the synthetic sequence cleans shared dialogue state on close.
let cameraMode = 'default';
let cameraTarget = { id: 'old-camera-target' };

const windowObject = {
  __hobunjiPlayerProfile: { worldId: 'world-test', characterId: 'owner', isWorldOwner: true },
  GridTileAccessors: {
    getCurrentArea: () => 'map_prologue_rescue',
    getActiveScene: () => rescueScene,
  },
  PrologueSystem: {
    getWorldPrologue: () => ({ stage: 'rescue', completed: false }),
  },
  PrologueRescueMapRuntime: { rescueMapReady: () => true },
  WorldPopupText: { clearInteractionPrompts() {} },
  NpcScheduling: {
    init(deps) { npcSchedulingDeps = deps; return 'npc-init'; },
  },
  FarmAnimals: {
    init(deps) { farmAnimalDeps = deps; return 'farm-init'; },
  },
  DialogueContent: {
    init(deps) { dialogueInjectedDeps = deps; return 'dialogue-init'; },
    renderRelationshipHearts() { return ''; },
    stopNpcDialogueTypewriter() {},
    hideChoiceButtons() {},
    resetDialogueState() { dialogueResetCount++; },
    renderNpcDialoguePortrait() {
      portraitRenders++;
      return Promise.resolve(!!dialogueInjectedDeps?.getDialogueWalker?.());
    },
  },
};
const cameraDeps = {
  getCameraMode: () => cameraMode,
  setCameraMode(next) { cameraMode = next; cameraModes.push(next); },
  getCameraTarget: () => cameraTarget,
  setCameraTarget(next) { cameraTarget = next; cameraTargets.push(next); },
  cameraConfig: () => ({ dialogueMode: 'npcDialogue', defaultMode: 'default' }),
};

const context = {
  window: windowObject,
  document: documentStub,
  console,
  fetch: async url => ({
    ok: String(url).includes('prologue-chapter.json'),
    status: 200,
    async json() { return chapter; },
  }),
  setInterval() { return 1; },
  clearInterval() {},
  Promise,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-dialogue-runtime.js' });

assert.equal(windowObject.NpcScheduling.init({ npcWalkers }), 'npc-init');
assert.equal(npcSchedulingDeps.npcWalkers, npcWalkers, 'NpcScheduling wrapper must preserve the real dependency bag');
assert.equal(windowObject.FarmAnimals.init(cameraDeps), 'farm-init');
assert.equal(farmAnimalDeps, cameraDeps, 'FarmAnimals wrapper must preserve the real camera dependency bag');
assert.equal(windowObject.DialogueContent.init({ getDialogueOpen: () => false, getDialogueWalker: () => null, closeNpcDialogue() {} }), 'dialogue-init');
assert.equal(typeof dialogueInjectedDeps.getDialogueWalker, 'function', 'DialogueContent must receive the prologue-aware active-speaker getter');

(async () => {
  const runtime = windowObject.PrologueDialogueRuntime;
  assert.ok(runtime, 'PrologueDialogueRuntime must export its test/control API');
  assert.equal(await runtime.startDialogueTest(), true, 'rescue dialogue target test must start when the real map and NPCs are ready');

  assert.equal(elements.npcDialogue.classList.contains('open'), true, 'ordinary npcDialogue shell must be opened');
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir');
  assert.equal(elements.npcDialogueText.textContent, '[Target test] Jubmir speaking.');
  assert.equal(runtime.debugSnapshot().speakerNpcId, 'jubmir');
  assert.equal(cameraTarget, jubmirRoot, 'line 1 camera target must be the live Jubmir walker root');
  assert.equal(dialogueInjectedDeps.getDialogueWalker(), jubmir, 'shared DialogueContent portrait getter must resolve Jubmir on line 1');
  assert.equal(jubmirRoot.parent, rescueScene, 'Jubmir root must be staged into the real rescue scene');
  assert.equal(spearheadRoot.parent, rescueScene, 'Spearhead root must be staged into the real rescue scene');
  assert.deepEqual([jubmirRoot.position.x, jubmirRoot.position.z], [9.5, 12.5], 'Jubmir must use his authored rescue-map position');
  assert.deepEqual([spearheadRoot.position.x, spearheadRoot.position.z], [15.5, 12.5], 'Spearhead must use his authored rescue-map position');
  assert.equal(jubmir.pause, Infinity, 'staged speaker must be scheduler-frozen instead of walking away');
  assert.equal(spearhead.pause, Infinity, 'second staged speaker must also be scheduler-frozen');

  assert.equal(runtime.advanceDialogueTest(), true, 'line 2 must advance without selecting another NPC manually');
  assert.equal(elements.npcDialogueName.textContent, 'Spearhead Unumanuk');
  assert.equal(elements.npcDialogueText.textContent, '[Target test] Spearhead speaking.');
  assert.equal(runtime.debugSnapshot().speakerNpcId, 'spearhead_unumanuk');
  assert.equal(cameraTarget, spearheadRoot, 'line 2 camera target must automatically switch to Spearhead');
  assert.equal(dialogueInjectedDeps.getDialogueWalker(), spearhead, 'shared portrait getter must automatically switch to Spearhead');

  assert.equal(runtime.advanceDialogueTest(), true, 'line 3 must automatically return to the first speaker');
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir');
  assert.equal(elements.npcDialogueText.textContent, '[Target test] Jubmir again.');
  assert.equal(runtime.debugSnapshot().speakerNpcId, 'jubmir');
  assert.equal(cameraTarget, jubmirRoot, 'line 3 camera target must automatically return to Jubmir');
  assert.equal(dialogueInjectedDeps.getDialogueWalker(), jubmir, 'shared portrait getter must return to Jubmir with the authored line');
  assert.equal(runtime.debugSnapshot().targetChanges, 3, 'exactly three speaker/camera target changes must occur');
  assert.ok(portraitRenders >= 3, 'each speaker line must request a portrait refresh through ordinary DialogueContent');

  assert.equal(runtime.advanceDialogueTest(), true, 'advancing past the final line must close the test cleanly');
  assert.equal(elements.npcDialogue.classList.contains('open'), false, 'ordinary dialogue shell must close after the test sequence');
  assert.equal(runtime.debugSnapshot().testFinished, true);
  assert.ok(dialogueResetCount >= 1, 'shared dialogue content state must be reset after the synthetic cutscene dialogue');
  assert.equal(cameraMode, 'default', 'camera mode must restore after the test');
  assert.equal(cameraTarget.id, 'old-camera-target', 'prior camera target must restore after the test');

  runtime.restoreStagedActors();
  assert.equal(jubmirRoot.parent, ordinaryScene, 'Jubmir must return to his original scene parent');
  assert.equal(spearheadRoot.parent, ordinaryScene, 'Spearhead must return to his original scene parent');
  assert.equal(jubmir.area, 'town');
  assert.equal(spearhead.area, 'town');
  assert.deepEqual([jubmirRoot.position.x, jubmirRoot.position.y, jubmirRoot.position.z], [2, 0.1, 3], 'Jubmir original transform must be restored');
  assert.deepEqual([spearheadRoot.position.x, spearheadRoot.position.y, spearheadRoot.position.z], [4, 0.2, 5], 'Spearhead original transform must be restored');

  assert.equal(source.includes('player.x ='), false, 'cutscene dialogue runtime must not reposition the player');
  assert.equal(source.includes('player.y ='), false, 'cutscene dialogue runtime must not reposition the player');
  assert.equal(source.includes('updateHeadYaw'), false, 'speaker targeting test must not force NPC yaw headtracking');
  assert.equal(source.includes('updateHeadRotation'), false, 'speaker targeting test must not force NPC pitch headtracking');
  assert.deepEqual(chapter.stages.rescue.dialogue.map(line => line.speakerNpcId), ['jubmir', 'spearhead_unumanuk', 'jubmir'], 'authored test must explicitly change targets and return to the first speaker');
  assert.equal(chapter.stages.rescue.dialogue.every(line => line.headTracking === 'none'), true, 'target test lines must explicitly keep headtracking disabled');

  console.log('prologue automatic dialogue target regression passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
