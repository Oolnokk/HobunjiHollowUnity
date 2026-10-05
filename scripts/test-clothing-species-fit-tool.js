'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const toolDir = path.join(root, 'docs', 'tools', 'clothing-species-fit');
const hub = fs.readFileSync(path.join(root, 'docs', 'tools', 'index.html'), 'utf8');
const index = fs.readFileSync(path.join(toolDir, 'index.html'), 'utf8');
const loader = fs.readFileSync(path.join(toolDir, 'loader.js'), 'utf8');
const patchAuthor = fs.readFileSync(path.join(toolDir, 'behind-sprite-patch.js'), 'utf8');
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
assert(loader.includes('behind-sprite-patch.js'), 'loader must attach the behind-sprite patch author after the core app');
assert(app.includes('buildDerivedOverlayLayer'), 'tool must derive an overlay from imported regular species clothing art');
assert(app.includes('clearRect(0,0,clipped.width'), 'derived overlay must make pixels above the cutoff transparent');
assert(app.includes('const shiftY=(normalHeight-cutoffY)'), 'derived overlay must align the source cutoff with the main portrait cutoff');
assert(app.includes('warpExtendedOverlay'), 'derived overlay must pass through the extended warp');
assert(app.includes('downloadExtendedWarp'), 'tool must bake/export the final warped overlay');
assert(app.includes('GRID_SIZE=6'), 'species-fit mesh must remain 6x6');
assert(app.includes('CELL_SUBDIVISIONS=4'), 'bilinear cell rendering must retain the local subdivision fix');
assert(app.includes('getBehindPatchCatalog:behindPatchCatalog'), 'core editor must expose exact clothing/body source-layer discovery');
assert(app.includes("R.speciesCfg.get('mao-ao')?.[gender]?.portraitBodyLayers"), 'body patch author must use Mao-ao body source layers');
assert(app.includes('targetBody.find(candidate=>candidate?.id&&candidate.id===layer?.id)'), 'body source layers must pair to target-species body layers by layer ID');
assert(app.includes('warpGarment(sourceCanvas,targetGrid()'), 'behind sprites must reuse the final authored 6x6 deformation grid');
assert(patchAuthor.includes('Selected clothing piece'), 'patch author must support existing clothing source layers');
assert(patchAuthor.includes('Body sprite'), 'patch author must support body sprite source layers');
assert(patchAuthor.includes('Corrective patch PNG'), 'patch author must accept a transparent corrective PNG');
assert(patchAuthor.includes('composeSource(baseCanvas,patchCanvas,transform)'), 'patch must composite over existing source art before deformation');
assert(patchAuthor.includes('api.warpBehindPatchCanvas(composite)'), 'batch output must call the core deformation implementation');
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
