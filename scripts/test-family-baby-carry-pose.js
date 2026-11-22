#!/usr/bin/env node
'use strict';
// Regression: one dimension-scaled pose source feeds gameplay and the furniture author.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const files = {
  profile: fs.readFileSync('docs/config/family-baby-carry-pose.js', 'utf8'),
  family: fs.readFileSync('docs/js/family-baby-burdens.js', 'utf8'),
  burden: fs.readFileSync('docs/js/shattercasks.js', 'utf8'),
  editor: fs.readFileSync('docs/tools/furniture-avatar-author/carryable-objects.js', 'utf8'),
  editorHtml: fs.readFileSync('docs/tools/furniture-avatar-author/index.html', 'utf8'),
  gameHtml: fs.readFileSync('docs/index.html', 'utf8'),
  hierarchy: fs.readFileSync('docs/js/xray-hierarchy.js', 'utf8'),
  compositor: fs.readFileSync('docs/js/held-object-render-order.js', 'utf8'),
};
const storage = new Map(); // Simulated browser overrides, independent of family/save data.
const browser = { localStorage: {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
} };
vm.runInNewContext(files.profile, { window: browser, console });
const profile = browser.FamilyBabyCarryPose;
assert(profile, 'baby grips have a central runtime config');
const sized = profile.forSize(.3, .4);
assert.equal(sized.handTargets.left.x, .3 * .4, 'left grip follows real portrait width');
assert.equal(sized.handTargets.right.x, -.3 * .4, 'right grip follows real portrait width');
assert.equal(sized.handTargets.left.z, .4 * .05, 'grip depth follows baby portrait height');
assert.equal(sized.billboardAnchor.position.z, .4 * -.48, 'held anchor follows baby portrait height');
assert.equal(sized.backCarry.rotation.y, 180, 'back stow pose retains the original orientation');
const exported = profile.toProfile(sized, .3, .4);
profile.save(exported);
assert.equal(profile.forSize(.6, .8).handTargets.left.x, .6 * .4, 'JSON round-trip remains dimension independent');
const carried = { billboardAnchor: { position: {}, rotation: {} },
  backCarry: { position: {}, rotation: {} },
  handTargets: { left: { rotation: {} }, right: { rotation: {} } } };
const originalSocket = carried.handTargets.left;
profile.applyTo(carried, .3, .4);
assert.equal(carried.handTargets.left, originalSocket, 'refresh does not replace a hand socket held by the grip solver');
profile.save({ held: { position: { x: Infinity, y: -100, z: 100 } } });
assert(Number.isFinite(profile.forSize(.3, .3).billboardAnchor.position.x), 'invalid imported grip values are sanitized');
profile.reset();
assert.equal(storage.size, 0, 'reset removes a device-local pose override');

const scriptOrder = files.gameHtml.indexOf('config/family-baby-carry-pose.js');
assert(scriptOrder > 0 && scriptOrder < files.gameHtml.indexOf('js/family-baby-burdens.js'),
  'game initializes the same pose module before creating a physical baby');
assert(files.editorHtml.includes('../../config/family-baby-carry-pose.js'),
  'furniture editor loads the exact same shared source');
assert(files.editor.includes("id=\"carryBabyEdit\"") && files.editor.includes('carryBabyApply')
  && files.editor.includes('carryBabyExport') && files.editor.includes('carryBabyImport'),
  'mobile furniture Carryables panel edits, applies and transfers baby grips');
assert(files.editor.includes('editingBaby?savedFurnitureCarry:state.carryable'),
  'exporting regular furniture during baby authoring preserves the furniture profile');
assert(files.family.includes('FamilyBabyCarryPose.applyTo(carryable, w, h)'),
  'baby rebuilds reuse the shared pose instead of restoring hardcoded coordinates');
assert(files.family.includes('hobunjiFamilyBabyPhysicalCarry'),
  'both baby portrait paths identify themselves as physical baby art');
assert(files.hierarchy.includes("'baby.carrierForeground'") && files.compositor.includes("'baby.carrierForeground'"),
  'the editable x-ray hierarchy and renderer both know the baby-only rule');

// Exercise the real carried-material reconciliation methods without booting the world.
const start = files.burden.indexOf('  function restoreCarriedMaterial(');
const end = files.burden.indexOf('  function carryDeps()', start);
assert(start >= 0 && end > start, 'extract the current live carry renderer, not a duplicate algorithm');
const liveMethods = files.burden.slice(start, end);
const makeHarness = new Function('window', `
  const backXray=new Map(), heldRenderOrders=new Map(), frontXray=new Map(),
    skinnedRearOverlays=new Map(), rearHeadwearXray=new Map();
  const CARRIED_VESSEL_RENDER_ORDER=1.4, HELD_BABY_FOREGROUND_ORDER=30, STOWED_BURDEN_RENDER_ORDER=2.15;
  let held=null, backCarried=null;
  const carryDeps=()=>({playerMesh:{}}),backCarryRoot=()=>({});
  const syncCarrierRearPortrait=()=>{}, restoreRearHeadwear=()=>{}, removeSkinnedRearOverlay=()=>{};
  ${liveMethods}
  return {setHeldRearXray,setHeld:value=>held=value,setBack:value=>backCarried=value,snapshots:heldRenderOrders};
`);
const xray = { XrayHierarchy: { get: () => 'on' } };
const harness = makeHarness(xray);
const material = { depthWrite: false, depthTest: true, transparent: false };
const mesh = { isMesh: true, userData: {}, material, renderOrder: 3 };
const baby = { kind: 'familyBaby', meshColliders: [mesh], group: { traverse() {} } };
harness.setHeld(baby); harness.setHeldRearXray(baby);
assert.equal(mesh.renderOrder, 30, 'held infant paints after the normal 28-ranked pants mesh');
assert.equal(material.depthWrite, true, 'held infant alpha writes physical depth to protect the later pants overlay');
assert.equal(material.depthTest, true, 'real world obstacles still occlude a held infant');
assert.equal(material.transparent, true, 'infant retains its alpha-cutout front silhouette');
xray.XrayHierarchy.get = () => 'off';
harness.setHeldRearXray(baby);
assert.equal(mesh.renderOrder, 1.4, 'turning the baby rule off uses original physical carry order');
assert.equal(material.depthWrite, false, 'normal held burden depth rule is restored when opted out');
xray.XrayHierarchy.get = () => 'on';
harness.setHeld(null); harness.setBack(baby); harness.setHeldRearXray(baby);
assert.equal(mesh.renderOrder, 2.15, 'back-stowing preserves the ordinary owner-back sandwich');
assert.equal(material.depthWrite, false, 'back-stowed infant does not stamp foreground depth');
harness.setBack(null); harness.setHeldRearXray(null);
assert.equal(mesh.renderOrder, 3, 'dropping restores the original render order');
assert.equal(material.transparent, false, 'dropping restores the original material state');
assert.equal(harness.snapshots.size, 0, 'no stale held geometry remains registered');
console.log('PASS baby carry profile, editor transfer, carrier x-ray, back stow and restoration');
