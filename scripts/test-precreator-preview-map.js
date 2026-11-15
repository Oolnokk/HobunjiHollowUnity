#!/usr/bin/env node
'use strict';
// Headless integration checks for the isolated pre-creator preview map (no save or actual GPU needed).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'docs/tools/preview-map/index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'docs/tools/preview-map/preview-map.js'), 'utf8');
const onboarding = fs.readFileSync(path.join(root, 'docs/onboarding-core.js'), 'utf8');
const gate = fs.readFileSync(path.join(root, 'docs/js/save-startup-gate.js'), 'utf8');
assert.ok(html.includes('id="world"') && html.includes('id="tabAppearance"'), 'preview has accessible canvas and control tab');
assert.ok(html.includes('avatar-preview-scene.js') && html.includes('npc-avatar-preview-utils.js'), 'real avatar and portrait runtimes are reused');
assert.ok(onboarding.includes('id="slOpenPreviewMap"'), 'save-source screen links to the preview before choosing a farmer');
assert.ok(gate.includes('id="hobunjiEmptySavePreview"'), 'empty-save gate also exposes the preview');
assert.ok(!source.includes('HobunjiOnboarding.init'), 'preview cannot start or mutate a world save');
assert.doesNotThrow(() => new Function(source), 'preview source parses');

function el(tag = 'div') {
  const events = new Map();
  const elem = {
    tag, value: '', textContent: '', disabled: false, hidden: false, attrs: {}, children: [],
    addEventListener(type, listener) { events.set(type, listener); },
    fire(type, event = {}) { const listener = events.get(type); if (!listener) throw Error('no ' + type + ' on ' + tag); return listener({
      target: this, currentTarget: this, preventDefault() {}, ...event,
    }); },
    setAttribute(key, value) { this.attrs[key] = value; },
    replaceChildren() { this.children = []; this.value = ''; },
    add(option) { this.children.push(option); if (!this.value) this.value = option.value; },
    get selectedOptions() { return this.children.filter(o => o.value === this.value); },
    closest() { return null; },
    setPointerCapture() {}, releasePointerCapture() {},
  };
  return elem;
}
const ids = ['world', 'returnLink', 'species', 'gender', 'outfit', 'tool', 'clearTool', 'resetView',
  'resetViewOther', 'status', 'debug', 'tabAppearance', 'tabControls', 'appearance', 'controls'];
const nodes = Object.fromEntries(ids.map(id => [id, el(id)])); // Models only the controls actually used by this module.
const hooks = new Map(); // Captures window events so tests can dispatch keys and lifecycle events.
const fakeDoc = {
  referrer: 'https://example.test/docs/index.html',
  getElementById: id => nodes[id] || null,
  createElement: tag => el(tag),
};
const mat = function Material(props = {}) { Object.assign(this, props); this.dispose = () => {}; };
const geom = function Geometry() { this.dispose = () => {}; };
const fakeTHREE = {
  MeshLambertMaterial: mat, MeshBasicMaterial: mat, BoxGeometry: geom,
  DodecahedronGeometry: geom, CylinderGeometry: geom, ConeGeometry: geom, PlaneGeometry: geom,
  NearestFilter: 1000, DoubleSide: 2,
  Fog: class { constructor() {} },
  Mesh: class {
    constructor(geometry, material) {
      this.geometry = geometry; this.material = material;
      this.position = { set() {} }; this.rotation = { z: 0 };
    }
  },
  TextureLoader: class {
    load(url) { assert.ok(url.startsWith('../../assets/toolsprites/')); return { dispose() {}, url }; }
  },
};
const fighterOptions = [
  { speciesId: 'mao_ao', gender: 'male', label: 'Mao-ao male' },
  { speciesId: 'mao_ao', gender: 'female', label: 'Mao-ao female' },
  { speciesId: 'kenkari', gender: 'male', label: 'Kenkari male' },
];
const models = []; // Records actual avatar models used by the shared preview module.
const avatarRotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
const holder = { rotation: avatarRotation, children: [],
  add(mesh) { this.children.push(mesh); }, remove(mesh) { this.children = this.children.filter(x => x !== mesh); } };
const camera = {
  position: { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } },
  lookAt(x, y, z) { this.target = { x, y, z }; },
};
let previewOptions, disposed = false;
const preview = {
  THREE: fakeTHREE, scene: { add() {} }, avatarHolder: holder, camera,
  setAvatar(_front, args) { models.push(args); return {}; },
  start() {}, resize() {}, dispose() { disposed = true; },
};
const windowStub = {
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { previewPortraitCanvasSize: 200 } },
    account: { shopCatalog: [{ id: 'hat-1', category: 'hat' }, { id: 'torso-1', category: 'torso' }] },
    appearanceEditor: { species: { 'mao-ao': { label: 'Mao-ao' }, kenkari: { label: 'Kenkari' } } } } },
  NpcAvatarPreview: {
    ensurePortraitCosmetics: async () => ({}),
    randomProfile: (seed, { speciesId, gender }) => ({ fighter: { speciesId, gender }, bodyColors: { A: {} },
      eyes: { id: 'eyes' }, seed }),
    buildProfileFromNpcExport: npc => ({ actor: npc, fighter: npc.appearance, seed: npc.appearance.randomSeed }),
    renderProfileToCanvas: async () => true,
  },
  AvatarPreviewScene: { create: async args => { previewOptions = args; return preview; } },
  getPortraitFighters: () => fighterOptions,
  addEventListener(type, fn) { hooks.set(type, fn); },
  renderProfile() {},
};
let backCount = 0;
const context = vm.createContext({
  window: windowStub, document: fakeDoc, navigator: {
    getGamepads: () => [{ axes: new Float32Array([0.85, 0, 0.70, 0]) }],
  }, location: { origin: 'https://example.test' }, history: { back() { backCount++; } },
  URL, Math, Option: function(label, value) { this.textContent = label; this.label = label; this.value = value; },
  ResizeObserver: undefined,
});
vm.runInContext(source, context);
const finishMicrotasks = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  await finishMicrotasks();
  assert.equal(windowStub.HobunjiPreviewMap.getDebug().rendererReady, true, 'shared preview renderer initialized');
  assert.equal(models.length, 1, 'generic avatar rendered into shared preview scene');
  assert.equal(nodes.species.children.length, 2, 'species list comes from the actual supported fighter set');
  assert.equal(nodes.gender.children.length, 2, 'gender options follow the selected species');
  assert.equal(nodes.tool.disabled, false, 'controls activate after avatar renderer is ready');
  assert.ok(previewOptions?.controls === false && previewOptions?.grid === false, 'camera orbit is disabled and a real tiny map replaces the grid');

  const originalYaw = holder.rotation.y;
  nodes.world.fire('pointerdown', { pointerId: 1, clientX: 30, clientY: 40, button: 0 });
  nodes.world.fire('pointermove', { pointerId: 1, clientX: 82, clientY: 48 });
  assert.ok(holder.rotation.y > originalYaw, 'drag rotates the farmer rather than camera');
  nodes.world.fire('pointerup', { pointerId: 1 });
  const yawBeforePad = holder.rotation.y;
  previewOptions.onFrame(1000);
  previewOptions.onFrame(1025);
  assert.ok(holder.rotation.y > yawBeforePad, 'right-stick axis rotates farmer');
  assert.ok(camera.position.x - camera.target.x > 2.1, 'fixed camera angle is preserved during left-stick pan');

  nodes.species.value = 'kenkari';
  nodes.species.fire('change');
  await finishMicrotasks();
  assert.equal(nodes.gender.value, 'male', 'unsupported gender is not selectable');
  assert.equal(models.at(-1).speciesId, 'kenkari', 'species selection regenerates the real avatar');

  const oldSeed = models.at(-1).profile.seed;
  nodes.outfit.fire('click');
  await finishMicrotasks();
  assert.notEqual(models.at(-1).profile.seed, oldSeed, 'random clothing rerolls the portrait and outfit');
  nodes.tool.fire('click');
  assert.ok(windowStub.HobunjiPreviewMap.getDebug().activeTool, 'random tool appears on same avatar holder');
  assert.ok(holder.children.some(child => child.name?.startsWith('preview_held_')), 'tool has an actual visible 3D sprite mesh');
  nodes.clearTool.fire('click');
  assert.equal(windowStub.HobunjiPreviewMap.getDebug().activeTool, null, 'unequip clears the tool mesh');

  nodes.tabControls.fire('click');
  assert.equal(nodes.controls.hidden, false, 'controls tab opens');
  assert.equal(nodes.appearance.hidden, true, 'appearance tab closes');
  nodes.returnLink.fire('click');
  assert.equal(backCount, 1, 'return button restores previous character selection screen');
  hooks.get('pagehide')();
  assert.equal(disposed, true, 'preview renderer releases WebGL resources when exiting');
  console.log('precreator preview map: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
