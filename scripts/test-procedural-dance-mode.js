const assert = require('assert');
const fs = require('fs');

const adapter = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8');
const danceLoader = fs.readFileSync('docs/js/procedural-dance-mode.js', 'utf8');
const dance = fs.readFileSync('docs/js/procedural-dance-mode-core.js', 'utf8');
const pinnedPreview = fs.readFileSync('docs/tools/procedural-animation-editor/commit-pinned-preview.html', 'utf8');

assert.doesNotThrow(() => new Function(danceLoader), 'procedural dance loader has invalid JavaScript syntax');
assert.doesNotThrow(() => new Function(dance), 'procedural dance core has invalid JavaScript syntax');
assert(adapter.includes("new URL('procedural-dance-mode.js', SELF_SCRIPT_SRC)"), 'Dance loader is not commit/branch-relative to the loaded editor adapter');
assert(adapter.includes("new URL('../../js/procedural-dance-mode.js', window.location.href)"), 'Dance loader is missing the direct-editor fallback path');
assert(danceLoader.includes("getElementById('animationLegBonesEnabled')"), 'Dance leg-bone button does not delegate to the editor canonical checkbox');
assert(danceLoader.includes("getObjectByName?.('LegBonesDebug')"), 'Dance leg-bone diagnostics do not verify the editor canonical LegBonesDebug root');
assert(danceLoader.includes('__editorCanonicalBoneToggle: true'), 'Dance loader does not identify the editor canonical bone-toggle adapter');
assert(!danceLoader.includes('new THREE.CylinderGeometry'), 'Dance loader should not create a duplicate leg-bone visualization');
assert(danceLoader.includes('/_ExperimentalFeet$/i'), 'Dance loader does not discover the procedural editor generated fallback feet root');
assert(danceLoader.includes('/_LeftFoot$/i') && danceLoader.includes('/_RightFoot$/i'), 'Dance loader does not reuse the editor generated left/right foot assemblies');
assert(danceLoader.includes('editorGeneratedFeetDanceBridge'), 'Dance loader does not expose/install the generated-foot compatibility shim');
assert(danceLoader.includes('left_hip: left.hip') && danceLoader.includes('right_foot: right.foot'), 'Generated-foot shim does not present the shared Dance core leg interface');
assert(danceLoader.includes('writeRealFootFromSolvedChain'), 'Shared Dance IK writes are not redirected into the actual generated foot assemblies');
assert(danceLoader.includes('positions.setXYZ(1, knee.x, knee.y, knee.z)'), 'Canonical LegBonesDebug knee point is not updated from the post-Dance generated-foot solve');
assert(danceLoader.includes("new URL('procedural-dance-mode-core.js', SELF_SCRIPT_SRC)"), 'Dance core is not loaded from the same branch/commit as the compatibility loader');

for (const style of ['side-step','bouncy','loose-sway','gentle-twirl','skipping-twirl','foot-tap','head-bob','small-sway']) {
  assert(dance.includes(`'${style}'`), `Dance mode is missing gameplay-preview style: ${style}`);
}

assert(dance.includes('Math.expm1(safeGroove / curveRate) / Math.expm1(100 / curveRate)'), 'Dance mode does not preserve the gameplay-preview exponential Groove mapping');
assert(dance.includes("makeRangeRow('Groove'"), 'Dance authoring workspace is missing the 0-100 Groove control');
assert(dance.includes("makeRangeRow('Drunkenness'"), 'Dance authoring workspace is missing the 0-100 Drunkenness control');
assert(dance.includes('DRUNK_MAX_PITCH_DEG = 26'), 'Dance drunken blend does not preserve runtime drunk-walk pitch range');
assert(dance.includes('DRUNK_MAX_ROLL_DEG = 60'), 'Dance drunken blend does not preserve runtime drunk-walk roll range');
assert(dance.includes('DRUNK_CROSS_STEP_WIDTH = 0.32'), 'Dance drunken blend is missing runtime crossed-step behavior');
assert(dance.includes('DRUNK_HESITATION_LIFT = 0.08'), 'Dance drunken blend is missing runtime hesitation behavior');
assert(dance.includes('window.LegBones.solveTwoBoneLeg'), 'Dance mode does not reuse the shared procedural leg IK solver');
assert(dance.includes('root.worldToLocal(targetWorld.clone())'), 'Dance IK does not convert planted world targets back into the moving body local space');
assert(dance.includes('leg.anchorWorld.clone()'), 'Dance IK does not keep a stable planted world-space foot anchor');
assert(dance.includes('renderer.render = function proceduralDanceRender'), 'Dance pose is not applied at the render boundary after normal editor animation writers');
assert(dance.includes('getDebug()'), 'Dance mode is missing its mobile-friendly diagnostic API');
assert(danceLoader.includes('Latest change: Dance now drives the editor generated fallback feet'), 'Dance panel latest-change summary does not mention the editor fallback-foot integration');

assert(pinnedPreview.includes("hobunjiNpcPlaneAvatarRepoViewer.source.v1"), 'Commit-pinned preview does not target the repository source setting used by the editor');
assert(pinnedPreview.includes('/^[0-9a-f]{40}$/i'), 'Commit-pinned preview does not require an immutable 40-character commit SHA');
assert(pinnedPreview.includes('sourceSettings.ref = pinnedSha'), 'Commit-pinned preview does not force internally fetched repository files to the page commit');
assert(pinnedPreview.includes('frame.contentWindow?.localStorage'), 'Commit-pinned preview does not explicitly hand the pinned ref into the iframe storage context');
assert(pinnedPreview.includes('childSettings.ref !== pinnedSha'), 'Commit-pinned preview does not verify the embedded editor actually retained the pin');
assert(pinnedPreview.includes("frame.contentWindow.location.replace('index.html')"), 'Commit-pinned preview cannot correct a lost pin with one controlled reload');
assert(pinnedPreview.includes('restorePreviousSourceSettings'), 'Commit-pinned preview does not restore the user\'s normal repository source after the temporary harness closes');

console.log('procedural dance mode: PASS');
