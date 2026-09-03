const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const anatomy = fs.readFileSync('docs/config/procedural-anatomy-profiles.js', 'utf8');
const solver = fs.readFileSync('docs/js/leg-bones.js', 'utf8');
const author = fs.readFileSync('docs/js/procedural-limb-pose-author.js', 'utf8');
const manual = fs.readFileSync('docs/js/procedural-limb-manual-author.js', 'utf8');
const bootstrap = fs.readFileSync('docs/js/procedural-limb-facing-preserver.js', 'utf8');
const adapter = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8');

for (const [label, source] of [['anatomy', anatomy], ['solver', solver], ['author', author], ['manual', manual], ['bootstrap', bootstrap], ['adapter', adapter]]) {
  assert.doesNotThrow(() => new Function(source), `${label} source must parse as JavaScript`);
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { const length = this.length(); return length > 0 ? this.multiplyScalar(1 / length) : this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) { this.x = a.y*b.z-a.z*b.y; this.y = a.z*b.x-a.x*b.z; this.z = a.x*b.y-a.y*b.x; return this; }
  applyQuaternion() { return this; }
}
class Quaternion { clone(){return new Quaternion();} setFromUnitVectors(){return this;} setFromEuler(){return this;} invert(){return this;} multiply(){return this;} normalize(){return this;} }
class Euler { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} }
const THREE = { Vector3, Quaternion, Euler, MathUtils: { degToRad: value => value*Math.PI/180 } };
const solverContext = { window: {} };
vm.createContext(solverContext); vm.runInContext(solver, solverContext);
const LegBones = solverContext.window.LegBones;
assert.equal(typeof LegBones.solveTwoBoneLeg, 'function');
assert.equal(typeof LegBones.solveFixedTwoBoneChain, 'function');
assert.equal(typeof LegBones.solveSubdividedChain, 'function');

function distance(a,b){ return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z); }
const root = new Vector3(0,0,0), target = new Vector3(0,-1,0);
const straight = LegBones.solveSubdividedChain(THREE,{root,target,jointFraction:.6});
assert.equal(straight.mode,'target-span-subdivision');
assert(Math.abs(straight.joint.y + .6) < 1e-9, 'automatic arm subdivision must begin on the shoulder→hand span');
assert(Math.abs(straight.upperLength - .6) < 1e-9, 'upper arm is the requested share of the original shoulder→hand span before bend');
assert(Math.abs(straight.lowerLength - .4) < 1e-9, 'forearm is the remainder of the original shoulder→hand span before bend');
assert(Math.abs(distance(straight.solvedTarget,target)) < 1e-9, 'target-span solver never moves the hand target');
const explicitJoint = new Vector3(.25,-.45,.1);
const manualSolve = LegBones.solveSubdividedChain(THREE,{root,target,joint:explicitJoint,jointFraction:.5});
assert.equal(manualSolve.mode,'explicit-joint-subdivision');
assert(Math.abs(distance(manualSolve.joint,explicitJoint)) < 1e-9, 'manual elbow/knee handle is honored exactly');
assert(Math.abs(distance(manualSolve.solvedTarget,target)) < 1e-9, 'manual endpoint is honored exactly');

for (const field of ['upperArmFraction','upperArmRadiusHeightFraction','forearmRadiusHeightFraction','thighRadiusHeightFraction','calfRadiusHeightFraction','torsoRadiusHeightFraction']) assert(anatomy.includes(field));
assert(!anatomy.includes("'rakakoan::male'"));
assert(!anatomy.includes("'ghoul::male'"));
assert(anatomy.includes('HOBUNJI_TRANSFORM_SPECIES_ALIASES'));

for (const pose of ['normal','manual','crossLegged','kneel','sideLeanLeft','sideLeanRight','lieSideLeft','lieSideRight','lieBack','carryUpright']) assert(author.includes(pose), `missing pose ${pose}`);
assert(author.includes("poseId: 'normal'"), 'extension must initialize in true off mode');
assert(author.includes("if (runtime.poseId === 'normal') return"), 'normal frames must not own the avatar');
assert(author.includes('LegBones.solveSubdividedChain'), 'arms/manual limbs must use target-span subdivision solver');
assert(author.includes("armLengthSource: 'live shoulder → hand target span, subdivided before elbow bend'"), 'arm length must come from live shoulder→hand span, not standing free-hand length');
assert(!author.includes("armLengthSource: profile ? 'attachment-rig shoulder → posterior/free-hand anchor'"), 'old free-hand-derived arm-length rule must be gone');
assert(!author.includes('runtime.anatomy.upperArmLength'), 'automatic arms must not be forced through a precomputed upper-arm length');
assert(!author.includes('runtime.anatomy.forearmLength'), 'automatic arms must not be forced through a precomputed forearm length');
assert(author.includes('solveManualArm'), 'manual arms share the subdivision solver with an exact elbow');
assert(author.includes('solveManualLeg'), 'manual legs accept an exact knee');
assert(author.includes('releaseManualToPhysics'), 'manual mode can release its ownership before physics');
assert(author.includes("document.getElementById('footingPanel')"), 'release-to-physics opens the existing physics workspace rather than creating another physics system');
assert(author.includes('physics is not turned on automatically'), 'manual mode must leave physics opt-in');
assert(author.includes('hobunji-procedural-limb-pose-library.v3'), 'export schema must describe manual IK revision');
assert(author.includes("'https://esm.sh/three@0.128.0'"), 'fallback Three version must match the shared renderer/main');
assert(author.includes("findNamedObject(root, [`${side}_hip`"), 'manual/ground legs reuse the real procedural hierarchy');
assert(author.includes('chain.calf.position.set(0, -solved.upperLength, 0)'));
assert(author.includes('chain.foot.position.set(0, -solved.lowerLength, 0)'));
assert(!author.includes('poseRoot.scale.set(1, 1, 1)'));
assert(!author.includes('poseRoot.rotation.set('));

assert(manual.includes('TransformControls'), 'manual mode uses the editor-compatible translate gizmo');
for (const kind of ['hand','elbow','foot','knee']) assert(manual.includes(`'${kind}'`), `manual mode missing ${kind} handle`);
assert(manual.includes('releaseToPhysics'), 'manual helper can relinquish IK ownership');
assert(manual.includes("ownership: 'manual handles → IK; physics off'"), 'debug must clearly show physics is off during manual authoring');
assert(!manual.includes('new THREE.WebGLRenderer'), 'manual IK must reuse the editor renderer');
assert(!manual.includes('new THREE.Scene'), 'manual IK must reuse the editor scene');
assert(manual.includes('getScene?.()') && manual.includes('getCamera?.()') && manual.includes('getRenderer?.()'), 'manual helper consumes the shared backdrop renderer API');

assert(bootstrap.includes('dormantAuthorSentinel'));
assert(!bootstrap.includes('buildSinglePlaneAvatarModel ='));
assert(adapter.includes('await loadLimbFacingPreserver()'));

console.log('procedural limb pose author v3: PASS');
