'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const toolDir = path.join(root, 'docs', 'tools', 'clothing-species-fit');
const hub = fs.readFileSync(path.join(root, 'docs', 'tools', 'index.html'), 'utf8');
const index = fs.readFileSync(path.join(toolDir, 'index.html'), 'utf8');
const loader = fs.readFileSync(path.join(toolDir, 'loader.js'), 'utf8');
const app = Array.from({ length: 12 }, (_, i) =>
  fs.readFileSync(path.join(toolDir, `app.part${i + 1}.txt`), 'utf8')
).join('');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(hub.includes('data-target="clothing-species-fit"'), 'dev tools hub must expose the clothing species fit tab');
assert(hub.includes('src="clothing-species-fit/index.html"'), 'dev tools hub must iframe the clothing species fit tool');
assert(index.includes('id="extUseCutoff"'), 'tool must expose regular-sprite cutoff mode');
assert(index.includes('id="extCutoffY"'), 'tool must expose cutoff Y authoring');
assert(index.includes('Export baked warped extended overlay PNG'), 'tool must expose baked extended-overlay PNG export');
assert(loader.includes('i<=12'), 'loader must concatenate every app chunk');
assert(app.includes('buildDerivedOverlayLayer'), 'tool must derive an overlay from imported regular species clothing art');
assert(app.includes('clearRect(0,0,clipped.width'), 'derived overlay must make pixels above the cutoff transparent');
assert(app.includes('const shiftY=(normalHeight-cutoffY)'), 'derived overlay must align the source cutoff with the main portrait cutoff');
assert(app.includes('warpExtendedOverlay'), 'derived overlay must pass through the extended warp');
assert(app.includes('downloadExtendedWarp'), 'tool must bake/export the final warped overlay');
assert(app.includes('GRID_SIZE=6'), 'species-fit mesh must remain 6x6');
assert(app.includes('CELL_SUBDIVISIONS=4'), 'bilinear cell rendering must retain the local subdivision fix');

// Parse the exact concatenated browser application without executing DOM/runtime code.
new Function(app);

console.log('clothing species fit / extended overlay tool regression checks passed');
