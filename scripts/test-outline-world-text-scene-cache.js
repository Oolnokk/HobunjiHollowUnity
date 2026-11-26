#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Exercises the shipped text-overlay registry, not a reimplementation.
const fs = require('node:fs'); // Reads the one production owner before constructing a fake Three.js scene.
const source = fs.readFileSync('docs/js/outline-render-performance.js', 'utf8'); // Actual browser module.
const begin = source.indexOf('  function isWorldTextOverlayMaterial(');
const end = source.indexOf('  function reserveWorldTextOverlayLayer(', begin);
assert(begin >= 0 && end > begin, 'world-text cache and structure epoch helpers remain together');
const extracted = source.slice(begin, end); // Contains candidate predicate, add/remove hooks and cache lookup.

class Object3D {
  constructor() { this.isObject3D = true; this.parent = null; this.children = []; this.visible = true; }
  add(...children) {
    for (const child of children) {
      child.parent?.remove(child);
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }
  remove(...children) {
    for (const child of children) {
      const at = this.children.indexOf(child);
      if (at >= 0) { this.children.splice(at, 1); child.parent = null; }
    }
    return this;
  }
  clear() { this.remove(...this.children); return this; }
  traverse(fn) {
    fn(this);
    for (const child of this.children) child.traverse(fn);
  }
}
class Scene extends Object3D {
  constructor() { super(); this.isScene = true; this.fullWalks = 0; }
  traverse(fn) { this.fullWalks++; super.traverse(fn); }
}
const THREE = { Object3D, Scene }; // Production wrappers install on both classes.
let clock = 1000; // Deterministic fake performance clock.
const api = new Function('THREE', 'performance', 'WORLD_TEXT_RENDER_ORDER_MIN', 'window',
  extracted + '\nreturn {collectWorldTextOverlayEntries, sceneStructureEpoch, stats: () => ({worldTextFullScans,worldTextIncrementalRoots,worldTextCacheHits})};'
)(THREE, { now: () => clock }, 1200, {}); // Initial scene collection is a full traversal.
function popup() {
  const p = new Object3D();
  p.isMesh = true;
  p.layers = { mask: 1 };
  p.renderOrder = 1250;
  p.material = { map: { isCanvasTexture: true }, depthTest: false, depthWrite: false };
  return p;
}
const scene = new Scene();
for (let i = 0; i < 1000; i++) scene.add(new Object3D()); // Dense environment with no world text.
assert.equal(api.collectWorldTextOverlayEntries(scene).length, 0);
assert.equal(scene.fullWalks, 1, 'first base render discovers popup candidates');
assert.equal(api.collectWorldTextOverlayEntries(scene).length, 0);
assert.equal(scene.fullWalks, 1, 'steady frame reuses the scene cache');
assert(api.stats().worldTextCacheHits >= 1);

const vfx = new Object3D(); // Unrelated new geometry used to invalidate the old full-scene cache.
scene.add(vfx);
assert.equal(api.collectWorldTextOverlayEntries(scene).length, 0);
assert.equal(scene.fullWalks, 1, 'incidental scene.add does not rescan all 1000 nodes');
assert(api.stats().worldTextIncrementalRoots > 0, 'newly attached root is evaluated');

const group = new Object3D();
const text = popup();
group.add(text);
scene.add(group);
assert.deepEqual(api.collectWorldTextOverlayEntries(scene).map(entry => entry.object), [text],
  'a new nested popup appears without waiting for the safety rescan');
assert.equal(scene.fullWalks, 1, 'nested popup discovery inspects only the attached group');

const delayed = new Object3D();
delayed.isMesh = true;
delayed.layers = { mask: 1 };
scene.add(delayed);
delayed.renderOrder = 1300; // Runtime may stamp a material/tag after adding the mesh.
delayed.material = { map: { isCanvasTexture: true }, depthTest: false, depthWrite: false };
assert.equal(api.collectWorldTextOverlayEntries(scene).length, 2, 'post-add tags are read when the pending root is processed');

group.visible = false;
assert.deepEqual(api.collectWorldTextOverlayEntries(scene).map(entry => entry.object), [delayed],
  'hidden parent suppresses popup without unregistering it');
group.visible = true;
scene.visible = false;
assert.deepEqual(api.collectWorldTextOverlayEntries(scene), [],
  'hiding the scene itself suppresses every cached popup');
scene.visible = true;
assert(api.collectWorldTextOverlayEntries(scene).some(entry => entry.object === delayed),
  'restoring scene visibility reveals the unchanged popup immediately');

const otherScene = new Scene();
assert.equal(api.collectWorldTextOverlayEntries(otherScene).length, 0, 'destination scene has already been scanned');
const destinationWalks = otherScene.fullWalks; // Checks that a moved group is processed incrementally.
otherScene.add(group);
assert.deepEqual(api.collectWorldTextOverlayEntries(scene).map(entry => entry.object), [delayed],
  'a moved popup never renders in the old scene');
assert.equal(scene.fullWalks, 1, 'moving/removing a group does not require a full scan');
assert.deepEqual(api.collectWorldTextOverlayEntries(otherScene).map(entry => entry.object), [text],
  'a moved popup appears immediately in a previously cached destination scene');
assert.equal(otherScene.fullWalks, destinationWalks, 'moving a group never needs a full destination-scene rescan');

scene.remove(delayed);
assert.equal(api.collectWorldTextOverlayEntries(scene).length, 0, 'detached popup is pruned');
scene.add(delayed);
assert.equal(api.collectWorldTextOverlayEntries(scene).length, 1, 'reattachment is detected immediately');

const late = new Object3D();
late.isMesh = true;
late.layers = { mask: 1 };
scene.add(late);
api.collectWorldTextOverlayEntries(scene); // Candidate is not yet eligible.
late.renderOrder = 1300;
late.material = { map: { isCanvasTexture: true }, depthTest: false, depthWrite: false };
assert.equal(api.collectWorldTextOverlayEntries(scene).length, 1, 'no stale candidate is accepted before full safety scan');
clock += 1100;
assert.equal(api.collectWorldTextOverlayEntries(scene).length, 2, 'periodic rescan finds an edited mesh that changed long after add');
assert.equal(scene.fullWalks, 2, 'safety rescan is bounded to roughly one per second');
assert(api.sceneStructureEpoch(scene) > 0, 'structure epoch stays available to score-actor caching');

// Hundreds of nested add() calls during a live scene build must not rescan
// the entire subtree once for its parent AND again for each new child.
const beforeBulkRootScans = api.stats().worldTextIncrementalRoots; // Used to prove one scan regardless of nested attachment count.
const beforeBulkSceneWalks = scene.fullWalks; // Used to ensure bulk builds never trigger a full-scene traversal.
const vegetationRoot = new Object3D(); // Representative root attached before its descendants are generated.
scene.add(vegetationRoot);
for (let i = 0; i < 600; i++) {
  const vegetationBranch = new Object3D(); // Used as the parent of a newly generated leaf or popup.
  vegetationRoot.add(vegetationBranch);
  vegetationBranch.add(new Object3D());
}
const nestedPopup = popup(); // Ensures the skipped child scans don't miss deeply nested world text.
vegetationRoot.children[599].add(nestedPopup);
assert(api.collectWorldTextOverlayEntries(scene).some(entry => entry.object === nestedPopup),
  'new world text nested under a queued parent is discovered immediately');
assert.equal(api.stats().worldTextIncrementalRoots, beforeBulkRootScans + 1,
  'all 1200 descendant add events collapse to one subtree scan');
assert.equal(scene.fullWalks, beforeBulkSceneWalks, 'bulk attachment does not trigger a full-scene search');

// Clearing a scene drops cached overlay references and reattaching does not
// strand them in a permanently removed state.
const clearScene = new Scene(); // Independent scene prevents bulk-tree traversal from hiding this edge case.
const clearPopup = popup(); // World text reused after leaving and re-entering a scene.
clearScene.add(clearPopup);
assert.equal(api.collectWorldTextOverlayEntries(clearScene).length, 1);
clearScene.clear();
assert.equal(api.collectWorldTextOverlayEntries(clearScene).length, 0, 'cleared text no longer renders');
clearScene.add(clearPopup);
assert.equal(api.collectWorldTextOverlayEntries(clearScene).length, 1, 'reattached text immediately renders after clear');
console.log('Outline world-text scene cache: additions, moves, removal, hidden parent, late tags, bulk builds and rescan passed');
