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
const shoulders = read('docs/js/procedural-hand-portrait-shoulders.js');
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
assert(editor.includes('requestAnimationFrame(syncPreview)'), 'inverse-hand sliders must force a post-editor-pose live preview sync');

assert(gripModes.includes("'palm-parallel'"), 'shared grip modes must include palm-parallel');
assert(gripModes.includes("'palm-perpendicular'"), 'shared grip modes must include palm-perpendicular');
assert(gripModes.includes('pickshovel') && gripModes.includes("return 'palm-perpendicular'"), 'pick shovel must default to perpendicular grip');
assert(gripModes.includes('PALM_CLEARANCE'), 'default grips must offset the palm from a zero-origin handle');
assert(gripEditor.includes('handGripModeSelect'), 'attack editor must expose grip modes as a dropdown');

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

assert(bootstrap.includes('hand-grip-modes.js'), 'shared grip modes must load before the frame driver');
assert(bootstrap.includes('procedural-hand-portrait-shoulders.js'), 'portrait shoulder tracker must load before the frame driver attaches rigs');
assert(bootstrap.includes('attack-editor-hand-inverse-configurator.js'), 'editor inverse-hand authoring adapter must be parser-loaded');
assert(bootstrap.includes('attack-editor-hand-grip-mode.js'), 'editor grip-mode dropdown must be parser-loaded');

console.log('procedural hands: grip modes + reversible reach + constrained elbows + dynamic shoulders PASS');
