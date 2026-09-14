'use strict';

const fs = require('fs'); // Reads the runtime/loader sources for a fast ownership-order regression without a browser.
const path = require('path'); // Resolves repository-relative paths from this script consistently.

const root = process.env.HOBUNJI_REPO || path.join(__dirname, '..');
const split = fs.readFileSync(path.join(root, 'docs/js/terrain-jigsaw-surface-split.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8');
const boundary = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/index.html'), 'utf8');

for (const expected of [
  "const DEFAULT_SPLIT_ANGLE_DEG = 24",
  "const OWNER = 'surface-split-jigsaw-v1'",
  'current.normal.dot(neighbor.normal)',
  'baseBake.call(jigsaw, tempMesh',
  'terrainJigsawSurfaceSplitSignature',
  'terrainJigsawFinalOwner: OWNER',
  'delete object.userData.terrainJigsawIgnore',
  'mapper.remapNaturalTerrainMesh = protectedRemap',
  'jigsaw.bakeMesh = publicBake',
  'jigsaw.scanScene = scanScene',
]) {
  if (!split.includes(expected)) throw new Error(`segmented Jigsaw final-owner contract missing: ${expected}`);
}

if (!loader.includes("['TerrainJigsawSurfaceSplit', 'terrain-jigsaw-surface-split.js?v=20260914a']")) {
  throw new Error('HousePieces does not load segmented Jigsaw after the terrain runtime stack.');
}
if (loader.includes("['NaturalSurfaceJigsawExclusion'")) {
  throw new Error('Legacy natural-surface Jigsaw exclusion is still loaded by HousePieces.');
}
const postIndex = loader.indexOf("['NaturalSurfaceStretchPostJigsaw'");
const splitIndex = loader.indexOf("['TerrainJigsawSurfaceSplit'");
if (!(postIndex >= 0 && splitIndex > postIndex)) {
  throw new Error('Segmented Jigsaw must load after the legacy post-Jigsaw ordering guard so it can become final owner.');
}

const protectedIndex = boundary.indexOf('<script src="protected-edge-stretch.js"></script>');
const boundarySplitIndex = boundary.indexOf('<script src="../../js/terrain-jigsaw-surface-split.js?v=20260914a"></script>');
const previewIndex = boundary.indexOf('<script src="scenery-3d-preview.js"></script>');
if (!(protectedIndex >= 0 && boundarySplitIndex > protectedIndex && previewIndex > boundarySplitIndex)) {
  throw new Error('Boundary Terrain must install the r128 baker bridge, then segmented Jigsaw, then its 3D comparison preview.');
}

console.log('Segmented Jigsaw final-owner regression passed.');
