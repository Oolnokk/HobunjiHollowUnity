#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Exercise the real renderer's shared depth-material transaction.
const fs = require('node:fs'); // Read production functions instead of maintaining a second replayer.
const source = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'); // Source of truth for player/NPC/enemy passes.
function block(begin, end) {
  const a = source.indexOf(begin), b = source.indexOf(end, a + begin.length);
  assert(a >= 0 && b > a, 'shipping helper exists: ' + begin);
  return source.slice(a, b);
} // Bounded extraction avoids starting the browser-only rendering engine.

const outline = new Function(block('  function isAuthoredInkPlane(', '  function enforceHeldMesh(')
  + '\nreturn isAuthoredInkPlane;')();
const inked = [
  { geometry: { type: 'PlaneGeometry' }, userData: {} }, // Tool/weapon and character body PNG.
  { geometry: { type: 'BufferGeometry' }, userData: { isPngPlane: true } }, // Replacement portrait meshes.
  { geometry: { type: 'BufferGeometry' }, userData: { hobunjiWeaponAssemblyPart: true } }, // Flail heads/ropes.
  { geometry: { type: 'BufferGeometry' }, userData: { noOutline: true } }, // Merged tree leaf cards.
  { geometry: { type: 'BufferGeometry' }, userData: { hobunjiPantsGarment: true } }, // GPU-deformable authored PNG pants grid must not get duplicate outlines.
  { geometry: { type: 'BufferGeometry' }, userData: { isBillboard: true } }, // Town and farm grass.
  { geometry: { type: 'BufferGeometry' }, userData: { isRichFoliageBillboard: true } }, // Wilderness grass.
]; // Flat authored artwork that must never receive new black shell pixels.
for (const mesh of inked) assert(outline(mesh), 'authored sprites are excluded from generated outlines');
for (const flag of ['hobunjiProceduralHand','hobunjiProceduralFoot']) {
  assert(!outline({ ...inked[0], userData: { [flag]: true } }), 'volumetric ' + flag + ' keeps the shell pass');
}
assert(!outline({ geometry: { type: 'BoxGeometry' }, userData: {} }), '3D furniture keeps its shell');

const enforceSource = block('  function isAuthoredInkPlane(', '  function markHeldPlane(');
const enforce = new Function('h', [
  'const {hasLayer,forEachMaterial,DEFAULT_LAYER,SHELL_LAYER,HELD_OVERLAY_LAYER,LEGACY_HELD_RENDER_ORDER}=h;',
  'let invariantRepairCount = 0;',
  enforceSource,
  'return enforceHeldMesh;'
].join('\n'))({
  hasLayer:(mesh,layer)=>!!(mesh.layers.mask & (1<<layer)),
  forEachMaterial:(material,fn)=>(Array.isArray(material)?material:[material]).forEach(fn),
  DEFAULT_LAYER:0, SHELL_LAYER:1, HELD_OVERLAY_LAYER:29, LEGACY_HELD_RENDER_ORDER:0,
}); // Production held-material/layer enforcement, with no Three.js dependency.
function heldFixture(geometry, userData={}) {
  return {isMesh:true,geometry,userData,material:{depthTest:true},renderOrder:0,
    layers:{mask:3,enable(n){this.mask |= 1<<n;},disable(n){this.mask &= ~(1<<n);}}};
} // Starts with an accidentally enabled shell layer as might happen after a visual rebuild.
const weapon = heldFixture({type:'PlaneGeometry'});
enforce(weapon);
assert.equal(weapon.layers.mask & 2,0,'existing PNG weapons lose only the synthetic shell layer');
assert(weapon.layers.mask & (1<<29),'PNG weapons retain their selective held x-ray layer');
assert(weapon.layers.mask & 1,'PNG weapons retain ordinary color rendering');
const hand = heldFixture({type:'BoxGeometry'}, {hobunjiProceduralHand:true});
enforce(hand);
assert(hand.layers.mask & 2,'hand still receives a volumetric outline');

console.log('Authored ink shell exclusions and held-mesh layer enforcement tests passed.');
