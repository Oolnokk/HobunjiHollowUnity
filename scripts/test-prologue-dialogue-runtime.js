'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-dialogue-runtime.js', 'utf8'); // Runtime under test: loader-covered actor construction + automatic dialogue targets.
const chapter = JSON.parse(fs.readFileSync('docs/config/cutscenes/prologue-chapter.json', 'utf8')); // Authored actor positions/speaker order.

function classList() {
  const values = new Set(); // Used as the fake DOM class backing store for loader/dialogue assertions.
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
  'hobunjiLoadScreen', 'npcDialogue', 'arcContainer', 'npcDialogueName', 'npcDialogueText', 'npcDialogueHearts',
  'npcDialogueContinue', 'npcDialogueLeave',
].map(id => [id, element(id)]));
const documentListeners = new Map(); // Captures click/player-ready listeners for the headless runtime.
const documentStub = {
  documentElement: element('documentElement'),
  readyState: 'complete',
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

function root(name, height = 0.9) {
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
function scene(name) {
  return {
    name,
    children: [],
    add(child) {
      child.parent?.remove?.(child);
      child.parent = this;
      if (!this.children.includes(child)) this.children.push(child);
    },
    remove(child) {
      this.children = this.children.filter(entry => entry !== child);
      if (child.parent === this) child.parent = null;
    },
  };
}
const rescueScene = scene('rescue-scene'); // Real active rescue scene receiving newly built prologue-owned NPC roots.
const rescueGrid = [[{}]]; // Only presence is required by prepareRescueStage; map topology is covered by the separate zone regression.
const database = {
  npcs: [
    {
      id: 'jubmir', name: 'Jubmir', relationship: null,
      appearance: { speciesId: 'tletingan', gender: 'female' }, equippedCosmetics: [], appliedDyes: {},
    },
    {
      id: 'spearhead_unumanuk', name: 'Spearhead Unumanuk', relationship: null,
      appearance: { speciesId: 'mao-ao', gender: 'male' }, equippedCosmetics: [], appliedDyes: {},
    },
  ],
}; // Proves the runtime can build scripted actors when NO ordinary scheduled walkers exist.

let farmAnimalDeps = null; // Captures the original FarmAnimals init call to prove wrapper transparency.
let dialogueInjectedDeps = null; // Captures the prologue-aware getters passed through DialogueContent.init.
let cameraMode = 'default';
let cameraTarget = { id: 'old-camera-target' };
const cameraTargets = []; // Records each automatic camera target change.
let portraitRenders = 0; // Counts shared gameplay-dialogue portrait refreshes.
let dialogueResetCount = 0; // Ensures the synthetic sequence cleans shared dialogue state.
let cosmeticsEnsures = 0; // Confirms real NPC avatar resources are prepared during setup.
const profileBuildIds = []; // Confirms both database records are turned into avatar profiles.
const worldAvatarBuildIds = []; // Confirms both profiles become actual world models.
const renderEvents = []; // Records loader/actor/render ordering for the no-pop-in assertion.
const disposedRoots = []; // Records actor disposal outside the rescue stage.
const rafQueue = []; // Gives the test explicit control over the runtime's two-frame loading release barrier.

const cameraDeps = {
  getCameraMode: () => cameraMode,
  setCameraMode(next) { cameraMode = next; },
  getCameraTarget: () => cameraTarget,
  setCameraTarget(next) { cameraTarget = next; cameraTargets.push(next); },
  cameraConfig: () => ({ dialogueMode: 'npcDialogue', defaultMode: 'default' }),
};

const windowObject = {
  __hobunjiPlayerProfile: { worldId: 'world-test', characterId: 'owner', isWorldOwner: true, isNewWorld: false },
  GridTileAccessors: {
    getCurrentArea: () => 'map_prologue_rescue',
    getActiveScene: () => rescueScene,
    getActiveGrid: () => rescueGrid,
  },
  PrologueSystem: { getWorldPrologue: () => ({ stage: 'rescue', completed: false }) },
  WorldPopupText: { clearInteractionPrompts() {} },
  LocalDBOverrides: { async loadDatabase(id) { return id === 'npcDatabase' ? database : null; } },
  LoadingScreenRuntime: {
    show() { renderEvents.push('loader-show'); elements.hobunjiLoadScreen.classList.add('visible'); },
    setProgress(value, label) { renderEvents.push(`progress:${value}:${label}`); },
    async hide() { renderEvents.push('loader-hide'); elements.hobunjiLoadScreen.classList.remove('visible'); },
  },
  NpcAvatarPreview: {
    async ensurePortraitCosmetics() { cosmeticsEnsures++; renderEvents.push('cosmetics-ready'); },
    buildProfileFromNpcExport(exported) {
      profileBuildIds.push(exported.id);
      renderEvents.push(`profile:${exported.id}`);
      return { fighter: { id: `${exported.id}-fighter` }, npcId: exported.id };
    },
    async renderProfileToCanvas(canvas, profile, options = {}) {
      renderEvents.push(`render:${profile.npcId}:${options.portraitView || 'front'}`);
      canvas.profile = profile;
    },
  },
  PNGPlaneAvatar: {
    buildSinglePlaneAvatarModel(_THREE, frontCanvas, options) {
      const npcId = options?.npcRecord?.id || frontCanvas?.profile?.npcId || 'unknown';
      worldAvatarBuildIds.push(npcId);
      renderEvents.push(`world:${npcId}`);
      return root(`prologue_actor_${npcId}`, 1.0);
    },
    disposeAvatarModel(actorRoot) { disposedRoots.push(actorRoot); },
  },
  THREE: {},
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { worldModelWidth: 1, previewPortraitCanvasSize: 64, worldAlphaTest: 0.01 } } } },
  FarmAnimals: {
    init(deps) { farmAnimalDeps = deps; return 'farm-init'; },
  },
  DialogueContent: {
    init(deps) { dialogueInjectedDeps = deps; return 'dialogue-init'; },
    renderRelationshipHearts() { return ''; },
    stopNpcDialogueTypewriter() {},
    hideChoiceButtons() {},
    resetDialogueState() { dialogueResetCount++; },
    async renderNpcDialoguePortrait() {
      portraitRenders++;
      const walker = dialogueInjectedDeps?.getDialogueWalker?.();
      renderEvents.push(`dialogue-portrait:${walker?.rec?.id || 'none'}`);
      return !!walker?.profile;
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
      return JSON.stringify({ worlds: [{ id: 'world-test', prologue: { stage: 'rescue', completed: false } }] });
    },
  },
  fetch: async url => {
    if (String(url).includes('prologue-chapter.json')) return { ok: true, status: 200, async json() { return chapter; } };
    if (String(url).includes('hobunji-starter-npc-database.json')) return { ok: true, status: 200, async json() { return database; } };
    return { ok: false, status: 404, async json() { return {}; } };
  },
  setInterval() { return 1; },
  clearInterval() {},
  requestAnimationFrame(callback) { rafQueue.push(callback); return rafQueue.length; },
  MutationObserver: class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  },
  Promise,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-dialogue-runtime.js' });

assert.equal(windowObject.FarmAnimals.init(cameraDeps), 'farm-init');
assert.equal(farmAnimalDeps, cameraDeps, 'FarmAnimals wrapper must preserve the real camera dependency bag');
assert.equal(windowObject.DialogueContent.init({ getDialogueOpen: () => false, getDialogueWalker: () => null, closeNpcDialogue() {} }), 'dialogue-init');
assert.equal(typeof dialogueInjectedDeps.getDialogueWalker, 'function', 'DialogueContent must receive the prologue-aware active-speaker getter');

async function flushTwoFrames() {
  const first = rafQueue.shift();
  assert.equal(typeof first, 'function', 'stage setup must schedule first loading-release paint frame');
  first();
  const second = rafQueue.shift();
  assert.equal(typeof second, 'function', 'stage setup must schedule second loading-release paint frame');
  await second();
  await Promise.resolve();
}

(async () => {
  const runtime = windowObject.PrologueDialogueRuntime;
  assert.ok(runtime, 'PrologueDialogueRuntime must export its setup/control API');
  assert.equal(runtime.debugSnapshot().actorsReady, 0, 'test starts with no scripted actors and no ordinary npcWalkers fallback');

  const ready = await runtime.prepareRescueStage();
  assert.equal(ready, true, 'rescue setup must construct its own actors and prime dialogue');
  assert.equal(runtime.isRescueStageReady(), true, 'stage readiness must require completed actor/dialogue setup');
  assert.equal(elements.hobunjiLoadScreen.classList.contains('visible'), true, 'loading screen must STILL cover the scene after actors/dialogue are ready but before two paint frames');

  assert.deepEqual([...profileBuildIds].sort(), ['jubmir', 'spearhead_unumanuk'], 'both real NPC database records must build avatar profiles');
  assert.deepEqual([...worldAvatarBuildIds].sort(), ['jubmir', 'spearhead_unumanuk'], 'both NPC profiles must become actual world models');
  assert.ok(cosmeticsEnsures >= 2, 'NPC cosmetics must be prepared during hidden loading setup');
  assert.equal(rescueScene.children.length, 2, 'both scripted NPC world roots must already be attached before loading release');
  const jubmirRoot = rescueScene.children.find(child => child.userData?.prologueNpcId === 'jubmir');
  const spearheadRoot = rescueScene.children.find(child => child.userData?.prologueNpcId === 'spearhead_unumanuk');
  assert.ok(jubmirRoot, 'Jubmir scripted root must exist in the rescue scene');
  assert.ok(spearheadRoot, 'Spearhead scripted root must exist in the rescue scene');
  assert.deepEqual([jubmirRoot.position.x, jubmirRoot.position.z], [9.5, 12.5], 'Jubmir must use authored rescue-map position');
  assert.deepEqual([spearheadRoot.position.x, spearheadRoot.position.z], [15.5, 12.5], 'Spearhead must use authored rescue-map position');
  assert.equal(jubmirRoot.userData.prologueAuthored, true, 'scripted actors must be marked authored so rescue hostile purges can distinguish intentional content');

  assert.equal(elements.npcDialogue.classList.contains('open'), true, 'ordinary npcDialogue shell must be primed while the loader is still up');
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir');
  assert.equal(elements.npcDialogueText.textContent, '[Target test] Jubmir speaking.');
  assert.equal(runtime.debugSnapshot().speakerNpcId, 'jubmir');
  assert.equal(cameraTarget, jubmirRoot, 'line 1 camera target must be the newly built Jubmir actor');
  assert.equal(dialogueInjectedDeps.getDialogueWalker().rec.id, 'jubmir', 'shared portrait getter must resolve the scripted Jubmir walker');
  assert.ok(portraitRenders >= 1, 'line 1 portrait must be rendered before stageReady becomes true');

  const loaderShowIndex = renderEvents.indexOf('loader-show');
  const firstWorldIndex = renderEvents.findIndex(entry => entry.startsWith('world:'));
  const firstDialoguePortraitIndex = renderEvents.indexOf('dialogue-portrait:jubmir');
  assert.ok(loaderShowIndex >= 0 && loaderShowIndex < firstWorldIndex, 'loading hold must begin before either NPC world model is built');
  assert.ok(firstWorldIndex >= 0 && firstWorldIndex < firstDialoguePortraitIndex, 'world actors must exist before the first dialogue portrait is primed');
  assert.equal(renderEvents.includes('loader-hide'), false, 'loader must not hide anywhere in the async construction pipeline itself');

  await flushTwoFrames();
  assert.equal(renderEvents.includes('loader-hide'), true, 'loader may hide only after setup and the two-frame paint barrier');
  assert.equal(elements.hobunjiLoadScreen.classList.contains('visible'), false, 'scene is revealed only after both actors and line 1 are painted');

  assert.equal(await runtime.advanceDialogueTest(), true, 'line 2 must advance without manually selecting another NPC');
  assert.equal(elements.npcDialogueName.textContent, 'Spearhead Unumanuk');
  assert.equal(elements.npcDialogueText.textContent, '[Target test] Spearhead speaking.');
  assert.equal(runtime.debugSnapshot().speakerNpcId, 'spearhead_unumanuk');
  assert.equal(cameraTarget, spearheadRoot, 'line 2 camera target must automatically switch to the built Spearhead actor');
  assert.equal(dialogueInjectedDeps.getDialogueWalker().rec.id, 'spearhead_unumanuk', 'shared portrait getter must automatically switch to Spearhead');

  assert.equal(await runtime.advanceDialogueTest(), true, 'line 3 must automatically return to Jubmir');
  assert.equal(elements.npcDialogueName.textContent, 'Jubmir');
  assert.equal(elements.npcDialogueText.textContent, '[Target test] Jubmir again.');
  assert.equal(cameraTarget, jubmirRoot, 'line 3 camera target must automatically return to Jubmir');
  assert.equal(runtime.debugSnapshot().targetChanges, 3, 'exactly three automatic target changes must occur');
  assert.ok(portraitRenders >= 3, 'each line must refresh the ordinary dialogue portrait');

  assert.equal(await runtime.advanceDialogueTest(), true, 'advancing past final line must close the temporary dialogue test');
  assert.equal(elements.npcDialogue.classList.contains('open'), false, 'ordinary dialogue shell must close after the test sequence');
  assert.equal(runtime.debugSnapshot().testFinished, true);
  assert.ok(dialogueResetCount >= 1, 'shared dialogue state must reset after synthetic cutscene dialogue');
  assert.equal(cameraMode, 'default', 'camera mode must restore after the sequence');
  assert.equal(cameraTarget.id, 'old-camera-target', 'prior camera target must restore after the sequence');

  assert.equal(source.includes('npcWalkers'), false, 'scripted prologue actors must not depend on ordinary scheduled npcWalkers');
  assert.equal(source.includes('player.x ='), false, 'cutscene dialogue runtime must not reposition the player');
  assert.equal(source.includes('player.y ='), false, 'cutscene dialogue runtime must not reposition the player');
  assert.equal(source.includes('updateHeadYaw'), false, 'automatic speaker targeting must not force NPC yaw headtracking');
  assert.equal(source.includes('updateHeadRotation'), false, 'automatic speaker targeting must not force NPC pitch headtracking');
  assert.deepEqual(chapter.stages.rescue.dialogue.map(line => line.speakerNpcId), ['jubmir', 'spearhead_unumanuk', 'jubmir'], 'authored test must explicitly change targets and return to the first speaker');
  assert.equal(chapter.stages.rescue.dialogue.every(line => line.headTracking === 'none'), true, 'target test lines must explicitly keep headtracking disabled');

  console.log('prologue automatic dialogue target + hidden actor setup regression passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
