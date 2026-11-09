'use strict';

// Run: node scripts/test-loadout-weapon-preview.js
// Regression coverage for the Loadout split and its independent WebGL lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/loadout-weapon-preview.js', 'utf8'); // Exercises the shipped renderer, not a test duplicate.
const ui = fs.readFileSync('docs/js/combat/combat-loadout-ui.js', 'utf8'); // Guards scroll/focus preservation at the existing UI seam.
const css = fs.readFileSync('docs/style.css', 'utf8'); // Guards the fixed right half and scroll-only left half.
const html = fs.readFileSync('docs/index.html', 'utf8'); // Guards single preview markup and the script dependency order.
const equipment = fs.readFileSync('docs/js/equipment-panel.js', 'utf8'); // Guards the holstered weapon lookup.
const vfx = fs.readFileSync('docs/js/combat/weapon-enchantment-vfx.js', 'utf8'); // Guards the isolated enchantment particle API.

for (const id of ['combatLoadoutPane', 'combatLoadoutPreview', 'combatLoadoutPreviewStage', 'combatLoadoutPreviewStatus', 'combatLoadoutPreviewName']) {
  assert.equal(html.split('id="' + id + '"').length - 1, 1, id + ' is authored exactly once');
}
assert.match(css, /#mpLoadout\.active\s*\{\s*display:\s*flex;\s*overflow:\s*hidden;/);
assert.match(css, /#mpLoadout #combatLoadoutPane\s*\{[^}]*overflow-y:\s*auto;/);
assert.match(css, /#combatLoadoutPreview\s*\{[^}]*overflow:\s*hidden;/);
assert.match(ui, /pane\.scrollTop = previousScroll/);
assert.match(ui, /restoreLoadoutControlFocus\(pane, restoreFocusId\)/);
assert.match(equipment, /getEquippedWeaponPreviewPlane/);
assert.match(vfx, /createPreviewEmitter,/);
assert(html.indexOf('weapon-enchantment-vfx.js') < html.indexOf('loadout-weapon-preview.js'));

let menuOpen = true; // Test visibility transitions without replacing the actual menu module.
let loadoutActive = true; // Tracks which menu tab owns the viewport.
let equippedKey = 'crafted_sword'; // The weapon is equipped but never attached to a held-tool parent.
let texture = { id: 'verdigris-texture' }; // Serves as the live, already-recolored gameplay texture.
let creationCount = 0; // Independent particle emitters created by the preview.
let disposalCount = 0; // Preview emitter cleanup after geometry/material/equip changes.
let gpuDisposals = 0; // Counts viewport-only material/geometry cleanup.
let draws = 0; // Verifies frame throttling and lifecycle suspension.
let nextFrameId = 1; // Stable RAF IDs used for cancellation tests.
const frames = new Map(); // Synthetic requestAnimationFrame queue advanced by each test tick.
const observers = []; // Captures menu class observers so close/reopen can be simulated.

function element(id) {
  return {
    id, isConnected: true, dataset: {}, textContent: '', hidden: false,
    clientWidth: 240, clientHeight: 340, children: [], listeners: {},
    classList: {
      contains(value) {
        if (id === 'menuPanel') return value === 'open' && menuOpen;
        if (id === 'mpLoadout') return value === 'active' && loadoutActive;
        return false;
      },
    },
    setAttribute() {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    appendChild(child) { this.children.push(child); },
    remove() {},
    setPointerCapture() {},
    releasePointerCapture() {},
  };
}
const nodes = Object.fromEntries(['menuPanel', 'mpLoadout', 'combatLoadoutPreview',
  'combatLoadoutPreviewStage', 'combatLoadoutPreviewStatus', 'combatLoadoutPreviewName']
  .map(id => [id, element(id)])); // The real preview IDs are required for initialization.

class Vector3 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; }
}
class Geometry {
  constructor(version = 0) {
    this.attributes = { position: { version } };
    this.boundingBox = {
      getSize(v) { v.x = 0.5; v.y = 1.2; v.z = 0; },
      getCenter(v) { v.x = 0; v.y = 0; v.z = 0; },
    };
  }
  clone() { return new Geometry(this.attributes.position.version); }
  computeBoundingBox() {}
  dispose() { gpuDisposals++; }
}
class Material {
  constructor(map) { this.map = map; }
  clone() { return new Material(this.map); }
  dispose() { gpuDisposals++; }
}
class Group {
  constructor() { this.children = []; this.rotation = { x: 0, y: 0 }; }
  add(child) { this.children.push(child); }
  remove(child) { this.children = this.children.filter(item => item !== child); }
  updateMatrixWorld() {}
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.rotation = { set() {} }; this.position = new Vector3(); this.layers = { set() {} };
  }
}
class Camera {
  constructor(fov) { this.fov = fov; this.position = new Vector3(); this.aspect = 1; }
  lookAt() {}
  updateProjectionMatrix() {}
  updateMatrixWorld() {}
}
class Renderer {
  constructor() { this.domElement = element('previewCanvas'); }
  setPixelRatio() {}
  setClearColor() {}
  setSize() {}
  render() { draws++; }
  dispose() {}
}
let actualPlane = { geometry: new Geometry(), material: new Material(texture) }; // Represents the game's cached weapon mesh, independent of its active slot.
const browser = {
  window: {
    devicePixelRatio: 3,
    addEventListener() {},
    removeEventListener() {},
    EquipmentPanel: { getEquippedWeaponPreviewPlane: key => key === equippedKey ? actualPlane : null },
    WeaponEnchantmentVFX: {
      createPreviewEmitter(_plane, key) {
        creationCount++;
        return {
          update() {},
          dispose() { disposalCount++; },
          debugSnapshot: () => ({ weaponKey: key }),
        };
      },
    },
  },
  document: { readyState: 'complete', getElementById: id => nodes[id] || null },
  THREE: { WebGLRenderer: Renderer, Scene: Group, Group, Mesh, PerspectiveCamera: Camera, Vector3, DoubleSide: 2 },
  MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame(callback) { const id = nextFrameId++; frames.set(id, callback); return id; },
  cancelAnimationFrame(id) { frames.delete(id); },
}; // Production preview runs unchanged in an isolated simulated browser.
vm.createContext(browser);
vm.runInContext(source, browser, { filename: 'loadout-weapon-preview.js' });
const api = browser.window.CombatLoadoutWeaponPreview; // Only public UI hooks are used below.

function tick(now) {
  const due = [...frames.values()]; // Runs exactly one simulated animation frame.
  frames.clear();
  for (const callback of due) callback(now);
}
api.sync(equippedKey, 'Crafted Sword');
tick(1000);
assert.equal(api.debugSnapshot().modelLoaded, true, 'holstered equipped weapon renders');
assert.equal(api.debugSnapshot().verdigrisTextureShared, true, 'preview uses the gameplay metal texture');
assert.equal(creationCount, 1, 'only one independent preview emitter is mounted');
const firstDraws = draws; // Frame budget must not affect the game's own render loop.
tick(1015);
assert.equal(draws, firstDraws, 'intermediate display frame is skipped');
tick(1040);
assert.equal(draws, firstDraws + 1, 'preview draws again within its 30fps frame budget');
actualPlane.geometry.attributes.position.version++;
tick(1500);
assert.equal(creationCount, 2, 'modular geometry re-layout rebuilds the preview');
assert.equal(disposalCount, 1, 'the old preview emitter is disposed');
actualPlane.material = new Material(texture);
tick(2000);
assert.equal(creationCount, 3, 'live material replacement rebuilds the preview even if its map is unchanged');
loadoutActive = false;
for (const notify of observers) notify();
assert.equal(frames.size, 0, 'closing the loadout suspends the independent renderer');
loadoutActive = true;
for (const notify of observers) notify();
assert.equal(frames.size, 1, 'reopening the loadout resumes the independent renderer');
tick(2500);
const canvas = nodes.combatLoadoutPreviewStage.children[0]; // The actual renderer canvas owns the WebGL lifecycle listeners.
canvas.listeners.webglcontextlost({ preventDefault() {} });
for (const notify of observers) notify();
assert.equal(frames.size, 0, 'a lost GPU context cannot be restarted by an observer');
canvas.listeners.webglcontextrestored();
assert.equal(frames.size, 1, 'the restored GPU context resumes');
equippedKey = 'none';
api.sync('none', 'No weapon equipped');
tick(3000);
assert.equal(api.debugSnapshot().modelLoaded, false, 'unequipping removes the preview model');
assert.equal(disposalCount, 3, 'unequipping disposes the last preview emitter');
assert(gpuDisposals >= 6, 'all superseded viewport-owned materials/geometries are disposed');
console.log('Loadout fixed 3D weapon preview integration/lifecycle checks passed.');
