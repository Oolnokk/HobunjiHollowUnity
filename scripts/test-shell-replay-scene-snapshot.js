#!/usr/bin/env node
'use strict';

// Executes the compositor's real candidate enumeration, material preparation,
// and shell exclusion helpers without requiring a GPU or browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/js/held-object-render-order.js'), 'utf8');

function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'found shipped section ' + start);
  return source.slice(a, b);
}

const helpers = new Function(
  'hasLayer', 'SHELL_LAYER', 'PNG_OCCLUDER_LAYER', 'forEachMaterial',
  'saveMaterialState', 'setSurfaceOcclusionDepthOnly', 'isProtectedCover', 'useSpriteOcclusionCutout',
  section('  function prepareNonGroundDepthMaterials(', '  function prepareCutoutDepthMaterials(') +
  section('  function hideNonXrayShellMeshes(', '  // Replays shell outlines for the same meshes') +
  '\nreturn { prepareNonGroundDepthMaterials, hideNonXrayShellMeshes, collectShellReplayCandidates };'
)(
  (object, layer) => !!(object.layers?.mask & (1 << layer)), 1, 4,
  (materials, callback) => (Array.isArray(materials) ? materials : [materials]).forEach(callback),
  (states, material) => {
    if (!states.has(material)) states.set(material, { colorWrite: material.colorWrite, depthWrite: material.depthWrite });
  },
  () => {}, () => false, () => {},
);

const opaque = { colorWrite: true, depthWrite: false, alphaTest: 0.4 };
const star = { colorWrite: true, depthWrite: false, alphaTest: 0 };
const xrayShell = { isMesh: true, layers: { mask: 1 << 1 | 1 << 4 }, material: opaque, visible: true, userData: {} };
const ordinaryShell = { isMesh: true, layers: { mask: 1 << 1 }, material: { colorWrite: true, depthWrite: true }, visible: true, userData: {} };
const skySprite = { isSprite: true, layers: { mask: 1 }, material: star, visible: true, userData: { hobunjiNoOutline: true } };
const hiddenShell = { isMesh: true, layers: { mask: 1 << 1 }, material: {}, visible: false };
let sceneWalks = 0; // Counts expensive traversals to verify multi-elevation replay reuses one enumeration.
const holder = { visible: true, children: [ordinaryShell] }; // Parent visibility can change in an onBeforeRender hook between grouped passes.
const scene = {
  visible: true,
  children: [xrayShell, holder, skySprite, hiddenShell],
  traverseVisible(callback) {
    sceneWalks++;
    function visit(node) {
      if (node.visible === false) return;
      callback(node);
      for (const child of node.children || []) visit(child);
    }
    visit(this);
  },
};
for (const child of scene.children) child.parent = scene;
ordinaryShell.parent = holder;

const candidates = helpers.collectShellReplayCandidates(scene);
assert.equal(sceneWalks, 1, 'collect visible candidates exactly once');
assert.deepEqual(candidates.depth, [xrayShell, ordinaryShell, skySprite],
  'depth snapshot includes visible meshes and excluded celestial sprites');
assert.deepEqual(candidates.shell, [xrayShell, ordinaryShell],
  'shell snapshot excludes hidden and non-shell objects');

const states = helpers.prepareNonGroundDepthMaterials(scene, candidates.depth);
assert.equal(sceneWalks, 1, 'depth material preparation reuses the snapshot without a tree walk');
assert.equal(opaque.colorWrite, false);
assert.equal(opaque.depthWrite, true, 'PNG cutouts still occlude during depth reconstruction');
assert.equal(star.colorWrite, false, 'celestial sprite colors do not leak into depth replays');
for (const [material, before] of states) Object.assign(material, before);

const hidden = helpers.hideNonXrayShellMeshes(scene, new Set([xrayShell]), candidates.shell);
assert.equal(sceneWalks, 1, 'shell masking reuses the same snapshot without traversing');
assert.equal(xrayShell.visible, true, 'active elevation shell remains visible');
assert.equal(ordinaryShell.visible, false, 'other elevation shells are excluded');
assert.equal(hiddenShell.visible, false, 'previously hidden meshes remain hidden');
for (const [mesh, wasVisible] of hidden) mesh.visible = wasVisible;

const fallbackStates = helpers.prepareNonGroundDepthMaterials(scene);
assert.equal(sceneWalks, 2, 'uncached callers still get the original live traversal');
for (const [material, before] of fallbackStates) Object.assign(material, before);
const fallbackHidden = helpers.hideNonXrayShellMeshes(scene, new Set([xrayShell]));
assert.equal(sceneWalks, 3, 'uncached shell callers still traverse live scene visibility');
for (const [mesh, wasVisible] of fallbackHidden) mesh.visible = wasVisible;

// A rendering hook can hide an entire actor group after the snapshot. The
// cached candidate list must then behave like a fresh traverseVisible, without
// writing to invisible actors' shared materials or hiding their shell planes.
holder.visible = false;
const hiddenByParent = helpers.prepareNonGroundDepthMaterials(scene, candidates.depth);
assert.equal(hiddenByParent.has(ordinaryShell.material), false,
  'hidden ancestor excludes stale depth candidates from material mutation');
const maskedUnderHiddenParent = helpers.hideNonXrayShellMeshes(scene, new Set([xrayShell]), candidates.shell);
assert.equal(maskedUnderHiddenParent.has(ordinaryShell), false,
  'hidden ancestor excludes stale shell candidates from per-group masking');
assert.equal(ordinaryShell.visible, true, 'hidden parent does not mutate child visible flag');
for (const [material, before] of hiddenByParent) Object.assign(material, before);
holder.visible = true;

// Changes to the individual mesh and removal from the scene must also be
// considered live between depth passes.
ordinaryShell.visible = false;
const hiddenSelf = helpers.prepareNonGroundDepthMaterials(scene, candidates.depth);
assert.equal(hiddenSelf.has(ordinaryShell.material), false, 'hidden mesh is skipped');
for (const [material, before] of hiddenSelf) Object.assign(material, before);
ordinaryShell.visible = true;
ordinaryShell.parent = null;
const detached = helpers.hideNonXrayShellMeshes(scene, new Set([xrayShell]), candidates.shell);
assert.equal(detached.has(ordinaryShell), false, 'detached mesh is skipped');
ordinaryShell.parent = holder;
assert.equal(sceneWalks, 3, 'visibility validation does not require any extra scene traversals');

const replay = section('  function replayShellOutlineXray(', '  function wrappedRender(');
assert.match(replay, /let replayCandidates = null;/,
  'shell candidate snapshot remains in scope through the final depth restore');
assert.match(replay, /replayCandidates = collectShellReplayCandidates\(scene\)/,
  'shell replay captures the scene after temporary culling is installed');
assert.equal((replay.match(/prepareNonGroundDepthMaterials\(scene, replayCandidates\.depth\)/g) || []).length, 2,
  'grouped depth pass and final depth restore both reuse that one candidate set');
assert.match(replay, /hideNonXrayShellMeshes\(scene, groupSet, replayCandidates\.shell\)/,
  'every elevation group uses cached shell candidates');

console.log('shell replay scene snapshot tests passed');
