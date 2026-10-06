'use strict';
const assert = require('node:assert/strict'); // Verifies core routing and draw-time diagnostics without a browser.
const fs = require('node:fs'); // Loads the actual creator owner rather than a duplicate implementation.
const vm = require('node:vm'); // Executes the owner functions against small DOM/Three-shaped fixtures.
const source = fs.readFileSync('docs/js/onboarding-character-creation-redesign.js', 'utf8'); // Functions under test.
class Element {
  constructor() { this.dataset = {}; this.listeners = {}; this.buttons = []; this.classList = { contains: () => false, toggle: (_key, value) => { this.active = value; } }; }
  set innerHTML(html) {
    this.html = html;
    this.buttons = [...html.matchAll(/<button([^>]*)>/g)].map(([, attributes]) => {
      const button = new Element(); // A fresh button is created on every family-panel rebuild.
      button.dataset.obSubspecies = attributes.match(/data-ob-subspecies="([^"]+)"/)?.[1];
      button.disabled = /\sdisabled/.test(attributes);
      button.active = /ob-active/.test(attributes);
      return button;
    });
  }
  appendChild(child) { this.child = child; }
  querySelectorAll() { return this.buttons; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
let current = 'tletingan'; // Simulates onboarding-core's authoritative current identity.
let coreClicks = 0; // Detects missing or duplicate state transitions.
const family = new Element(); // Top-level Slagothim family indicator.
const cores = Object.fromEntries(['tletingan', 'nuhongan'].map(id => [id, { classList: { contains: () => current === id }, click() { current = id; coreClicks++; } }])); // Real core selection stand-ins.
const group = { parentElement: { querySelector: () => null }, querySelector(selector) { return selector.includes('ob-family') ? family : cores[selector.match(/="([^"]+)"/)?.[1]]; }, after(details) { this.details = details; } }; // The rebuilt panel is nested beneath the creator card.
const context = { document: { createElement: () => new Element() }, activeCoreSpecies: () => current, LORE: { slagothim: { label: 'Slagothim', text: '' }, tletingan: { label: 'Tletingan', text: '' }, nuhongan: { label: 'Nuhongan', text: '' } }, speciesDescriptionHtml: entry => entry?.label || '' }; // Only external dependencies of the UI owner.
vm.createContext(context);
vm.runInContext('let familyOpen = false;\n' + source.slice(source.indexOf('  function renderSpeciesDetails('), source.indexOf('  function enhanceSpeciesWorkflow(')), context);
const render = () => { context.renderSpeciesDetails({}, group, cores.tletingan); return group.details.child; }; // Runs the actual family renderer after each core state transition.
let panel = render(); // First Tletingan panel must already contain an enabled Nuhongan choice.
assert.equal(panel.buttons.find(button => button.dataset.obSubspecies === 'nuhongan').disabled, false);
panel.buttons.find(button => button.dataset.obSubspecies === 'nuhongan').click();
assert.equal(current, 'nuhongan');
assert.equal(coreClicks, 1);
panel = render();
assert.equal(family.active, true);
assert.equal(panel.buttons.find(button => button.dataset.obSubspecies === 'nuhongan').active, true);
panel.buttons.find(button => button.dataset.obSubspecies === 'tletingan').click();
assert.equal(current, 'tletingan');
assert.equal(coreClicks, 2);
for (let index = 0; index < 3; index++) assert.equal(render().buttons.find(button => button.dataset.obSubspecies === 'nuhongan').disabled, false);
delete cores.nuhongan;
assert.equal(render().buttons.find(button => button.dataset.obSubspecies === 'nuhongan').disabled, true, 'missing core species must not create a clickable dead end');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; }
  normalize() { const length = Math.hypot(this.x, this.y, this.z) || 1; this.x /= length; this.y /= length; this.z /= length; return this; }
  transformDirection(matrix) { const x = this.x; this.x = x * Math.cos(matrix.yaw) + this.z * Math.sin(matrix.yaw); this.z = this.z * Math.cos(matrix.yaw) - x * Math.sin(matrix.yaw); return this; }
  dot(other) { return this.x * other.x + this.y * other.y + this.z * other.z; }
  toArray() { return [this.x, this.y, this.z]; }
}
const status = {}; // Existing mobile-readable status owns diagnostic results.
let delegated = 0; // Existing mesh callback must remain wired.
const plane = { onBeforeRender() { delegated++; }, matrixWorld: { yaw: 0, determinant: () => 1, toArray: () => [] }, getWorldPosition: value => value }; // Actual draw callback fixture.
const model = { parent: { rotation: { y: 0 } }, userData: { neckRig: { skinnedPlane: plane, neckJoint: { rotation: { y: 0 } } } } }; // Creator model.
const scene = { THREE: { Vector3 }, root: { rotation: { y: 0.1 } }, canvas: {}, captureFacing: false }; // On-demand capture flag.
const camera = { position: new Vector3(1.55, 1.08, 2.75), getWorldPosition(value) { Object.assign(value, this.position); return value; } }; // Original creator camera.
const diagnosticContext = { status, window: {}, document: {} }; // Diagnostics stop at status publication when no panel is mounted.
vm.createContext(diagnosticContext);
vm.runInContext(source.slice(source.indexOf('  function installFacingDiagnostics('), source.indexOf('  function renderPreviewFrame(')), diagnosticContext);
diagnosticContext.installFacingDiagnostics(scene, model, { fighter: { headUrl: 'front.png' } });
plane.onBeforeRender(null, {}, camera);
assert.equal(status.facingDiagnostics, undefined, 'normal frames must not allocate/serialize a diagnostic snapshot');
scene.captureFacing = true;
plane.onBeforeRender(null, { overrideMaterial: {} }, camera);
assert.equal(scene.captureFacing, true, 'outline pass cannot consume the capture');
plane.onBeforeRender(null, {}, camera);
assert.equal(status.facingDiagnostics.renderedSide, 'front');
plane.matrixWorld.yaw = Math.PI;
scene.captureFacing = true;
plane.onBeforeRender(null, {}, camera);
assert.equal(status.facingDiagnostics.renderedSide, 'behind');
assert.equal(scene.root.rotation.y, 0.1, 'diagnostics must never rotate the character');
assert.equal(status.facingDiagnostics.frontHeadUrl, 'front.png');
assert.equal(delegated, 4);
console.log('Creator subspecies routing and draw-time facing diagnostics passed.');
