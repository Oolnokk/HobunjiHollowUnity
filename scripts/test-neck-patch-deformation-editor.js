const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const hub = read('docs/tools/index.html');
const html = read('docs/tools/neck-patch-deformation-editor/index.html');
const app = read('docs/tools/neck-patch-deformation-editor/app.js');
const config = JSON.parse(read('docs/config/cosmetics/neck-patch-deformations.json'));

assert.match(hub, /data-target="neck-patch-deformation-editor"/, 'tools hub must expose the neck patch editor tab');
assert.match(hub, /neck-patch-deformation-editor\/index\.html/, 'tools hub must embed the neck patch editor');
assert.match(html, /id="stage"/, 'editor needs its deformation canvas');
assert.match(html, /id="downloadSpritesBtn"/, 'editor needs a combined-sprite ZIP export');
assert.match(html, /id="npcReferenceSelect"/, 'editor needs a repo NPC rear-portrait picker');
assert.match(html, /id="npcReferenceOpacity"/, 'repo NPC rear portrait needs independent preview opacity');
assert.match(html, /id="showAboveTargetClothing"[^>]*checked/, 'upper clothing should be equipped by default for the real runtime rear view');
assert.match(html, /npc-avatar-preview-utils\.js/, 'editor must load the runtime NPC portrait adapter');
assert.match(html, /portrait-utils\.js/, 'editor must use the canonical portrait renderer');
assert.match(html, /id="transformMode"/, 'editor needs a transform-box mode before local deformation');
assert.doesNotMatch(html, /id="moveMode"|id="scaleMode"/, 'transform box should replace the redundant separate move/scale modes');
assert.match(html, /id="xrayPatch"[^>]*checked/, 'authoring preview should put the deformed patch above the garment by default');
assert.match(html, /jszip\.min\.js/, 'sprite folder export needs JSZip');
assert.match(app, /Object\.freeze\(\[2, 3, 4\]\)/, 'editor must restrict authoring to 2x2 through 4x4 square meshes');
for (const sprite of ['patchsprite_poncho-behind.png', 'patchsprite_bodywrap-behind.png', 'patchsprite_tankantunic-behind.png']) {
  assert.match(app, new RegExp(sprite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `editor must load ${sprite}`);
}
assert.strictEqual(config.schema, 'hobunji_neck_patch_deformations.v1');
assert.deepStrictEqual(Object.keys(config.patches).sort(), ['bodywrap', 'poncho', 'tunic']);
assert.match(app, /fetch\(url, \{ cache: 'force-cache', mode: 'cors' \}\)/, 'editor must fetch image bytes before creating canvas-readable images');
assert.match(app, /URL\.createObjectURL\(blob\)/, 'editor must decode fetched image blobs through object URLs');
assert.match(app, /Alpha bounds fallback:/, 'alpha-bound scanning must fail soft instead of aborting preview loading');
assert.match(app, /Promise\.allSettled/, 'patch and garment image loads must resolve independently so one failure does not erase the other');
assert.match(app, /function transformHandlePositions/, 'transform mode must expose corner, edge, and center handles');
assert.match(app, /function transformHitTest/, 'transform mode must hit-test handles and the box interior');
assert.match(app, /function scalePointsFromAnchor/, 'transform resizing must preserve the opposite handle as its anchor');
assert.match(app, /handle === 'move'/, 'dragging the transform middle must move the entire mesh');
assert.match(app, /handle\.includes\('w'\) \|\| handle\.includes\('e'\)/, 'left and right handles must resize X');
assert.match(app, /handle\.includes\('n'\) \|\| handle\.includes\('s'\)/, 'top and bottom handles must resize Y');
assert.match(app, /drawTransformBox/, 'transform mode must draw its bounding box and handles');
assert.match(app, /hobunji-starter-npc-database\.json/, 'editor must source reference NPCs from the canonical repo database');
assert.match(app, /ensurePortraitCosmetics/, 'repo NPC references must initialize the canonical portrait cosmetics pipeline');
assert.match(app, /buildProfileFromNpcExport/, 'repo NPC references must use the runtime NPC profile adapter');
assert.match(app, /portraitView: 'behind'/, 'repo NPC references must render the actual runtime behind portrait');
assert.match(app, /behindLayerOrder/, 'reference rendering must split the canonical behind-plane layer order');
assert.match(app, /state\.familyId === 'tunic' \? 'torsoClothing' : 'overwear'/, 'target bucket must match the selected garment slot');
assert.match(app, /REFERENCE_CLOTHING_LAYER_KEYS/, 'upper clothing/accessories must be separated from non-clothing rear layers');
assert.match(app, /npcReferenceAboveClothing/, 'upper clothing must be independently togglable');
assert.match(app, /npcReferenceAboveNonClothing/, 'rear hair/non-clothing must retain its canonical position above the target');
assert.match(app, /ctx\.setTransform\(-scaleX/, 'runtime rear portrait must be flipped and inverse-mapped into raw source-sprite coordinates');
assert.doesNotMatch(app, /loadBackplaneReference|backplaneFile|importBackplaneBtn/, 'generic uploaded backplane sprites must not replace the repo NPC runtime reference');
assert.match(app, /state\.targetImage = targetResult\.status === 'fulfilled'/, 'garment preview must survive unrelated patch-bound failures');
const exportStart = app.indexOf('async function renderCombinedSpriteCanvas');
const exportEnd = app.indexOf('async function downloadCombinedSpritesZip', exportStart);
assert.ok(exportStart >= 0 && exportEnd > exportStart, 'combined-sprite renderer must remain inspectable');
const exportRenderer = app.slice(exportStart, exportEnd);
assert.doesNotMatch(exportRenderer, /npcReference|repoNpcs|portraitView/i, 'repo NPC rear reference must never be baked into garment exports');
const garmentDrawIndex = exportRenderer.indexOf('exportCtx.drawImage(targetImage');
const patchDrawIndex = exportRenderer.indexOf('drawWarpedPatchTo(');
assert.ok(garmentDrawIndex >= 0 && patchDrawIndex > garmentDrawIndex, 'combined sprites must draw the garment first and the deformed patch on top');
assert.match(app, /downloadCombinedSpritesZip/, 'editor must bake and download combined sprites');
assert.match(app, /hobunji_neck_patch_baked_sprites\.v1/, 'ZIP must contain a runtime integration manifest');
for (const stem of ['poncho1-behind', 'tankanbodywrap-behind', 'tankantunic-behind']) {
  assert.match(app, new RegExp(stem), `export naming must include ${stem}`);
}
console.log('neck patch deformation editor checks passed');
