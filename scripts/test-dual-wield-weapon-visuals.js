'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Executes the production duplicate builder below.
const dual = fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8');
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const driver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8');
const held = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
const runtimeEntries = ['docs/index.html', 'docs/tools/animation-author/index.html', 'docs/tools/attack-animation-editor/index.html']; // All entry points must request the current shared hand bootstrap.
assert.match(dual, /const DUPLICATE_Z_GAP = 0\.15/, 'dual weapons use the requested halved 0.15 total plane-normal gap');
assert.match(dual, /const MAIN_HAND_LAG_MS = 45/, 'main-hand duplicate keeps the requested small transform lag');
assert.match(dual, /plane\.add\(offRoot\)[\s\S]*plane\.add\(mainRoot\)/, 'both visible weapon roots are children of the hidden original plane');
assert.match(dual, /record\.material\.visible = false/, 'original weapon material is hidden without hiding child duplicates');
assert.match(dual, /duplicate\.position\.set\?\.\(0, 0, side === 'main' \? -HALF_Z_SEPARATION : HALF_Z_SEPARATION\)/, 'only visible child weapons receive the equal/opposite local sprite-plane-normal offsets');
assert.doesNotMatch(dual, /offsetWorld\.set\(0, 0, -HALF_Z_SEPARATION\)/, 'main root no longer carries the sandwich offset');
assert.match(dual, /desiredWorldPosition\.copy\(basePosition\)/, 'main root replays only the delayed source transform');
assert.match(dual, /delayedParentPose[\s\S]*MAIN_HAND_LAG_MS/, 'main root replays delayed translation + rotation without inheriting sprite scale twice');
assert.match(dual, /current\.plane\.updateWorldMatrix\?\.\(true, false\)[\s\S]*current\.offRoot\.updateMatrixWorld\?\.\(true\)[\s\S]*current\.mainRoot\.updateMatrixWorld\?\.\(true\)/, 'duplicate world matrices are current before either hand reads its weapon socket');
assert.match(dual, /root\.scale\.set\(1, 1, 1\)/, 'dual roots stay unit-scale so the hidden parent is the sole sprite-scale authority');
assert.match(dual, /idleStancePoses/, 'dual presentation consumes explicit main/offhand idle stance poses');
assert.doesNotMatch(dual, /requestAnimationFrame/, 'dual-wield visuals must share the scheduler/hand-sync owners instead of starting a second frame loop');
assert.match(dual, /transformSocketForHand/, 'dual visual layer exposes per-hand socket transforms');
assert.match(dual, /hobunjiDualWieldDuplicate: true, hobunjiHeldObjectPlane: true/, 'dual-wield weapon copies inherit the held-overlay layer, so they must register as held planes (front-portrait mask) instead of drawing unmasked over the holder');
assert.match(dual, /const weapon = side === 'right' \? current\.mainMesh : current\.offMesh/, 'each hand resolves its socket from its visible child weapon');
assert.match(dual, /planeLocalPosition = socketFrame\.position\.clone\(\)\.applyMatrix4\(inversePlaneWorld\)[\s\S]*planeLocalPosition\.clone\(\)\.applyMatrix4\(weapon\.matrixWorld\)/, 'child grip position is reconstructed in original-plane local space and resolved through the visible child weapon matrix');
assert.match(dual, /mirrorQuaternionAcrossLocalX[\s\S]*source\.x, -source\.y, -source\.z, source\.w/, 'offhand grip orientation mirrors the proper frame across child-local X instead of losing the reflection in quaternion decomposition');
assert.match(dual, /mirroredChild = side === 'left'[\s\S]*mirrorQuaternionAcrossLocalX\(planeLocalQ/, 'the offhand receives the flipped grip frame independently of the forward-facing sprite');
assert.match(dual, /duplicate\.scale\.set\?\.\(1, 1, 1\)/, 'both weapon copies preserve the source blade facing; the idle offhand pose owns its rotation');
assert.match(driver, /const primarySocket = toolSocketWorld\(record, toolHolder, primaryGrip(?:, visualBasis)?\)/, 'the original fixed 1H socket remains the canonical grip before Dual Wield remapping');
assert.match(driver, /owners\.right = freeHand\?\.influence > 0\.0001 \? 'avatar-local-free-right-hand' : 'primary-grip'[\s\S]*if \(dualWield\) owners\.right = 'dual-wield-main-grip'/, 'free pluck poses are reported separately while ordinary grips retain primary-grip ownership before Dual Wield refinement');
assert.match(driver, /transformSocketForHand\?\.\(record, 'right'/, 'right hand follows the lagged main duplicate');
assert.match(driver, /transformSocketForHand\?\.\(record, 'left'/, 'left hand follows the offhand duplicate');
assert.match(driver, /offhandBaseSocket = toolSocketWorld\(record, toolHolder, offhandGrip(?:, visualBasis)?\)/, 'the offhand copy resolves its own grip frame');
assert.match(driver, /offhandGrip = toolGrips\.offhandPrimaryGripForTool\?\.\(toolKey, gripContext, scaleIdentity\) \|\| primaryGrip/, 'that frame is the authored 1H grip without the main hand\'s palm-side offset, falling back to the shared grip');
assert.match(grips, /dualWieldStateForTool/, 'shared grip state exposes Dual Wield as a melee hand mode');
assert.match(grips, /defaultTwoHand = sequence === 'attack'/, 'ordinary melee attacks default to 2H');
assert(held.includes('dual-wield-weapon-visuals.js'), 'held-action bootstrap loads dual-wield visuals');
const heldActionTokens = runtimeEntries.map(path => {
  const html = fs.readFileSync(path, 'utf8');
  return html.match(/held-action-animations\.js\?v=([A-Za-z0-9_-]+)/)?.[1] || null;
});
assert(heldActionTokens.every(token => token && token === heldActionTokens[0]), 'game and authoring pages must use the same fresh held-action bootstrap token');
assert.match(editor, /loadEditorAnimationGrip\?\.\(\{ actionId: currentActionId, toolKey: preset\.toolKey, sequence: preset\.sequence \|\| 'attack', style: preset\.style, still: preset\.still, poses: anim\.poses \}\)/, 'switching Actions reloads per-attack hand-mode metadata with its action and tool identity');
console.log('dual wield: transform-following roots, child-local grip frames with proper offhand reflection, child-only sandwich offsets, main-hand lag, default 2H, and independent editor flags PASS');

// Execute the mesh builder: a negative offhand X scale reverses an asymmetric axe blade.
class DuplicateMesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
    this.scale = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
    this.quaternion = { identity() {} };
    this.layers = { mask: 1 };
  }
}
const builderSource = dual.slice(dual.indexOf('  function makeDuplicateMesh('), dual.indexOf('  function makeRoot(')); // Isolates the unchanged production factory dependencies.
const fixtureGlobal = {}; // The source geometry owner is optional, but must be honored when installed.
const builder = vm.runInNewContext(`(${builderSource.trim()})`, {
  HALF_Z_SEPARATION: 0.075,
  global: fixtureGlobal,
  cloneOwnedMaterial: material => ({ ...material }),
}); // Calls the actual factory for both anatomical sides.
const sourcePlane = new DuplicateMesh({ axeBlade: true }, {}); // Shared source geometry must retain its authored handedness.
for (const side of ['main', 'off']) {
  const copy = builder(sourcePlane, side); // The visible weapon tested against the same blade geometry.
  assert.equal(copy.geometry, sourcePlane.geometry);
  assert.equal(copy.scale.x, 1, `${side} axe blade must face the authored direction`);
  assert.equal(copy.scale.y, 1);
  assert.equal(copy.scale.z, 1);
  assert.equal(copy.position.z, side === 'main' ? -0.075 : 0.075);
}

// A temporary compressed buffer must not become a duplicate's permanent source.
const originalGeometry = {original: true};
fixtureGlobal.HeldGroundPose = {originalGeometryFor: geometry => {assert.equal(geometry, sourcePlane.geometry);return originalGeometry;}};
assert.equal(builder(sourcePlane, 'main').geometry, originalGeometry);
assert.equal(builder(sourcePlane, 'off').geometry, originalGeometry);
delete fixtureGlobal.HeldGroundPose;

class GripQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
  clone() { return new GripQuaternion(this.x, this.y, this.z, this.w); }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this; }
  normalize() { return this; }
  multiply(q) {
    const { x, y, z, w } = this; // Preserves the input rotation during quaternion composition.
    return this.set(w*q.x + x*q.w + y*q.z - z*q.y, w*q.y - x*q.z + y*q.w + z*q.x,
      w*q.z + x*q.y - y*q.x + z*q.w, w*q.w - x*q.x - y*q.y - z*q.z);
  }
}
class GripPoint {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  clone() { return new GripPoint(this.x, this.y, this.z); }
  applyMatrix4(matrix) { this.z += matrix.z || 0; return this; }
}
const gripMatrix = z => ({ z, clone() { return gripMatrix(this.z); }, invert() { this.z *= -1; return this; } }); // Translation-only fixture isolates the hand direction from the weapon position.
const gripWeapon = z => ({ matrixWorld: gripMatrix(z), quaternion: new GripQuaternion(), scale: { x: 1 }, updateMatrixWorld() {} }); // Both visible sprites retain the corrected forward facing.
const gripState = { influence: 1, idleBlend: 0, invisible: false, plane: { matrixWorld: gripMatrix(0), quaternion: new GripQuaternion() }, mainMesh: gripWeapon(-0.075), offMesh: gripWeapon(0.075) }; // Supplies a live dual pair to the production socket resolver.
const mirrorStart = dual.indexOf('  function mirrorQuaternionAcrossLocalX('); // Bounds of the production direction conversion.
const mirrorEnd = dual.indexOf('  function currentPlanePose(', mirrorStart);
const socketStart = dual.indexOf('  function transformSocketForHand('); // Bounds of the production per-hand dispatch.
const socketEnd = dual.indexOf('  function resetPoseHistory(', socketStart);
let syncCalls = 0; // Lean sync: both hands of one rig solve share one sync.
const socketScope = {
  syncNow: () => { syncCalls++; return gripState; },
  leanSync: true, stats: { syncs: 0, solveReuses: 0 },
  state: null,
  ACTIVE_EPSILON: 0.0001,
  hierarchyWorldQuaternion: (node, target) => target.set(node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w),
  DUPLICATE_Z_GAP: 0.15,
  MAIN_HAND_LAG_MS: 45,
};
const socketResolver = vm.runInNewContext(`${dual.slice(mirrorStart, mirrorEnd)}\n(${dual.slice(socketStart, socketEnd).trim()})`, socketScope); // Exercises the real branch selecting the offhand frame even though neither weapon is reflected.
const authoredSocket = { position: new GripPoint(-0.04, -0.04, -0.1), quaternion: new GripQuaternion(0.5, -0.5, 0.5, 0.5) }; // A normalized nontrivial grip makes yaw/roll reversal observable.
const rightGrip = socketResolver({}, 'right', authoredSocket); // Main hand keeps the authored direction.
const leftGrip = socketResolver({}, 'left', authoredSocket); // Offhand flips its grip while remaining on its own visible weapon.
assert.deepEqual([rightGrip.quaternion.x, rightGrip.quaternion.y, rightGrip.quaternion.z, rightGrip.quaternion.w], [0.5, -0.5, 0.5, 0.5]);
assert.deepEqual([leftGrip.quaternion.x, leftGrip.quaternion.y, leftGrip.quaternion.z, leftGrip.quaternion.w], [0.5, -0.5, -0.5, -0.5], 'visible offhand corrects the half-turn about its local grip X axis');
assert.equal(leftGrip.dualWield.mirroredGripFrame, true);
assert.equal(rightGrip.dualWield.mirroredGripFrame, false);
assert.equal(leftGrip.position.x, authoredSocket.position.x);
assert(Math.abs(leftGrip.position.z - (authoredSocket.position.z + 0.075)) < 1e-9);
assert.equal(authoredSocket.quaternion.y, -0.5, 'offhand conversion must not mutate the shared authored grip');
gripState.invisible = true;
const invisibleGrip = socketResolver({}, 'left', authoredSocket);
assert.deepEqual([invisibleGrip.quaternion.x, invisibleGrip.quaternion.y, invisibleGrip.quaternion.z, invisibleGrip.quaternion.w], [0.5, 0.5, -0.5, 0.5], 'invisible offhand idle keeps its original orientation');
gripState.invisible = false;
// Lean sync: one rig solve (procedural-hand-frame-driver.js passes the same object for both hands) syncs once,
// and both hands still resolve exactly the frames they resolve with a sync each.
{
  const record = {}, solve = {};
  syncCalls = 0;
  const right = socketResolver(record, 'right', authoredSocket, solve), left = socketResolver(record, 'left', authoredSocket, solve);
  assert.equal(syncCalls, 1, 'both hands of one solve share one sync');
  assert.equal(socketScope.stats.solveReuses, 1);
  assert.deepEqual([right.quaternion.x, right.quaternion.y, right.quaternion.z, right.quaternion.w], [rightGrip.quaternion.x, rightGrip.quaternion.y, rightGrip.quaternion.z, rightGrip.quaternion.w]);
  assert.deepEqual([left.quaternion.x, left.quaternion.y, left.quaternion.z, left.quaternion.w], [leftGrip.quaternion.x, leftGrip.quaternion.y, leftGrip.quaternion.z, leftGrip.quaternion.w]);
  socketResolver(record, 'right', authoredSocket, {}); // A new solve syncs again.
  socketResolver({}, 'left', authoredSocket, solve); // A different actor never reuses another's sync.
  assert.equal(syncCalls, 3);
  socketScope.leanSync = false; syncCalls = 0;
  const fresh = {};
  socketResolver(record, 'right', authoredSocket, fresh); socketResolver(record, 'left', authoredSocket, fresh);
  assert.equal(syncCalls, 2, 'full sync (Settings off): one sync per hand, as before');
  socketScope.leanSync = true;
}
// Execute the real anatomical reflection helper with the default calibrated
// right/left bases, arbitrary grip rotation, and a yawed portrait.
{
  const mirrorPaired = vm.runInNewContext(`${dual.slice(mirrorStart, dual.indexOf('  function bakedWorldQuaternion(', mirrorStart))}\n(${dual.slice(dual.indexOf('  function mirrorPairedWristOrientation('), dual.indexOf('  function transformSocketForHand(')).trim()})`, {});
  const q = (x=0,y=0,z=0,w=1) => new GripQuaternion(x,y,z,w);
  const yaw = q(0, Math.sin(.37), 0, Math.cos(.37));
  const halfTurn = q(0,1,0,0);
  const rightBasis = q(), leftBasis = halfTurn;
  const rig = { copyGripWristBasis(side, out, calibrationSide) {
    if (side === 'left') assert.equal(calibrationSide, 'right');
    return out.copy(side === 'right' ? rightBasis : leftBasis);
  }};
  const record = { rig };
  const state = { mirrorOffhand: true, invisible: false, frameScratch: {
    bodyQuaternion: yaw, mirrorWristLocal: q(), mirrorWristInverse: q(),
    mirrorWristRightBasis: q(), mirrorWristLeftBasis: q(),
  }};
  const solve = { dualWieldRecord: record, dualWieldState: state };
  const raw = yaw.clone().multiply(q(.5,.5,-.5,.5));
  const out = q();
  assert.equal(mirrorPaired(record, solve, raw, out), true);
  // The resulting visible hand frame, expressed in portrait space, must
  // preserve proximal Y (and Z) under X reflection, not reverse it.
  const actual = yaw.clone().invert().multiply(out).multiply(leftBasis);
  const source = yaw.clone().invert().multiply(raw).multiply(rightBasis);
  const expected = q(source.x, -source.y, -source.z, source.w);
  const dot = actual.x*expected.x + actual.y*expected.y + actual.z*expected.z + actual.w*expected.w;
  assert(Math.abs(Math.abs(dot)-1)<1e-10, 'paired visible hand orientation must be the anatomical reflection');
  state.mirrorOffhand = false;
  const original = out.clone();
  assert.equal(mirrorPaired(record, solve, raw, out), false, 'independently authored offhand keeps its legacy grip');
  assert.deepEqual(out, original);
  state.mirrorOffhand = true; state.invisible = true;
  assert.equal(mirrorPaired(record, solve, raw, out), false, 'invisible idle offhand is unaffected');
}
assert.match(driver, /mirrorPairedWristOrientation\?\.\(record, dualSolve, primary\.quaternion, secondary\.quaternion\)/, 'the shared frame driver reflects the authored wrist before applying offhand shoulder constraints');

// The holder bake skipping the copy roots is executed in test-dual-wield-state-consistency.js.

const runtimeDeps = { toolHolder: { children: [] }, playerMesh: {} }; // Mirrors the real hand-runtime injection, which omits toolMeshMap.
const runtimeContext = vm.runInNewContext(`(${dual.slice(dual.indexOf('  function currentContext('), dual.indexOf('  function currentDualState(')).trim()})`, {
  inAttackEditor: () => false,
  global: { ProceduralHandAttachments: { gameDeps: runtimeDeps }, WeaponToolStances: { getRuntimeState: () => ({ activeSlot: 'weapon' }) } },
}); // Executes production context discovery rather than supplying a pre-resolved context.
const liveWeapon = { visible: true, userData: { toolPlane: { isObject3D: true, visible: true } } }; // Represents the equipped dagger group under the scene-level holder.
const hiddenWeapon = { visible: false, userData: { toolPlane: { isObject3D: true, visible: true } } }; // Ensures hidden equipment cannot displace the equipped visual.
runtimeDeps.toolHolder.children = [{ userData: {} }, hiddenWeapon, liveWeapon];
assert.equal(runtimeContext().visual, liveWeapon, 'runtime dual visuals must find the equipped weapon without a mesh map');
assert.equal(runtimeContext().plane, liveWeapon.userData.toolPlane);
assert.equal(runtimeContext().holder, runtimeDeps.toolHolder);
liveWeapon.userData.toolPlane.visible = false;
assert.equal(runtimeContext().visual, liveWeapon, 'held-object base rendering temporarily hides the plane while hand sentinels still need its duplicates');
liveWeapon.userData.toolPlane.visible = true;
runtimeDeps.toolHolder.children = [hiddenWeapon];
assert.equal(runtimeContext().visual, null, 'hidden/holstered equipment does not start duplicates');
runtimeDeps.toolMeshMap = { weapon: liveWeapon };
assert.equal(runtimeContext().visual, liveWeapon, 'existing object-map integrations remain supported');
runtimeDeps.toolMeshMap = new Map([['weapon', liveWeapon]]);
assert.equal(runtimeContext().visual, liveWeapon, 'existing Map integrations remain supported');
delete runtimeDeps.toolMeshMap;
const replacementWeapon = { visible: true, userData: { toolPlane: { isObject3D: true } } }; // Simulates swapping the dagger mesh without reconstructing the injected dependencies.
runtimeDeps.toolHolder.children = [replacementWeapon];
assert.equal(runtimeContext().visual, replacementWeapon, 'equipment swaps resolve the new attached weapon');

// Horizontal movement lean must not rotate the neutral offhand's mirror plane.
const uprightYaw = vm.runInNewContext('('+dual.slice(dual.indexOf('  function uprightMirrorYaw('),dual.indexOf('  function mirrorSolvedWeapon(')).trim()+')');
const angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
for(const yaw of [-Math.PI,-2,-.3,0,.7,2,Math.PI]){
  for(const lean of [-.6,-.2,0,.2,.6]){
    for(const direction of [0,.8,Math.PI/2,2.4]){
      const qYaw=new GripQuaternion(0,Math.sin(yaw/2),0,Math.cos(yaw/2));
      const qLean=new GripQuaternion(Math.cos(direction)*Math.sin(lean/2),0,Math.sin(direction)*Math.sin(lean/2),Math.cos(lean/2));
      const result=uprightYaw(qLean.multiply(qYaw));
      assert(Math.abs(angleDiff(result,yaw))<1e-9,'world-space pitch/roll cannot change the neutral mirror yaw');
      const nx=Math.cos(result),nz=-Math.sin(result);
      const main={x:.8,y:.15,z:.2},pivot={x:.1,y:1,z:.4};
      const side=(main.x-pivot.x)*nx+(main.z-pivot.z)*nz;
      const off={x:main.x-2*side*nx,y:main.y,z:main.z-2*side*nz};
      assert.equal(off.y,main.y,'vertical reflection preserves the source ground clearance');
    }
  }
}
assert.match(dual,/const upright=current\.source==='runtime'&&current\.idleBlend>=1-ACTIVE_EPSILON/,'editor and authored attack poses retain their original mirror frame');
assert.match(dual,/s\.bodyPosition\.addScaledVector\(s\.bodyRight\.set\(e\[4\],e\[5\],e\[6\]\),posterior\)/,'mirror passes through the same posterior pivot as the movement lean');
