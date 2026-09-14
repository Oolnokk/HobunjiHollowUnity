'use strict';

const fs = require('fs');
const path = require('path');
const root = process.env.HOBUNJI_REPO || path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/current-game-terrain-auto.js'), 'utf8');

for (const expected of [
  '../../config/natural-surface-materials.js',
  '../../js/natural-surface-materials.js',
  "natural.naturalizeMesh(mesh, 'rocks')",
  'maxPatchWorldSize: FARM_PATCH_WORLD_SIZE',
  'const FARM_PATCH_WORLD_SIZE = 6',
  "const FINAL_OWNER = 'surface-split-jigsaw-v2'",
  'finalOwnerCounts',
  'boundaryPreviewCurrentGameOwner',
  'loadScriptOnce',
  'dependenciesReady',
  "preview3dRebuild')?.click",
]) {
  if (!source.includes(expected)) throw new Error(`Boundary CURRENT GAME AUTO parity contract missing: ${expected}`);
}
if (source.includes('restorePreviewMaterialIdentity')) {
  throw new Error('Boundary CURRENT GAME AUTO must retain the game-produced material instead of restoring the clean editor material.');
}
if (source.includes('document.write')) {
  throw new Error('Boundary CURRENT GAME AUTO must never block the parser with document.write.');
}
if (source.includes('MutationObserver')) {
  throw new Error('Boundary CURRENT GAME AUTO status diagnostics must not mutate-observe their own status element.');
}
if (source.includes('current-game-terrain-auto-impl.js')) {
  throw new Error('Boundary CURRENT GAME AUTO must be a single nonblocking script, not a nested parser-loaded implementation.');
}
console.log('Boundary CURRENT GAME AUTO full-pipeline + nonblocking bootstrap regression passed.');
