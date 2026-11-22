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
const close = (a,b,label) => assert(Math.abs(a-b)<1e-9, label+' ('+a+' vs '+b+')');
// Real source portrait dimensions and detected spine/neck pivots define grip origins.
const data={
  visualCentroidLocalY:.12,portraitVerticalPlacementRatio:.8,
  neckRig:{spinePosteriorY:-.12,spineBase:{x:.03},neckLocal:{x:.02,y:.14,z:.015},
    skinnedPlane:{position:{z:.02}}},
};
const anchors=profile.anchorsForAvatar(data,.3,.4);
close(anchors.posterior.y,.20,'posterior uses real infant spine pivot and portrait placement');
close(anchors.posterior.x,0,'posterior starts at pinned spline node 0, not the offset neck base');
const pinned=profile.anchorsForAvatar({visualCentroidLocalY:.12,neckRig:{
  spinePosteriorY:-.19,spineBase:{x:.08},splineNodes:[{position:{x:0,y:-.12,z:0}}],
  neckLocal:{x:.02,y:.14,z:0},
}},.3,.4);
close(pinned.posterior.y,.20,'actual spine root bone wins over a stale posterior height hint');
close(pinned.posterior.x,0,'posterior root remains centered even when shoulder/neck base shifts laterally');
close(anchors.neck.x,.02,'right grip uses head-turn pivot X rather than shoulder midpoint');
close(anchors.neck.y,.46,'neck uses unscaled head-turn pivot, not top of painted alpha');
const sized=profile.forSize(.3,.4,anchors);
const D=profile.defaultProfile, GL=D.grips.left.offset, GR=D.grips.right.offset; // Authored defaults, not hardcoded numbers.
close(sized.handTargets.left.x,anchors.posterior.x+GL.x,'left grip is relative to baby posterior');
close(sized.handTargets.left.y,anchors.posterior.y+GL.y,'left grip Y is unscaled anatomy-relative distance');
close(sized.handTargets.left.z,anchors.posterior.z+GL.z,'left grip depth is unscaled by baby height');
close(sized.handTargets.right.x,anchors.neck.x+GR.x,'right grip is relative to baby neck');
close(sized.handTargets.right.y,anchors.neck.y+GR.y,'right grip Y is relative to neck joint');
close(sized.billboardAnchor.position.y,.4*D.held.position.y,'baby mount pivot still scales with portrait');
close(sized.backCarry.rotation.z,D.back.rotation.z,'back stow pose retains authored orientation');
assert.equal(sized.elbows.left,null,'legacy shoulder fallback remains when elbow is not explicitly authored');

// Readout-only portrait coordinates are separate from saved world-local offsets.
const point={x:-.18,y:.16,z:-.06};
const uv=profile.pointToPortrait(point,.6,.4);
close(uv.u,.2,'readout U');
close(uv.v,.6,'readout V');
close(uv.depth,-.15,'readout depth');
const world=profile.pointFromPortrait(uv,.6,.4);
for(const axis of ['x','y','z'])close(world[axis],point[axis],'portrait projection roundtrip '+axis);

const savedProfile=profile.toProfile(sized,.3,.4,anchors);
assert.equal(savedProfile.grips.left.anchor,'posterior','left grip declares real anatomical basis');
assert.equal(savedProfile.grips.right.anchor,'neck','right grip declares real anatomical basis');
close(savedProfile.grips.left.offset.y,GL.y,'saved left Y is direct distance from posterior');
close(savedProfile.grips.right.offset.y,GR.y,'saved right Y is direct distance from neck');
// New randomized infant: different portrait size/pivots, SAME raw local offsets.
const newAnchors=profile.anchorsForAvatar({
  visualCentroidLocalY:.045,neckRig:{spinePosteriorY:-.07,neckLocal:{x:-.01,y:.055}},
},.2,.25);
const rerolled=profile.forSizeFrom(savedProfile,.2,.25,newAnchors);
close(rerolled.handTargets.left.x-newAnchors.posterior.x,GL.x,'random baby preserves left posterior offset regardless of size');
close(rerolled.handTargets.left.y-newAnchors.posterior.y,GL.y,'random baby preserves left posterior height offset');
close(rerolled.handTargets.right.x-newAnchors.neck.x,GR.x,'random baby preserves right neck offset');
close(rerolled.handTargets.right.y-newAnchors.neck.y,GR.y,'random baby preserves right neck height offset');

// Compatibility: previously saved percentage-based baby grips are still accepted.
const legacy={grips:{left:{position:{x:.4,y:.5,z:.05}},
  right:{position:{x:-.4,y:.5,z:.05}}}};
const migrated=profile.forSizeFrom(legacy,.3,.4,anchors);
close(migrated.handTargets.left.x,.3*.4,'legacy left portrait-X stays in place');
close(migrated.handTargets.left.y,.4*.5,'legacy left portrait-Y stays in place');
close(migrated.handTargets.right.z,.4*.05,'legacy right portrait-Z stays in place');
const migratedProfile=profile.toProfile(migrated,.3,.4,anchors);
assert.equal(migratedProfile.grips.left.anchor,'posterior','legacy export upgrades to new explicit anchor');
assert.equal(Object.hasOwn(migratedProfile.grips.left,'position'),false,'migrated profile no longer saves portrait percentages');

const independent=profile.forSize(.6,.4);
independent.handTargets.left.x=-.18;independent.handTargets.left.y=.16;
independent.elbows.left={x:.075,y:-.12,z:.2};
const oldAnchors=profile.anchorsForAvatar({},.6,.4);
const authored=profile.toProfile(independent,.6,.4,oldAnchors);
const preservedSocket=independent.handTargets.left; // Live GLB hand rig can retain this object reference.
profile.applyFrom(independent,authored,.3,.2,newAnchors);
assert.equal(independent.handTargets.left,preservedSocket,'baby grip recalibration retains live socket object identity');
close(independent.handTargets.left.x-newAnchors.posterior.x,-.18-oldAnchors.posterior.x,
  'resizing reuses EXACT saved posterior-local X, not a portrait fraction');
close(independent.handTargets.left.y-newAnchors.posterior.y,.16-oldAnchors.posterior.y,
  'resizing reuses EXACT saved posterior-local Y');
close(independent.elbows.left.y,-.12,'authored elbow remains shoulder-relative across baby sizes');

profile.save(savedProfile);
close(profile.forSize(.6,.8,newAnchors).handTargets.left.x-newAnchors.posterior.x,GL.x,
  'saved anatomy-relative grip persists independently of child portrait width');
const carried={billboardAnchor:{position:{},rotation:{}},backCarry:{position:{},rotation:{}},
  handTargets:{left:{rotation:{}},right:{rotation:{}}}};
const originalSocket=carried.handTargets.left;
profile.applyTo(carried,.3,.4,anchors);
assert.equal(carried.handTargets.left,originalSocket,'live refresh preserves the exact hand socket');
profile.save({held:{position:{x:Infinity,y:-100,z:100}}});
assert(Number.isFinite(profile.forSize(.3,.3).billboardAnchor.position.x),'invalid imported numbers are sanitized');
profile.reset();
assert.equal(storage.size,0,'reset removes a device-local pose override');

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
assert(/FamilyBabyCarryPose\.applyTo\([\s\S]*?group\.userData\.familyBabyGripAnchors/.test(files.family),
  'baby rebuilds feed the shared carry solver REAL infant posterior and neck anchors');
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
