const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const anatomy = fs.readFileSync('docs/config/procedural-anatomy-profiles.js', 'utf8');
const solver = fs.readFileSync('docs/js/leg-bones.js', 'utf8');
const author = fs.readFileSync('docs/js/procedural-limb-pose-author.js', 'utf8');
const bootstrap = fs.readFileSync('docs/js/procedural-limb-facing-preserver.js', 'utf8');
const adapter = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8');

// Compile every changed JavaScript source so malformed edits fail before the
// string/integration assertions below.
for (const [label, source] of [['anatomy', anatomy], ['solver', solver], ['author', author], ['bootstrap', bootstrap], ['adapter', adapter]]) {
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
  crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; }
  applyQuaternion() { return this; }
}

class Quaternion {
  clone() { return new Quaternion(); }
  setFromUnitVectors() { return this; }
  setFromEuler() { return this; }
  invert() { return this; }
  multiply() { return this; }
}

class Euler {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}

const THREE = { Vector3, Quaternion, Euler, MathUtils: { degToRad: value => value * Math.PI / 180 } };
const solverContext = { window: {} };
vm.createContext(solverContext);
vm.runInContext(solver, solverContext);
const LegBones = solverContext.window.LegBones;
assert.strictEqual(typeof LegBones.solveTwoBoneLeg, 'function', 'legacy gait solver must remain exported');
assert.strictEqual(typeof LegBones.solveFixedTwoBoneChain, 'function', 'fixed-length anatomical solver must be exported');

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

const reachable = LegBones.solveFixedTwoBoneChain(THREE, {
  root: new Vector3(0, 0, 0),
  target: new Vector3(0.7, -0.6, 0.2),
  upperLength: 0.65,
  lowerLength: 0.55,
  pole: new Vector3(0.5, 0.2, 0.8),
});
assert(reachable.reachable, 'ordinary target should be reachable');
assert(Math.abs(distance(new Vector3(0, 0, 0), reachable.joint) - 0.65) < 1e-6, 'fixed solver must preserve upper segment length');
assert(Math.abs(distance(reachable.joint, reachable.solvedTarget) - 0.55) < 1e-6, 'fixed solver must preserve lower segment length');

const tooFar = LegBones.solveFixedTwoBoneChain(THREE, {
  root: new Vector3(0, 0, 0),
  target: new Vector3(0, 0, 50),
  upperLength: 0.6,
  lowerLength: 0.4,
  pole: new Vector3(1, 0, 0),
});
assert(!tooFar.reachable, 'far target should report unreachable rather than stretch anatomy');
assert(tooFar.solvedDistance <= 1.0 + 1e-6, 'unreachable target must clamp to fixed maximum reach');
assert(Math.abs(distance(new Vector3(0, 0, 0), tooFar.joint) - 0.6) < 1e-6, 'far clamp must still preserve upper length');
assert(Math.abs(distance(tooFar.joint, tooFar.solvedTarget) - 0.4) < 1e-6, 'far clamp must still preserve lower length');

for (const field of [
  'upperArmFraction',
  'upperArmRadiusHeightFraction',
  'forearmRadiusHeightFraction',
  'thighRadiusHeightFraction',
  'calfRadiusHeightFraction',
  'torsoRadiusHeightFraction',
]) assert(anatomy.includes(field), `species anatomy profile is missing ${field}`);
assert(!anatomy.includes("'rakakoan::male'"), 'Rakakoan anatomy must stay live-linked to Kenkari instead of copying numbers');
assert(!anatomy.includes("'ghoul::male'"), 'Ghoul anatomy must stay live-linked to Mao-ao instead of copying numbers');
assert(anatomy.includes('HOBUNJI_TRANSFORM_SPECIES_ALIASES'), 'anatomy resolver must consume the shared transform alias table');

const anatomyContext = { window: { HOBUNJI_TRANSFORM_SPECIES_ALIASES: { rakakoan: 'kenkari', ghoul: 'mao-ao' } } };
vm.createContext(anatomyContext);
vm.runInContext(anatomy, anatomyContext);
const anatomyApi = anatomyContext.window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES;
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(anatomyApi.resolve('ghoul', 'female'))),
  JSON.parse(JSON.stringify(anatomyApi.resolve('mao-ao', 'female'))),
  'Ghoul must resolve the live Mao-ao anatomy profile',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(anatomyApi.resolve('rakakoan', 'male'))),
  JSON.parse(JSON.stringify(anatomyApi.resolve('kenkari', 'male'))),
  'Rakakoan must resolve the live Kenkari anatomy profile',
);

for (const pose of ['normal', 'crossLegged', 'kneel', 'sideLeanLeft', 'sideLeanRight', 'lieSideLeft', 'lieSideRight', 'lieBack', 'carryUpright']) {
  assert(author.includes(pose), `Ground / Carry author is missing pose ${pose}`);
}
for (const contract of [
  'HOBUNJI_ATTACHMENT_RIG_PROFILES',
  'leftHandShoulder',
  'rightHandShoulder',
  'armLengthHeightPercentOffset',
  'LegBones.solveFixedTwoBoneChain',
  'ProceduralHandAttachments',
  'placeHandWorld',
  'hobunji-procedural-limb-pose-library.v2',
  'existing hip → thigh → calf → foot hierarchy',
]) assert(author.includes(contract), `Ground / Carry author is missing integration contract: ${contract}`);

assert(author.includes("poseId: 'normal'"), 'Ground / Carry must initialize in true no-ownership Normal mode');
assert(author.includes("if (runtime.poseId === 'normal') return"), 'Normal animation frames must return before writing avatar state');
assert(author.includes("loadScript('js/leg-bones.js?v="), 'pose author must ensure its fixed solver itself instead of depending on bootstrap side effects');
assert(author.includes('captureBaseline()'), 'ground poses must capture the existing animator transform before taking ownership');
assert(author.includes('restoreBaseline()'), 'ground poses must restore the exact existing animator transform when released');
assert(author.includes('runtime.baseline?.standingHipX?.[side]'), 'ground pose hip targets must stay pinned to the pre-pose standing stance rather than feeding back from moved hips');
assert(!author.includes('poseRoot.scale.set(1, 1, 1)'), 'Ground / Carry must never erase species/gender scale');
assert(!author.includes('poseRoot.rotation.set('), 'Ground / Carry must not zero/replace legacy yaw with Euler writes');
assert(author.includes("findNamedObject(root, [`${side}_hip`"), 'Ground / Carry must discover the real procedural hip hierarchy recursively');
assert(author.includes('chain.calf.position.set(0, -solved.upperLength, 0)'), 'ground IK must drive the existing calf pivot using runtime leg-chain format');
assert(author.includes('chain.foot.position.set(0, -solved.lowerLength, 0)'), 'ground IK must keep the existing real foot on the solved calf endpoint');
assert(author.includes("legLengthSource: 'runtime posterior → procedural-foot contact'"), 'ground leg length must match the runtime seated/standing anatomy rule');
assert(author.includes("ownership: runtime.poseId === 'carryUpright' ? 'hands/object only; legacy body + gait authoritative'"), 'mobile debug must expose which system owns body/gait');
assert(author.includes('restoreMovementInputs()'), 'leaving carry must restore movement settings changed by the temporary carry preset');

// The legacy filename now provides only a bounded explicit opt-in bootstrap.
assert(bootstrap.includes('dormantAuthorSentinel'), 'Ground / Carry bootstrap must keep the workspace dormant until explicit activation');
assert(bootstrap.includes("button.addEventListener('click', activateGroundCarry)"), 'Ground / Carry must require explicit opt-in');
assert(bootstrap.includes('MAX_BUTTON_WAIT_FRAMES'), 'bootstrap HUD polling must be bounded');
assert(!bootstrap.includes('neckRig: true'), 'Ground / Carry bootstrap must not alter unrelated avatar construction mode');
assert(!bootstrap.includes('selectedCard.click()'), 'Ground / Carry bootstrap must not force-rebuild the selected NPC');
assert(!bootstrap.includes('rotation.set ='), 'Ground / Carry bootstrap must not monkey-patch THREE.Euler instances');
assert(!bootstrap.includes('bootstrapFrame'), 'Ground / Carry bootstrap must not run a permanent animation-frame polling loop');
assert(!bootstrap.includes('buildSinglePlaneAvatarModel ='), 'Ground / Carry bootstrap must not replace the shared avatar builder');

assert(adapter.includes('procedural-limb-facing-preserver.js?v=20260902c'), 'procedural editor adapter must cache-bust the repaired lazy Ground / Carry bootstrap');
assert(adapter.includes('await loadLimbFacingPreserver()'), 'lazy bootstrap must be established before the adapter considers the pose author');
assert(adapter.includes('procedural-limb-pose-author.js?v=20260902c'), 'adapter compatibility author path must point at the repaired revision');

console.log('procedural limb pose author: PASS');