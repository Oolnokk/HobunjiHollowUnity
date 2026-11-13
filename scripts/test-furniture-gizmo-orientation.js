#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercises the Furniture Author's actual axis configuration rather than duplicating its selection logic.
const html = fs.readFileSync('docs/tools/furniture-avatar-author/index.html', 'utf8');
const begin = html.indexOf('function configureTransformAxesForSelection()');
const end = html.indexOf('\nfunction onTransformObjectChange()', begin);
assert.ok(begin >= 0 && end > begin, 'Furniture Author exposes its axis configuration');
assert.match(html, /id="gizmoSpaceStatus"/, 'axis frame is explained inside the editor for mobile debugging');

const status = { textContent: '' }; // Shows which frame should match the visible handles.
let selected = null; // Selected furniture record for each test case.
const transform = { // Minimal TransformControls surface, including the three independently enabled axes.
  showX:true, showY:true, showZ:true, mode:'translate', space:null,
  setSpace(value) { this.space = value; },
  getMode() { return this.mode; }
};
const state = { selectedType:null }; // Exercises each selectable object family.
const context = {
  state, transform,
  selectedPart: () => selected,
  linkedCup: () => ({ taperAxis:'z' }),
  setTransformMode: mode => { transform.mode = mode; },
  $: id => id === 'gizmoSpaceStatus' ? status : null
};
vm.createContext(context);
vm.runInContext(html.slice(begin, end), context, { filename:'furniture-author-axis-config.js' });

function check(type, kind, mode, space, axes = [true, true, true]) {
  state.selectedType = type;
  selected = kind ? { kind } : null;
  transform.mode = mode;
  vm.runInContext('configureTransformAxesForSelection()', context);
  assert.equal(transform.space, space, `${type} ${mode} gizmo must use ${space} coordinates`);
  assert.deepEqual([transform.showX, transform.showY, transform.showZ], axes, 'visible axes match this mode');
}

for (const mode of ['translate', 'rotate', 'scale']) {
  check('part', 'box', mode, 'local');
  check('placement', null, mode, 'local');
  check('partGroup', null, mode, 'world');
}
for (const mode of ['translate', 'rotate']) {
  check('seatAnchor', null, mode, 'local');
  check('emitter', null, mode, 'local');
}
assert.match(status.textContent, /Local axes/, 'single-object gizmo explains its visual alignment');
check('partGroup', null, 'rotate', 'world');
assert.match(status.textContent, /World axes/, 'multi-piece centroid explains why it cannot use a shared local orientation');

check('part', 'liquidSurface', 'rotate', 'local', [false, false, true]);
assert.equal(transform.mode, 'translate', 'liquid level is translate-only');
assert.equal(transform.showX, false);
assert.equal(transform.showY, false);
assert.equal(transform.showZ, true, 'vessel Z axis is the only visible draggable');

check('emitter', null, 'scale', 'local');
assert.equal(transform.mode, 'translate', 'emitters have fixed scale');
check('seatAnchor', null, 'scale', 'local');
assert.equal(transform.mode, 'translate', 'seat anchors have fixed scale');

check(null, null, 'translate', 'local');
assert.match(status.textContent, /Select an object/, 'empty selection has actionable diagnostics');

// All editor selection paths should use the shared configuration instead of resetting to world.
assert.doesNotMatch(html, /else\s+transform\.setSpace\?\.\('world'\)/, 'no world-space fallback may override object-local axes');
assert.match(html, /setTransformMode\(button\.dataset\.transformMode\);configureTransformAxesForSelection\(\)/, 'switching Move/Rotate/Scale recomputes axis orientation');
assert.match(html, /configureTransformAxesForSelection\(\);const object=objectForSelection\(\)/, 'piece selection recomputes axis orientation');

// Exercise the real live-drag callback: placement data is scalar-only, while authored
// primitive pieces keep independent dimensions along their own visible axes.
const changeStart = html.indexOf('function onTransformObjectChange()');
const changeEnd = html.indexOf('\nfunction finalizeTransformEdit()', changeStart);
assert.ok(changeStart >= 0 && changeEnd > changeStart, 'Furniture Author exposes the real transform update callback');

const placedRecord = { id:'item', surfaceId:'surface', scale:1, cameraRelativeDeadzone:false }; // One-size export for placed items.
const placedMesh = {
  position: { clone: () => ({ sub: () => ({ dot: () => 0 }) }) },
  rotation:{ x:0, y:0, z:0 },
  scale:{ x:1.5, y:0.75, z:1.0, setScalar(size) { this.x=this.y=this.z=size; } },
  userData:{}
}; // A one-axis drag initially produces a nonuniform Three.js object.
const primitivePart = {
  id:'part', kind:'box', transform:{ x:0,y:0,z:0,rx:0,ry:0,rz:0,sx:2,sy:3,sz:4 }
}; // Geometry owns the authored dimensions; object.scale contains drag multipliers.
const primitiveMesh = {
  position:{ x:0.2, y:0.6, z:0.4 },
  rotation:{ x:0, y:Math.PI/2, z:0 },
  scale:{ x:1.5, y:0.8, z:1.25 },
  userData:{ authoredDimensions:{ sx:2,sy:3,sz:4 } }
};
const objects = new Map([['part', primitiveMesh]]);
const previews = new Map([['item', placedMesh]]);
const changeContext = {
  state, transform, RAD:180/Math.PI, meshes:objects, itemPreviewMeshes:previews,
  selectedPart:() => state.selectedType==='part'?primitivePart:null,
  selectedPlacement:()=>state.selectedType==='placement'?placedRecord:null,
  getSurfaceWorldFrame:() => ({ center:{},u:{},v:{},normal:{} }),
  refreshSelectionUI:()=>{},updateLists:()=>{},rebuildItemPreviews:()=>{}
}; // Uses real callbacks without a browser, WebGL, or missing mobile console.
vm.createContext(changeContext);
vm.runInContext(html.slice(changeStart,changeEnd),changeContext,{filename:'furniture-author-object-change.js'});

state.selectedType='placement'; transform.mode='scale';
vm.runInContext('onTransformObjectChange()',changeContext);
assert.equal(placedRecord.scale, 1.0833, 'placed-item scale persists as one scalar');
assert.deepEqual([placedMesh.scale.x,placedMesh.scale.y,placedMesh.scale.z],[placedRecord.scale,placedRecord.scale,placedRecord.scale],
  'preview remains uniform throughout the drag, not just when pointer is released');

state.selectedType='part'; transform.mode='scale';
vm.runInContext('onTransformObjectChange()',changeContext);
assert.equal(primitivePart.transform.sx,3,'X scale edits the independent local X dimension');
assert.equal(primitivePart.transform.sy,2.4,'Y scale edits the independent local Y dimension');
assert.equal(primitivePart.transform.sz,5,'Z scale edits the independent local Z dimension');
assert.equal(primitivePart.transform.ry,90,'rotated part saves visible orientation in authored degrees');

console.log('Furniture gizmo axis-orientation regression passed.');
