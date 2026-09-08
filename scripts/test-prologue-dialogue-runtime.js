'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-dialogue-runtime.js', 'utf8'); // Runtime under test.
const chapter = JSON.parse(fs.readFileSync('docs/config/cutscenes/prologue-chapter.json', 'utf8')); // Authored actor/speaker order.

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
    classList: classList(),
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    closest(selector) { return selector.split(',').some(part => part.trim() === `#${this.id}`) ? this : null; },
  };
}

const elements = Object.fromEntries([
  'npcDialogue',
  'arcContainer',
  'npcDialogueName',
  'npcDialogueText',
  'npcDialogueHearts',
  'npcDialogueContinue',
  'npcDialogueLeave',
].map(id => [id, element(id)]));

const documentListeners = new Map();
const documentStub = {
  getElementById(id) { return elements[id] || null; },
  createElement(tag) {
    if (tag === 'canvas') return { width: 0, height: 0, getContext() { return {}; } };
    return element(tag);
  },
  addEventListener(type, handler) {
    const list = documentListeners.get(type) || [];
    list.push(handler);
    documentListeners.set(type, list);
  },
};

function root(name, height = 1) {
  return {
    name,
    parent: null,
    userData: { portraitModelHeight: height },
    position: {
      x: 0, y: 0, z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
    rotation: { y: 0 },
  };
}

const rescueScene = {
  children: [],
  add(child) {
    child.parent = this;
    if (!this.children.includes(child)) this.children.push(child);
  },
  remove(child) {
    this.children = this.children.filter(entry => entry !== child);
    if (child.parent === this) child.parent = null;
  },
};
const rescueGrid = Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => ({ type: 'grass' })));

const database = {
  npcs: [
    {
      id: 'jubmir',
      name: 'Jubmir',
      appearance: { speciesId: 'tletingan', gender: 'female' },
      equippedCosmetics: [],
      appliedDyes: {},
    },
    {
      id: 'spearhead_unumanuk',
      name: 'Spearhead Unumanuk',
      appearance: { speciesId: 'mao-ao', gender: 'male' },
      equippedCosmetics: [],
      appliedDyes: {},
    },
  ],
};

let farmAnimalDeps = null;
let dialogueInjectedDeps = null;
let cameraMode = 'default';
let cameraTarget = { id: 'old-target' };
let portraitRenders = 0;
let revealChecks = 0;
let loaderShows = 0;
let loaderHides = 0;
const progressEvents = [];
const profileBuildIds = [];
const worldBuildIds = [];

const cameraDeps = {
  getCameraMode: () => cameraMode,
  setCameraMode(next) { cameraMode = next; },
  getCameraTarget: () => cameraTarget,
  setCameraTarget(next) { cameraTarget = next; },
  cameraConfig: () => ({ dialogueMode: 'npcDialogue', defaultMode: 'default' }),
};

const windowObject = {
  __hobunjiPlayerProfile: {
    worldId: 'world-test',
    characterId: 'owner',
    isWorldOwner: true,
    isNewWorld: false,
  },
  __hobunjiPrologueHiddenSetup: true,
  GridTileAccessors: {
    getCurrentArea: () => 'map_prologue_rescue',
    getActiveScene: () => rescueScene,
    getActiveGrid: () => rescueGrid,
  },
  PrologueSystem: {
    getWorldPrologue: () => ({ stage: 'rescue', completed: false }),
  },
  PrologueRescueMapRuntime: {
    requestRevealCheck() { revealChecks++; },
  },
  LoadingScreenRuntime: {
    show() { loaderShows++; },
    hide() { loaderHides++; },
    setProgress(value, label) { progressEvents.push({ value, label }); },
  },
  WorldPopupText: { clearInteractionPrompts() {} },
  LocalDBOverrides: {
    async loadDatabase(id) { return id === 'npcDatabase' ? database : null; },
  },
  NpcAvatarPreview: {
    async ensurePortraitCosmetics() {},
    buildProfileFromNpcExport(exported) {
      profileBuildIds.push(exported.id);
      return { npcId: exported.id };
    },
    async renderProfileToCanvas(canvas, profile) {
      canvas.profile = profile;
    },
  },
  PNGPlaneAvatar: {
    buildSinglePlaneAvatarModel(_THREE, frontCanvas, options) {
      const npcId = options?.npcRecord?.id || frontCanvas?.profile?.npcId || 'unknown';
      worldBuildIds.push(npcId);
      return root(`actor-${npcId}`, 1);
    },
    disposeAvatarModel() {},
  },
  THREE: {},
  SCRATCHBONES_CONFIG: {
    game: {
      assets: {
        pngPlaneAvatar: {
          worldModelWidth: 1,
          previewPortraitCanvasSize: 64,
          worldAlphaTest: 0.01,
        },
      },
    },
  },
  FarmAnimals: {
    init(deps) { farmAnimalDeps = deps; return 'farm-init'; },
  },
  DialogueContent: {
    init(deps) { dialogueInjectedDeps = deps; return 'dialogue-init'; },
    renderRelationshipHearts() { return ''; },
    stopNpcDialogueTypewriter() {},
    hideChoiceButtons() {},
    resetDialogueState() {},
    async renderNpcDialoguePortrait() {
      portraitRenders++;
      return !!dialogueInjectedDeps?.getDialogueWalker?.()?.profile;
    },
  },
};

const context = {
  window: windowObject,
  document: documentStub,
  console,
  localStorage: {
    getItem(key) {
      if (key !== 'hobunjiSaveMeta') return null;
      return JSON.stringify({
        worlds: [{ id: 'world-test', prologue: { stage: 'rescue', completed: false } }],
      });
    },
  },
  fetch: async url => {
    if (String(url).includes('prologue-chapter.json')) {
      return { ok: true, status: 200, async json() { return chapter; } };
    }
    if (String(url).includes('hobunji-starter-npc-database.json')) {
      return { ok: true, status: 200, async json() { return database; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  },
  setInterval() { return 1; },
  clearInterval() {},
  Promise,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-dialogue-runtime.js' });

(async () => {
  const runtime = windowObject.PrologueDialogueRuntime;
  assert.ok(runtime, 'PrologueDialogueRuntime must export its API');

  // The first several attempts happen before normal camera/dialogue init in the
  // real browser. They must fail transiently rather than becoming sticky.
  for (let i = 0; i < 6; i++) {
    assert.equal(await runtime.prepareRescueStage(), false, `early dependency wait ${i + 1} must be retryable`);
  }
  assert.equal(runtime.debugSnapshot().lastStatus, 'waiting-dialogue-camera-deps');

  assert.equal(windowObject.FarmAnimals.init(cameraDeps), 'farm-init');
  assert.equal(farmAnimalDeps, cameraDeps, 'FarmAnimals wrapper must preserve the injected dependency object');
  assert.equal(
    windowObject.DialogueContent.init({
      getDialogueOpen: () => false,
      getDialogueWalker: () => null,
      closeNpcDialogue() {},
    }),
    'dialogue-init',
  );

  assert.equal(await runtime.prepareRescueStage(), true, 'setup succeeds once gameplay dependencies are available');
  assert.equal(runtime.isRescueStageReady(), true);
  assert.equal(rescueScene.children.length, 2, 'both scripted actors must be created from database records');
  assert.deepEqual([...profileBuildIds].sort(), ['jubmir', 'spearhead_unumanuk']);
  assert.deepEqual([...worldBuildIds].sort(), ['jubmir', 'spearhead_unumanuk']);

  const jubmirRoot = rescueScene.children.find(child => child.userData?.prologueNpcId === 'jubmir');
  const spearheadRoot = rescueScene.children.find(child => child.userData?.prologueNpcId === 'spearhead_unumanuk');
  assert.ok(jubmirRoot);
  assert.ok(spearheadRoot);
  assert.deepEqual([jubmirRoot.position.x, jubmirRoot.position.z], [9.5, 12.5]);
  assert.deepEqual([spearheadRoot.position.x, spearheadRoot.position.z], [15.5, 12.5]);

  assert.equal(elements.npcDialogue.classList.contains('open'), true, 'ordinary dialogue shell must be open');
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir');
  assert.equal(elements.npcDialogueText.textContent, '[Target test] Jubmir speaking.');
  assert.equal(cameraTarget, jubmirRoot);
  assert.equal(dialogueInjectedDeps.getDialogueWalker().rec.id, 'jubmir');
  assert.ok(portraitRenders >= 1);
  assert.ok(revealChecks >= 1, 'stage readiness must signal the single map/loader owner');

  // Crucial regression: the dialogue runtime must NEVER own the loading screen.
  assert.equal(loaderShows, 0, 'dialogue runtime must not create/restart loading generations');
  assert.equal(loaderHides, 0, 'dialogue runtime must not hide the loading screen');
  assert.equal(runtime.debugSnapshot().loaderOwnedBy, 'PrologueRescueMapRuntime');
  assert.equal(windowObject.__hobunjiPrologueHiddenSetup, true, 'dialogue readiness must not clear hidden-audio state before actual reveal');
  assert.ok(progressEvents.some(event => event.label === 'prologue-dialogue-ready'));

  assert.equal(await runtime.advanceDialogueTest(), true);
  assert.equal(elements.npcDialogueName.textContent, 'Spearhead Unumanuk');
  assert.equal(cameraTarget, spearheadRoot);
  assert.equal(dialogueInjectedDeps.getDialogueWalker().rec.id, 'spearhead_unumanuk');

  assert.equal(await runtime.advanceDialogueTest(), true);
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir');
  assert.equal(cameraTarget, jubmirRoot);
  assert.equal(runtime.debugSnapshot().targetChanges, 3);

  assert.equal(await runtime.advanceDialogueTest(), true);
  assert.equal(elements.npcDialogue.classList.contains('open'), false);
  assert.equal(runtime.debugSnapshot().testFinished, true);
  assert.equal(cameraMode, 'default');
  assert.equal(cameraTarget.id, 'old-target');

  assert.equal(source.includes('LoadingScreenRuntime?.show'), false, 'dialogue module must have no loader show ownership');
  assert.equal(source.includes('LoadingScreenRuntime?.hide'), false, 'dialogue module must have no loader hide ownership');
  assert.equal(source.includes("classList.remove('visible')"), false, 'dialogue module must never remove the loader DOM class');
  assert.equal(source.includes("classList.add('visible')"), false, 'dialogue module must never re-add the loader DOM class');
  assert.equal(source.includes('player.x ='), false, 'dialogue runtime must not reposition the player');
  assert.equal(source.includes('player.y ='), false, 'dialogue runtime must not reposition the player');
  assert.equal(source.includes('updateHeadYaw'), false, 'dialogue runtime must not force yaw headtracking');
  assert.equal(source.includes('updateHeadRotation'), false, 'dialogue runtime must not force pitch headtracking');

  console.log('prologue single-loader-owner + automatic dialogue target regression passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
