'use strict';

const fs = require('fs');
const path = require('path');
const root = process.env.HOBUNJI_REPO || path.join(__dirname, '..');

const index = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/index.html'), 'utf8');
const author = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/protected-edge-stretch.js'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/scenery-3d-preview.js'), 'utf8');
const house = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8');
const exclusion = fs.readFileSync(path.join(root, 'docs/js/natural-surface-jigsaw-exclusion.js'), 'utf8');

for (const expected of [
  '../../config/natural-surface-materials.js',
  '../../js/natural-surface-materials.js',
  '../../js/surface-stretch-uv-furniture.js',
  '../../js/natural-surface-jigsaw-exclusion.js',
  '../../js/farm-cliff-rock-outline.js',
  '../../js/terrain-render-chunks.js',
  '../../js/border-terrain.js',
  'installBoundaryR128JigsawApiBridge',
]) {
  if (!index.includes(expected)) throw new Error(`Boundary author missing explicit shared-runtime dependency: ${expected}`);
}

if (index.includes('current-game-terrain-auto')) throw new Error('Boundary author still loads the retired tool-side game imitation.');
if (index.includes('terrain-jigsaw-surface-split')) throw new Error('Boundary author still loads the retired duplicate surface splitter.');
if (author.includes('document.write')) throw new Error('Boundary Jigsaw author must not mutate parser script order with document.write.');
if (author.includes('current-game-terrain-auto')) throw new Error('Boundary Jigsaw author still bootstraps the retired current-game adapter.');

for (const expected of [
  "window.FarmCliffRockOutline?.applyRockMaterialAndTextureOutline?.(scene.children.slice())",
  'function semanticSurface(mesh)',
  'function currentOwner(mesh)',
  "left.textContent = 'CURRENT GAME AUTO'",
  "right.textContent = 'DIRECT JIGSAW'",
  'api.bakeMesh(temp',
  'scene.userData.terrainJigsawDisableAuto = true',
]) {
  if (!preview.includes(expected)) throw new Error(`Boundary comparison is not using the audited game-vs-Jigsaw path: ${expected}`);
}

if (house.includes('TerrainJigsawSurfaceSplit')) throw new Error('Gameplay still loads the speculative duplicate segmented-Jigsaw owner.');
if (exclusion.includes('terrainJigsawWallWrapParity')) throw new Error('NaturalSurfaceJigsawExclusion still owns speculative material replacement.');
if (!exclusion.includes("naturalSurfaceUvOwner = 'HobunjiSurfaceStretchUV'")) throw new Error('Natural-surface final ownership tag missing.');

for (const retired of [
  'docs/js/terrain-jigsaw-surface-split.js',
  'docs/tools/background-scenery-author/current-game-terrain-auto.js',
  'docs/tools/background-scenery-author/current-game-terrain-auto-impl.js',
]) {
  if (fs.existsSync(path.join(root, retired))) throw new Error(`Retired terrain parity layer still exists: ${retired}`);
}

console.log('Boundary current-game-auto vs Direct Jigsaw audit regression passed.');
