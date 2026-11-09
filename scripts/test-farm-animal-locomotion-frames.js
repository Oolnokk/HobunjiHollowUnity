'use strict';

// Farm livestock must swap to their run frames while walking (like wild
// creatures) and back to idle once standing. Executes docs/js/farm-animals.js
// against stubs and drives a real animal's update() loop.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/farm-animals.js', 'utf8');

function makeMaterialPlane(name) {
  return { name, material: { map: null, needsUpdate: false }, position: { y: 0 } };
}

function makeHarness({ genotype }) {
  const composeCalls = [];
  const loadedUrls = [];
  const window = {
    SCRATCHBONES_CONFIG: { game: { livestock: { wander: {}, animalWidths: {} } } },
    HobunjiCacheAudit: { register() {} },
    CreatureTextureCache: {
      create() {
        const store = new Map();
        return { get: k => store.get(k), put: (k, v) => { store.set(k, v); return v; }, retain() {}, keyFor() { return null; } };
      },
      genotypeFrameSetKey: k => k,
      isDisposed: () => false,
      fitGeneratedCanvas: c => c,
    },
    CreatureGenetics: {
      creatureSizeScale: () => ({ x: 1, y: 1 }),
      creatureGroundOffset: () => NaN,
      applyCreatureBillboardScale() {},
      creatureBreathScaleY: () => 1,
    },
    CreatureGeneticsRender: {
      SPECIES: { 'gar-wolf': { base: { idle: 'gw_idle.png', run1: 'gw_run1.png', run2: 'gw_run2.png' } } },
      genotypeSignature: () => 'sig',
      headRigForKind: () => null,
      eyeStateKey: shut => (shut ? 'b' : 'o'),
      composeFrame: (kind, frame) => { composeCalls.push(frame); return Promise.resolve({ frame }); },
    },
    PNGPlaneAvatar: {
      buildAnimalPlaneAvatarModel() {
        const front = makeMaterialPlane('x_front_plane');
        const back = makeMaterialPlane('x_back_plane');
        return { group: { children: [front, back], position: { set() {} }, rotation: { y: 0 } }, dispose() {} };
      },
    },
    PerpRotation: { clearHeadtrackHint() {}, setHeadtrackHint() {}, setMovementHint() {} },
    CreatureBlink: { getVisualState: () => false },
    VoorgAssRegistration: null,
  };
  window.window = window;
  const THREE = {
    SRGBColorSpace: 'srgb', RepeatWrapping: 1000,
    CanvasTexture: class { constructor(canvas) { this.canvas = canvas; this.repeat = { set() {} }; this.offset = { set() {} }; } },
    TextureLoader: class {
      load(url, onLoad) {
        loadedUrls.push(url);
        const tex = { url, repeat: { set() {} }, offset: { set() {} }, clone() { return { url, repeat: { set() {} }, offset: { set() {} } }; } };
        if (onLoad) queueMicrotask(onLoad); // Loads asynchronously, like the real loader.
        return tex;
      }
    },
  };
  const context = { window, THREE, console, performance: { now: () => 1000 }, queueMicrotask, Promise, Math, Number, Map, Set };
  vm.runInNewContext(source, context, { filename: 'farm-animals.js' });

  const grid = Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => ({ type: 'grass' })));
  const animalObjects = new Set();
  const worldObjects = new Map();
  window.FarmAnimals.init({
    CREATURE_DB: { 'gar-wolf': { sprites: { idle: 'gw_idle.png', run: ['gw_run1.png', 'gw_run2.png'] } } },
    getGrid: () => grid, tileSurfaceY: () => 0, animalObjects, worldObjects,
    scene: { add() {}, remove() {} }, _markPngPlane() {},
    resolveCreatureGroundAnchorRatio() {}, creaturePlaneGroundOffset: () => 0,
    loadWorldLivestock: () => [{ id: 'l1', kind: 'gar-wolf', col: 5, row: 5, genotype }],
    getFarmBuildings: () => [], getWorldObjectAt: () => null, isSolid: () => false,
    TileType: { TRENCH: 'trench', RIVER: 'river', STREAM: 'stream' },
    setWorldLivestockFrameCache() {}, rnd: () => 0.5,
    getPlayerFaceTarget: () => null, nearestAngleAmong: () => 0, cameraRelativePerps: () => [], cameraRelativeCreaturePerps: () => [],
    perpClamp: (_s, t) => ({ effectiveTarget: t, snapTo: null }), angleDiff: () => 0, CREATURE_PERP_DEAD_RAD: 0,
    calendar: { day: 1 },
  });
  window.FarmAnimals.respawnWorldLivestock();
  const animal = [...animalObjects][0];
  assert.ok(animal, 'livestock factory spawned an animal');
  return { animal, window, composeCalls, loadedUrls };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const mapOf = animal => animal.avatarRef.group.children[0].material.map;

// Genotype animal: composes run1/run2 while walking, returns to idle at rest.
(async () => {
  {
    const { animal, composeCalls } = makeHarness({ genotype: { g: 1 } });
    const dt = 1 / 30;
    for (let i = 0; i < 4; i++) { animal.update(dt); await flush(); }
    assert.equal(animal._frameAppliedKey, 'idle', 'a standing animal shows idle');
    assert.ok(!composeCalls.some(f => f.startsWith('run')), 'no run frame is composed while standing');

    const seen = new Set();
    for (let i = 0; i < 90; i++) {
      animal.targetCol = 30; // update() walks it east at the real wander speed.
      animal.update(dt);
      await flush();
      seen.add(animal._frameAppliedKey);
    }
    assert.ok(seen.has('run1') && seen.has('run2'), `walking cycles both run frames (saw ${[...seen]})`);
    assert.ok(composeCalls.includes('run1') && composeCalls.includes('run2'), 'run frames come from the genotype compositor');

    animal.targetCol = Math.round(animal.wx - 0.5); animal.wx = animal.targetCol + 0.5;
    for (let i = 0; i < 20; i++) { animal.update(dt); await flush(); }
    assert.equal(animal._frameAppliedKey, 'idle', 'the animal settles back to idle once it stops');
  }

  // Held still (dialogue freeze) while previously walking: forced idle.
  {
    const { animal } = makeHarness({ genotype: { g: 1 } });
    const dt = 1 / 30;
    for (let i = 0; i < 40; i++) { animal.targetCol = 30; animal.update(dt); await flush(); }
    assert.ok(/^run/.test(animal._frameAppliedKey), 'precondition: animal is mid-walk');
    animal._dialogueFrozen = true;
    for (let i = 0; i < 5; i++) { animal.update(dt); await flush(); }
    assert.equal(animal._frameAppliedKey, 'idle', 'a dialogue-frozen animal returns to idle');
  }

  // A single-frame reposition (barn wake-up) is not a walk.
  {
    const { animal } = makeHarness({ genotype: { g: 1 } });
    const dt = 1 / 30;
    for (let i = 0; i < 4; i++) { animal.update(dt); await flush(); }
    animal.wx += 10; animal.targetCol = Math.round(animal.wx - 0.5); animal.update(dt); await flush();
    assert.equal(animal._locoWalking, false, 'a teleport does not start the walk cycle');
  }

  // Plain (genotype-less) animal swaps static run PNGs once they have loaded.
  {
    const { animal, loadedUrls } = makeHarness({ genotype: undefined });
    const dt = 1 / 30;
    const maps = new Set();
    for (let i = 0; i < 90; i++) {
      animal.targetCol = 30;
      animal.update(dt);
      await flush();
      const m = mapOf(animal);
      if (m?.url) maps.add(m.url);
    }
    assert.ok(maps.has('gw_run1.png') && maps.has('gw_run2.png'), `plain animal binds both run sprites (saw ${[...maps]})`);
    assert.ok(loadedUrls.every(u => /run/.test(u)), 'idle art is not re-uploaded before the animal first walks');
    animal.targetCol = Math.round(animal.wx - 0.5); animal.wx = animal.targetCol + 0.5;
    for (let i = 0; i < 20; i++) { animal.update(dt); await flush(); }
    assert.equal(mapOf(animal).url, 'gw_idle.png', 'plain animal returns to its idle sprite at rest');
  }

  console.log('Farm animal locomotion-frame checks passed.');
})().catch(err => { console.error(err); process.exit(1); });
