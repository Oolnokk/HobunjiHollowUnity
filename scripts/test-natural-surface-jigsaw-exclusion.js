const fs = require('fs');
const path = require('path');
const vm = require('vm');

const calls = []; // Used to prove the exclusion layer preserves the real mapper call before tagging UV ownership.
const mapper = {
  installed: true,
  remapNaturalTerrainMesh(mesh, label) {
    calls.push({ mesh, label });
    return mesh?.shouldMap ? { patchCount: 2 } : null;
  },
};
const windowMock = { HobunjiSurfaceStretchUV: mapper };
windowMock.window = windowMock;

const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'natural-surface-jigsaw-exclusion.js'); // Used to execute the exact production ownership adapter.
vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), { window: windowMock });

const mapped = { shouldMap: true, userData: {} }; // Used to model a successfully recognized natural cliff/rock mesh.
const report = mapper.remapNaturalTerrainMesh(mapped, 'cliff-test');
if (!report || calls.length !== 1) throw new Error('Natural-surface mapper was not preserved');
if (mapped.userData.terrainJigsawIgnore !== true) throw new Error('Mapped natural surface was not excluded from Terrain Jigsaw');
if (mapped.userData.naturalSurfaceUvOwner !== 'HobunjiSurfaceStretchUV') throw new Error('Natural-surface UV ownership metadata was not recorded');

const unrelated = { shouldMap: false, userData: {} }; // Used to prove unrelated meshes are not excluded merely because the adapter was called.
mapper.remapNaturalTerrainMesh(unrelated, 'unrelated');
if (unrelated.userData.terrainJigsawIgnore) throw new Error('Unmapped mesh was incorrectly excluded from Terrain Jigsaw');

console.log(JSON.stringify({ mapped: mapped.userData, unrelated: unrelated.userData, calls: calls.map(call => call.label) }, null, 2));