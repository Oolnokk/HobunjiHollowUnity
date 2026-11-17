'use strict';

// Run: node scripts/test-loadout-weapon-preview.js
// Regression coverage for the Loadout split and its independent WebGL lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/loadout-weapon-preview.js', 'utf8'); // Exercises the shipped renderer, not a test duplicate.
const ui = fs.readFileSync('docs/js/combat/combat-loadout-ui.js', 'utf8'); // Guards scroll/focus preservation at the existing UI seam.
const css = fs.readFileSync('docs/style.css', 'utf8'); // Guards the fixed right half and scroll-only left half.
const html = require('./classic-script-group-index.js').expandClassicScriptGroups(); // Guards single preview markup and the script dependency order.
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
assert.match(vfx, /maskByPlane = new Map\(supplied\.map/,'flail preview uses layer-specific enamel masks');
const assemblies = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // The head/rope bridge remains read-only and scoped to cached equipment.
assert.match(assemblies, /function previewParts\(plane\)/);
assert(html.indexOf('weapon-enchantment-vfx.js') < html.indexOf('loadout-weapon-preview.js'));

let menuOpen = true; // Test visibility transitions without replacing the actual menu module.
let loadoutActive = true; // Tracks which menu tab owns the viewport.
let equippedKey = 'crafted_sword'; // The weapon is equipped but never attached to a held-tool parent.
let texture = { id: 'verdigris-texture' }; // Serves as the live, already-recolored gameplay texture.
let creationCount = 0; // Independent particle emitters created by the preview.
let disposalCount = 0; // Preview emitter cleanup after geometry/material/equip changes.
let gpuDisposals = 0; // Counts viewport-only material/geometry cleanup.
let flailAssembly = null; // Simulates the async live flail head and exact head/shaft metal masks.
let lastPreviewTargets = null; // Verifies head emitters bind to the cloned meshes, not gameplay meshes.
let lastPreviewPlane = null; // Inspects preview-only visibility while dual wield hides source materials.
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
class Matrix4 {
  copy(source) { this.copiedFrom = source; return this; }
  invert() { return this; }
  multiply() { return this; }
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
  constructor() {
    this.children = []; this.rotation = { x: 0, y: 0 };
    this.position = new Vector3(); this.matrix = new Matrix4(); this.matrixWorld = new Matrix4();
    this.layers = { set() {} }; this.userData = {}; this.visible = true; this.isObject3D = true;
  }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
  updateMatrixWorld() {}
  clone() { const copy = new Group(); copy.userData = { ...this.userData }; return copy; }
}
class Mesh extends Group {
  constructor(geometry, material) {
    super(); this.geometry = geometry; this.material = material; this.isMesh = true;
    this.rotation = { set() {} };
  }
  clone() { const copy = new Mesh(this.geometry, this.material); copy.userData = { ...this.userData }; return copy; }
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
    HobunjiWeaponSpriteAssemblies: { previewParts: plane => plane === actualPlane ? flailAssembly : null },
    WeaponEnchantmentVFX: {
      createPreviewEmitter(_plane, key, targets) {
        lastPreviewPlane = _plane;
        lastPreviewTargets = targets;
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
  THREE: { WebGLRenderer: Renderer, Scene: Group, Group, Mesh, PerspectiveCamera: Camera, Vector3, Matrix4, DoubleSide: 2 },
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
// The live flail renderer stores its head/rope outside the haft plane. The Loadout
// must adopt those *images* and their separate metal masks, without adopting the actual meshes.
equippedKey = 'modular:flail';
const flailMap = { id: 'recolored-haft' }; // The base weapon texture is already aged in the live equipment cache.
const chainMap = { id: 'recolored-chain' }; // Raster chain can also carry a metal material.
const headMap = { id: 'verdigris-head-layer-1' }; // Both sprite layers must retain their own aged texture.
const secondHeadMap = { id: 'verdigris-head-layer-2' };
actualPlane = new Mesh(new Geometry(), new Material(flailMap));
const chain = new Mesh(new Geometry(), new Material(chainMap));
chain.userData.hobunjiWeaponAssemblyPart = true;
const head = new Group();
head.name = 'flail_head';
const headLayerA = new Mesh(new Geometry(), new Material(headMap));
const headLayerB = new Mesh(new Geometry(), new Material(secondHeadMap));
headLayerA.userData.hobunjiWeaponAssemblyPart = true;
headLayerB.userData.hobunjiWeaponAssemblyPart = true;
head.add(headLayerA);
head.add(headLayerB);
const rig = new Group();
rig.add(actualPlane);
rig.add(chain);
rig.add(head);
flailAssembly = { ready: false, chain, headRoot: head, metalTargets: [] };
api.sync(equippedKey, 'Flail');
tick(3500);
assert.equal(api.debugSnapshot().flail.parts, 0, 'a still-loading flail first displays its ready haft');
assert.equal(lastPreviewTargets?.length, 0, 'unloaded flails never emit enchantments from their bare haft');
const maskA = { width: 2, height: 2, indices: Uint32Array.of(0, 2), matchedMetalPixels: 2 };
const maskB = { width: 2, height: 2, indices: Uint32Array.of(1), matchedMetalPixels: 1 };
const idleChainPose = new Matrix4(); // The cached flail's authored rest pose can be supplied before gameplay has ever simulated its swing.
const idleHeadPose = new Matrix4();
flailAssembly = { ready: true, chain, headRoot: head,
  neutralMatrices: { chain: idleChainPose, headRoot: idleHeadPose },
  metalTargets: [
  { plane: headLayerA, mask: maskA }, { plane: headLayerB, mask: maskB },
] };
actualPlane.material.visible = false; // Gameplay's dual-wield compositor hides the source haft, not its Loadout copy.
head.visible = false; chain.visible = false; // The two live flail replicas replace these original flexible roots.
headLayerA.material.visible = false; // A source layer can also be hidden by gameplay's compositor.
tick(4000);
assert.equal(lastPreviewPlane.material.visible, true, 'a hidden dual-wield haft is restored only in the preview');
assert.equal(lastPreviewTargets[0].plane.material.visible, true, 'hidden metal head layer displays in the preview');
assert.equal(lastPreviewTargets[0].plane.parent.visible, true, 'hidden original head root is shown only in its preview clone');
assert.equal(actualPlane.material.visible, false, 'preview never unmasks live gameplay source material');
assert.equal(head.visible, false, 'preview never unhides the actual gameplay flail head');
assert.equal(api.debugSnapshot().flail.parts, 2, 'async rope and head are copied without another equip action');
assert.equal(api.debugSnapshot().flail.metalEmitters, 2, 'both head metal layers receive distinct emitters');
assert.equal(lastPreviewTargets.length, 2, 'the VFX renderer is given both head masks');
assert.notEqual(lastPreviewTargets[0].plane, headLayerA, 'head effect binds to a preview clone, not the gameplay scene');
assert.equal(lastPreviewTargets[0].plane.material.map, headMap, 'first head layer retains its live verdigris map');
assert.equal(lastPreviewTargets[1].plane.material.map, secondHeadMap, 'second head layer retains its own live map');
assert.equal(lastPreviewTargets[0].mask, maskA, 'authored metal pixel mask survives the preview copy');
assert.equal(lastPreviewTargets[0].plane.parent.matrix.copiedFrom, idleHeadPose,
  'head art is positioned using the independent neutral pose, not the unposed gameplay root');
assert.equal(lastPreviewTargets[1].mask, maskB, 'second layer uses its own metal pixel mask');
const withHead = creationCount; // Changes within a loaded head must invalidate the copied preview, not the live weapon.
headLayerB.material = new Material({ id: 'new-head-oxidation-map' });
tick(4500);
assert.equal(creationCount, withHead + 1, 'a replaced head finish rebuilds the preview and its enchantments');
api.sync('none', 'No weapon equipped');
tick(5000);
assert.equal(api.debugSnapshot().flail.parts, 0, 'leaving the slot disposes the preview-only flail copies');
// A static layered weapon can load its authored overlay AFTER its base weapon.
// Rebuild only the viewport copies once the new layer appears.
equippedKey = 'crafted_sword';
actualPlane = new Mesh(new Geometry(), new Material({ id: 'ready-sword' }));
api.sync(equippedKey, 'Crafted Sword');
tick(5500);
const beforeOverlay = creationCount; // Late source-art loading must be visible without changing equipment slots.
const overlay = new Mesh(new Geometry(), new Material({ id: 'late-weapon-overlay' }));
overlay.userData.hobunjiWeaponAssemblyPart = true;
overlay.material.visible = false; // Dual-wield can hide static overlay source materials too.
actualPlane.add(overlay);
tick(6000);
assert.equal(creationCount, beforeOverlay + 1, 'late static weapon artwork triggers one viewport rebuild');
assert.equal(lastPreviewPlane.children[0].material.visible, true, 'hidden static overlay material is restored in the preview clone');
assert.equal(overlay.material.visible, false, 'static overlay source material stays hidden in gameplay');
tick(6500);
assert.equal(creationCount, beforeOverlay + 1, 'loaded static overlays do not cause repeated rebuilds');
api.sync('none', 'No weapon equipped');
console.log('Loadout fixed 3D weapon preview integration/lifecycle + multilayer flail checks passed.');
