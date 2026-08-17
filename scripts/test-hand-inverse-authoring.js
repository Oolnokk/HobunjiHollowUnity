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
const shoulders = read('docs/js/procedural-hand-portrait-shoulders.js');
const armMask = read('docs/js/portrait-arm-cloud-mask.js');
const bootstrap = read('docs/js/held-action-animations.js');

assert(config.includes('handFromTool'), 'hand model config must author handFromTool');
assert(config.includes('model.toolGrip = identityTransform()'), 'legacy toolGrip must be neutralized to avoid double transforms');
assert(driver.includes('desiredHandWorld = toolWorldPosition.clone().add(handOffset)'), 'runtime must derive the hand target from the tool frame');
assert(driver.includes('clampDeltaWorld = result.target.clone().sub(desiredHandWorld)'), 'runtime must clamp based on the requested hand target');
assert(driver.includes('adjustedToolWorld = toolWorldPosition.clone().add(clampDeltaWorld)'), 'overreach must pull the tool pose inward by the hand clamp delta');
assert(driver.includes('queueEditorPoseRewrite(adjustedLocal)'), 'editor clamp must persist corrected keyframe coordinates');
assert(driver.includes('renderOrder = -100000'), 'current-frame hand solve must run before opaque hand meshes render');
assert(editor.includes('Hand position relative to tool attach'), 'editor must expose direct hand-from-tool position controls');
assert(editor.includes('Mutate the') && editor.includes('existing profile object in place'), 'inverse-hand sliders must not reload GLB profiles on every tick');
assert(editor.includes('requestAnimationFrame(syncPreview)'), 'inverse-hand sliders must force a post-editor-pose live preview sync');
assert(editor.includes('same clamp runs live in-game'), 'editor help must explain shared live behavior');

assert(shoulders.includes('skinnedPlane.boneTransform') || shoulders.includes('skinnedPlane.applyBoneTransform'), 'shoulders must sample live skinned portrait vertices');
assert(shoulders.includes('binding.deltaLocal.copy(deformedParent).sub(restParent)'), 'shoulders must inherit portrait deformation delta including Z');
assert(shoulders.includes('shiftedTarget = worldTarget.clone().sub(deltaWorld)'), 'IK reach must be solved from the dynamically moved shoulder');
assert(shoulders.includes('dynamicShoulders'), 'dynamic shoulder XYZ must be exposed in debug state');

assert(armMask.includes("filter(layer => /arm[lr]/i.test"), 'higher cloud mask must select only fighter arm body layers');
assert(armMask.includes('ax: base.ax + axOffset'), 'arm-only cloud mask must be positioned above the existing full-avatar mask');
assert(armMask.includes("globalCompositeOperation = 'destination-out'"), 'arm-only mask must punch alpha from the isolated arm raster');
assert(armMask.includes('drawArmIsolated'), 'arm mask must isolate each arm before compositing so torso/overwear remain untouched');

assert(bootstrap.includes('portrait-arm-cloud-mask.js'), 'arm-only cloud mask adapter must load before portrait rendering');
assert(bootstrap.includes('procedural-hand-portrait-shoulders.js'), 'portrait shoulder tracker must load before the frame driver attaches rigs');
assert(bootstrap.includes('attack-editor-hand-inverse-configurator.js'), 'editor inverse-hand authoring adapter must be parser-loaded');

console.log('procedural hands: live inverse preview + dynamic portrait shoulders + arm-only cloud mask PASS');
