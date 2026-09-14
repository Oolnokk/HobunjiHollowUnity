'use strict';

const fs = require('fs'); // Reads the runtime/loader sources for a fast ownership-order regression without a browser.
const path = require('path'); // Resolves repository-relative paths from this script consistently.

const root = process.env.HOBUNJI_REPO || path.join(__dirname, '..');
const split = fs.readFileSync(path.join(root, 'docs/js/terrain-jigsaw-surface-split.js'), 'utf8');
const exclusion = fs.readFileSync(path.join(root, 'docs/js/natural-surface-jigsaw-exclusion.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8');
const boundary = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/index.html'), 'utf8');

for (const expected of [
  "const DEFAULT_SPLIT_ANGLE_DEG = 24",
  "const OWNER = 'surface-split-jigsaw-v2'",
  'current.normal.dot(neighbor.normal)',
  'baseBake.call(jigsaw, tempMesh',
  'terrainJigsawSurfaceSplitSignature',
  'terrainJigsawFinalOwner: OWNER',
  'terrainJigsawIgnore: true',
  'mapper.mapMesh = wrappedMapMesh',
  'mapper.remapNaturalTerrainMesh = wrappedRemapNatural',
  'leave mesh.material exactly as-is',
]) {
  if (!split.includes(expected)) throw new Error(`segmented Jigsaw single-owner contract missing: ${expected}`);
}

for (const forbidden of [
  'rendererProto.render =',
  'jigsaw.scanScene =',
  'jigsaw.bakeMesh = publicBake',
  'mesh.material = Array.isArray',
]) {
  if (split.includes(forbidden)) throw new Error(`segmented Jigsaw must not install competing live ownership: ${forbidden}`);
}

for (const expected of [
  "const FINAL_OWNER = 'surface-split-jigsaw-v2'",
  'const WALL_NORMAL_Y_MAX = 0.55',
  'texture.wrapS = THREE.RepeatWrapping',
  'texture.wrapT = THREE.ClampToEdgeWrapping',
  "texture.name = `${sourceMaterial.map.name || 'natural'}__jigsaw_repeatU`",
  'width > 4 && height > 4',
  'patchMapperAfterSegmentedJigsaw()',
  '=== Segmented Jigsaw material parity ===',
]) {
  if (!exclusion.includes(expected)) throw new Error(`segmented Jigsaw material-parity contract missing: ${expected}`);
}
if (!/Object\.defineProperty\(window, 'TerrainJigsawSurfaceSplit'/.test(exclusion)) {
  throw new Error('material parity must install immediately when the later segmented-Jigsaw API becomes available.');
}

if (!loader.includes("['TerrainJigsawSurfaceSplit', 'terrain-jigsaw-surface-split.js?v=20260914b']")) {
  throw new Error('HousePieces does not load the single-pass segmented Jigsaw adapter.');
}
if (!loader.includes("['NaturalSurfaceJigsawExclusion', 'natural-surface-jigsaw-exclusion.js?v=20260902a']")) {
  throw new Error('Natural-surface exclusion must remain loaded so the ordinary Jigsaw scan cannot race the segmented mapper.');
}
const terrainIndex = loader.indexOf("['TerrainRenderChunks'");
const postIndex = loader.indexOf("['NaturalSurfaceStretchPostJigsaw'");
const splitIndex = loader.indexOf("['TerrainJigsawSurfaceSplit'");
if (!(terrainIndex >= 0 && postIndex > terrainIndex && splitIndex > postIndex)) {
  throw new Error('Segmented Jigsaw must install after TerrainJigsawUV and the existing ordering guard.');
}

const protectedIndex = boundary.indexOf('<script src="protected-edge-stretch.js"></script>');
const boundarySplitIndex = boundary.indexOf('terrain-jigsaw-surface-split.js');
const previewIndex = boundary.indexOf('<script src="scenery-3d-preview.js"></script>');
if (!(protectedIndex >= 0 && boundarySplitIndex > protectedIndex && previewIndex > boundarySplitIndex)) {
  throw new Error('Boundary Terrain must install the r128 baker bridge, then segmented Jigsaw, then its 3D comparison preview.');
}

console.log('Segmented Jigsaw single-owner + material-parity regression passed.');
