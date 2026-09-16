'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-sleep-presentation.js', 'utf8');

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Box3 {
  constructor() { this.min = { y: 0 }; }
  setFromObject(group) {
    this.min.y = Number(group.position?.y || 0) - Number(group.scale?.y || 1);
    return this;
  }
}
class CanvasTexture {
  constructor(canvas) {
    this.canvas = canvas;
    this.repeat = { set: (x, y) => { this.repeat.x = x; this.repeat.y = y; } };
    this.offset = { set: (x, y) => { this.offset.x = x; this.offset.y = y; } };
  }
}

const renderSnapshots = [];
class WebGLRenderer {
  render() {
    renderSnapshots.push({
      barnHead: barnAvatar.headAngle,
      barnMap: barnGroup.children[0].material.map,
      outdoorHead: outdoorAvatar.headAngle,
      outdoorYaw: outdoorAvatar.headYaw,
      outdoorMap: outdoorGroup.children[0].material.map,
      outdoorLookDebug: outdoorAnimal._lookAtDebug,
    });
  }
}

function makeGroup(name, scaleY = 1) {
  const front = { name: `${name}_front_plane`, material: { map: { id: `${name}:front:awake` } } };
  const back = { name: `${name}_back_plane`, material: { map: { id: `${name}:back:awake` } } };
  return {
    name,
    userData: {},
    visible: true,
    parent: { getWorldScale(target) { return target.set(1, 1, 1); } },
    scale: new Vec3(1, scaleY, 1),
    position: new Vec3(0, scaleY, 0),
    children: [front, back],
    traverse(fn) { fn(this); for (const child of this.children) fn(child); },
    updateMatrixWorld() {},
  };
}

function makeAvatar(group, maxDeg) {
  return {
    group,
    headRig: { rig: { maxDeg } },
    headAngle: -12,
    headYaw: 18,
    setHeadRotation(degrees) { this.headAngle = degrees; return degrees; },
    updateHeadYaw(degrees) { this.headYaw = degrees; return degrees; },
  };
}

const barnGroup = makeGroup('barn_sleep_drenkirra_barn-1', 0.5);
const outdoorGroup = makeGroup('farm_drenkirra_outdoor-1', 0.5);
const barnAvatar = makeAvatar(barnGroup, 28);
const outdoorAvatar = makeAvatar(outdoorGroup, 32);

const composeCalls = [];
const CreatureGeneticsRender = {
  SPECIES: {
    drenkirra: {
      base: { idle: 'drenkirra_idle.png', run2: 'drenkirra_run2.png' },
      eyeOverlay: { blink: 'assets/creaturesprites/drenkirra_blink.png' },
    },
  },
  genotypeSignature(_kind, genotype) { return genotype?.sig || 'plain'; },
  composeFrame(kind, frame, genotype, blinkShut) {
    const result = { kind, frame, genotype, blinkShut };
    composeCalls.push(result);
    return Promise.resolve(result);
  },
};

const PNGPlaneAvatar = {
  buildAnimalPlaneAvatarModel(_three, _url, options = {}) {
    if (String(options.name).startsWith('barn_sleep_')) return barnAvatar;
    throw new Error(`unexpected build ${options.name}`);
  },
};

const farmAnimals = new Set();
const FarmAnimals = { init() {} };
const Combat = { init() {} };
const outdoorAnimal = {
  livestockId: 'outdoor-1',
  animalKey: 'drenkirra',
  genotype: { sig: 'outdoor' },
  avatarRef: outdoorAvatar,
  _outdoorSleepBlend: 1,
  _outdoorVisualStress: 0,
  _outdoorAppliedScaleY: 0.5,
  _lookAtDebug: { target: 'player' },
};
farmAnimals.add(outdoorAnimal);

const windowStub = {
  THREE: { Box3, Vector3: Vec3, CanvasTexture, WebGLRenderer, RepeatWrapping: 1000, SRGBColorSpace: 'srgb' },
  PNGPlaneAvatar,
  CreatureGeneticsRender,
  FarmAnimals,
  Combat,
  BARN_INCUBATOR_CONFIG: { visuals: { sleepScaleY: 0.75 } },
  CREATURE_DB: { drenkirra: { sprites: { idle: 'drenkirra_idle.png', run: ['drenkirra_run1.png', 'drenkirra_run2.png'] } } },
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

windowStub.FarmAnimals.init({ animalObjects: farmAnimals, CREATURE_DB: windowStub.CREATURE_DB });
windowStub.Combat.init({ hostileObjects: new Set(), companionObjects: new Set() });
windowStub.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(windowStub.THREE, 'drenkirra_idle.png', {
  name: 'barn_sleep_drenkirra_barn-1', creatureId: 'drenkirra',
});

Promise.resolve(windowStub.CreatureGeneticsRender.composeFrame('drenkirra', 'idle', { sig: 'barn' }, false)).then(() => {
  const firstStatic = composeCalls.at(-1);
  assert.equal(firstStatic.frame, 'run2', 'static sleeper still freezes on run2');
  assert.equal(firstStatic.blinkShut, true, 'static sleeper forces the closed-eye/blink overlay even when caller asks for awake eyes');
  assert.equal(barnGroup.userData.animalSleepBlinkOverlay, 'assets/creaturesprites/drenkirra_blink.png', 'static sleeper records the configured blink overlay');

  const renderer = new windowStub.THREE.WebGLRenderer();
  renderer.render();
  return Promise.resolve().then(() => {
    renderer.render();
    const visible = renderSnapshots.at(-1);
    assert.equal(visible.barnHead, 28, 'barn sleeper holds its head at the authored downward limit');
    assert.equal(visible.outdoorHead, 32, 'outdoor sleeper overrides player head tracking with the authored downward limit');
    assert.equal(visible.outdoorYaw, 0, 'sleeping head yaw is neutral instead of tracking the player sideways');
    assert.equal(visible.outdoorLookDebug, null, 'sleeping animal no longer advertises a player look-at ray');
    assert.equal(visible.outdoorMap.canvas.frame, 'run2', 'outdoor sleeper still freezes on run2');
    assert.equal(visible.outdoorMap.canvas.blinkShut, true, 'outdoor sleeper renders only the permanent closed-eye sleep composite');
    assert(composeCalls.filter(call => call.genotype?.sig === 'outdoor').every(call => call.blinkShut === true), 'no awake-eye composite is requested for the sleeping outdoor animal');

    const debug = windowStub.AnimalSleepPresentation.getDebug();
    assert.equal(debug.sleepingEyes, 'blink-overlay-closed-only', 'diagnostics report permanent closed-eye sleep presentation');
    assert.equal(debug.sleepingHead, 'authored-max-down', 'diagnostics report the downward sleeping head pose');
    assert(debug.headDownApplications >= 2, 'diagnostics count applied sleeping head overrides');

    outdoorAnimal._outdoorSleepBlend = 0;
    outdoorAvatar.headAngle = -9; // Simulates normal awake head tracking resuming before the next render.
    renderer.render();
    assert.equal(renderSnapshots.at(-1).outdoorHead, -9, 'waking releases the central head override back to ordinary tracking');
    console.log('animal sleep closed-eye/head-down regression tests passed');
  });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
