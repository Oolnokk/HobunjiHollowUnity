const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const config = JSON.parse(read('docs/config/furniture-authored/burdenPlinth.json'));

assert.equal(config.key, 'burdenPlinth');
assert.equal(config.name, 'Burden Plinth');
assert.equal(config.puzzle.role, 'activator');
assert.equal(config.puzzle.behavior, 'burdenPlate');
assert.equal(config.recognizedSurfaces.find(surface => surface.id === config.puzzle.payloadSurfaceId)?.label, 'Payload Attachment Surface');
assert.ok(config.puzzle.motion.parts.burden_plinth_lower, 'compression animation must target the moving plate');
assert.equal(JSON.stringify(config).includes('pillar_heavy'), false, 'donor identifier must not leak into the new asset');

const window = {};
vm.runInNewContext(read('docs/js/furniture-puzzle-properties.js'), { window });
const puzzle = window.FurniturePuzzleProperties.normalizePuzzle(config.puzzle);
assert.equal(puzzle.requiredBurdenKind, 'shattercask');
assert.equal(puzzle.channel, 'A');
assert.equal(puzzle.completionChannel, 'B');
assert.equal(puzzle.motion.reversalSeconds, .9);
assert.equal(window.FurniturePuzzleProperties.ACTIVATORS.includes('burdenPlate'), true);
assert.equal(window.FurniturePuzzleProperties.normalizePuzzle({ role:'activator', behavior:'burdenPlate', motion:{ reversalSeconds:-2 } }).motion.reversalSeconds, 0);

const runtime = read('docs/js/furniture-puzzle-runtime.js');
assert.match(runtime, /placeHeldBurdenOnSurface/);
assert.match(runtime, /retrievePlacedBurden/);
assert.match(runtime, /setChannelSource/);
assert.match(runtime, /Number\(puzzle\.motion\.reversalSeconds\) \|\| 0\) \* progress/);
assert.match(runtime, /payload\.group\.parent !== anchor/);
assert.match(runtime, /setBurdenPlateOutputs\(mapId, id, puzzle, true, false\)/);
assert.match(runtime, /setBurdenPlateOutputs\(mapId, id, puzzle, true, true\)/);
assert.match(runtime, /completionChannel/);

const carry = read('docs/js/shattercasks.js');
assert.match(carry, /function heldBurdenInfo\(\)/);
assert.match(carry, /function placeHeldBurdenOnSurface\(/);
assert.match(carry, /function retrievePlacedBurden\(/);
assert.match(carry, /vase\.plinthAttached\)continue/);

const authored = read('docs/js/authored-furniture-runtime.js');
assert.match(authored, /function createSurfaceAnchor\(/);
assert.match(authored, /payloadAttachmentSurfaceId/);

const interactions = read('docs/js/furniture-table-system.js');
assert.match(interactions, /function puzzleObject\(/);
assert.match(interactions, /kind:wardrobe\?'wardrobe':isBurdenPlate\?'burdenPlate'/);
assert.match(interactions, /interactBurdenPlate/);

const authoring = read('docs/tools/furniture-avatar-author/puzzle-properties.js');
assert.match(authoring, /puzzleRequiredBurden/);
assert.match(authoring, /puzzleCompletionChannel/);
assert.match(authoring, /puzzlePayloadSurface/);
assert.match(authoring, /puzzleReverseDuration/);

const furnitureIndex = JSON.parse(read('docs/config/furniture-authored/index.json'));
assert.ok(furnitureIndex.furniture.some(entry => entry.key === 'burdenPlinth' && entry.file === 'config/furniture-authored/burdenPlinth.json'),
  'canonical authored-furniture index must expose the new piece');

const mapEditor = read('docs/tools/map-editor/index.html');
assert.match(mapEditor, /burdenPlinth:\{icon:'⚖️',label:'Burden Plinth'/);
assert.match(mapEditor, /behavior:'burdenPlate',channel:'A',completionChannel:'B'/);
assert.match(mapEditor, /payloadSurfaceId:'burden_plinth_lower:surface:2'/);

const localeEditor = read('docs/tools/locale-editor/index.html');
assert.match(localeEditor, /puzzle:data\.puzzle \? JSON\.parse\(JSON\.stringify\(data\.puzzle\)\)/);
assert.match(localeEditor, /if \(p\.puzzle\) obj\.puzzle = window\.FurniturePuzzleProperties/);

assert.match(interactions, /puzzle:record\.puzzle \|\| data\.puzzle/,
  'async furniture registration must fall back to the loaded authored puzzle definition');

console.log('Burden Plinth asset, catalogs, authoring, attachment, interaction, channels and reversal checks passed.');
