'use strict';
const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const config = read('docs/config/hand-model-profiles.js');
const driver = read('docs/js/procedural-hand-frame-driver.js');
const editor = read('docs/js/attack-editor-hand-inverse-configurator.js');
const gripModes = read('docs/js/hand-grip-modes.js');
const gripEditor = read('docs/js/attack-editor-hand-grip-mode.js');
const medialWrists = read('docs/js/procedural-hand-medial-wrists.js');
const shoulders = read('docs/js/procedural-hand-portrait-shoulders.js');
const biceps = read('docs/js/procedural-arm-portrait-biceps.js');
const armLength = read('docs/js/procedural-hand-arm-length.js');
const forearmFollow = read('docs/js/procedural-hand-forearm-follow.js');
const materialRoles = read('docs/js/procedural-hand-foot-material-roles.js');
const armMask = read('docs/js/portrait-arm-cloud-mask.js');
const armBones = read('docs/js/arm-bones.js');
const bootstrap = read('docs/js/held-action-animations.js');

assert(config.includes('handFromTool'), 'hand model config must author handFromTool');
assert(config.includes("handedness: 'left'"), 'source basis must document left-hand authored GLBs');
assert(config.includes('model.toolGrip = identityTransform()'), 'legacy toolGrip must be neutralized to avoid double transforms');
assert(driver.includes('desiredHandWorld = toolWorldPosition.clone().add(handOffset)'), 'runtime must derive the hand target from the tool frame');
assert(driver.includes('clampDeltaWorld = result.target.clone().sub(desiredHandWorld)'), 'runtime must clamp based on the requested hand target');
assert(driver.includes('baseLocal = toolHolder.position.clone()'), 'reach clamp must preserve the unclamped tool pose');
assert(driver.includes('restorePreviousClampIfStillApplied'), 'reach clamp must be reversible when conditions change');
assert(!driver.includes('queueEditorPoseRewrite'), 'reach clamp must not rewrite authored editor keyframes');
assert(driver.includes('renderOrder = -100000'), 'current-frame hand solve must run before opaque hand meshes render');
assert(editor.includes('Hand position relative to tool attach'), 'editor must expose direct hand-from-tool position controls');
assert(editor.includes('existing profile object in place'), 'inverse-hand sliders must not reload GLB profiles on every tick');
assert(editor.includes('idle medial wrist facing is not hidden underneath these sliders'), 'editor must state that tool transforms contain no hidden medial yaw');
assert(editor.includes('effective') && editor.includes('bicep verts'), 'editor must expose live transform/reach/bicep diagnostics');

assert(gripModes.includes("'palm-parallel'"), 'shared grip modes must include palm-parallel');
assert(gripModes.includes("'palm-perpendicular'"), 'shared grip modes must include palm-perpendicular');
assert(gripModes.includes('pickshovel') && gripModes.includes("return 'palm-perpendicular'"), 'pick shovel must default to perpendicular grip');
assert(gripModes.includes('PALM_CLEARANCE'), 'default grips must offset the palm from a zero-origin handle');
assert(gripEditor.includes('handGripModeSelect'), 'attack editor must expose grip modes as a dropdown');

assert(medialWrists.includes('MEDIAL_YAW_DEG = 90'), 'idle wrists must rotate ninety degrees from front/back into a medial basis');
assert(medialWrists.includes("applyMedialWorldBasis(THREE, rig, ['left', 'right'])"), 'idle pose must turn both palms toward the character centerline');
assert(!medialWrists.includes('profiles.handTransformForSpecies ='), 'tool-following transform must not receive a hidden medial rotation');
assert(medialWrists.includes('appliesToToolDrivenRightHand: false'), 'medial basis must explicitly stay off the tool-driven right hand');

assert(armLength.includes('BASE_MULTIPLIER = 1.20'), 'all procedural arm lengths must start twenty percent longer');
assert(armLength.includes('spriteUpperArmDepth * 2'), 'arm reach must grow until the midpoint elbow clears the lowest raw arm pixel');
assert(armLength.includes('spriteRequiredArmLength'), 'expanded reach must expose sprite-driven diagnostics');

assert(forearmFollow.includes("forearmOrientationOwner: 'hand-pose'"), 'tool-driven hand pose must own forearm orientation');
assert(forearmFollow.includes('const elbow = targetLocal.clone().addScaledVector'), 'hand orientation must place the elbow from the forearm direction');
assert(forearmFollow.includes('shoulderToElbow'), 'upper arm must simply connect shoulder to the hand-defined elbow');

assert(biceps.includes('BICEP_WEIGHT = 0.94'), 'painted arm vertices must be strongly bicep weighted');
assert(biceps.includes('forearmWeight: 0'), 'painted arm vertices must have zero forearm influence');
assert(biceps.includes('new THREE.Skeleton([...oldSkeleton.bones, left.bone, right.bone])'), 'portrait skeleton must contain real bicep bones');
assert(biceps.includes('BEFORE') && biceps.includes('inverse'), 'bicep bones must be placed in idle pose before inverse bind calculation');

assert(materialRoles.includes("pachyderm: 'mashtzarr'"), 'pachyderm hands must reuse mashtzarr foot material slots');
assert(materialRoles.includes("sloth: 'tletingan'"), 'sloth hands must reuse tletingan foot material slots');
assert(materialRoles.includes("feline: 'mao-ao'"), 'feline hands must reuse feline foot material slots');
assert(materialRoles.includes('...footRoles'), 'hand material role mapping must copy the configured foot role table');

assert(armBones.includes('DEFAULT_MIN_ELBOW_DEG'), 'arm IK must constrain elbow folding');
assert(armBones.includes('DEFAULT_MAX_ELBOW_DEG'), 'arm IK must constrain elbow hyperextension');
assert(armBones.includes("constraint: requestedDistance > maxReach ? 'reach-limit' : 'elbow-fold-limit'"), 'arm IK must report which joint constraint clamped the target');

assert(shoulders.includes('skinnedPlane.boneTransform') || shoulders.includes('skinnedPlane.applyBoneTransform'), 'shoulders must sample live skinned portrait vertices');
assert(shoulders.includes('binding.deltaLocal.copy(deformedParent).sub(restParent)'), 'shoulders must inherit portrait deformation delta including Z');
assert(shoulders.includes('shiftedTarget = worldTarget.clone().sub(deltaWorld)'), 'IK reach must be solved from the dynamically moved shoulder');
assert(shoulders.includes('dynamicShoulders'), 'dynamic shoulder XYZ must be exposed in debug state');

assert(armMask.includes('hobunjiArmCloudAlphaMap'), 'arm cloud mask must build an isolated alpha map');
assert(armMask.includes("filter(layer => /arm[lr]/i.test"), 'higher cloud mask must select only fighter arm body layers');
assert(armMask.includes("globalCompositeOperation = 'destination-in'"), 'arm-only coverage must intersect raw arms with the higher cloud mask');

for (const script of [
  'procedural-hand-foot-material-roles.js',
  'procedural-arm-portrait-biceps.js',
  'procedural-hand-forearm-follow.js',
  'procedural-hand-arm-length.js',
]) assert(bootstrap.includes(script), `${script} must be parser-loaded before the frame driver`);
assert(bootstrap.includes('procedural-hand-medial-wrists.js'), 'idle medial wrist basis must load before the frame driver');
assert(bootstrap.includes('procedural-hand-portrait-shoulders.js'), 'portrait shoulder tracker must load before the frame driver attaches rigs');
assert(bootstrap.includes('attack-editor-hand-inverse-configurator.js'), 'editor inverse-hand authoring adapter must be parser-loaded');
assert(bootstrap.includes('attack-editor-hand-grip-mode.js'), 'editor grip-mode dropdown must be parser-loaded');

console.log('procedural hands: expanded reach + hand-driven forearm + bicep skinning + foot material roles + reversible transforms PASS');
