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

function check(type, kind, mode, space) {
  state.selectedType = type;
  selected = kind ? { kind } : null;
  transform.mode = mode;
  vm.runInContext('configureTransformAxesForSelection()', context);
  assert.equal(transform.space, space, `${type} ${mode} gizmo must use ${space} coordinates`);
  assert.equal(transform.showX, true);
  assert.equal(transform.showY, true);
  assert.equal(transform.showZ, true);
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

check('part', 'liquidSurface', 'rotate', 'local');
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
console.log('Furniture gizmo axis-orientation regression passed.');
