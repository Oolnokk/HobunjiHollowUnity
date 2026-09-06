const fs = require('fs');
const assert = require('assert');

const loader = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8');
const ground = fs.readFileSync('docs/js/procedural-limb-pose-author.js', 'utf8');
const bridge = fs.readFileSync('docs/js/procedural-ground-rest-input-bridge.js', 'utf8');

assert(loader.includes('procedural-ground-rest-input-bridge.js'), 'adapter loader must load the Ground/Rest input bridge');
assert(loader.includes('ProceduralGroundRestInputBridge?.installed'), 'adapter loader must verify the input bridge installed');
assert(ground.includes('version: 5'), 'Ground/Rest must expose the editor-native v5 API');
assert(ground.includes('_ExperimentalFeet'), 'Ground/Rest must target the editor ExperimentalFeet hierarchy');
assert(ground.includes('button.onclick = () => setPose'), 'Ground/Rest buttons must have direct click handlers');
assert(bridge.includes("document.addEventListener('pointerdown'"), 'input bridge must capture pointerdown');
assert(bridge.includes('stopImmediatePropagation'), 'input bridge must prevent preview canvas handlers from swallowing the pose press');
assert(bridge.includes('pointer-events:auto!important'), 'input bridge must force pointer events on the Ground/Rest controls');
assert(bridge.includes('HobunjiGameplayBackdrop?.log'), 'Ground/Carry messages must use the editor canonical copyable Diagnostics logger');
assert(bridge.includes("hobunjiNpcPlaneAvatarRepoViewer.source.v1"), 'GitHack pinning must update the source key the editor actually reads');
assert(bridge.includes('canonicalPinReload'), 'canonical source correction must reload at most once per pinned revision');
assert(bridge.includes('[Ground/Rest pose]') && bridge.includes('live hierarchy'), 'successful pose input must dump the bound live hierarchy into copyable Diagnostics');
assert(bridge.includes('#proceduralGroundCarryDiagnostics,#proceduralGroundCarryDiagnosticsStyle{display:none!important}'), 'legacy floating Ground/Carry logger must be hidden');
assert(bridge.includes('live state only, not the copyable Diagnostics log'), 'pose/carry JSON panes must be labeled as live state rather than logs');
assert(bridge.includes('forwardWrapperDiagnostics'), 'early wrapper diagnostics must be replayed into the canonical editor log');
assert(bridge.includes('Ground / Rest input bridge loaded'), 'input bridge must publish a page-load diagnostic');
assert(bridge.includes('Ground / Rest input ${inputCount}'), 'input bridge must publish a pre-IK input diagnostic');

console.log('procedural Ground/Rest input bridge: PASS');
