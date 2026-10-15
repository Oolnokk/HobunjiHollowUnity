'use strict';
const assert = require('node:assert/strict'); // Behavioral regression checks.
const fs = require('node:fs'); // Loads the shipped modules.
const vm = require('node:vm'); // Minimal browser runtime without rendering dependencies.
const window = { location: { pathname: '/index.html' }, RuntimeFrameScheduler: { register() {} } }; // Grip scheduler is isolated from a real game loop.
const context = vm.createContext({ window, console, document: { getElementById: () => null }, performance: { now: () => 0 } }); // Shared browser namespace.
function load(path) { vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
load('docs/config/modular-weapons.js');
load('docs/js/modular-weapons.js');
load('docs/js/town-mine.js');
load('docs/js/foundry-shop.js');
load('docs/js/hand-tool-grips.js');
const api = window.ModularWeapons, mine = window.TownMine; // Public feature APIs under test.
const defs = {}, shapes = { dagger: { animStyle: 'thrust', weaponIdleClass: 'light' }, bshuakauitl: { animStyle: 'sweep', weaponIdleClass: 'light' } }; // Donor behavior must remain independent of head type.
const metals = { nativeCopper: { label: 'Copper', hex: '#B87333' } }; // Single tier is enough to exercise deterministic registration.
api.registerDefinitions(defs, shapes, metals, ['nativeCopper']);
const key = api.itemKey('dagger', 'warhammer', 'nativeCopper'); // Blunt head on a dual-wield donor.
assert.equal(defs[key].dmgType, 'blunt');
assert.equal(defs[key].animStyle, 'thrust');
assert.equal(defs[key].shapeKey, 'dagger');
assert.deepEqual(plain(defs[key].slots), ['weapon']);
assert.equal(api.decode('modular:missing:dagger:nativeCopper'), null);
assert.equal(window.HobunjiHandToolGrips.toolKeyFor(key), 'dagger');
assert.equal(window.HobunjiHandToolGrips.weaponHandModeForTool(key), 'dual');
assert.equal(window.HobunjiHandToolGrips.toolScaleForTool(key), window.HobunjiHandToolGrips.toolScaleForTool('dagger'));
assert.deepEqual(plain(window.HobunjiHandToolGrips.authoredPrimaryGripForTool(key)), plain(window.HobunjiHandToolGrips.authoredPrimaryGripForTool('dagger')));
const heavyKey = api.itemKey('bshuakauitl', 'dagger', 'nativeCopper'); // Two-end source retains both sockets and its own two-hand grip.
assert.equal(window.HobunjiHandToolGrips.weaponHandModeForTool(heavyKey), 'two-hand');
assert.equal(api.getConfig().shafts.bshuakauitl.attachments.length, 2);
assert.equal(api.getConfig().shafts.bshuakauitl.attachments[1].rotation, 180);
const draft = plain(api.getConfig()); // Sparse overrides, including explicit false/zero, must remain distinct from inheritance.
draft.shafts.dagger.defaults = { scaleX: 1.2, scaleY: .8, flipX: true, flipY: false, x: 30, y: 10, rotation: 15 };
draft.shafts.dagger.overrides.warhammer = { flipX: false, x: 0, rotation: 0 };
api.replace(draft);
assert.deepEqual(plain(api.settings('dagger', 'warhammer')), { scaleX: 1.2, scaleY: .8, flipX: false, flipY: false, x: 0, y: 10, rotation: 0 });
draft.shafts.dagger.defaults.scaleX = 1.7;
api.replace(draft);
assert.equal(api.settings('dagger', 'warhammer').scaleX, 1.7);
assert.equal(api.settings('dagger', 'warhammer').flipX, false);
assert.throws(() => api.replace({ schema: 'bad' }));
const missingInventory = {}; // Missing stacks must reject a purchase without NaN or free upgrades.
let saves = 0; // Records successful durable transactions only.
mine.init({ inventory: missingInventory, woodItemKeys: ['pineLog', 'shadewoodLog'], save: () => saves++ });
assert.equal(mine.buildImprovement('foundry').ok, false);
assert.equal(mine.getTownValue(), 0);
assert.deepEqual(missingInventory, {});
const inventory = { gold: 3000, stone: 300, shadewoodLog: 150, bar_tinBronze: 40, bar_nativeCopper: 20 }; // Tests a missing first wood species.
mine.init({ inventory, woodItemKeys: ['pineLog', 'shadewoodLog'], save: () => saves++ });
mine.restore({ townValue: 2 });
assert.equal(mine.buildImprovement('foundry').ok, true);
assert.equal(mine.getTownValue(), 5);
assert.equal(mine.salePriceMultiplier(), 1.15);
assert.equal(inventory.pineLog, 0);
assert.equal(inventory.shadewoodLog, 50);
assert.equal(inventory.gold, 1000);
const afterUpgrade = plain(inventory); // Duplicate activation must not charge or award value again.
assert.equal(mine.buildImprovement('foundry').ok, false);
assert.deepEqual(inventory, afterUpgrade);
const saved = plain(mine.serialize()); // Restore must keep the +3 exactly once, without baking it into mine-earned value.
mine.restore(saved); mine.restore(saved);
assert.equal(mine.getTownValue(), 5);
mine.restore({ townValue: 2 });
assert.equal(mine.hasImprovement('foundry'), false);
assert.equal(mine.getTownValue(), 2);
mine.restore(saved);
const gear = { tools: {} }, unlocked = ['dagger']; // Live unlock authority may expand without reinitializing foundry.
window.FoundryShop.init({ inventory, TOOL_ITEM_DEFS: defs, UNLOCKED_TOOL_SHAPES: unlocked, VERDIGRIS_METAL_KEYS: ['nativeCopper'], getGearInventory: () => gear,
  metalBarItemKey: metal => `bar_${metal}`, clampInventoryStack() {}, saveGearInventory() {}, buildInventoryGrid() {}, buildEquipmentSlots() {}, saveMemberWorldData: () => saves++ });
assert.equal(window.FoundryShop.craft('dagger', 'warhammer', 'nativeCopper').ok, false);
unlocked.push('warhammer');
assert.equal(window.FoundryShop.craft('dagger', 'warhammer', 'nativeCopper').ok, true);
assert.equal(gear.tools[key], true);
assert.equal(inventory.gold, 960);
assert.equal(inventory.bar_nativeCopper, 15);
assert.equal(inventory.shadewoodLog, 45);
const afterCraft = plain(inventory); // A stale purchase button cannot consume twice.
assert.equal(window.FoundryShop.craft('dagger', 'warhammer', 'nativeCopper').ok, false);
assert.deepEqual(inventory, afterCraft);
assert.equal(window.FoundryShop.craft('missing', 'dagger', 'nativeCopper').ok, false);
inventory.gold = NaN;
assert.equal(window.FoundryShop.craft('warhammer', 'dagger', 'nativeCopper').ok, false);
const relicParts = api.unlockedParts([], { harlyaoRelics: { relic: { shape: 'longsword' } } }, defs); // Relic unlocks join the same part catalog.
assert(relicParts.heads.includes('harlyao-longsword'));
assert(relicParts.shafts.includes('harlyao-longsword'));
const oldWorld = plain(mine.serialize()); // Switching worlds cannot leak a foundry bonus.
mine.restore(null); assert.equal(mine.getTownValue(), 0); assert.equal(mine.hasImprovement('foundry'), false);
mine.restore(oldWorld); assert.equal(mine.getTownValue(), 5);
assert.equal(saves, 2);
console.log('Foundry/modular weapons: transactions, unlocks, save/restore, damage, donor grips/scales and override inheritance passed.');
