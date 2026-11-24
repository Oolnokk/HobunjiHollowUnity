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
assert.equal(D.held.pivot,'posterior','default cradle mounts at the infant posterior');
close(sized.billboardAnchor.position.y,anchors.posterior.y+.4*D.held.position.y,'held mount = real posterior + portrait-scaled offset');
assert.equal(D.back.pivot,'neck','back stow pivots at the neck so the head peeks over the shoulder at any baby size');
close(sized.backCarry.position.y,anchors.neck.y+.4*D.back.position.y,'back mount = real neck pivot + portrait-scaled offset');
// Posterior clamp: a spine root far below the painted bust (no pants on a carried baby) is lifted
// to within 7% of the bust's lower edge; a root already near the edge is untouched.
const deepRoot=profile.anchorsForAvatar({visualCentroidLocalY:.085,neckRig:{splineNodes:[{position:{x:0,y:-.29,z:0}}],neckLocal:{x:0,y:-.12,z:0}}},.34,.34);
close(deepRoot.posterior.y,.085-.34*.07,'deep spine root clamps to just under the painted bust');
const nearRoot=profile.anchorsForAvatar({visualCentroidLocalY:.1267,neckRig:{splineNodes:[{position:{x:0,y:-.1299,z:0}}],neckLocal:{x:0,y:-.0374,z:0}}},.2304,.2304);
close(nearRoot.posterior.y,.1267+.1152-.1299,'Mao\'ao newborn posterior (6% under the bust) is unchanged');
// A species whose posterior sits BELOW the portrait origin (Mashtzarr newborn) still mounts at its bottom.
const lowAnchors={posterior:{x:0,y:-.035,z:0},neck:{x:0,y:.135,z:0}};
close(profile.forSize(.34,.34,lowAnchors).billboardAnchor.position.y,-.035+.34*D.held.position.y,'mount follows a low posterior, not a fixed portrait fraction');
// Profiles saved before pivots existed keep their portrait-normalized mount meaning.
const legacyPose=profile.forSizeFrom({held:{position:{x:0,y:.06,z:-.48}}},.3,.4,anchors);
assert.equal(legacyPose.billboardAnchor.pivot,'portrait','pivot-less saved pose is treated as legacy portrait space');
close(legacyPose.billboardAnchor.position.z,.4*-.48,'legacy mount still scales with portrait');
close(legacyPose.billboardAnchor.position.y,.4*.06,'legacy mount ignores the anatomy pivot');
// Editor round-trip: applying then saving keeps the pivot and the posterior-relative offset.
const tripped=profile.toProfile(profile.forSizeFrom({held:{pivot:'posterior',position:{x:.1,y:-.2,z:.05}}},.3,.4,anchors),.3,.4,anchors);
assert.equal(tripped.held.pivot,'posterior','round-trip keeps the posterior pivot');
close(tripped.held.position.y,-.2,'round-trip keeps the posterior-relative mount offset');
const converted=profile.toProfile(legacyPose,.3,.4,anchors);
assert.equal(converted.held.pivot,'posterior','saving a legacy pose converts it to the anatomical pivot');
const reapplied=profile.forSizeFrom(converted,.3,.4,anchors).billboardAnchor.position;
for(const axis of ['x','y','z'])close(reapplied[axis],legacyPose.billboardAnchor.position[axis],'conversion keeps the exact mount for this baby ('+axis+')');
// Automatic clean-up: the retired v1 key and any pivot-less stored pose are deleted on load.
{
  const store=new Map([['hobunji.familyBabyCarryPose.v1','{"held":{"position":{"y":.06}}}'],
    ['hobunji.familyBabyCarryPose.v3','{"held":{"position":{"y":0.06}},"back":{"pivot":"neck"}}']]);
  const w2={localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
  vm.runInNewContext(files.profile,{window:w2,console});
  assert.equal(store.size,0,'retired and legacy stored poses are removed');
  assert.deepEqual(JSON.parse(JSON.stringify(w2.FamilyBabyCarryPose.storageStatus())),{key:'hobunji.familyBabyCarryPose.v3',clearedRetired:1,rejectedStored:true,migratedStored:false},'mobile status reports the clean-up');
  assert.equal(w2.FamilyBabyCarryPose.snapshot().held.pivot,'posterior','defaults are used after clean-up');
  const keep=new Map([['hobunji.familyBabyCarryPose.v3',JSON.stringify({...profile.defaultProfile,held:{...profile.defaultProfile.held,posteriorOffset:{x:.2,y:.1,z:.1}}})]]);
  const w3={localStorage:{getItem:k=>keep.has(k)?keep.get(k):null,setItem:(k,v)=>keep.set(k,v),removeItem:k=>keep.delete(k)}};
  vm.runInNewContext(files.profile,{window:w3,console});
  assert.equal(w3.FamilyBabyCarryPose.snapshot().held.posteriorOffset.x,.2,'an anatomical stored pose is kept');
  const previousDefaults={...profile.defaultProfile,
    held:{...profile.defaultProfile.held,rotation:{...profile.defaultProfile.held.rotation,y:-10.92}},
    back:{...profile.defaultProfile.back,posteriorOffset:{...profile.defaultProfile.back.posteriorOffset,x:.0581}},
    grips:{...profile.defaultProfile.grips,left:{...profile.defaultProfile.grips.left,offset:{x:.05,y:-.02,z:.03}}}}; // Old v3 defaults plus an authored left grip.
  const legacyV3=new Map([['hobunji.familyBabyCarryPose.v3',JSON.stringify(previousDefaults)]]); // Device profile before the default rotation/recenter.
  const w4={localStorage:{getItem:k=>legacyV3.get(k)||null,
    setItem:(k,v)=>legacyV3.set(k,v),removeItem:k=>legacyV3.delete(k)}};
  vm.runInNewContext(files.profile,{window:w4,console});
  close(w4.FamilyBabyCarryPose.snapshot().held.rotation.y,D.held.rotation.y,'old untouched yaw migrates to the midpoint');
  close(w4.FamilyBabyCarryPose.snapshot().back.posteriorOffset.x,D.back.posteriorOffset.x,'old shoulder offset migrates to center');
  close(w4.FamilyBabyCarryPose.snapshot().grips.left.offset.x,.05,'stored custom hand grip survives migration');
  assert.equal(w4.FamilyBabyCarryPose.storageStatus().migratedStored,true,'migration visible in mobile diagnostics');
  assert.equal(JSON.parse(legacyV3.get('hobunji.familyBabyCarryPose.v3')).held.rotation.y,D.held.rotation.y,
    'revised pose is persisted once rather than re-migrated on each load');
  // Devices that loaded the intermediate face-up release must migrate too.
  const faceUpV3={...profile.defaultProfile,held:{...profile.defaultProfile.held,
    rotation:{...profile.defaultProfile.held.rotation,y:-90}}}; // Last release's stored default.
  const faceUpStore=new Map([['hobunji.familyBabyCarryPose.v3',JSON.stringify(faceUpV3)]]); // Simulated device storage.
  const faceUpWindow=()=>({localStorage:{getItem:k=>faceUpStore.get(k)||null,
    setItem:(k,v)=>faceUpStore.set(k,v),removeItem:k=>faceUpStore.delete(k)}}); // Fresh page load.
  const wFaceUp=faceUpWindow(); // First load after the midpoint update.
  vm.runInNewContext(files.profile,{window:wFaceUp,console});
  close(wFaceUp.FamilyBabyCarryPose.snapshot().held.rotation.y,-50.46,'face-up default migrates to the midpoint');
  close(wFaceUp.FamilyBabyCarryPose.snapshot().back.posteriorOffset.x,-.025,'centered stow is unchanged');
  assert.equal(wFaceUp.FamilyBabyCarryPose.storageStatus().migratedStored,true);
  const wReload=faceUpWindow(); // Reload verifies persisted migration is idempotent.
  vm.runInNewContext(files.profile,{window:wReload,console});
  close(wReload.FamilyBabyCarryPose.snapshot().held.rotation.y,-50.46,'midpoint remains after reload');
  assert.equal(wReload.FamilyBabyCarryPose.storageStatus().migratedStored,false);
  const customV3={...previousDefaults,
    held:{...previousDefaults.held,rotation:{...previousDefaults.held.rotation,y:-50}},
    back:{...previousDefaults.back,posteriorOffset:{...previousDefaults.back.posteriorOffset,x:.01}}}; // User-authored deviations from both old defaults.
  const customStore=new Map([['hobunji.familyBabyCarryPose.v3',JSON.stringify(customV3)]]); // Test that user authoring outranks defaults.
  const w5={localStorage:{getItem:k=>customStore.get(k)||null,
    setItem:(k,v)=>customStore.set(k,v),removeItem:k=>customStore.delete(k)}};
  vm.runInNewContext(files.profile,{window:w5,console});
  close(w5.FamilyBabyCarryPose.snapshot().held.rotation.y,-50,'authored held yaw is not overwritten');
  close(w5.FamilyBabyCarryPose.snapshot().back.posteriorOffset.x,.01,'authored back offset is not overwritten');
  assert.equal(w5.FamilyBabyCarryPose.storageStatus().migratedStored,false,'no unnecessary write for an authored pose');
  const bad=new Map([['hobunji.familyBabyCarryPose.v3','{not json']]);
  vm.runInNewContext(files.profile,{window:{localStorage:{getItem:k=>bad.has(k)?bad.get(k):null,setItem:()=>{},removeItem:k=>bad.delete(k)}},console});
  assert.equal(bad.size,0,'corrupt stored pose JSON is removed');
}
// The Furniture Author rebuilds every carryable through normalized(); it must keep the baby pivot
// (else an editor save silently downgrades to legacy portrait space) and add none to furniture.
{
  const editor=fs.readFileSync('docs/tools/furniture-avatar-author/carryable-objects.js','utf8');
  const start=editor.indexOf('  function normalized(value) {'),end=editor.indexOf('  state.carryable=normalized(state.carryable);',start);
  assert(start>0&&end>start,'extract the editor carryable normalizer');
  const normalizedFn=new Function(editor.slice(start,end)+'\nreturn normalized;')();
  const baby=normalizedFn(profile.forSize(.3,.4,anchors));
  assert.equal(baby.billboardAnchor.pivot,'posterior','editor keeps the cradle pivot');
  assert.equal(baby.backCarry.pivot,'neck','editor keeps the back-stow pivot');
  assert.equal(profile.toProfile(baby,.3,.4,anchors).back.pivot,'neck','editor save keeps anatomical pivots');
  const furniture=normalizedFn({enabled:true,billboardAnchor:{position:{x:0,y:.5,z:0}}});
  assert.equal('pivot' in furniture.billboardAnchor||'pivot' in furniture.backCarry,false,'furniture exports gain no pivot field');
}
close(sized.backCarry.rotation.z,D.back.rotation.z,'back stow pose retains authored orientation');
// Shattercasks inverts the XYZ anchor rotation. Its transformed +Z face normal must point
// diagonally upward and forward in arms, while the body remains cradled across the torso.
const radians = axis => D.held.rotation[axis]*Math.PI/180; // The live solver consumes these degrees.
const faceUpY = Math.sin(radians('z'))*Math.sin(radians('y'))*Math.cos(radians('x'))
  + Math.cos(radians('z'))*Math.sin(radians('x')); // Y of inverse XYZ rotation applied to +Z.
const faceForwardZ = Math.cos(radians('y'))*Math.cos(radians('x')); // Z of the same transformed face normal.
close(D.held.rotation.y,(-10.92-90)/2,'held yaw is halfway between both previous defaults');
assert(faceUpY>.65&&faceUpY<.8&&faceForwardZ>.55&&faceForwardZ<.75,
  'default held infant looks diagonally upward and forward');
assert(D.back.posteriorOffset.x<0&&D.back.posteriorOffset.x>-.04,
  'default back-stowed infant has a small spine-centering offset, not the old shoulder offset');
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
const firstRevision=carried._backCarryRevision; // Revision belongs to this baby carryable, not a global renderer toggle.
assert(firstRevision>0,'initial authoring of an empty back mount creates a first pose revision');
profile.applyTo(carried,.3,.4,anchors);
assert.equal(carried._backCarryRevision,firstRevision,'identical family sync does not invalidate the body mount');
const altered=profile.snapshot();altered.back.posteriorOffset.z-=.07;
profile.save(altered);
profile.applyTo(carried,.3,.4,anchors);
assert.equal(carried._backCarryRevision,firstRevision+1,'editing the back stow increments the revision exactly once');
profile.applyTo(carried,.3,.4,anchors);
assert.equal(carried._backCarryRevision,firstRevision+1,'stable edited profile does not repeatedly invalidate the pose');
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
  const stowedDepthMeshes=new Set(); // Required by the live stowed-material reconciliation.
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
