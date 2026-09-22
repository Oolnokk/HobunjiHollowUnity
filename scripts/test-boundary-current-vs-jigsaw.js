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
  '../../js/terrain-render-chunks.js',
  '../../js/border-terrain.js',
  'installBoundaryR128JigsawApiBridge',
  'AUTHORED PREVIEW',
  'JIGSAW SURFACE UV',
]) {
  if (!index.includes(expected)) throw new Error(`Boundary author missing authored-preview dependency/label: ${expected}`);
}

for (const forbidden of [
  '../../js/natural-surface-materials.js',
  '../../js/surface-stretch-uv-furniture.js',
  '../../js/natural-surface-jigsaw-exclusion.js',
  '../../js/farm-cliff-rock-outline.js',
  'current-game-terrain-auto',
  'terrain-jigsaw-surface-split',
]) {
  if (index.includes(forbidden)) throw new Error(`Boundary author still loads a gameplay terrain wrapper that can alter the author preview: ${forbidden}`);
}

if (author.includes('document.write')) throw new Error('Boundary Jigsaw author must not mutate parser script order with document.write.');
if (author.includes('current-game-terrain-auto')) throw new Error('Boundary Jigsaw author still bootstraps the retired current-game adapter.');

for (const expected of [
  'async function loadTerrainConfig()',
  'function makeWorldMaterial(texture, kind)',
  "const grassOrd = makeWorldMaterial(grassTexture, 'grass')",
  "const cliffOrd = makeWorldMaterial(cliffTexture, 'cliff')",
  'function textureSummary(grassTexture, cliffTexture, grassPath, cliffPath)',
  "left.textContent = 'CURRENT WORLD UV'",
  "right.textContent = 'JIGSAW SURFACE UV'",
  'api.bakeMesh(temp,{...settings,force:true,disposeSource:true})',
  'scene.userData.terrainJigsawDisableAuto = true',
]) {
  if (!preview.includes(expected)) throw new Error(`Boundary authored-vs-Jigsaw preview contract missing: ${expected}`);
}

for (const forbidden of [
  'FarmCliffRockOutline',
  'semanticSurface(mesh)',
  'currentOwner(mesh)',
  'CURRENT GAME AUTO',
]) {
  if (preview.includes(forbidden)) throw new Error(`Boundary author preview still contains the regressed gameplay-pipeline imitation: ${forbidden}`);
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

console.log('Boundary authored-preview vs Direct Jigsaw regression passed.');
