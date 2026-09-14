'use strict';

const fs = require('fs'); // Used to statically verify the shared Tool Hub parity bootstrap without needing a browser.
const path = require('path'); // Used to resolve repository-relative source files consistently.

const root = process.env.HOBUNJI_REPO || path.join(__dirname, '..');
const wrapper = fs.readFileSync(path.join(root, 'docs/js/panel-ui.js'), 'utf8');
const parity = fs.readFileSync(path.join(root, 'docs/js/tool-terrain-preview-parity.js'), 'utf8');
const mapEditor = fs.readFileSync(path.join(root, 'docs/tools/map-editor/index.html'), 'utf8');
const cutscene = fs.readFileSync(path.join(root, 'docs/tools/cutscene-director/index.html'), 'utf8');

for (const expected of ['panel-ui-core.js', 'tool-terrain-preview-parity.js', 'document.write']) {
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
for (const expected of ['rock: 0x79807c', 'cliff: 0x6a6460']) {
  if (!mapEditor.includes(expected)) throw new Error(`Map Editor legacy terrain signature changed; parity fallback needs review: ${expected}`);
}
for (const expected of ['color:0x6b5638', 'TerrainPreview.buildPlateauMesaGeometry', 'TerrainPreview.buildRockFormationGeometry']) {
  if (!cutscene.includes(expected)) throw new Error(`Cutscene legacy terrain signature changed; parity fallback needs review: ${expected}`);
}
if (parity.includes('Native full-PNG span <output')) throw new Error('obsolete full-PNG-span authoring control still present');
console.log('Tool Hub terrain preview parity static regression passed.');
