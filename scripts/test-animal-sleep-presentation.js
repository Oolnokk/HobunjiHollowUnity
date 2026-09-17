'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-sleep-presentation.js', 'utf8');
const troughSource = fs.readFileSync('docs/js/farm-troughs.js', 'utf8');
const wildernessSource = fs.readFileSync('docs/js/wildlife-cloud-forest-behavior.js', 'utf8');
const nestSource = fs.readFileSync('docs/js/den-nest-system.js', 'utf8');
const incubatorSource = fs.readFileSync('docs/js/barn-incubator.js', 'utf8');
const welfareSource = fs.readFileSync('docs/js/outdoor-livestock-welfare.js', 'utf8');

assert.match(troughSource, /barn_sleep_\$\{rec\.kind\}_\$\{rec\.id\}/, 'barn sleepers use the shared static-sleeper naming contract');
assert.match(nestSource, /nest_sleep_\$\{record\.id\}/, 'wild nest babies use the shared static-sleeper naming contract');
assert.match(incubatorSource, /incubator_sleep_\$\{slot\.baby\.id\}/, 'incubator babies use the shared static-sleeper naming contract');
assert.match(wildernessSource, /state\.mode = 'sleeping'/, 'wilderness Drenkirra publish the sleeping state consumed by the shared presenter');
assert.match(welfareSource, /_outdoorSleepBlend/, 'outdoor livestock publish the sleep blend consumed by the shared presenter');
assert.match(source, /phase: 'pre-render'/, 'sleep presentation prepares through the shared pre-render scheduler checkpoint');
assert.match(source, /phase: 'post-game'/, 'sleep presentation restores temporary transforms after the frame driver completes');
assert.doesNotMatch(source, /WebGLRenderer\?\.prototype|__animalSleepPresentationRenderPatched/, 'sleep presentation never patches the global Three.js renderer');

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
let boxSetFromObjectCalls = 0; // Counts expensive hierarchy-bound scans so repeated render passes cannot silently reintroduce the regression.
class Box3 {
  constructor() { this.min = { y: 0 }; }
  setFromObject(group) {
    boxSetFromObjectCalls++;
    this.min.y = Number(group.position?.y || 0) - Number(group.scale?.y || 1);
    return this;
  }
}
class CanvasTexture {
  constructor(canvas) {
    this.canvas = canvas;
    this.repeat = { set: (x, y) => { this.repeat.x = x; this.repeat.y = y; } };
    this.offset = { set: (x, y) => { this.offset.x = x; this.offset.y = y; } };
    this.needsUpdate = false;
  }
}
class TextureLoader {
  load(url, onLoad) {
    onLoad({
      url,
      repeat: { set() {} },
      offset: { set() {} },
      clone() { return { url, repeat: { set() {} }, offset: { set() {} } }; },
    });
  }
}

const renderedSnapshots = [];
class WebGLRenderer {
  render() {
    renderedSnapshots.push({
      barnY: barnGroup.scale.y,
      nestY: nestGroup.scale.y,
      outdoorY: outdoorGroup.scale.y,
      wildY: wildGroup.scale.y,
    });
  }
}

function makeMaterial(name, initialMap) {
  return { name, map: initialMap, needsUpdate: false };
}
function makeGroup(name, scaleY, positionY) {
  const front = { name: `${name}_front_plane`, material: makeMaterial('front', { id: `${name}:front:idle` }) };
  const back = { name: `${name}_back_plane`, material: makeMaterial('back', { id: `${name}:back:idle` }) };
  return {
    name,
    userData: {},
    visible: true,
    traverseCalls: 0, // Lets the regression prove awake animals do not pay sleep-only hierarchy traversal cost.
    parent: { getWorldScale(target) { target.set(1, 1, 1); return target; } },
    scale: new Vec3(1, scaleY, 1),
    position: new Vec3(0, positionY, 0),
    children: [front, back],
    traverse(fn) { this.traverseCalls++; fn(this); for (const child of this.children) fn(child); },
    updateMatrixWorld() {},
  };
}

const barnGroup = makeGroup('barn_sleep_drenkirra_barn-1', 0.5, 0.5);
const nestGroup = makeGroup('nest_sleep_baby-1', 0.75, 0.75);
const outdoorGroup = makeGroup('farm_drenkirra_outdoor-1', 0.4, 0.4);
const wildGroup = makeGroup('wild_drenkirra_1', 0.5, 0.5);
const awakeFarmGroup = makeGroup('farm_drenkirra_awake-1', 1, 1);

const composeCalls = [];
const CreatureGeneticsRender = {
  SPECIES: {
    drenkirra: { base: { idle: 'drenkirra_idle.png', run1: 'drenkirra_run1.png', run2: 'drenkirra_run2.png' } },
    uumkaoii: { base: { idle: 'uum.png' } },
  },
  genotypeSignature(_kind, genotype) { return genotype?.sig || 'plain'; },
  composeFrame(kind, frame, genotype, blinkShut) {
    composeCalls.push({ kind, frame, genotype, blinkShut });
    return Promise.resolve({ kind, frame, genotype });
  },
};

const PNGPlaneAvatar = {
  buildAnimalPlaneAvatarModel(_three, _url, options = {}) {
    if (String(options.name).startsWith('barn_sleep_')) return { group: barnGroup };
    if (String(options.name).startsWith('nest_sleep_')) return { group: nestGroup };
    return { group: makeGroup(options.name || 'animal', 1, 1) };
  },
};

const farmAnimals = new Set();
const hostileObjects = new Set();
const companionObjects = new Set();
const FarmAnimals = { init() {} };
const Combat = { init() {} };
const schedulerEntries = new Map(); // Stores registered callbacks so the test can drive one logical browser frame without a real RAF.
const RuntimeFrameScheduler = {
  register(id, callback, options = {}) {
    schedulerEntries.set(id, { callback, options });
    return () => schedulerEntries.delete(id);
  },
  unregister(id) { return schedulerEntries.delete(id); },
};
const originalRendererRender = WebGLRenderer.prototype.render; // Proves the feature no longer replaces renderer.render globally.

const windowStub = {
  THREE: {
    Box3,
    Vector3: Vec3,
    CanvasTexture,
    TextureLoader,
    WebGLRenderer,
    RepeatWrapping: 1000,
    SRGBColorSpace: 'srgb',
  },
  PNGPlaneAvatar,
  CreatureGeneticsRender,
  FarmAnimals,
  Combat,
  RuntimeFrameScheduler,
  BARN_INCUBATOR_CONFIG: { visuals: { sleepScaleY: 0.75 } },
  CREATURE_DB: {
    drenkirra: { sprites: { idle: 'drenkirra_idle.png', run: ['drenkirra_run1.png', 'drenkirra_run2.png'] } },
    uumkaoii: { sprites: { idle: 'uum.png', run: ['uum.png'] } },
  },
  OutdoorLivestockWelfare: { constants: { OUTDOOR_AWAKE_MIN_SCALE_Y: 0.8 } },
};
windowStub.window = windowStub;

const context = {
  window: windowStub,
  globalThis: windowStub,
  console,
  Math,
  Number,
  Object,
  Array,
  Set,
  Map,
  WeakMap,
  String,
  Date,
  Promise,
  performance: { now: () => 1000 },
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'animal-sleep-presentation.js' });

(async () => {
  assert.equal(windowStub.AnimalSleepPresentation.SLEEP_SCALE_Y, 0.75, '75% is the one authoritative sleep Y scale');
  assert.deepEqual(
    JSON.parse(JSON.stringify(windowStub.AnimalSleepPresentation.frameDescriptor('drenkirra', windowStub.CREATURE_DB.drenkirra, true))),
    { frame: 'run2', url: 'drenkirra_run2.png', usesRun2: true },
    'sleep chooses run2 when the species has a second run frame',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(windowStub.AnimalSleepPresentation.frameDescriptor('uumkaoii', windowStub.CREATURE_DB.uumkaoii, true))),
    { frame: 'idle', url: 'uum.png', usesRun2: false },
    'species without run2 fall back to idle',
  );

  windowStub.FarmAnimals.init({
    animalObjects: farmAnimals,
    CREATURE_DB: windowStub.CREATURE_DB,
  });
  windowStub.Combat.init({ hostileObjects, companionObjects });

  // Static sleepers are discovered by the existing shared PNG avatar builder.
  windowStub.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(windowStub.THREE, 'drenkirra_idle.png', {
    name: 'barn_sleep_drenkirra_barn-1', creatureId: 'drenkirra',
  });
  windowStub.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(windowStub.THREE, 'drenkirra_idle.png', {
    name: 'nest_sleep_baby-1', creatureId: 'drenkirra',
  });

  // The immediately-following static sleeping compose is redirected to run2.
  await windowStub.CreatureGeneticsRender.composeFrame('drenkirra', 'idle', { sig: 'nest' }, false);
  assert.equal(composeCalls.at(-1).frame, 'run2', 'static sleeping genotype compose freezes on run2');

  const outdoorAnimal = {
    livestockId: 'outdoor-1',
    animalKey: 'drenkirra',
    genotype: { sig: 'outdoor' },
    avatarRef: { group: outdoorGroup },
    _outdoorSleepBlend: 1,
    _outdoorVisualStress: 1,
    _outdoorAppliedScaleY: 0.4, // old authored 0.5 sleep * full 0.8 neglect
  };
  farmAnimals.add(outdoorAnimal);

  const awakeFarmAnimal = {
    livestockId: 'awake-1',
    animalKey: 'drenkirra',
    genotype: { sig: 'awake' },
    avatarRef: { group: awakeFarmGroup },
    _outdoorSleepBlend: 0,
    _outdoorVisualStress: 0,
    _outdoorAppliedScaleY: 1,
  };
  farmAnimals.add(awakeFarmAnimal);

  const wildAnimal = {
    id: 'wild-1',
    creatureKey: 'drenkirra',
    genotype: { sig: 'wild' },
    def: windowStub.CREATURE_DB.drenkirra,
    avatarRef: { group: wildGroup },
    scaleY: 0.5,
    _cfDrenkirra: { mode: 'sleeping' },
  };
  hostileObjects.add(wildAnimal);

  assert.equal(windowStub.THREE.WebGLRenderer.prototype.render, originalRendererRender, 'install leaves the global WebGLRenderer prototype untouched');
  const prepareEntry = schedulerEntries.get('animal-sleep-presentation-pre-render');
  const restoreEntry = schedulerEntries.get('animal-sleep-presentation-restore');
  assert.equal(prepareEntry?.options?.phase, 'pre-render', 'sleep preparation runs at the scheduler pre-render checkpoint');
  assert.equal(restoreEntry?.options?.phase, 'post-game', 'sleep transform restoration runs after the complete gameplay render sequence');

  const renderer = new windowStub.THREE.WebGLRenderer();

  // Frame 1 starts async sleep composites. The temporary scale/grounding transforms
  // must remain active through every render pass, then restore exactly once post-game.
  prepareEntry.callback({ frameId: 1, timestamp: 16, deltaMs: 16 });
  assert.equal(awakeFarmGroup.traverseCalls, 0, 'awake farm animals never traverse their avatar hierarchy for sleep-only texture capture');
  const sleepingTraverseCountsAfterFrame1 = {
    outdoor: outdoorGroup.traverseCalls,
    wild: wildGroup.traverseCalls,
  };
  assert(sleepingTraverseCountsAfterFrame1.outdoor > 0, 'sleep entry captures outdoor animal plane materials once');
  assert(sleepingTraverseCountsAfterFrame1.wild > 0, 'sleep entry captures wilderness animal plane materials once');
  const frame1BoundsCalls = boxSetFromObjectCalls;
  renderer.render();
  renderer.render();
  assert.equal(boxSetFromObjectCalls, frame1BoundsCalls, 'multiple renderer passes do not repeat animal hierarchy/bounds scans');
  restoreEntry.callback({ frameId: 1, timestamp: 16, deltaMs: 16 });

  await Promise.resolve();

  // Frame 2 reapplies the now-resolved closed-eye sleep textures and proves the
  // same temporary transforms stay stable across multiple independent render passes.
  prepareEntry.callback({ frameId: 2, timestamp: 32, deltaMs: 16 });
  assert.equal(awakeFarmGroup.traverseCalls, 0, 'awake animals remain traversal-free on later frames');
  assert.equal(outdoorGroup.traverseCalls, sleepingTraverseCountsAfterFrame1.outdoor, 'outdoor sleeper reuses its cached plane-material list after sleep entry');
  assert.equal(wildGroup.traverseCalls, sleepingTraverseCountsAfterFrame1.wild, 'wilderness sleeper reuses its cached plane-material list after sleep entry');
  const frame2BoundsCalls = boxSetFromObjectCalls;
  renderer.render();
  renderer.render();
  assert.equal(boxSetFromObjectCalls, frame2BoundsCalls, 'renderer.render remains presentation-work-free after scheduler preparation');

  const visible = renderedSnapshots.at(-1);
  assert(Math.abs(visible.barnY - 0.75) < 1e-9, 'barn sleeper renders at the shared 75% Y scale');
  assert(Math.abs(visible.nestY - 0.75) < 1e-9, 'nest baby renders at the shared 75% Y scale');
  assert(Math.abs(visible.outdoorY - 0.60) < 1e-9, 'outdoor sleeper applies 75% sleep before full 80% neglect (0.75 × 0.80)');
  assert(Math.abs(visible.wildY - 0.75) < 1e-9, 'wilderness sleeper renders at the shared 75% Y scale');

  assert(Math.abs(barnGroup.scale.y - 0.75) < 1e-9, 'temporary barn sleep scale stays active through the complete render sequence');
  assert(Math.abs(outdoorGroup.scale.y - 0.60) < 1e-9, 'temporary outdoor sleep/neglect scale stays active through the complete render sequence');
  assert(Math.abs(wildGroup.scale.y - 0.75) < 1e-9, 'temporary wilderness sleep scale stays active through the complete render sequence');

  restoreEntry.callback({ frameId: 2, timestamp: 32, deltaMs: 16 });
  assert.equal(barnGroup.scale.y, 0.5, 'post-game restoration returns barn simulation/authored scale');
  assert.equal(nestGroup.scale.y, 0.75, 'already-central nest scale remains unchanged after post-game restoration');
  assert.equal(outdoorGroup.scale.y, 0.4, 'post-game restoration returns outdoor welfare simulation scale');
  assert.equal(wildGroup.scale.y, 0.5, 'post-game restoration returns wilderness authored scale');

  assert(composeCalls.some(call => call.frame === 'run2' && call.genotype?.sig === 'outdoor'), 'outdoor sleeping art requests run2');
  assert(composeCalls.some(call => call.frame === 'run2' && call.genotype?.sig === 'wild'), 'wilderness sleeping art requests run2');

  const debug = windowStub.AnimalSleepPresentation.getDebug();
  assert.equal(debug.sleepScaleY, 0.75, 'mobile diagnostics expose the central 75% sleep scale');
  assert.equal(debug.preferredFrame, 'run2-if-present-else-idle', 'mobile diagnostics expose run2 sleep-frame preference');
  assert.equal(debug.schedulerRegistered, true, 'mobile diagnostics confirm shared scheduler ownership');
  assert.equal(debug.schedulerCadence, 'pre-render-once/post-game-restore', 'mobile diagnostics expose the once-per-frame sleep cadence');
  assert.equal(debug.preparedFrames, 2, 'diagnostics count one preparation per simulated browser frame');
  assert.equal(debug.restoredFrames, 2, 'diagnostics count one restoration per simulated browser frame');
  assert.equal(debug.lastPreparedFrameId, 2, 'diagnostics retain the last prepared scheduler frame id');
  assert.equal(debug.lastRestoredFrameId, 2, 'diagnostics retain the last restored scheduler frame id');
  assert.equal(debug.lastPreparedBoundsScans, 6, 'diagnostics expose the six generic grounding scans still required for three rescaled sleepers in one frame');
  assert.equal(debug.boundsScans, 12, 'diagnostics accumulate generic grounding scans across both prepared frames');
  assert.equal(debug.activeTemporaryTransforms, 0, 'no sleep-only transform survives the post-game restoration');
  console.log('animal sleep presentation regression tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
