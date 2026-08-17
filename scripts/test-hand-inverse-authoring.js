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
const bootstrap = read('docs/js/held-action-animations.js');

assert(config.includes('handFromTool'), 'hand model config must author handFromTool');
assert(config.includes('model.toolGrip = identityTransform()'), 'legacy toolGrip must be neutralized to avoid double transforms');
assert(driver.includes('desiredHandWorld = toolWorldPosition.clone().add(handOffset)'), 'runtime must derive the hand target from the tool frame');
assert(driver.includes('clampDeltaWorld = result.target.clone().sub(desiredHandWorld)'), 'runtime must clamp based on the requested hand target');
assert(driver.includes('adjustedToolWorld = toolWorldPosition.clone().add(clampDeltaWorld)'), 'overreach must pull the tool pose inward by the hand clamp delta');
assert(driver.includes('queueEditorPoseRewrite(adjustedLocal)'), 'editor clamp must persist corrected keyframe coordinates');
assert(editor.includes('Hand position relative to tool attach'), 'editor must expose direct hand-from-tool position controls');
assert(editor.includes('same clamp runs live in-game'), 'editor help must explain shared live behavior');
assert(bootstrap.includes('attack-editor-hand-inverse-configurator.js'), 'editor inverse-hand authoring adapter must be parser-loaded');

console.log('procedural hands: inverse hand-from-tool authoring + live reach clamp PASS');
