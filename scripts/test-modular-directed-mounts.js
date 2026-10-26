'use strict';

const assert = require('node:assert/strict'); // Regression assertions for geometry, compatibility and old exported drafts.
const fs = require('node:fs'); // Loads real production files, not duplicated algorithms.
const vm = require('node:vm'); // Runs browser runtime without the DOM.
const window = {}; // Standalone editor/runtime namespace.
const ctx = vm.createContext({ window, console }); // Pure affine and catalog checks do not require browser APIs.
for (const path of ['docs/config/modular-weapons.js', 'docs/js/modular-weapons.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
}
const api = window.ModularWeapons; // Shared gameplay + authoring compositor.
const plain = value => JSON.parse(JSON.stringify(value)); // Compare objects across VM realms.
const close = (a, b, label) => assert(Math.abs(a - b) < 1e-7, label + ': ' + a + ' != ' + b); // Floating geometry tolerance.

const cfg = api.getConfig(); // New v2 catalog.
assert.equal(cfg.schema, 'hobunji_modular_weapons.v2');
assert.equal(cfg.heads.dagger.mount.type, 'blade');
assert.equal(cfg.heads.warhammer.mount.type, 'weight');
assert.equal(cfg.shafts.dagger.mounts[0].type, 'tang');
assert.equal(cfg.shafts.warhammer.mounts[0].type, 'eye');
assert.equal(cfg.shafts.warhammer.defaults, undefined, 'No shaft-wide placement defaults remain.');
assert.equal(api.isDisallowed('dagger', 'warhammer'), true, 'Blade haft cannot take a weight eye without an eye mount.');
assert.equal(api.isDisallowed('warhammer', 'dagger'), true, 'Weight haft cannot take a tang blade without a tang mount.');
assert.equal(api.isDisallowed('dagger', 'fishing-spear'), false, 'Tang-to-tang pairing remains compatible.');
assert.equal(api.isDisallowed('warhammer', 'fishing-mace'), false, 'Eye-to-eye pairing remains compatible.');
assert.equal(cfg.shafts.bshuakauitl.mounts.length, 2, 'Multi-ended haft keeps both arrows.');
const values = api.settings('dagger', 'warhammer'); // Historical calibration retained for existing saves.
assert.equal(values.y, 45);
assert.equal(values.animation, 'thrust');

const head = { type: 'blade', start: { x: 100, y: 200 }, end: { x: 100, y: 160 } }; // 40-pixel head tang, pointing upward.
const tang = { type: 'tang', start: { x: 260, y: 800 }, end: { x: 340, y: 800 } }; // 80-pixel haft tang, pointing right.
const neutral = { scaleX: 1, scaleY: 1, flipX: false, flipY: false, x: 0, y: 0, rotation: 0 };
const transform = api.headTransform(tang, neutral, head); // Auto: +90° and 2x scale, without any manual correction.
close(transform.a * head.start.x + transform.c * head.start.y + transform.e, tang.start.x, 'Arrow base x');
close(transform.b * head.start.x + transform.d * head.start.y + transform.f, tang.start.y, 'Arrow base y');
close(transform.a * head.end.x + transform.c * head.end.y + transform.e, tang.end.x, 'Arrow tip x');
close(transform.b * head.end.x + transform.d * head.end.y + transform.f, tang.end.y, 'Arrow tip y');
close(Math.hypot(transform.a, transform.b), 2, 'Automatic uniform scale');
const corrected = api.headTransform(tang, { ...neutral, x: 5, y: 10, scaleX: 1.5, rotation: 30 }, head); // Pair corrections layered over auto transform.
close(Math.hypot(corrected.a, corrected.b), 3, 'Manual scale multiplies auto scale');
assert.notEqual(corrected.e, transform.e, 'Pair offset actually changes the position.');

const modified = plain(cfg); // Editor adds both kinds to a previously blade-only haft.
modified.shafts.dagger.mounts.push({ type: 'eye', start: { x: 210, y: 615 }, end: { x: 210, y: 535 } });
modified.shafts.dagger.overrides.warhammer.disallow = false; // Explicit legacy disallow still has priority until turned off.
api.replace(modified);
assert.equal(api.isDisallowed('dagger', 'warhammer'), false, 'New eye line enables weighted head.');
assert.equal(api.isDisallowed('dagger', 'fishing-spear'), false, 'Original tang mount still enables blades.');
assert.equal(api.matchingMounts(api.getConfig().shafts.dagger, api.getConfig().heads.warhammer).length, 1);
assert.equal(api.matchingMounts(api.getConfig().shafts.dagger, api.getConfig().heads.dagger).length, 1);
const extras = plain(api.getConfig()); // Per-pair manual corrections must not bleed to another head.
extras.shafts.dagger.overrides.warhammer.x = 42;
api.replace(extras);
assert.equal(api.settings('dagger', 'warhammer').x, 42);
assert.notEqual(api.settings('dagger', 'fishing-spear').x, 42);
assert.equal(api.getConfig().shafts.dagger.mounts.length, 2);
const beforeInvalid = plain(api.getConfig());
const invalid = plain(beforeInvalid); // Validator rejects zero-length directed line without crashing the game.
invalid.shafts.dagger.mounts[0].end = { ...invalid.shafts.dagger.mounts[0].start };
api.replace(invalid);
assert.deepEqual(plain(api.getConfig().shafts.dagger.mounts[0]), plain(cfg.shafts.dagger.mounts[0]));
assert.throws(() => api.replace({ schema: 'not-a-catalog', heads: {}, shafts: {} }), /Invalid modular/);

const migrated = { schema: 'hobunji_modular_weapons.v1', heads: { dagger: { attach: { x: 120, y: 250 } } },
  shafts: { dagger: { attachments: [{ x: 240, y: 880, rotation: 180 }],
    defaults: { scaleX: 1.2, scaleY: 0.75, x: 20, y: 6, rotation: 12, animation: 'thrust' },
    overrides: { 'fishing-spear': { scaleY: 1.5 } } } } }; // Representative v3 localStorage/import data.
api.replace(migrated);
assert.deepEqual(plain(api.getConfig().heads.dagger.mount.start), { x: 120, y: 250 });
assert.deepEqual(plain(api.getConfig().shafts.dagger.mounts[0].start), { x: 240, y: 880 });
assert.equal(api.getConfig().shafts.dagger.mounts[0].end.y, 960, '180° legacy socket becomes a reversed directed line.');
assert.equal(api.settings('dagger', 'fishing-spear').scaleY, 1.5);
assert.equal(api.settings('dagger', 'fishing-spear').scaleX, 1.2);
assert.equal(api.settings('dagger', 'fishing-spear').x, 20);
assert.equal(api.getConfig().shafts.dagger.defaults, undefined);
console.log('Directed mounts: compatibility, arrow alignment, 2x auto scaling, pair-only corrections, multi-mounts, invalid geometry, v1 migration passed.');
