'use strict';

const fs = require('fs');
const path = require('path');

const root = process.env.HOBUNJI_REPO || path.join(__dirname, '..');
const wrapper = fs.readFileSync(path.join(root, 'docs/js/panel-ui.js'), 'utf8');
const parity = fs.readFileSync(path.join(root, 'docs/js/tool-terrain-preview-parity.js'), 'utf8');
const mapEditorFix = fs.readFileSync(path.join(root, 'docs/js/map-editor-terrain-texture-fix.js'), 'utf8');
const mapEditor = fs.readFileSync(path.join(root, 'docs/tools/map-editor/index.html'), 'utf8');
const cutscene = fs.readFileSync(path.join(root, 'docs/tools/cutscene-director/index.html'), 'utf8');
const jigsawAuthor = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/protected-edge-stretch.js'), 'utf8');
const boundaryPreview = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/scenery-3d-preview.js'), 'utf8');
const jigsawRuntime = fs.readFileSync(path.join(root, 'docs/js/terrain-render-chunks.js'), 'utf8');

for (const expected of ['panel-ui-core.js', 'map-editor-terrain-texture-fix.js', 'tool-terrain-preview-parity.js', 'document.write']) {
  if (!wrapper.includes(expected)) throw new Error(`panel-ui wrapper missing bootstrap contract: ${expected}`);
}
for (const expected of [
  "ensureScript('../config/natural-surface-materials.js'",
  "ensureScript('./natural-surface-materials.js'",
  "ensureScript('./surface-stretch-uv-furniture.js'",
  'Unstretched pixel scale',
  'DEFAULT_SPAN * settings.pixelScale',
  'edgeReferenceWorldSize: nativeSpan()',
  'edgeSourceFraction: settings.edge',
  'geometrySteepRatio',
  "terrainKey === 'cliff'",
  "terrainKey === 'rock'",
  "new Set(['6a6460', '79807c', '6b5638'])",
  'const legacyColor = materials.some',
  'legacyColor && geometrySteepRatio',
  'STEEP_RATIO_MIN',
  'HobunjiToolTerrainParity',
  'sourcePixelWorldSizeX',
  'per source pixel',
  'toolTerrainParityProtected',
  'requestAnimationFrame',
  'window.TerrainPreview || window.BorderTerrain',
]) {
  if (!parity.includes(expected)) throw new Error(`tool terrain parity missing contract: ${expected}`);
}
for (const expected of [
  'map-editor',
  'TextureLoader.prototype',
  '__hobunjiMapEditorLastRender',
  'queueRedraw()',
  'NaturalSurfaceMaterials',
  'toolTerrainPreviewMaterialPreserved',
  'function patchResolvePreviewMat()',
  'terrainKey:String(key',
  'hobunjiTerrainConfiguredTexture',
  'hydrateMaterial(material, mapId, key)',
  'return mesh',
]) {
  if (!mapEditorFix.includes(expected)) throw new Error(`Map Editor texture fix missing contract: ${expected}`);
}
for (const expected of ['rock: 0x79807c', 'cliff: 0x6a6460', 'mat.map = finalTex']) {
  if (!mapEditor.includes(expected)) throw new Error(`Map Editor preview terrain/material contract changed; texture fix needs review: ${expected}`);
}
for (const expected of ['color:0x6b5638', 'TerrainPreview.buildPlateauMesaGeometry', 'TerrainPreview.buildRockFormationGeometry']) {
  if (!cutscene.includes(expected)) throw new Error(`Cutscene legacy terrain signature changed; parity fallback needs review: ${expected}`);
}
for (const expected of [
  'function persistMaterialStretch()',
  'background.materialStretch = clone(stretch)',
  'function announceAuthorChange(reason)',
  "'edge-px'",
  "'edge-world'",
  "announceAuthorChange('enabled')",
  'authorRevision',
]) {
  if (!jigsawAuthor.includes(expected)) throw new Error(`Boundary Terrain jigsaw author missing live-setting contract: ${expected}`);
}
if (jigsawAuthor.includes('document.write')) throw new Error('Boundary Terrain author reintroduced parser-time dependency injection.');

for (const expected of [
  'function jigsawEnabled()',
  'edgePx: clamp',
  'edgeWorldWidth: clamp',
  'function ensureBakeUv(geometry)',
  'bakeGeometry.clearGroups()',
  'bakeMaterial.transparent = false',
  'api.bakeMesh(temp',
  "window.FarmCliffRockOutline?.applyRockMaterialAndTextureOutline?.(scene.children.slice())",
  "left.textContent = 'CURRENT GAME AUTO'",
  "right.textContent = 'DIRECT JIGSAW'",
  'function semanticSurface(mesh)',
  'function currentOwner(mesh)',
  'direct Jigsaw baker returned null',
]) {
  if (!boundaryPreview.includes(expected)) throw new Error(`Boundary Terrain 3D preview missing audited comparison contract: ${expected}`);
}
for (const expected of ['options.edgePx ?? DEFAULT_EDGE_PX', 'options.edgeWorldWidth ?? DEFAULT_EDGE_WORLD', 'edgePx/Math.max(1,size.width)', 'settings.edgeWorldWidth']) {
  if (!jigsawRuntime.includes(expected)) throw new Error(`runtime jigsaw baker no longer consumes an authored setting: ${expected}`);
}
if (parity.includes('Native full-PNG span <output')) throw new Error('obsolete full-PNG-span authoring control still present');
console.log('Tool Hub terrain preview + audited Boundary Terrain comparison regression passed.');
