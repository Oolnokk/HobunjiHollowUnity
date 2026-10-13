'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const toolDir = path.join(root, 'docs', 'tools', 'clothing-species-fit');
const hub = fs.readFileSync(path.join(root, 'docs', 'tools', 'index.html'), 'utf8');
const index = fs.readFileSync(path.join(toolDir, 'index.html'), 'utf8');
const loader = fs.readFileSync(path.join(toolDir, 'loader.js'), 'utf8');
// V24 ships the behind-sprite author as split text chunks, concatenated in order by loader.js.
const patchAuthor = Array.from({ length: 5 }, (_, i) =>
  fs.readFileSync(path.join(toolDir, `behind.part${i + 1}.txt`), 'utf8')
).join('');
const app = Array.from({ length: 12 }, (_, i) =>
  fs.readFileSync(path.join(toolDir, `app.part${i + 1}.txt`), 'utf8')
).join('');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(hub.includes('data-target="clothing-species-fit"'), 'dev tools hub must expose the clothing species fit tab');
assert(hub.includes('src="clothing-species-fit/index.html"'), 'dev tools hub must iframe the clothing species fit tool');
// V24 (#971) removed the derived-overlay cutoff mode; the extended overlay is imported top-aligned and warped directly.
assert(index.includes('id="downloadExtended"'), 'tool must expose the warped extended-overlay PNG export');
assert(index.includes('id="importDiagnostics"'), 'tool must accept a pasted diagnostics fit');
assert(loader.includes('i<=12'), 'loader must concatenate every app chunk');
assert(/behind\.part\$\{i\}\.txt/.test(loader) && loader.includes('i<=5'), 'loader must attach every behind-sprite patch author chunk after the core app');
assert(app.includes('warpExtendedOverlay'), 'extended overlay must pass through the extended warp');
assert(app.includes('downloadExtendedWarp'), 'tool must bake/export the final warped overlay');
assert(app.includes('GRID_SIZE=6'), 'species-fit mesh must remain 6x6');
assert(app.includes('CELL_SUBDIVISIONS=4'), 'bilinear cell rendering must retain the local subdivision fix');
assert(app.includes('getBehindPatchCatalog:behindPatchCatalog'), 'core editor must expose exact clothing/body source-layer discovery');
assert(app.includes('R.speciesCfg.get(targetSpecies)?.[gender]?.portraitBodyLayers'), 'body patch author must offer the selected species body layers');
assert(app.includes('warpGarment(sourceCanvas,fitState?targetGridFromFitState(fitState'), 'behind sprites must reuse the authored 6x6 fit deformation grid');
assert(patchAuthor.includes('Selected clothing piece'), 'patch author must support existing clothing source layers');
assert(patchAuthor.includes('Body sprite'), 'patch author must support body sprite source layers');
assert(patchAuthor.includes('Corrective patch PNG'), 'patch author must accept a transparent corrective PNG');
assert(patchAuthor.includes('composeSource(baseCanvas,patchCanvas,transform)'), 'patch must composite over existing source art before deformation');
assert(patchAuthor.includes('api.warpBehindPatchCanvas(composite'), 'batch output must call the core deformation implementation');
assert(patchAuthor.includes('torso|arm-L|arm-R'), 'body output naming must support torso and both authored arm layers');
assert(patchAuthor.includes("return `${stem}-back.png`"), 'clothing output must use a back-sprite filename');
assert(patchAuthor.includes('behind-sprite-manifest.json'), 'ZIP must include source/target/patch provenance');
assert(patchAuthor.includes('buildStoredZip(entries)'), 'patched behind sprites must export as one ZIP');
assert(patchAuthor.includes('pointerdown'), 'patch placement must be draggable without devtools');
assert(patchAuthor.includes('class="importStatus"'), 'patch workflow must expose in-tool diagnostics for mobile use');

// Parse both browser applications without executing DOM/runtime code.
new Function(app);
new Function(patchAuthor);

console.log('clothing species fit / extended overlay / behind-sprite patch author regression checks passed');
