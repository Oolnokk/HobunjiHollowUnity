'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const bridge = fs.readFileSync('docs/js/procedural-editor-foot-bridge.js', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
const bootstrap = fs.readFileSync('docs/js/procedural-limb-facing-preserver.js', 'utf8');

assert.doesNotThrow(() => new Function(bridge), 'procedural editor foot bridge must parse as JavaScript');
assert.doesNotThrow(() => new Function(bootstrap), 'limb bootstrap must parse after foot-bridge integration');

// The Procedural Animation Editor owns legacy direct ExperimentalFeet transforms;
// the adapter must reuse those rather than attach a duplicate gait system.
assert.match(bridge, /_ExperimentalFeet\$\/i/, 'bridge must locate the editor ExperimentalFeet root');
assert.match(bridge, /_LeftFoot\$\/i/, 'bridge must locate the editor left-foot gait transform');
assert.match(bridge, /_RightFoot\$\/i/, 'bridge must locate the editor right-foot gait transform');
assert.match(bridge, /foot\.position\.copy\(locomotionPointToParent/, 'manual/ground IK must move the same visible editor foot transform');
assert.doesNotMatch(bridge, /ProceduralLegAnimation\.attach/, 'bridge must not create a second procedural leg/gait controller');
assert.doesNotMatch(bridge, /new\s+THREE\.WebGLRenderer/, 'bridge must reuse the editor renderer/scene');

// Repository-authored species feet beat the procedural fallback unless the author
// deliberately supplied an editor-specific custom foot override.
assert.match(config, /"mao-ao"\s*:\s*\{\s*"glb"\s*:\s*"assets\/models\/feet\/foot_feline\.glb"/, 'Mao\'ao must have a configured authored feline foot GLB');
assert.match(bridge, /feetSettings\(\)\.species/, 'bridge must read the live proceduralFeet species table');
assert.match(bridge, /AUTHORED_VISUAL_NAME = 'HobunjiRepoAuthoredFootVisual'/, 'bridge must identify its repo-authored visual replacement');
assert.match(bridge, /importedOverrideFor\(context\.model, side\)/, 'manual editor GLB imports must remain explicit overrides');
assert.match(bridge, /child\.visible = false/, 'primitive fallback children must be hidden after configured GLB succeeds');
assert.match(bridge, /GLB_AUTOFIT_MULTIPLIER = 2/, 'editor configured-foot sizing must match canonical runtime autofit');

// The accepted Mao'ao male Manual IK export is now the exact cross-legged leg
// reference: feet tucked near centerline and knees flared outward.
for (const value of [
  '-0.032269477130428825', '-0.1247820704974712',
  '0.029829823623628127', '0.11696889134621108',
  '0.0891998118916785', '0.08425773718554744',
]) {
  assert.ok(bridge.includes(value), `cross-legged bridge must retain accepted reference value ${value}`);
}
assert.match(bridge, /mode === 'crossLegged'[\s\S]*solveSubdividedChain/, 'cross-legged must use exact knee + foot targets rather than a bend pole approximation');
assert.match(bridge, /joint:\s*reference\.knee/, 'accepted cross-legged knee must be supplied as an exact joint');
assert.match(bridge, /target:\s*reference\.foot/, 'accepted cross-legged foot must be supplied as the exact endpoint');

// The old editor stores foot contact as groundLocalY + contactRadiusY. The bridge
// must correct that coordinate mismatch before fixed ground solvers run.
assert.match(bridge, /groundLocalY/, 'bridge must account for the editor floor-local offset');
assert.match(bridge, /copied\.target\.y \+= groundLocalY/, 'ground foot targets must be corrected into the editor locomotion space');
assert.match(bridge, /copied\.pole\.y \+= groundLocalY/, 'ground knee poles must receive the same floor-space correction');

// Manual mode uses the public author export and drives endpoints continuously;
// Normal/carry relinquish ownership so the legacy gait remains authoritative.
assert.match(bridge, /getExport\(\)\?\.manual/, 'manual foot target must come from the public Manual IK author state');
assert.match(bridge, /if \(mode === 'manual' \|\| GROUND_MODES\.has\(mode\)\) state\.driveFrame = requestAnimationFrame\(syncDrivenFeet\)/, 'continuous endpoint ownership must exist only during Manual/Ground modes');
assert.match(bootstrap, /procedural-editor-foot-bridge\.js\?v=20260902e/, 'limb bootstrap must load the repository-authored foot bridge');
assert.match(bootstrap, /bridge\?\.activateLimbBridge\?\.\(\)/, 'opening Limb Author must activate the editor/IK solver bridge');

console.log('procedural editor foot bridge: PASS');
