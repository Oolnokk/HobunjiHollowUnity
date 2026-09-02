const assert = require('assert');
const fs = require('fs');

const anatomy = fs.readFileSync('docs/config/procedural-anatomy-profiles.js', 'utf8');
const solver = fs.readFileSync('docs/js/leg-bones.js', 'utf8');
const author = fs.readFileSync('docs/js/procedural-limb-pose-author.js', 'utf8');
const bootstrap = fs.readFileSync('docs/js/procedural-limb-facing-preserver.js', 'utf8');
const adapter = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8');

for (const field of [
  'upperArmFraction',
  'upperArmRadiusHeightFraction',
  'forearmRadiusHeightFraction',
  'thighRadiusHeightFraction',
  'calfRadiusHeightFraction',
  'torsoRadiusHeightFraction',
]) assert(anatomy.includes(field), `species anatomy profile is missing ${field}`);

assert(!anatomy.includes('upperArmLength:'), 'anatomy profile must not duplicate canonical arm lengths');
assert(!anatomy.includes('upperLegLength:'), 'anatomy profile must not duplicate canonical leg lengths');
assert(solver.includes('function solveTwoBoneLeg'), 'legacy gait solver was removed');
assert(solver.includes('function solveFixedTwoBoneChain'), 'fixed-length anatomical solver is missing');
assert(solver.includes('window.LegBones = { solveTwoBoneLeg, solveFixedTwoBoneChain }'), 'legacy and fixed solvers are not exported together');

for (const pose of ['crossLegged', 'kneel', 'sideLeanLeft', 'sideLeanRight', 'lieSideLeft', 'lieSideRight', 'lieBack', 'carryUpright']) {
  assert(author.includes(pose), `Ground / Carry author is missing pose ${pose}`);
}
for (const contract of [
  'HOBUNJI_ATTACHMENT_RIG_PROFILES',
  'leftHandShoulder',
  'rightHandShoulder',
  'armLengthHeightPercentOffset',
  'experimentalFeet',
  'LegBones.solveFixedTwoBoneChain',
  'ProceduralHandAttachments',
  'placeHandWorld',
  'upperArmRadius',
  'forearmRadius',
  'thighRadius',
  'calfRadius',
  'torsoRadius',
  'hobunji-procedural-limb-pose-library.v1',
]) assert(author.includes(contract), `Ground / Carry author is missing contract: ${contract}`);

// Most important compatibility contract: before the user explicitly opens
// Ground / Carry, the old procedural animator must remain completely
// authoritative. The bootstrap sentinel prevents procedural-impact-tabs.js
// from eager-loading the pose author.
assert(bootstrap.includes('dormantAuthorSentinel'), 'Ground / Carry lacks an explicit dormant state');
assert(bootstrap.includes('window.HobunjiProceduralLimbPoseAuthor = dormantAuthorSentinel'), 'Ground / Carry no longer blocks eager author startup');
assert(bootstrap.includes("button.addEventListener('click', activateGroundCarry)"), 'Ground / Carry is not explicit opt-in');
assert(bootstrap.includes("delete window.HobunjiProceduralLimbPoseAuthor"), 'explicit activation cannot release the dormant sentinel');
assert(bootstrap.includes('ensureBranchFixedLegSolver'), 'explicit activation does not ensure the branch fixed-length solver');
assert(bootstrap.includes('protectLegacyYaw'), 'Ground / Carry does not preserve the old animator facing');
assert(bootstrap.includes('groundCarryRelativeEulerSet'), 'zero-yaw Ground / Carry writes are not relative to the legacy yaw');

// The old PNGPlaneAvatar renderer already owns front/back culling. Ground /
// Carry must never add a second material/mesh visibility controller.
assert(!bootstrap.includes('material.visible ='), 'Ground / Carry must not hide/show portrait materials');
assert(!bootstrap.includes('cameraRelativePortraitFace'), 'Ground / Carry must not choose portrait faces from camera position');
assert(!bootstrap.includes('DOUBLE_SIDE'), 'Ground / Carry must not override legacy portrait culling');
assert(!bootstrap.includes('frontMaterials'), 'Ground / Carry must not classify portrait materials');
assert(!bootstrap.includes('backMaterials'), 'Ground / Carry must not classify portrait materials');

assert(adapter.includes('procedural-limb-facing-preserver.js?v='), 'procedural editor adapter does not load the lazy Ground / Carry bootstrap');
assert(adapter.includes('await loadLimbFacingPreserver()'), 'bootstrap is not established before the adapter considers the pose author');
assert(adapter.includes('procedural-limb-pose-author.js?v='), 'adapter contract for the pose author disappeared');

console.log('procedural limb pose author: PASS');
