#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const context = { window:{} };
vm.createContext(context);
vm.runInContext(read('docs/js/furniture-puzzle-properties.js'), context);
const api = context.window.FurniturePuzzleProperties;
assert.ok(api, 'shared puzzle schema should install');

const activator = { id:'plate', puzzle:{ role:'activator', behavior:'pressurePlate', channel:'door-a' } };
const mechanism = { id:'door', puzzle:{ role:'mechanism', behavior:'stoneDoor', channel:'door-a', motion:{ axis:'y', distance:1.5 } } };
const result = api.validateWiring([activator, mechanism], [{ id:'wire-a', fromId:'plate', toId:'door' }]);
assert.equal(result.valid, true, JSON.stringify(result));
assert.equal(result.wiring.length, 1);
const migratedMechanism = api.normalizePuzzle(mechanism.puzzle);
assert.equal(migratedMechanism.version, 3);
assert.equal(migratedMechanism.motion.on.position.y, 1.5, 'legacy axis/distance should migrate into the ON transform');
assert.deepEqual(JSON.parse(JSON.stringify(migratedMechanism.motion.off.position)), { x:0, y:0, z:0 });
assert.equal(api.normalizeWiring([...result.wiring, ...result.wiring]).length, 1, 'duplicate graph edges should collapse');

const debrisApi = read('docs/tools/debris-ifier/debrisifier-v50-api.js');
assert.match(debrisApi, /generateOutdoorLocale/);
assert.match(debrisApi, /tagPuzzleFurniture/);
assert.match(read('docs/js/random-outdoor-ruins.js'), /generateLocaleDefs/);

for (const editor of ['docs/tools/locale-editor/index.html', 'docs/tools/map-editor/index.html']) {
  const html = read(editor);
  assert.match(html, /PuzzleWiringEditorAdapter/, `${editor} should expose a wiring adapter`);
  assert.match(html, /puzzle-wiring-editor\.js/, `${editor} should load shared wiring mode`);
  assert.match(html, /puzzleWiring/, `${editor} should persist wiring`);
}
const furnitureEditor = read('docs/tools/furniture-avatar-author/index.html');
assert.match(furnitureEditor, /puzzle-properties\.js/);
const puzzleEditor = read('docs/tools/furniture-avatar-author/puzzle-properties.js');
assert.match(puzzleEditor, /Puzzle Furniture/);
assert.match(puzzleEditor, /puzzleEditOff/, 'furniture editor should provide an OFF-state visual authoring mode');
assert.match(puzzleEditor, /puzzleEditOn/, 'furniture editor should provide an ON-state visual authoring mode');
assert.match(puzzleEditor, /playTransition/, 'furniture editor should preview the authored OFF-to-ON lerp');
assert.match(puzzleEditor, /puzzlePreviewStatus/, 'mobile-visible diagnostics should report transition and collision state');
assert.match(puzzleEditor, /preview\.selectedPartId/, 'OFF/ON state authoring should target individual furniture pieces');
assert.match(puzzleEditor, /scale:\{ x:1, y:1, z:1 \}/, 'new OFF/ON states should begin at identity scale');
assert.match(puzzleEditor, /particleRateScale, opacity:1/, 'new OFF/ON states should begin fully visible');
assert.match(puzzleEditor, /raw === '' \? fallback/, 'blank transition fields must retain identity defaults instead of coercing to zero');
assert.match(puzzleEditor, /importRepoFurnitureBtn'\)\.onclick = \(\) => importRepoFurniture\(\)/, 'repository import button must dynamically invoke the puzzle-aware wrapper');
assert.match(furnitureEditor, /FurniturePuzzleAuthorPreview/, 'editor particle loop should consume the puzzle preview rate multiplier');
assert.match(furnitureEditor, /CURRENT_BUILD_FURNITURE_JSON = \['docs\/config\/furniture-authored\/woodenDoor\.json'\]/, 'Wooden Door must remain discoverable in a commit-pinned editor before it reaches main');
assert.match(read('docs/js/furniture-puzzle-runtime.js'), /registerMap/);
assert.match(read('docs/js/furniture-puzzle-runtime.js'), /particleRateScale/);
const door = JSON.parse(read('docs/config/furniture-authored/woodenDoor.json'));
assert.equal(door.key, 'woodenDoor', 'animated Wooden Door must not overwrite the entry-tunnel door asset');
assert.equal(door.puzzle.directInteraction, true);
assert.equal(door.puzzle.blocksMovement, true);
assert.equal(door.name, 'Wooden Door');
assert.equal(Object.keys(door.puzzle.motion.parts).length, 5, 'wooden door should preserve an OFF/ON transform for every uploaded piece');
const doorSlab = door.parts.find(part => part.name === 'Wooden Door Slab');
assert.ok(doorSlab, 'uploaded moving door slab should be retained');
assert.notDeepEqual(door.puzzle.motion.parts[doorSlab.id].off, door.puzzle.motion.parts[doorSlab.id].on, 'door slab should move between uploaded closed/open poses');
assert.equal(door.puzzle.motion.parts[doorSlab.id].off.rz, 0.985, 'file (11) closed slab transform should be preserved exactly');
assert.equal(door.puzzle.motion.parts[doorSlab.id].on.rz, 91.599, 'file (10) open slab transform should be preserved exactly');
assert.equal(api.normalizePuzzle(door.puzzle).motion.parts[doorSlab.id].on.rz, 91.599, 'shared schema must retain per-piece transforms');

const immutableSha = require('node:crypto').createHash('sha256').update(read('docs/tools/debris-ifier/debrisifier-v50-source.js')).digest('hex');
assert.equal(immutableSha, '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40');
console.log('Furniture puzzle authoring and outdoor ruin integration audit passed.');
