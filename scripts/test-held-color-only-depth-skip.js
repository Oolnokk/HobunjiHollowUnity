#!/usr/bin/env node
'use strict';

// Executes held-object-render-order.js's colour-only VFX skip: visible
// descendants of held gear that write neither depth nor stencil (weapon
// enchantment motes) are hidden only while a colourless depth submission
// draws, and everything else that could change depth is left alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/held-object-render-order.js'), 'utf8');
function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing section ${startMarker}`);
  return source.slice(start, end);
}

// Minimal scene graph with three.js-like traverseVisible.
const objectProto = { onBeforeRender() {} };
function node(name, props = {}) {
  const object = { name, visible: true, children: [], parent: null, onBeforeRender: objectProto.onBeforeRender, ...props };
  object.traverseVisible = function (visit) {
    if (!this.visible) return;
    visit(this);
    for (const child of this.children) child.traverseVisible(visit);
  };
  return object;
}
function add(parent, child) { child.parent = parent; parent.children.push(child); return child; }
const sprite = (name, material) => node(name, { isSprite: true, material });
const mesh = (name, material, extra = {}) => node(name, { isMesh: true, material, ...extra });
const colorOnly = () => ({ depthWrite: false, stencilWrite: false, alphaTest: 0 });

const scene = node('scene', { isScene: true });
const weapon = add(scene, mesh('weapon', { depthWrite: true }));
const emitter = add(weapon, node('weapon_enchantment_metal_particles'));
const motes = [0, 1, 2].map(i => add(emitter, sprite('mote_' + i, colorOnly())));
const parkedMote = add(emitter, sprite('parked', colorOnly())); parkedMote.visible = false;
const duplicate = add(weapon, mesh('dual_wield_copy', colorOnly())); // Registered gear: its own depth rules apply.
const depthChild = add(weapon, mesh('depth_child', { depthWrite: true }));
const cutout = add(weapon, mesh('cutout', { depthWrite: false, stencilWrite: false, alphaTest: 0.5 }));
const hooked = add(weapon, sprite('hooked', colorOnly())); hooked.onBeforeRender = () => {};
const stencilWriter = add(weapon, sprite('stencil', { depthWrite: false, stencilWrite: true }));
const pngPlane = add(weapon, mesh('png_plane', colorOnly()));
const multi = add(weapon, mesh('multi_ok', [colorOnly(), colorOnly()]));
const multiMixed = add(weapon, mesh('multi_mixed', [colorOnly(), { depthWrite: true }]));
const worldSprite = add(scene, sprite('world_rain', colorOnly())); // Not under held gear: out of scope.

const registry = members => ({ has: object => members.has(object) });
const heldMembers = new Set([weapon, duplicate]);
const dependency = {
  objectProto,
  heldRegistry: registry(heldMembers),
  waterOccludedRegistry: registry(new Set()),
  pngDepthRegistry: registry(new Set([pngPlane])),
  protectedCoverRegistry: registry(new Set()),
  tintCoverRegistry: registry(new Set()),
  hasLayer: () => false,
  PNG_OCCLUDER_LAYER: 7,
  isProtectedCover: () => false,
  collectVisible: (reg, target) => (reg === dependency.heldRegistry && target === scene ? [weapon] : []),
  hideObjects(objects) { const states = new Map(); for (const o of objects) { if (!o || states.has(o)) continue; states.set(o, o.visible); o.visible = false; } return states; },
  restoreVisibility(states) { for (const [o, v] of states) o.visible = v; },
};

const runtime = new Function('d', [
  'const {objectProto,heldRegistry,waterOccludedRegistry,pngDepthRegistry,protectedCoverRegistry,tintCoverRegistry,hasLayer,PNG_OCCLUDER_LAYER,isProtectedCover,collectVisible,hideObjects,restoreVisibility}=d;',
  section('  function materialLeavesDepthAndStencil(', '  function isAutoDepthReplayInert('),
  section('  // Colour-only VFX in colourless depth submissions.', '  function replayFrustumIntersects('),
  'return { hideColorOnlyHeldVfx, setEnabled: v => { colorOnlyDepthSkipEnabled = v; }, counts: () => ({ colorOnlyDepthSkips }) };',
].join('\n'))(dependency);

const skippable = [...motes, multi];
const untouched = [duplicate, depthChild, cutout, hooked, stencilWriter, pngPlane, multiMixed, worldSprite, weapon];
const visibleNow = list => list.map(o => o.visible);

// 1. Direct hide/restore.
const hidden = runtime.hideColorOnlyHeldVfx(scene);
assert.deepEqual([...hidden.keys()].map(o => o.name).sort(), skippable.map(o => o.name).sort(), 'only colour-only descendants of held gear');
assert.ok(skippable.every(o => o.visible === false));
assert.ok(untouched.every(o => o.visible === true), 'depth/stencil writers, gear, cutouts, hooked and non-held objects stay drawn');
assert.equal(parkedMote.visible, false);
dependency.restoreVisibility(hidden);
assert.ok(skippable.every(o => o.visible === true), 'restored');
assert.equal(parkedMote.visible, false, 'an already-hidden mote is never revealed');
assert.equal(runtime.counts().colorOnlyDepthSkips, skippable.length);

// 2. A/B switch off: nothing is hidden.
runtime.setEnabled(false);
const disabledHide = runtime.hideColorOnlyHeldVfx(scene);
assert.ok(!disabledHide || disabledHide.size === 0, 'switch off: unchanged behaviour');
assert.ok(skippable.every(o => o.visible === true), 'switch off: every mote stays drawn');
runtime.setEnabled(true);

// 3. Held replay call sites hide only inside colour-locked submissions.
const held = section('  function replaySelectiveHeldOverlay(', '  function isShellOutlinePass(');
assert.match(held, /if \(canLockColorMask\) colorOnlyHidden = hideColorOnlyHeldVfx\(scene\);/, 'depth rebuild: only when the colour mask is locked');
assert.match(held, /colorBuffer\.setLocked\(true\);\s*let gearColorOnly = null;[\s\S]{0,200}gearColorOnly = hideColorOnlyHeldVfx\(scene\);/, 'gear-depth recovery: after the colour lock');
assert.match(source, /setColorOnlyDepthSkipEnabled: value => \{ colorOnlyDepthSkipEnabled = value !== false; return colorOnlyDepthSkipEnabled; \}/);

console.log('held colour-only depth skip: hides only no-op VFX during colourless submissions, restores on success and failure');
