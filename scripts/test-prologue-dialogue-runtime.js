'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-dialogue-runtime.js', 'utf8'); // Runtime under test: stable loader hold + scripted NPC target switching.
const chapter = JSON.parse(fs.readFileSync('docs/config/cutscenes/prologue-chapter.json', 'utf8')); // Authored actors and target order.

function classList() {
  const values = new Set();
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
    closest(selector) { return selector.split(',').some(part => part.trim() === `#${id}`) ? this : null; },
  };
}
const elements = Object.fromEntries([
  'hobunjiLoadScreen', 'npcDialogue', 'arcContainer', 'npcDialogueName', 'npcDialogueText', 'npcDialogueHearts',
  'npcDialogueContinue', 'npcDialogueLeave',
].map(id => [id, element(id)]));

const documentStub = {
  documentElement: element('documentElement'),
  getElementById(id) { return elements[id] || null; },
  createElement(tag) {
    if (tag === 'canvas') return { width: 0, height: 0, getContext() { return {}; } };
    return element(tag);
  },
  addEventListener() {},
};

function makeScene() {
  return {
    children: [],
    add(child) { child.parent = this; if (!this.children.includes(child)) this.children.push(child); },
    remove(child) { this.children = this.children.filter(item => item !== child); if (child.parent === this) child.parent = null; },
  };
}
function makeRoot(name) {
  return {
    name,
    parent: null,
    userData: { portraitModelHeight: 1 },
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    rotation: { y: 0 },
  };
}

const rescueScene = makeScene();
const database = {
  npcs: [
    { id: 'jubmir', name: 'Jubmir', appearance: { speciesId: 'tletingan', gender: 'female' }, equippedCosmetics: [], appliedDyes: {} },
    { id: 'spearhead_unumanuk', name: 'Spearhead Unumanuk', appearance: { speciesId: 'mao-ao', gender: 'male' }, equippedCosmetics: [], appliedDyes: {} },
  ],
};

let loaderVisible = false;
let loaderShowCalls = 0;
let loaderHideCalls = 0;
let dialogueInjectedDeps = null;
let cameraTarget = null;
let cameraMode = 'default';
let portraitRenders = 0;
const rafQueue = [];

const windowObject = {
  __hobunjiPlayerProfile: { worldId: 'world-test', characterId: 'owner', isWorldOwner: true },
  GridTileAccessors: {
    getCurrentArea: () => 'map_prologue_rescue',
    getActiveScene: () => rescueScene,
    getActiveGrid: () => [[{}]],
  },
  PrologueSystem: { getWorldPrologue: () => ({ stage: 'rescue', completed: false }) },
  LocalDBOverrides: { async loadDatabase(id) { return id === 'npcDatabase' ? database : null; } },
  LoadingScreenRuntime: {
    getDebug: () => ({ visible: loaderVisible }),
    show() { loaderShowCalls++; loaderVisible = true; elements.hobunjiLoadScreen.classList.add('visible'); },
    setProgress() {},
    async hide() { loaderHideCalls++; loaderVisible = false; elements.hobunjiLoadScreen.classList.remove('visible'); },
  },
  NpcAvatarPreview: {
    async ensurePortraitCosmetics() {},
    buildProfileFromNpcExport(exported) { return { npcId: exported.id, fighter: { id: exported.id } }; },
    async renderProfileToCanvas(canvas, profile) { canvas.profile = profile; },
  },
  PNGPlaneAvatar: {
    buildSinglePlaneAvatarModel(_THREE, frontCanvas, options) {
      return makeRoot(`prologue_actor_${options?.npcRecord?.id || frontCanvas?.profile?.npcId}`);
    },
    disposeAvatarModel() {},
  },
  THREE: {},
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { worldModelWidth: 1, previewPortraitCanvasSize: 64 } } } },
  WorldPopupText: { clearInteractionPrompts() {} },
  FarmAnimals: { init() { return true; } },
  DialogueContent: {
    init(deps) { dialogueInjectedDeps = deps; return true; },
    renderRelationshipHearts() { return ''; },
    stopNpcDialogueTypewriter() {},
    hideChoiceButtons() {},
    resetDialogueState() {},
    async renderNpcDialoguePortrait() { portraitRenders++; return !!dialogueInjectedDeps?.getDialogueWalker?.(); },
  },
};

const context = {
  window: windowObject,
  document: documentStub,
  localStorage: {
    getItem(key) {
      if (key !== 'hobunjiSaveMeta') return null;
      return JSON.stringify({ worlds: [{ id: 'world-test', prologue: { stage: 'rescue', completed: false } }] });
    },
  },
  fetch: async url => ({
    ok: true,
    status: 200,
    async json() { return String(url).includes('prologue-chapter') ? chapter : database; },
  }),
  requestAnimationFrame(callback) { rafQueue.push(callback); return rafQueue.length; },
  setInterval() { return 1; },
  MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
  Promise,
  console,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-dialogue-runtime.js' });

(async () => {
  const runtime = windowObject.PrologueDialogueRuntime;
  assert.ok(runtime, 'runtime must export its public setup API');

  // Reproduce the real failure: actor setup is polled repeatedly before camera/dialogue deps exist.
  for (let index = 0; index < 6; index++) {
    assert.equal(await runtime.prepareRescueStage(), false, 'setup remains pending until gameplay dialogue dependencies initialize');
  }
  assert.equal(loaderShowCalls, 1, 'retry polling must start exactly one loading generation, never one generation per 80ms tick');
  assert.equal(runtime.debugSnapshot().loadingShowCalls, 1, 'debug snapshot exposes the stable one-show invariant');
  assert.equal(windowObject.__hobunjiPrologueHiddenSetup, true, 'hidden-setup audio gate remains active while setup is pending');

  const cameraDeps = {
    getCameraMode: () => cameraMode,
    setCameraMode(next) { cameraMode = next; },
    getCameraTarget: () => cameraTarget,
    setCameraTarget(next) { cameraTarget = next; },
    cameraConfig: () => ({ dialogueMode: 'npcDialogue', defaultMode: 'default' }),
  };
  windowObject.FarmAnimals.init(cameraDeps);
  windowObject.DialogueContent.init({ getDialogueOpen: () => false, getDialogueWalker: () => null, closeNpcDialogue() {} });

  assert.equal(await runtime.prepareRescueStage(), true, 'setup succeeds once gameplay dependencies are available');
  assert.equal(loaderShowCalls, 1, 'successful setup still reuses the original loading generation');
  assert.equal(runtime.debugSnapshot().actorsReady, 2, 'both scripted NPC actors must exist before reveal');
  assert.equal(rescueScene.children.length, 2, 'both NPC world roots must already be attached to the rescue scene');
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir');
  assert.equal(runtime.debugSnapshot().speakerNpcId, 'jubmir');
  assert.ok(portraitRenders >= 1, 'first speaker portrait is prepared during hidden setup');

  const first = rafQueue.shift();
  assert.equal(typeof first, 'function', 'setup schedules first paint barrier frame');
  first();
  const second = rafQueue.shift();
  assert.equal(typeof second, 'function', 'setup schedules second paint barrier frame');
  await second();
  await Promise.resolve();
  assert.equal(loaderHideCalls, 1, 'loader releases once after the two-frame barrier');
  assert.equal(windowObject.__hobunjiPrologueHiddenSetup, false, 'audio gate opens only after reveal');

  assert.equal(await runtime.advanceDialogueTest(), true);
  assert.equal(elements.npcDialogueName.textContent, 'Spearhead Unumanuk', 'line 2 automatically retargets Spearhead');
  assert.equal(await runtime.advanceDialogueTest(), true);
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir', 'line 3 automatically retargets Jubmir again');
  assert.equal(runtime.debugSnapshot().targetChanges, 3);

  assert.equal(source.includes('player.x ='), false, 'scripted dialogue must not reposition the player');
  assert.equal(source.includes('player.y ='), false, 'scripted dialogue must not reposition the player');
  assert.equal(source.includes('updateHeadYaw'), false, 'speaker changes do not force yaw headtracking');
  assert.equal(source.includes('updateHeadRotation'), false, 'speaker changes do not force pitch headtracking');

  console.log('prologue stable-loader + automatic dialogue target regression passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
