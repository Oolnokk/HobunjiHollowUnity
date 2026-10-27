#!/usr/bin/env node
'use strict';

// Executes docs/js/perception-mode.js in a vm sandbox: toggle/speed contract,
// target classification, crop/livestock info rows, and that update() feeds
// WorldPopupText.syncInfoLists with nearby crops and livestock only.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'perception-mode.js'), 'utf8');

class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Box3 { setFromObject(o) { this.min = { x: -0.5, z: -0.5 }; this.max = { x: (o.userData?.size || 1) - 0.5, z: 0.5 }; return this; } isEmpty() { return false; } }
class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
class Stub { constructor(...args) { this.args = args; this.texture = {}; this.width = 1; this.height = 1; this.uniforms = args[0]?.uniforms; } add() {} setSize(w, h) { this.width = w; this.height = h; } }
const THREE = {
  Vector3, Box3, Vector2, Color: Stub, WebGLRenderTarget: Stub, Scene: Stub, OrthographicCamera: Stub, ShaderMaterial: Stub,
  Mesh: Stub, PlaneGeometry: Stub, MeshBasicMaterial: Stub, LinearFilter: 1, RGBAFormat: 1, DoubleSide: 2,
}; // Enough of three.js for renderOverlay's mask + composite passes against a mock renderer.

function node(name, pos, parent) {
  const n = {
    name, parent: null, visible: true, children: [], userData: {}, renderOrder: 0,
    isMesh: false, isScene: false, pos,
    getWorldPosition(v) { return v.set(pos.x, 0, pos.z); },
    traverse(fn) { fn(this); this.children.forEach(c => c.traverse(fn)); },
  };
  if (parent) { n.parent = parent; parent.children.push(n); }
  return n;
}
function mesh(parent) {
  const m = node('m', parent.pos, parent);
  m.isMesh = true;
  m.material = { visible: true, colorWrite: true };
  m.layers = { mask: 1, enable(layer) { this.mask |= 1 << layer; }, disable(layer) { this.mask &= ~(1 << layer); } };
  return m;
}

const scene = node('scene', { x: 0, z: 0 });
scene.isScene = true;
const otherScene = node('other', { x: 0, z: 0 });
otherScene.isScene = true;

function entity(pos, inScene = scene) { const root = node('root', pos, inScene); mesh(root); return root; }

const wolf = { health: 10, def: { hostile: true }, avatarRef: { group: entity({ x: 2, z: 0 }) } };
const deer = { health: 10, def: { hostile: false }, avatarRef: { group: entity({ x: 3, z: 0 }) } };
const angryDeer = { health: 10, def: { hostile: false }, _territorialBehavior: { phase: 'fight' }, avatarRef: { group: entity({ x: 3.5, z: 0 }) } };
const neutralHunter = { health: 10, isPorakanekiHunter: true, _porakanekiPlannerControlled: true, avatarRef: { group: entity({ x: 4, z: 0 }) } };
const hostileHunter = { health: 10, isPorakanekiHunter: true, avatarRef: { group: entity({ x: 4.5, z: 0 }) } };
const bandit = { health: 10, isBandit: true, avatarRef: { group: entity({ x: 5, z: 0 }) } };
const denMother = { health: 10, isDenMother: true, def: { hostile: false }, avatarRef: { group: entity({ x: 5, z: 1 }) } }; // Guardian status overrides a normally peaceful species.
const farWolf = { health: 10, def: { hostile: true }, avatarRef: { group: entity({ x: 40, z: 0 }) } };
const offSceneWolf = { health: 10, def: { hostile: true }, avatarRef: { group: entity({ x: 1, z: 0 }, otherScene) } };
const companion = { health: 10, isCompanion: true, avatarRef: { group: entity({ x: 1, z: 1 }) } };
const npc = { root: entity({ x: 1, z: 2 }) };
const cow = { livestockId: 'live1', type: 'animal', avatarRef: { group: entity({ x: 2, z: 2 }) } };
const chest = { promptRoot: entity({ x: 3, z: 3 }) };
const bigBarn = { mesh: entity({ x: 4, z: 4 }) };
// Real feature providers own these roots independently of worldObjects/getSources.
const ore = entity({ x: 6, z: 1 }), separator = entity({ x: 6, z: 2 });
const shattercask = entity({ x: 6, z: 3 }), nest = entity({ x: 3, z: 5 }), hive = entity({ x: 2, z: 5 });
const mushroom = entity({ x: 7, z: 1 }), ruinEntrance = entity({ x: 8, z: 1 });
const wildOre = entity({ x: 9, z: 2 }); // Existing tile-indexed wilderness/mine rock, not a cave-site module target.
const farRock = entity({ x: 40, z: 0 }), staleRock = entity({ x: 3, z: 1 }, otherScene);
bigBarn.mesh.userData.size = 8;
const growing = { col: 1, row: 1, root: entity({ x: 1, z: 1.5 }), tile: { crop: 'garlink', cropAge: 1.5, water: 0.9, cropReady: false, stress: '' }, data: { label: 'garlink', growDays: 3, idealMin: 0.15, idealMax: 0.45 }, maxWater: 3 };
const ripe = { col: 2, row: 1, root: entity({ x: 2, z: 1.5 }), tile: { crop: 'needlegrain', cropAge: 3, water: 0, cropReady: true, stress: 'too dry' }, data: { label: 'needlegrain', growDays: 3, idealMin: 0.2, idealMax: 0.5 }, maxWater: 3 };

const synced = [];
const sandbox = {
  window: {},
  performance: { now: () => 1000 },
  document: (() => {
    const classes = new Set();
    const button = {
      listeners: {}, attrs: {},
      classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: name => classes.has(name), add() {}, remove() {} },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute(k, v) { this.attrs[k] = v; },
    };
    return {
      body: null, // Overlay vignette is skipped without a body; the ring button is what's under test.
      __button: button,
      getElementById: id => (id === 'btnPerceptionMode' ? button : null),
      createElement: () => ({ classList: { toggle() {} }, setAttribute() {} }),
    };
  })(),
  console,
};
sandbox.window.THREE = THREE;
sandbox.window.WorldPopupText = { syncInfoLists: entries => { synced.push(entries); return entries.length; }, clearInfoLists: () => synced.push('cleared') };
sandbox.window.CavernOreRocks = { senseTargets: () => [ore, separator, farRock, staleRock] };
sandbox.window.Shattercasks = { senseTargets: () => [shattercask] };
sandbox.window.DenNestSystem = { senseTargets: () => [nest] };
sandbox.window.HoneyfuzzleHives = { senseTargets: () => [hive] };
sandbox.window.CaveSiteSystem = { senseTargets: () => [mushroom, ruinEntrance, chest.promptRoot] }; // A registered chest must never glow twice.
sandbox.window.FarmAnimals = {
  livestockStatus: ids => new Map(ids.map(id => [id, {
    name: 'Mabel', hearts: 3.2, heartMax: 5, hasTrough: true, fed: false, feedDays: 0, pettedToday: true,
    resourceLabel: 'Egg', resourceReady: false, daysUntilResource: 2, housed: true, dewReady: null, dewDaysUntil: null,
  }])),
};
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
const PM = sandbox.window.PerceptionMode;
assert.ok(PM, 'PerceptionMode is exported');

// Toggle / speed contract.
const toggles = [];
PM.init({
  THREE,
  getActiveScene: () => scene,
  getPlayerTile: () => ({ x: 0, z: 0 }),
  getSources: () => ({
    creatures: [wolf, deer, angryDeer, neutralHunter, hostileHunter, bandit, denMother, farWolf, offSceneWolf, { health: 0, def: { hostile: true }, avatarRef: { group: entity({ x: 1, z: 0 }) } }],
    companions: [companion], npcs: [npc], livestock: [cow], corpses: [], interactables: [chest, bigBarn, cow], oreRocks: [wildOre], crops: [growing, ripe],
  }),
  onToggle: on => toggles.push(on),
});
assert.strictEqual(PM.speedMultiplier(), 1);
assert.strictEqual(PM.toggle(), true);
assert.strictEqual(PM.speedMultiplier(), 0.5, 'movement is halved while active');
PM.update(5000);
const snap = PM.debugSnapshot();
assert.deepStrictEqual(JSON.parse(JSON.stringify(snap.byCategory)), { hostile: 5, neutral: 2, friendly: 4, interact: 10 },
  'hostiles including Den-Mother red; harmless animals yellow; creatures/crops white; live scene-owned interactables green; far/off-scene/dead/oversized excluded');
assert.deepStrictEqual(JSON.parse(JSON.stringify(snap.specialSources)),
  { oreRocks: 4, shattercasks: 1, nests: 1, hives: 1, caveFeatures: 3 },
  'mobile Sense Mode diagnostics show registered providers before range/scene filtering');
assert.equal(snap.sources.oreRocks, 1, 'outdoor/mine ore rock roots flow through the game-owned source list');
assert(snap.rejected.offScene >= 1 && snap.rejected.outOfRange >= 1, 'stale cave roots and out-of-range rocks are rejected');

// Info lists: both crops and the cow, nothing else.
const entries = Array.from(synced[synced.length - 1], e => ({ key: e.key, rows: JSON.parse(JSON.stringify(e.rows)) })); // vm-realm arrays → this realm (roots are circular, so only keys/rows).
assert.deepStrictEqual(entries.map(e => e.key).sort(), ['crop:1,1', 'crop:2,1', 'livestock:live1']);
const growingRows = entries.find(e => e.key === 'crop:1,1').rows;
assert.strictEqual(growingRows[0][0].text, 'Garlink');
assert.strictEqual(growingRows[1][1].text, '50%');
assert.strictEqual(growingRows[2][1].text, '3', 'moisture numerator in tenths of max water');
assert.strictEqual(growingRows[2][2].text, '/3', 'denominator is the ideal band midpoint');
assert.strictEqual(growingRows[2][2].color, '#ffffff');
assert.strictEqual(growingRows[2][1].color, '#ffffff', 'at ideal moisture the numerator stays white');
const ripeRows = entries.find(e => e.key === 'crop:2,1').rows;
assert.strictEqual(ripeRows[2][1].text, '0');
assert.notStrictEqual(ripeRows[2][1].color, '#ffffff', 'dry soil tints the numerator toward crimson');
assert.ok(ripeRows.some(row => row[0].text === 'Too Dry'));
const cowRows = entries.find(e => e.key === 'livestock:live1').rows;
assert.strictEqual(cowRows[0][0].text, 'Mabel');
assert.deepStrictEqual(cowRows[1].map(s => s.text), ['Fed', 'No', '(trough empty)']);
assert.deepStrictEqual(cowRows[2].map(s => s.text), ['Petted', 'Yes']);
assert.deepStrictEqual(cowRows[3].map(s => s.text), ['Egg', 'in 2 days']);

// lerpHex endpoints.
assert.strictEqual(PM.__test.lerpHex('#ffffff', '#dc143c', 1), '#dc143c');

// Toggling off clears lists and restores speed; no cooldown on re-toggle.
assert.strictEqual(PM.toggle(), false);
assert.strictEqual(synced[synced.length - 1], 'cleared');
assert.strictEqual(PM.speedMultiplier(), 1);
assert.strictEqual(PM.toggle(), true, 're-enables immediately');
assert.deepStrictEqual(toggles, [true, false, true]);

// The outer-ring button toggles the mode on pointerdown and mirrors its state.
const button = sandbox.document.__button;
assert.strictEqual(typeof button.listeners.pointerdown, 'function', 'init binds #btnPerceptionMode');
assert.strictEqual(button.classList.contains('active'), true, 'button shows active while the sense is on');
button.listeners.pointerdown({ preventDefault() {} });
assert.strictEqual(PM.isActive(), false, 'tapping the button turns it off');
assert.strictEqual(button.classList.contains('active'), false);
assert.strictEqual(button.attrs['aria-pressed'], 'false');
button.listeners.pointerdown({ preventDefault() {} });
assert.strictEqual(PM.isActive(), true, 'and back on, no cooldown');

// renderOverlay: the mask pass swaps materials/layers only for its own
// render, and every piece of renderer state is restored afterwards — even when
// the mask render throws (a stuck render target would black out the canvas).
PM.update(9000);
const targetMesh = wolf.avatarRef.group.children[0];
const originalMaterial = targetMesh.material;
const camera = { layers: { mask: 1, set(layer) { this.mask = 1 << layer; } } };
const renderer = {
  target: 'canvas-target', autoClear: true, shadowMap: { enabled: true, autoUpdate: true }, passes: [], failMask: false,
  getDrawingBufferSize(v) { return v.set(200, 100); },
  getRenderTarget() { return this.target; },
  setRenderTarget(target) { this.target = target; },
  getClearColor(c) { return c; }, getClearAlpha() { return 1; }, setClearColor() {}, clear() {},
  render(renderScene) {
    const mask = renderScene === scene;
    if (mask) {
      assert.notStrictEqual(targetMesh.material, originalMaterial, 'mask pass draws with the category material');
      assert.strictEqual(this.autoClear, false);
      if (this.failMask) throw new Error('mask failure');
    }
    this.passes.push(mask ? 'mask' : 'composite');
  },
};
const assertRestored = label => {
  assert.strictEqual(renderer.target, 'canvas-target', `${label}: render target restored`);
  assert.strictEqual(renderer.autoClear, true, `${label}: autoClear restored`);
  assert.strictEqual(renderer.shadowMap.autoUpdate, true, `${label}: shadow auto-update restored`);
  assert.strictEqual(targetMesh.material, originalMaterial, `${label}: source material restored`);
  assert.strictEqual(targetMesh.layers.mask, 1, `${label}: perception layer removed`);
  assert.strictEqual(camera.layers.mask, 1, `${label}: camera layers restored`);
};
PM.renderOverlay(renderer, scene, camera);
assert.deepStrictEqual(renderer.passes, ['mask', 'composite']);
assert.ok(PM.debugSnapshot().rendered > 0);
assertRestored('normal frame');
renderer.passes.length = 0;
renderer.failMask = true;
assert.throws(() => PM.renderOverlay(renderer, scene, camera), /mask failure/);
assert.deepStrictEqual(renderer.passes, [], 'no composite of an incomplete mask');
assertRestored('failed mask pass');

console.log('perception mode: ok');
