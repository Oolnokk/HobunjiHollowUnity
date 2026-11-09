'use strict';
// Browser-independent behavioral tests for the Foundry's actual naming, tool-slot and flail resolvers.
const assert = require('node:assert/strict'); // Uses Node's built-in exact assertions.
const fs = require('node:fs'); // Loads shipped gameplay/editor code without a synthetic copy of the rules.
const vm = require('node:vm'); // Runs browser globals with no DOM or graphics driver.
const window = { RuntimeFrameScheduler: { register() {} } }; // Shared authoring registry and game module namespace.
const context = vm.createContext({ window }); // Persistent VM global across all live config/module evaluations.
const load = file => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file }); // Exact repository entrypoints.
const plain = value => JSON.parse(JSON.stringify(value)); // Compares VM-owned objects in the host realm.

load('docs/config/weapon-sprite-assemblies.js');
load('docs/config/modular-weapons.js');
load('docs/js/modular-weapons.js');
const api = window.ModularWeapons; // Live Foundry resolver under test.
const config = api.getConfig(); // Shared, committed identities (not cosmetic hardcoded test data).
const metals = { nativeCopper: { label: 'Copper' } }; // Minimal forge metal needed for naming and slot registration.
const definitions = {}; // All generated equipment records are verified below.
const shapes = { fishingmace: { animStyle: 'sweep' }, harlyaoLongsword: { animStyle: 'sweep' },
  grappleFlail: { animStyle: 'sweep' }, warhammer: { animStyle: 'sweep' } }; // Test donor metadata is independent of naming.
const item = (shaft, head) => api.itemKey(shaft, head, 'nativeCopper'); // Saved ID must remain part-based and language-independent.

assert.equal(config.shafts['fishing-mace'].label, 'Bored Wrapped Handle');
assert.equal(config.heads['fishing-mace'].label, 'Barb-flanged Mace Head');
assert.equal(config.shafts['harlyao-longsword'].label, 'Trapezoidal Hilt');
assert.equal(config.heads['harlyao-longsword'].label, 'Harlyao-style Long-blade');
assert.equal(api.weaponName('fishing-mace', 'fishing-mace', 'Copper'), 'Copper Bored-handled Barb-flanged Mace');
assert.equal(api.weaponName('harlyao-longsword', 'harlyao-longsword', 'Copper'),
  'Copper Harlyao-style Long-blade with a Trapezoidal Hilt');
assert.equal(item('fishing-mace','warhammer'), 'modular:fishing-mace:warhammer:nativeCopper');
assert.deepEqual(plain(api.decode(item('fishing-mace','warhammer'))),
  { shaft: 'fishing-mace', head: 'warhammer', metal: 'nativeCopper' });

api.registerDefinitions(definitions, shapes, metals, ['nativeCopper']);
assert.equal(definitions[item('fishing-mace','fishing-mace')].label, 'Copper Bored-handled Barb-flanged Mace');
assert.equal(definitions[item('harlyao-longsword','harlyao-longsword')].label,
  'Copper Harlyao-style Long-blade with a Trapezoidal Hilt');
assert.deepEqual(plain(definitions[item('fishing-spear', 'hatchet')].slots), ['weapon','axe'],
  'only a tool-worthy handle with an axe-capable head grants the existing axe action and mastery events');
assert.deepEqual(plain(definitions[item('dagger','hatchet')].slots), ['weapon'],
  'the same head on a non-tool-worthy hilt must not become an axe');
assert.deepEqual(plain(definitions[item('fishing-spear','pickshovel-scoop')].slots), ['weapon','shovel'],
  'tool role originates with the selected head, not the shaft donor');
assert(config.heads.hoe.toolSlots.includes('hoe'),
  'a hoe head retains its crop-harvest mastery channel when its calibration is eventually approved');

const original = plain(window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.grappleFlail); // The Tool Hub's source must not be mutated by derived weapons.
const shaftOwner = api.flailRecipe('grapple-flail','warhammer'); // Haft-owned rope replaces the authored head with the modular sprite.
assert(shaftOwner?.flail, 'rope-bearing shaft produces an actual flexible weapon assembly');
assert.equal(shaftOwner.flail.chain.type, 'rope');
assert.equal(shaftOwner.flail.chain.lengthPx, original.flail.chain.lengthPx);
assert.equal(shaftOwner.flail.head.layers.length, 1);
assert.equal(shaftOwner.flail.head.layers[0].sprite, config.heads.warhammer.sprite);
assert.equal(shaftOwner.flail.head.anchorLayer, 'modular-head');
assert.equal(shaftOwner.flail.head.anchor.x, config.heads.warhammer.mount.start.x);
assert.equal(shaftOwner.sprite, config.shafts['grapple-flail'].sprite);
const headOwner = api.flailRecipe('fishing-mace', 'grapple-flail'); // Head-owned rope reattaches original multilayer head to a different shaft.
assert(headOwner?.flail);
assert.equal(headOwner.flail.head.layers.length, original.flail.head.layers.length,
  'a multi-layer flexible head retains its full authored back/front render ordering');
assert.equal(headOwner.flail.haftAnchor.x, config.shafts['fishing-mace'].mounts[0].start.x);
assert.equal(headOwner.flail.haftAnchor.y, config.shafts['fishing-mace'].mounts[0].start.y);
assert.equal(headOwner.sprite, config.shafts['fishing-mace'].sprite);
assert.deepEqual(plain(window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.grappleFlail), original,
  'derived modular flails never overwrite the Tool Hub source recipe');
assert.equal(api.isDisallowed('grapple-flail', 'grapple-flail'), true,
  'two rope-owning pieces cannot produce two overlapping pendulums');
assert.equal(api.flailRecipe('grapple-flail', 'grapple-flail'), null);

assert(definitions[item('grapple-flail','warhammer')].weaponAssembly?.flail,
  'real equipment definition hands the multi-sprite runtime a dynamic head/rope assembly');
assert(definitions[item('fishing-mace','grapple-flail')].weaponAssembly?.flail,
  'head-authored flexible assemblies reach the exact same renderer');
assert.equal(definitions[item('fishing-mace','warhammer')].weaponAssembly, undefined,
  'ordinary rigid modular weapons keep their prior baked sprite route');

const editable = plain(config); // Author edits and imported draft sanitation exercise the real replace() migration path.
editable.heads.warhammer.weaponNames = { prefix: 'Mallet Head', suffix: 'Hammer End' };
editable.heads.warhammer.toolSlots = ['axe', 'weapon', 'unknown', 'axe'];
editable.shafts.dagger.namePosition = 'suffix';
editable.shafts.dagger.nameAffix = 'on a dagger grip';
editable.shafts.dagger.toolWorthy = true;
editable.shafts['grapple-flail'].flailAssembly = null;
api.replace(editable);
assert.equal(api.weaponName('dagger','warhammer','Copper'), 'Copper Hammer End on a dagger grip');
assert.deepEqual(plain(api.getConfig().heads.warhammer.toolSlots), ['axe']);
assert.equal(api.getConfig().shafts['grapple-flail'].flailAssembly, null,
  'author can remove an existing rope reference and return to rigid weapon behavior');
api.registerDefinitions(definitions, shapes, metals, ['nativeCopper']);
assert.deepEqual(plain(definitions[item('dagger','warhammer')].slots), ['weapon','axe']);
const oldDraft = plain(window.MODULAR_WEAPON_CONFIG); // Old browser drafts predate the new name and role metadata.
delete oldDraft.heads['fishing-mace'].weaponNames;
oldDraft.heads['fishing-mace'].label = 'Fishing Mace'; // Historical weapon label must not overwrite a newly published part label.
delete oldDraft.shafts['fishing-mace'].namePosition;
oldDraft.shafts['fishing-mace'].label = 'Fishing Mace';
api.replace(oldDraft);
assert.equal(api.getConfig().heads['fishing-mace'].label, 'Barb-flanged Mace Head');
assert.equal(api.getConfig().shafts['fishing-mace'].label, 'Bored Wrapped Handle');

const gameHtml = fs.readFileSync('docs/index.html', 'utf8'); // Check the runtime and modular authoring tool use the same cache-revisioned catalog.
const editorHtml = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8');
for (const id of ['head-part-label','head-name-prefix','head-name-suffix','head-tool-slots','shaft-tool-worthy',
  'shaft-name-affix','shaft-name-position','head-flail-assembly','shaft-flail-assembly','head-rope-x','head-rope-y'])
  assert(editorHtml.includes('id="' + id + '"'), 'The editable modular part field must exist: ' + id);
const gameToken = gameHtml.split('config/modular-weapons.js?v=')[1]?.split('"')[0];
const editorToken = editorHtml.split('config/modular-weapons.js?v=')[1]?.split('"')[0];
assert.equal(editorToken, gameToken, 'Game and editor must share the same committed modular catalog version');
const runtimeSource = fs.readFileSync('docs/js/modular-weapons.js', 'utf8');
assert(runtimeSource.includes('if (flail) paintHaft();'),
  'moving modular flail heads must never be burned into the rigid weapon base texture');
console.log('Modular part names, tool slots, flail ownership and draft migration passed.');
