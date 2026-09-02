const assert = require('assert');
const fs = require('fs');

const anatomy = fs.readFileSync('docs/config/procedural-anatomy-profiles.js', 'utf8'); // Verifies the new species+gender thickness/split source without duplicating canonical limb lengths.
const solver = fs.readFileSync('docs/js/leg-bones.js', 'utf8'); // Verifies legacy gait IK remains available beside fixed anatomical two-bone IK.
const author = fs.readFileSync('docs/js/procedural-limb-pose-author.js', 'utf8'); // Verifies the isolated Ground / Carry workspace integration contracts.
const facing = fs.readFileSync('docs/js/procedural-limb-facing-preserver.js', 'utf8'); // Verifies the editor-authored front-facing yaw survives Ground / Carry torso posing.
const adapter = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8'); // Verifies the already-loaded procedural editor adapter boots the new workspace.

for (const field of [
  'upperArmFraction',
  'upperArmRadiusHeightFraction',
  'forearmRadiusHeightFraction',
  'thighRadiusHeightFraction',
  'calfRadiusHeightFraction',
  'torsoRadiusHeightFraction',
]) {
  assert(anatomy.includes(field), `species anatomy profile is missing ${field}`);
}
for (const key of [
  'kenkari::male', 'kenkari::female',
  'mao-ao::male', 'mao-ao::female',
  'engh-sho::male', 'engh-sho::female',
  'tletingan::male', 'tletingan::female',
  'mashtzarr::male', 'mashtzarr::female',
]) {
  assert(anatomy.includes(`'${key}'`), `species anatomy profile is missing ${key}`);
}
assert(!anatomy.includes('upperArmLength:'), 'anatomy profile must not create a competing authored arm-length table');
assert(!anatomy.includes('upperLegLength:'), 'anatomy profile must not create a competing authored leg-length table');

assert(solver.includes('function solveTwoBoneLeg'), 'legacy procedural-foot solver was removed');
assert(solver.includes('function solveFixedTwoBoneChain'), 'fixed-length anatomical solver is missing');
assert(solver.includes('upper * upper - lower * lower + solvedDistance * solvedDistance'), 'fixed solver is not using a two-segment law-of-cosines joint solve');
assert(solver.includes('reachable:'), 'fixed solver does not expose reach diagnostics');
assert(solver.includes('window.LegBones = { solveTwoBoneLeg, solveFixedTwoBoneChain }'), 'both legacy and fixed solvers are not exported together');

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
  'limbPoseDebug',
  'Ground / Carry',
  'hobunji-procedural-limb-pose-library.v1',
]) {
  assert(author.includes(contract), `Ground / Carry author is missing contract: ${contract}`);
}
assert(author.includes("runtime.backdrop?.setMovementPlayback?.(false)"), 'ground poses do not pause procedural locomotion before taking over body/feet');
assert(author.includes("runtime.backdrop?.setMovementPlayback?.(true)"), 'heavy carry style does not resume the existing movement engine');
assert(author.includes("input.dispatchEvent(new Event('input', { bubbles: true }))"), 'heavy carry style bypasses the existing procedural movement controls/state');
assert(author.includes("/_ExperimentalFeet$/"), 'ground poses do not reuse the procedural editor’s current species-specific feet');
assert(author.includes('new MutationObserver'), 'mobile authoring panel is not restored when preview UI is rebuilt');

assert(facing.includes('hobunjiLimbPoseBaselineYaw'), 'facing preserver does not store the untouched editor yaw');
assert(facing.includes('protectedGroundCarryEulerSet'), 'facing preserver does not intercept the Ground / Carry Euler setter');
assert(facing.includes('originalSet.call(this, x, preserveFacing ? baselineYaw : y, z, order)'), 'Ground / Carry zero-yaw writes are not replaced with the captured editor yaw');
assert(facing.includes("hobunji-backdrop-avatar-changed"), 'facing preserver does not recapture yaw when the preview avatar rebuilds');
assert(facing.includes('Ground / Carry facing preserved'), 'facing fix lacks a mobile-visible confirmation');

assert(adapter.includes('procedural-limb-facing-preserver.js?v='), 'procedural editor adapter does not load the facing preserver');
assert(adapter.includes('await loadLimbFacingPreserver()'), 'facing preserver is not guaranteed to load before the Ground / Carry author');
assert(adapter.includes('procedural-limb-pose-author.js?v='), 'procedural editor adapter does not load the Ground / Carry author');
assert(adapter.includes('LIMB_POSE_SCRIPT_ID'), 'Ground / Carry adapter loader lacks duplicate-load protection');

console.log('procedural limb pose author: PASS');
