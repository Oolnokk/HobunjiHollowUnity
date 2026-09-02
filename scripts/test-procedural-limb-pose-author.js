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

// Preview parity contract: the Attack Animation Editor is the known-good NPC
// preview. Procedural NPC builds must opt into the same neck-rigged/skinned
// PNGPlaneAvatar assembly, including rebuilding the already-selected startup
// NPC through the editor's own selection handler after the wrapper is ready.
assert(bootstrap.includes('installAttackEditorAvatarParity'), 'procedural preview does not install Attack Editor avatar parity');
assert(bootstrap.includes('proceduralAttackPreviewParityBuild'), 'shared PNG avatar builder is not wrapped for procedural preview parity');
assert(bootstrap.includes('neckRig: true'), 'procedural NPC previews do not request the Attack Editor neck-rig assembly');
assert(bootstrap.includes('proceduralPreviewParity'), 'procedural preview parity is not exposed in avatar diagnostics');
assert(bootstrap.includes('selectedCard.click()'), 'startup NPC is not rebuilt through the existing editor selection pipeline');
assert(bootstrap.includes("referenceTool: 'attack-animation-editor'"), 'preview parity diagnostics do not identify the known-good reference tool');

// Ground / Carry remains explicit opt-in. The bootstrap sentinel prevents
// procedural-impact-tabs.js from eager-loading the pose author, while the
// base procedural preview parity fix is active independently of Ground/Carry.
assert(bootstrap.includes('dormantAuthorSentinel'), 'Ground / Carry lacks an explicit dormant state');
assert(bootstrap.includes('window.HobunjiProceduralLimbPoseAuthor = dormantAuthorSentinel'), 'Ground / Carry no longer blocks eager author startup');
assert(bootstrap.includes("button.addEventListener('click', activateGroundCarry)"), 'Ground / Carry is not explicit opt-in');
assert(bootstrap.includes("delete window.HobunjiProceduralLimbPoseAuthor"), 'explicit activation cannot release the dormant sentinel');
assert(bootstrap.includes('ensureBranchFixedLegSolver'), 'explicit activation does not ensure the branch fixed-length solver');
assert(bootstrap.includes('protectLegacyYaw'), 'Ground / Carry does not preserve the old animator facing');
assert(bootstrap.includes('groundCarryRelativeEulerSet'), 'zero-yaw Ground / Carry writes are not relative to the legacy yaw');

// The parity fix changes construction mode only. It must not resurrect the
// discarded camera-relative material/mesh visibility workaround.
assert(!bootstrap.includes('material.visible ='), 'procedural preview must not hide/show portrait materials');
assert(!bootstrap.includes('cameraRelativePortraitFace'), 'procedural preview must not choose portrait faces from camera position');
assert(!bootstrap.includes('DOUBLE_SIDE'), 'procedural preview must not override portrait culling');
assert(!bootstrap.includes('frontMaterials'), 'procedural preview must not classify portrait materials');
assert(!bootstrap.includes('backMaterials'), 'procedural preview must not classify portrait materials');

assert(adapter.includes('procedural-limb-facing-preserver.js?v='), 'procedural editor adapter does not load the preview-parity/lazy Ground / Carry bootstrap');
assert(adapter.includes('await loadLimbFacingPreserver()'), 'preview parity bootstrap is not established before the adapter considers the pose author');
assert(adapter.includes('procedural-limb-pose-author.js?v='), 'adapter contract for the pose author disappeared');

console.log('procedural limb pose author: PASS');
