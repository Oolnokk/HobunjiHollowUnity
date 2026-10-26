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
assert.equal(api.getConfig().heads.kylie.dmgType, 'blunt', 'the shipped modular Kylie head must be blunt');
const staleKylieDraft = JSON.parse(JSON.stringify(api.getConfig())); // Simulates a player-authored attachment draft saved before Kylies became blunt.
staleKylieDraft.heads.kylie.dmgType = 'sharp';
api.replace(staleKylieDraft);
assert.equal(api.getConfig().heads.kylie.dmgType, 'blunt', 'imported older attachment drafts cannot silently restore sharp Kylie damage');
const modularEditorHtml = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8'); // Checks that the standalone editor loads the same committed Kylie catalog as gameplay.
const gameplayHtml = fs.readFileSync('docs/index.html', 'utf8');
const modularEditorConfigVersion = modularEditorHtml.match(/\.\.\/\.\.\/config\/modular-weapons\.js\?v=([^"']+)/)?.[1]; // Referenced only in this runtime/editor version parity assertion.
const gameplayConfigVersion = gameplayHtml.match(/config\/modular-weapons\.js\?v=([^"']+)/)?.[1]; // The game page's current modular config cache token.
assert(modularEditorConfigVersion && modularEditorConfigVersion === gameplayConfigVersion, 'standalone Modular Weapon Editor and gameplay load the same Kylie head config version');
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
assert.equal(api.getConfig().shafts.bshuakauitl.mounts.length, 4, 'Both eye locations have perpendicular companion tangs.');
assert(api.getConfig().shafts.bshuakauitl.mounts[1].end.y > api.getConfig().shafts.bshuakauitl.mounts[1].start.y, 'Opposed legacy socket becomes a reversed arrow.');
for (const shaft of ['dagger']) for (const head of ['hatchet', 'war-cleaver', 'warhammer', 'work-hammer']) assert.equal(api.isDisallowed(shaft, head), true);
assert.equal(api.isDisallowed('bshuakauitl', 'warhammer'), false);
for (const [shaftKey, shaft] of Object.entries(api.getConfig().shafts)) {
  for (const [headKey, head] of Object.entries(api.getConfig().heads)) {
    if (shaft.sourceShape === head.sourceShape) assert.equal(api.isDisallowed(shaftKey, headKey), true, `${shaftKey}/${headKey} must not duplicate its original weapon`);
  }
}
for (const head of ['hatchet', 'warhammer', 'work-hammer']) {
  assert.equal(api.isDisallowed('fishing-spear', head), true, 'Blade haft needs a matching eye for weighted heads.');
  assert.equal(api.settings('fishing-spear', head).animation, 'sweep', 'Older pair animation survives even when newly incompatible.');
}
assert.equal(api.isDisallowed('fishing-spear', 'war-cleaver'), false, 'A tang on the haft accepts another blade.');
for (const head of ['dagger', 'dagger-sword', 'harlyao-broadsword', 'harlyao-longsword', 'plains-blade']) assert.equal(api.isDisallowed('bshuakauitl', head), true);
assert.equal(api.settings('fishing-spear', 'dagger').animation, 'thrust');
const spearHammer = api.itemKey('fishing-spear', 'warhammer', 'nativeCopper'); // A sweeping head exception retains the spear's two-hand grip authority.
assert.equal(defs[spearHammer].animStyle, 'sweep');
assert.equal(defs[spearHammer].comboStyle, 'sweep');
assert.equal(window.HobunjiHandToolGrips.toolKeyFor(spearHammer), 'fishingspear');
assert.equal(api.isDisallowed('missing', 'dagger'), true);
assert.equal(api.getConfig().shafts['dagger-sword'].mounts.length, 1);
assert.equal(api.getConfig().shafts['dagger-sword'].crop, undefined);
assert.equal(api.settings('warhammer', 'harlyao-longsword').scaleX, 1.65, 'Keep old calibration as per-pair correction');
assert.equal(api.settings('dagger', 'warhammer').y, 45, 'Keep original haft correction for each head pairing');
const broadShaft = api.getConfig().shafts['harlyao-broadsword']; // Baseline Harlyao sword shaft used for the default longsword proportion.
const longShaft = api.getConfig().shafts['harlyao-longsword']; // Explicit per-head overrides may intentionally diverge from this default relation.
assert.deepEqual(plain(longShaft.mounts), plain(broadShaft.mounts));
assert(Math.abs(api.settings('harlyao-longsword', 'dagger').scaleX - api.settings('harlyao-broadsword', 'dagger').scaleX * .9) < 1e-6);
assert(Math.abs(api.settings('harlyao-longsword', 'dagger').scaleY - api.settings('harlyao-broadsword', 'dagger').scaleY * 1.1) < 1e-6);
assert.equal(longShaft.defaults, undefined, 'No global shaft correction settings remain.');
const draft = plain(api.getConfig()); // Sparse overrides, including explicit false/zero, must remain distinct from inheritance.
draft.shafts.dagger.overrides.warhammer = { scaleX: 1.2, scaleY: .8, flipX: false, flipY: false, x: 0, y: 10, rotation: 0, animation: 'thrust', disallow: true };
api.replace(draft);
assert.deepEqual(plain(api.settings('dagger', 'warhammer')), { scaleX: 1.2, scaleY: .8, flipX: false, flipY: false, x: 0, y: 10, rotation: 0, animation: 'thrust', layerOrder: 'head-over-haft', disallow: true });
draft.shafts.dagger.overrides.warhammer.scaleX = 1.7;
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
unlocked.push('warhammer', 'bshuakauitl');
assert.equal(window.FoundryShop.craft('bshuakauitl', 'dagger', 'nativeCopper').ok, false);
const blockedInventory = plain(inventory); // A direct call with both parts unlocked still must enforce the pair policy.
assert.equal(window.FoundryShop.craft('dagger', 'warhammer', 'nativeCopper').ok, false);
assert.deepEqual(inventory, blockedInventory);
const enabled = plain(api.getConfig()); // Explicit false survives sanitization and grants an author-approved exception.
enabled.shafts.dagger.overrides.warhammer.disallow = false;
enabled.shafts.dagger.mounts.push({ type: 'eye', start: { x: 211, y: 617 }, end: { x: 211, y: 537 } }); // Adds the missing sleeve for a weighted head.
api.replace(enabled);
assert.equal(api.isDisallowed('dagger', 'warhammer'), false);
assert.equal(api.getConfig().shafts.dagger.overrides.warhammer.disallow, false);
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
const relicParts = api.unlockedParts(['dagger'], { harlyaoRelics: { relic: { shape: 'longsword' } } }, defs); // Relic unlocks join the same part catalog.
assert(relicParts.heads.includes('harlyao-longsword'));
assert(relicParts.shafts.includes('harlyao-longsword'));
const oldWorld = plain(mine.serialize()); // Switching worlds cannot leak a foundry bonus.
mine.restore(null); assert.equal(mine.getTownValue(), 0); assert.equal(mine.hasImprovement('foundry'), false);
mine.restore(oldWorld); assert.equal(mine.getTownValue(), 5);
assert.equal(saves, 2);
const legacy = plain(api.getConfig()); // Legacy exports cannot restore the crop/second socket or silently erase new restrictions.
legacy.shafts['dagger-sword'].mounts.push({ type: 'eye', start: { x: 193, y: 880 }, end: { x: 193, y: 800 } });
legacy.shafts['dagger-sword'].crop = { x: 0, y: 640, width: 450, height: 248 };
delete legacy.shafts.dagger.overrides.warhammer.disallow;
api.replace(legacy);
assert.equal(api.isDisallowed('dagger', 'warhammer'), true);
assert.equal(api.getConfig().shafts['dagger-sword'].mounts.length, 2);
assert.equal(api.getConfig().shafts['dagger-sword'].crop, undefined);
const motion = plain(api.getConfig()); // Both animation choices can be authored at shaft and individual-head levels.
motion.shafts['fishing-spear'].overrides.warhammer.animation = 'thrust';
api.replace(motion); api.registerDefinitions(defs, shapes, metals, ['nativeCopper']);
assert.equal(defs[spearHammer].animStyle, 'thrust'); assert.equal(defs[spearHammer].comboStyle, 'thrust');
delete motion.shafts['fishing-spear'].overrides.warhammer.animation;
// There is no global attack animation; the selected combination's missing override inherits the neutral sweep.
api.replace(motion); api.registerDefinitions(defs, shapes, metals, ['nativeCopper']);
assert.equal(api.getConfig().shafts['fishing-spear'].overrides.warhammer.animation, undefined);
assert.equal(defs[spearHammer].animStyle, 'sweep');
motion.shafts['fishing-spear'].overrides.warhammer.animation = 'invalid';
api.replace(motion); assert.equal(api.settings('fishing-spear', 'warhammer').animation, 'sweep');
const olderMotion = plain(api.getConfig()); // Older exports still receive the authored safe spear sweep exceptions.
// Older saved per-pair records also remain independent of any shaft-global default.
api.replace(olderMotion);
assert.equal(api.settings('fishing-spear', 'dagger').animation, 'thrust');
assert.equal(api.settings('fishing-spear', 'warhammer').animation, 'sweep');
const spearInventory = { gold: 100, pineLog: 20, bar_nativeCopper: 10 }, spearGear = { tools: {} }; // The allowed spear/hammer path must actually craft, not merely appear unlocked.
const spearWithEye = plain(api.getConfig()); // Give this thrusting haft an additional sleeve for hammer heads.
spearWithEye.shafts['fishing-spear'].mounts.push({ type: 'eye', start: { x: 199, y: 834 }, end: { x: 199, y: 754 } });
api.replace(spearWithEye);
window.FoundryShop.init({ inventory: spearInventory, TOOL_ITEM_DEFS: defs, UNLOCKED_TOOL_SHAPES: ['fishingspear', 'warhammer'], VERDIGRIS_METAL_KEYS: ['nativeCopper'], getGearInventory: () => spearGear,
  metalBarItemKey: metal => `bar_${metal}`, clampInventoryStack() {}, saveGearInventory() {}, buildInventoryGrid() {}, buildEquipmentSlots() {}, saveMemberWorldData() {} });
assert.equal(window.FoundryShop.craft('fishing-spear', 'warhammer', 'nativeCopper').ok, true);
assert.equal(spearGear.tools[spearHammer], true); assert.equal(spearInventory.gold, 60);
console.log('Foundry/modular weapons: transactions, unlocks, save/restore, damage, donor grips/scales and override inheritance passed.');
