const fs = require('fs');
const assert = require('assert');

const loader = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8'); // Verifies Manual IK loads before the preset renderer hook.
const bridge = fs.readFileSync('docs/js/procedural-ground-rest-manual-bridge.js', 'utf8'); // Verifies the Ground / Rest host integration for the reusable author.
const manual = fs.readFileSync('docs/js/procedural-limb-manual-author.js', 'utf8'); // Verifies the existing reusable handle/history implementation remains authoritative.
const carry = fs.readFileSync('docs/js/procedural-carry-walk-mode.js', 'utf8'); // Verifies Carry no longer polls UI installation for the full retry window.

assert(loader.includes('procedural-ground-rest-manual-bridge.js'), 'loader must include the Ground / Rest Manual IK bridge');
assert(loader.indexOf("src('procedural-ground-rest-manual-bridge.js')") < loader.indexOf("src('procedural-limb-pose-author.js')"), 'Manual IK bridge must load before Ground / Rest preset author');
assert(loader.includes('whenRenderHookReady'), 'loader must wait until the manual renderer layer is installed');
assert(bridge.includes('ProceduralLimbManualAuthor.create'), 'Ground / Rest must instantiate the existing reusable Manual IK author');
assert(bridge.includes("guidePoint(side, 'arm', 2)"), 'manual hand targets must seed from the visible preset arm guides');
assert(bridge.includes("guidePoint(side, 'leg', 2)"), 'manual foot targets must seed from the visible preset leg guides');
assert(bridge.includes('solveSubdividedChain'), 'manual elbows/knees must use the explicit-joint subdivided solver');
assert(bridge.includes('preset body → manual limbs'), 'manual ownership must remain layered on top of the Ground / Rest body preset');
assert(bridge.includes('limbManualStart') && bridge.includes('limbManualStop') && bridge.includes('limbManualCopy'), 'Ground / Rest panel must expose manual edit/stop/copy controls');
assert(bridge.includes('manualModel') && bridge.includes("disposeManual('avatar-changed')"), 'Manual IK must be recreated instead of retaining another avatar locomotion root');
assert(bridge.includes('manualModelMatchesAvatar'), 'mobile-visible bridge diagnostics must expose stale-avatar protection');
assert(bridge.includes('originalResetPose') && bridge.includes('manualAwareResetPose'), 'direct resetPose callers such as Carry must release manual ownership');
assert(bridge.includes("stopManual('pose-reset')"), 'resetPose must stop active Manual IK before restoring the normal pose');
assert(manual.includes('limbManualUndo') && manual.includes('limbManualRedo'), 'existing Manual IK undo/redo controls must remain available');
assert(manual.includes('Ctrl/Cmd+Z'), 'existing Manual IK keyboard history shortcut must remain available');
assert(carry.includes('state.uiInstalled = Boolean(movementUiReady && panelReady && quickButtonReady)'), 'Carry bootstrap must set uiInstalled when its UI is actually ready');
assert(carry.includes('uiInstalled: state.uiInstalled'), 'Carry debug snapshot must expose UI bootstrap completion');

console.log('procedural Ground/Rest Manual IK bridge: PASS');
