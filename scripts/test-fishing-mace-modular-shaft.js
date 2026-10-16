'use strict';

const assert = require('node:assert/strict'); // Verifies the fishing-mace shaft's Foundry/runtime contract.
const fs = require('node:fs'); // Confirms the configured PNG exists and loads shipped browser modules.
const vm = require('node:vm'); // Runs the browser modules in a minimal isolated window.
const window = { location: { pathname: '/index.html' }, RuntimeFrameScheduler: { register() {} } }; // Shared browser namespace used by the loaded modules.
const context = vm.createContext({ window, console, document: { getElementById: () => null }, performance: { now: () => 0 } }); // Minimal DOM/runtime surface required by these modules.

function load(path) { vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

load('docs/config/modular-weapons.js');
load('docs/js/modular-weapons.js');
load('docs/js/hand-tool-grips.js');

const api = window.ModularWeapons; // Public modular-weapon API under test.
const defs = {}; // Receives generated modular item definitions for the assertions below.
const shapes = { fishingmace: { animStyle: 'sweep', weaponIdleClass: 'light' } }; // Donor metadata the new shaft must preserve.
const metals = { nativeCopper: { label: 'Native Copper', hex: '#B87333' } }; // One metal tier is enough to verify deterministic registration.
const shaft = api.getConfig().shafts['fishing-mace']; // Authored Fishing Mace shaft entry wired to the uploaded asset.

assert(shaft, 'Fishing Mace shaft must be registered.');
assert.equal(shaft.sourceShape, 'fishingmace');
assert.equal(shaft.sprite, 'assets/toolsprites/modular_pieces/weaponshaft_fishing_mace.png');
assert.equal(fs.existsSync(`docs/${shaft.sprite}`), true, 'Configured Fishing Mace shaft sprite must exist.');
assert.deepEqual(plain(shaft.attachments), [{ x: 193, y: 850, rotation: 0 }]);
assert.deepEqual(plain(shaft.defaults), {
  scaleX: 1,
  scaleY: 1,
  flipX: false,
  flipY: false,
  x: 5,
  y: 30,
  rotation: 0,
  animation: 'sweep',
});
assert.equal(shaft.defaults.animation, 'sweep');

assert.equal(api.isDisallowed('fishing-mace', 'fishing-mace'), true, 'Original-piece duplication must be excluded from Foundry and random selection.');

api.registerDefinitions(defs, shapes, metals, ['nativeCopper']);
const key = api.itemKey('fishing-mace', 'fishing-mace', 'nativeCopper'); // Native head/shaft pairing exercises the new donor path.
assert.equal(defs[key].shapeKey, 'fishingmace');
assert.equal(defs[key].animStyle, 'sweep');
assert.equal(defs[key].comboStyle, 'sweep');
assert.equal(defs[key].dmgType, 'blunt');
assert.equal(window.HobunjiHandToolGrips.toolKeyFor(key), 'fishingmace');
assert.equal(window.HobunjiHandToolGrips.weaponHandModeForTool(key), 'dual');

const unlocked = api.unlockedParts(['fishingmace'], { tools: {} }, defs); // Existing Fishing Mace discovery must unlock both modular parts.
assert(unlocked.heads.includes('fishing-mace'));
assert(unlocked.shafts.includes('fishing-mace'));

console.log('Fishing Mace modular shaft: uploaded authoring, Foundry unlock, dual-wield donor behavior, and original-pair restriction passed.');
