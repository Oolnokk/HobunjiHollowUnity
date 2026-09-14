'use strict';

const fs = require('fs');
const path = require('path');
const root = process.env.HOBUNJI_REPO || path.join(__dirname, '..');
const wrapper = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/current-game-terrain-auto.js'), 'utf8');
const impl = fs.readFileSync(path.join(root, 'docs/tools/background-scenery-author/current-game-terrain-auto-impl.js'), 'utf8');
const source = `${wrapper}\n${impl}`;

for (const expected of [
  '../../config/natural-surface-materials.js',
  '../../js/natural-surface-materials.js',
  "natural.naturalizeMesh(mesh, 'rocks')",
  'maxPatchWorldSize: FARM_PATCH_WORLD_SIZE',
  'const FARM_PATCH_WORLD_SIZE = 6',
  "const FINAL_OWNER = 'surface-split-jigsaw-v2'",
  'finalOwnerCounts',
  'boundaryPreviewCurrentGameOwner',
  'CURRENT AUTO rockified',
  'MutationObserver',
]) {
  if (!source.includes(expected)) throw new Error(`Boundary CURRENT GAME AUTO parity contract missing: ${expected}`);
}
if (source.includes('restorePreviewMaterialIdentity')) {
  throw new Error('Boundary CURRENT GAME AUTO must retain the game-produced material instead of restoring the clean editor material.');
}
for (const expected of [
  'current-game-terrain-auto-impl.js',
  '__boundaryCurrentGameAutoObserver?.disconnect?.()',
  'current === lastWritten',
  '__boundaryCurrentGameAutoSafeObserver',
]) {
  if (!wrapper.includes(expected)) throw new Error(`Boundary CURRENT GAME AUTO freeze guard missing: ${expected}`);
}
if (wrapper.includes('new MutationObserver(() => queueMicrotask(append))')) {
  throw new Error('Boundary CURRENT GAME AUTO wrapper reintroduced the self-triggering microtask observer loop.');
}
console.log('Boundary CURRENT GAME AUTO full-pipeline + freeze-guard regression passed.');
