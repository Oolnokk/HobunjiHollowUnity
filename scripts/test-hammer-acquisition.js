const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Executes the live generated shape catalog without starting the world.
const catalog = game.slice(game.indexOf('      const TOOL_SHAPE_DEFS ='), game.indexOf('      window.ModularWeapons?.registerDefinitions'));
const window = { location: { pathname: '' }, WEAPON_TRUST_VISIT_CONFIG: { gifts: [], bandits: {} }, MetalCraftShop: { init() {} } }; // Shared production-module sandbox.
window.DoorstepVisits = { whenApiAssigned(name, callback) { if (window[name]) callback(window[name]); }, registerProvider() {} }; // Runs the same smith initialization hook used by gameplay.
const context = vm.createContext({ window, console, setTimeout() {}, document: { addEventListener() {} } }); // Suppresses unrelated visitor scheduling.
vm.runInContext(`const TOOL_ITEM_DEFS = {}; const METAL_DEFS = {nativeCopper:{label:'Native Copper'}, tinBronze:{label:'Tin Bronze'}}; const VERDIGRIS_METAL_KEYS = Object.keys(METAL_DEFS); ${catalog}; window.defs = TOOL_ITEM_DEFS; window.shapes = HELD_SHAPE_DEFS; window.unlocked = UNLOCKED_TOOL_SHAPES;`, context);
for (const metal of ['nativeCopper', 'tinBronze']) {
  assert.deepEqual(Array.from(window.defs[`workhammer_${metal}`].slots), ['pick', 'weapon']);
  assert.deepEqual(Array.from(window.defs[`warhammer_${metal}`].slots), ['weapon']);
  assert.equal(window.defs[`warhammer_${metal}`].dmgType, 'blunt');
  assert.equal(window.defs[`workhammer_${metal}`].dmgType, 'blunt', 'work hammer keeps blunt melee damage');
  assert.equal(window.defs[`kylie_${metal}`].dmgType, 'blunt', 'crafted kylies use blunt melee mastery and impact effects');
}
const banditWeaponPool = vm.runInNewContext(`${fs.readFileSync('docs/config/weapon-trust-visits.js', 'utf8')}; window.WEAPON_TRUST_VISIT_CONFIG.bandits.weaponShapePool`, { window: {} }); // The production cultural bandit pool must admit ordinary work hammers.
assert(banditWeaponPool.includes('workhammer'), 'bandits can spawn with a work hammer');
assert.equal(banditWeaponPool.filter(shape => shape === 'workhammer').length, 1, 'work hammer receives one ordinary equal-weight pool entry');
const liveBanditConfig = vm.runInNewContext(fs.readFileSync('docs/config/weapon-trust-visits.js', 'utf8') + '; window.WEAPON_TRUST_VISIT_CONFIG', { window: {} }); // Uses the shipped cultural-bandit config rather than a synthetic pool.
const banditTestWindow = { WEAPON_TRUST_VISIT_CONFIG: liveBanditConfig, BanditCombat: { init() {} } }; // Minimal singleton needed for the actual cultural bandit bridge to accept combat dependencies.
vm.runInNewContext(fs.readFileSync('docs/js/weapon-trust-bandit-loadouts.js', 'utf8'), { window: banditTestWindow });
banditTestWindow.BanditCombat.init({ HELD_SHAPE_DEFS: window.shapes, TOOL_ITEM_DEFS: window.defs }); // Supplies the same generated catalog consumed by the real selection filter.
const allowedBanditShapes = banditTestWindow.WeaponTrustBanditLoadouts.allowedMeleeShapes('unrelated-species'); // Ensures a non-cultural bandit can genuinely select a hammer.
assert(allowedBanditShapes.includes('workhammer'), 'real bandit loadout filter admits work hammers for ordinary species');
vm.runInContext(fs.readFileSync('docs/js/weapon-trust-visits.js', 'utf8'), context);
const gear = { tools: {}, harlyaoRelics: {} }; // Simulates purchasing and unbinding across smith menu refreshes.
window.MetalCraftShop.init({ UNLOCKED_TOOL_SHAPES: window.unlocked, TOOL_SHAPE_DEFS: window.shapes, TOOL_ITEM_DEFS: window.defs, getGearInventory: () => gear });
for (const key of ['workhammer', 'warhammer', 'harlyaoLongsword', 'harlyaoBroadsword']) assert(!window.unlocked.includes(key));
gear.tools.workhammer_nativeCopper = true;
window.WeaponTrustVisits.syncSmithingShapeUnlocks();
assert(window.unlocked.includes('workhammer'));
assert(!window.unlocked.includes('warhammer'));
window.GameRandom = { random: () => 0 };
vm.runInContext(fs.readFileSync('docs/js/harlyao-relics.js', 'utf8'), context);
const relic = window.HarlyaoRelics.makeRelic('warhammer'); // Exercises bound-key persistence and restored weapon registration.
const boundKey = window.HarlyaoRelics.encodeBoundKey(relic);
assert.equal(window.HarlyaoRelics.decodeBoundKey(boundKey).shape, 'warhammer');
gear.harlyaoRelics.harlyaoRelic_warhammer_test = { shape: 'warhammer' };
window.HarlyaoRelics.init({ TOOL_ITEM_DEFS: window.defs, ITEM_DEFS: {}, getGearInventory: () => gear });
window.HarlyaoRelics.restore();
assert.equal(window.defs.harlyaoRelic_warhammer_test.shapeKey, 'warhammer');
assert.equal(window.defs.harlyaoRelic_warhammer_test.dmgType, 'blunt');
window.WeaponTrustVisits.syncSmithingShapeUnlocks();
assert(window.unlocked.includes('warhammer'));
for (const shape of ['longsword', 'broadsword']) gear.harlyaoRelics[shape] = { shape };
window.WeaponTrustVisits.syncSmithingShapeUnlocks();
assert(window.unlocked.includes('harlyaoLongsword'));
assert(window.unlocked.includes('harlyaoBroadsword'));
const stock = JSON.parse(fs.readFileSync('docs/config/shops/shop-stock.json', 'utf8')); // Confirms the authored store grants the actual registered gear key.
assert.equal(stock.shops.generalStoreWares.goods.find(item => item.key === 'workhammer_nativeCopper').givesTool, 'workhammer_nativeCopper');
window.requestAnimationFrame = () => 1;
vm.runInContext(fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'), context);
for (const key of ['warhammer_nativeCopper', 'workhammer_tinBronze', 'harlyaoRelic_warhammer_test']) {
  assert.equal(window.HobunjiHandToolGrips.weaponHandModeForTool(key), 'two-hand');
  assert(window.HobunjiHandToolGrips.primaryGripSpanForTool(key, 'melee'));
  assert(window.HobunjiHandToolGrips.secondaryGripSpanForTool(key, 'melee'));
}
console.log('Hammer catalog, relic persistence, store stock, and smith discovery unlocks passed.');
