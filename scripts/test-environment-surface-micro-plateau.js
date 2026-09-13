'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');

assert.match(source, /SNOW_THICKNESS = 0\.12/, 'micro-plateau snow must stay intentionally shallow');
assert.match(source, /TOP_CLEARANCE = 0\.018/, 'clean cap must clear sampled terrain peaks without becoming a tall second plateau');
assert.match(source, /return LAND_TYPES\.has\(type\) && !WATER_TYPES\.has\(type\)/, 'plateau-owned skipFloor tiles must still receive snow');
assert.doesNotMatch(source, /!tile\?\.skipFloor/, 'skipFloor must never suppress plateau/ramp snow coverage');
assert.match(source, /layerMask & \(1 << 3\)/, 'sampling must include unnamed terrain-layer plateau meshes');
assert.match(source, /scene\?\.traverse\?\.\(node => \{ if \(node\?\.isMesh\) add\(node\); \}\)/, 'sampling must traverse nested plateau and ramp terrain meshes');
assert.match(source, /source\.normal\.y < 0\.28/, 'steep cliff walls must not raise clean tile caps');
assert.match(source, /return \[top, top, top, top\]/, 'ordinary snow tiles must be perfectly flat regardless of source vertex crinkle');
assert.match(source, /rampCornerY/, 'ramps must preserve a clean authored slope instead of becoming random terrain facets');
assert.match(source, /environmentSurfaceTopGeometry = 'tile-driven-shallow-plateau'/, 'generated root must expose the new rendering mode');
assert.match(source, /RepeatWrapping/, 'snow PNG must tile consistently across generated micro-plateau surfaces');
assert.match(source, /makeMesh\(lipPos, lipUv, lipIdx/, 'short exposed plateau edges must use generated textured geometry');
assert.match(source, /setLegacyVisibility\(scene, false\)/, 'old copied-triangle snow must be hidden while the replacement renderer is active');
assert.match(source, /sampledTiles/, 'diagnostics must expose how many clean caps were backed by real rendered-terrain samples');

console.log('Environment surface micro-plateau source checks passed.');
