'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-dialogue-runtime.js', 'utf8');
const chapter = JSON.parse(fs.readFileSync('docs/config/cutscenes/prologue-chapter.json', 'utf8'));

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
    id,
    textContent: '',
    width: 200,
    height: 200,
    classList: classList(),
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
  };
}

const elements = Object.fromEntries([
  'npcDialogue', 'arcContainer', 'npcDialogueName', 'npcDialogueText',
  'npcDialogueHearts', 'npcDialogueContinue', 'npcDialogueLeave', 'npcPortraitCanvas',
].map(id => [id, element(id)]));

const documentStub = {
  getElementById(id) { return elements[id] || null; },
  createElement(tag) {
    if (tag === 'canvas') return element('generatedCanvas');
    return element(tag);
  },
  addEventListener() {},
};

function makeRoot(npcId) {
  return {
    parent: null,
    userData: { portraitModelHeight: 1 },
    position: {
      x: 0, y: 0, z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
    rotation: { y: 0 },
    npcId,
  };
}

const scene = {
  children: [],
  add(child) { child.parent = this; this.children.push(child); },
  remove(child) { this.children = this.children.filter(entry => entry !== child); child.parent = null; },
};
const grid = Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => ({ type: 'grass' })));
const database = {
  npcs: [
    { id: 'jubmir', name: 'Jubmir', appearance: { speciesId: 'tletingan', gender: 'female' }, equippedCosmetics: [], appliedDyes: {} },
    { id: 'spearhead_unumanuk', name: 'Spearhead Unumanuk', appearance: { speciesId: 'mao-ao', gender: 'male' }, equippedCosmetics: [], appliedDyes: {} },
  ],
};

let cameraMode = 'default';
let cameraTarget = null;
let directPortraitRenders = 0;
let ordinaryPortraitCalls = 0;
const cameraDeps = {
  getCameraMode: () => cameraMode,
  setCameraMode(value) { cameraMode = value; },
  getCameraTarget: () => cameraTarget,
  setCameraTarget(value) { cameraTarget = value; },
  cameraConfig: () => ({ dialogueMode: 'npcDialogue', defaultMode: 'default' }),
};

const windowObject = {
  __hobunjiPlayerProfile: { worldId: 'world-test', characterId: 'owner', isWorldOwner: true, isNewWorld: false },
  __hobunjiPrologueHiddenSetup: false,
  GridTileAccessors: {
    getCurrentArea: () => 'map_prologue_rescue',
    getActiveScene: () => scene,
    getActiveGrid: () => grid,
  },
  PrologueSystem: { getWorldPrologue: () => ({ stage: 'rescue', completed: false }) },
  PrologueRescueMapRuntime: { requestRevealCheck() {} },
  LoadingScreenRuntime: { setProgress() {} },
  WorldPopupText: { clearInteractionPrompts() {} },
  LocalDBOverrides: { async loadDatabase(id) { return id === 'npcDatabase' ? database : null; } },
  NpcAvatarPreview: {
    async ensurePortraitCosmetics() {},
    buildProfileFromNpcExport(exported) { return { npcId: exported.id }; },
    async renderProfileToCanvas(canvas, profile) {
      canvas.lastNpcId = profile.npcId;
      if (canvas === elements.npcPortraitCanvas) directPortraitRenders++;
      return true;
    },
  },
  PNGPlaneAvatar: {
    buildSinglePlaneAvatarModel(_THREE, _front, options) { return makeRoot(options.npcRecord.id); },
    disposeAvatarModel() {},
  },
  THREE: {},
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { worldModelWidth: 1, previewPortraitCanvasSize: 64, worldAlphaTest: 0.01 } } } },
  FarmAnimals: { init() { return 'farm-init'; } },
  DialogueContent: {
    // Deliberately NEVER called in this regression. This reproduces the live
    // report where PrologueDialogueRuntime saw camera=true, dialogue=false.
    init() { throw new Error('DialogueContent.init must not be required by this test'); },
    renderRelationshipHearts() { return ''; },
    stopNpcDialogueTypewriter() {},
    hideChoiceButtons() {},
    resetDialogueState() {},
    renderNpcDialoguePortrait() { ordinaryPortraitCalls++; throw new Error('walker bridge is unavailable'); },
  },
};

const context = {
  window: windowObject,
  document: documentStub,
  console,
  localStorage: {
    getItem(key) {
      return key === 'hobunjiSaveMeta'
        ? JSON.stringify({ worlds: [{ id: 'world-test', prologue: { stage: 'rescue', completed: false } }] })
        : null;
    },
  },
  fetch: async url => {
    if (String(url).includes('prologue-chapter.json')) return { ok: true, status: 200, async json() { return chapter; } };
    if (String(url).includes('hobunji-starter-npc-database.json')) return { ok: true, status: 200, async json() { return database; } };
    return { ok: false, status: 404, async json() { return {}; } };
  },
  setInterval() { return 1; },
  clearInterval() {},
  Promise,
};
windowObject.window = windowObject;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-dialogue-runtime.js' });

(async () => {
  const runtime = windowObject.PrologueDialogueRuntime;
  assert.ok(runtime);
  assert.equal(await runtime.prepareRescueActors(), true);
  assert.equal(windowObject.FarmAnimals.init(cameraDeps), 'farm-init');

  // Critical regression: no call to DialogueContent.init occurs here.
  assert.equal(runtime.debugSnapshot().dialogueBridgeReady, false);
  assert.equal(runtime.debugSnapshot().cameraDepsReady, true);
  assert.equal(await runtime.prepareRescueDialogue(), true, 'scripted dialogue must not deadlock on the missed walker bridge');

  assert.equal(runtime.debugSnapshot().sessionActive, true);
  assert.equal(runtime.debugSnapshot().speakerNpcId, 'jubmir');
  assert.equal(elements.npcDialogue.classList.contains('open'), true);
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir');
  assert.equal(elements.npcDialogueText.textContent, '[Target test] Jubmir speaking.');
  assert.equal(elements.npcPortraitCanvas.lastNpcId, 'jubmir');
  assert.equal(directPortraitRenders, 1, 'fallback must render into the real gameplay portrait canvas');
  assert.equal(ordinaryPortraitCalls, 0, 'unavailable walker renderer must not be called without the bridge');
  assert.equal(runtime.debugSnapshot().directPortraitFallbacks, 1);

  assert.equal(await runtime.advanceDialogueTest(), true);
  assert.equal(elements.npcDialogueName.textContent, 'Spearhead Unumanuk');
  assert.equal(elements.npcPortraitCanvas.lastNpcId, 'spearhead_unumanuk');
  assert.equal(directPortraitRenders, 2);
  assert.equal(runtime.debugSnapshot().dialogueBridgeReady, false, 'fallback remains independent of DialogueContent init ordering');

  assert.doesNotMatch(source, /if \(!cameraDeps \|\| !dialogueBridge/, 'walker bridge must never again be a post-reveal readiness gate');
  console.log('prologue late-DialogueContent bridge fallback regression passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
