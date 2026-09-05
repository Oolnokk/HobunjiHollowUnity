const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..'); // Used to read the exact production loader/runtime files from this checkout.
const loader = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8'); // Used to assert parser-time script ordering.
const runtime = fs.readFileSync(path.join(root, 'docs/js/natural-surface-stretch-runtime.js'), 'utf8'); // Used to assert nested terrain attachments are observed.
const post = fs.readFileSync(path.join(root, 'docs/js/natural-surface-stretch-post-jigsaw.js'), 'utf8'); // Used to assert render-time mutation ordering.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const terrainChunkAt = loader.indexOf("['TerrainRenderChunks', 'terrain-render-chunks.js"); // Used as the source module that can clone a loading texture and replace UVs.
const postGuardAt = loader.indexOf("['NaturalSurfaceStretchPostJigsaw', 'natural-surface-stretch-post-jigsaw.js"); // Used as the final guard that must load after TerrainRenderChunks.
assert(terrainChunkAt >= 0 && postGuardAt > terrainChunkAt, 'post-Jigsaw natural-surface guard must load after TerrainRenderChunks');

assert(/THREE\.Object3D\?\.prototype/.test(runtime), 'runtime repair must observe nested Object3D.add attachments, not only Scene.add');
assert(/naturalApi\.naturalizeMesh\s*=\s*wrappedNaturalizeMesh/.test(runtime), 'runtime repair must hook the authoritative NaturalSurfaceMaterials.naturalizeMesh path');
assert(/natural_#\?\[0-9a-f\]\{6\}/.test(runtime) || /natural_#\?\[0-9a-f\]\{6\}/i.test(runtime), 'runtime repair must recognize metadata-less natural texture names');

const jigsawScanAt = post.indexOf('jigsawApi.scanScene(scene, now)'); // Used as the first render-time terrain mutation.
// Searched starting after jigsawScanAt so this finds the actual call site rather than
// the (now named, top-level) inspectSceneTerrain function declaration earlier in the file.
const naturalRepairAt = post.indexOf('inspectSceneTerrain(scene)', jigsawScanAt + 1); // Used to restore natural texture/UV ownership immediately after Jigsaw.
const chunkScanAt = post.indexOf('chunkApi.scanScene(scene, now)'); // Used to spatially split only after natural surfaces are final.
const renderAt = post.indexOf('originalRender.call(this, scene, camera)'); // Used as the final actual GPU render call.
assert(jigsawScanAt >= 0, 'post-Jigsaw guard must invoke the existing Jigsaw scan');
assert(naturalRepairAt > jigsawScanAt, 'natural-surface repair must happen after Jigsaw mutation');
assert(chunkScanAt > naturalRepairAt, 'spatial chunking must happen after natural-surface repair');
assert(renderAt > chunkScanAt, 'actual rendering must happen after Jigsaw -> natural repair -> chunking');

assert(/terrainGeometryReadyRevision/.test(post) && /onTerrainGeometryReady/.test(post), 'post-Jigsaw wrapper must preserve TerrainRenderChunks geometry-ready notifications');
assert(/previousBakeMesh/.test(post) && /runtime\.inspectObject\(mesh\)/.test(post), 'manual TerrainJigsawUV.bakeMesh calls must also re-run natural-surface repair');

console.log(JSON.stringify({
  loaderOrder: ['TerrainRenderChunks', 'NaturalSurfaceStretchPostJigsaw'],
  renderOrder: ['jigsaw', 'natural-surface-repair', 'spatial-chunks', 'terrain-ready-notify', 'render'],
  nestedObjectAddsObserved: true,
  naturalizePathObserved: true,
}, null, 2));