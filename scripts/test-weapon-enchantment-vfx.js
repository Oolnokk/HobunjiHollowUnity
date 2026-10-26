const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const vfxPath = path.resolve(__dirname, '../docs/js/combat/weapon-enchantment-vfx.js'); // Used to load the new runtime module for source and state-persistence checks.
const verdigrisPath = path.resolve(__dirname, '../docs/js/tool-metal-recolor.js'); // Used to pin the metal-region detector to the existing verdigris thresholds.
const indexPath = path.resolve(__dirname, '../docs/index.html'); // Used to verify the VFX module is a normal cache-busted parser dependency after EnchantmentSystem.
const vfxSource = fs.readFileSync(vfxPath, 'utf8'); // Used by structural regression assertions below.
const verdigrisSource = fs.readFileSync(verdigrisPath, 'utf8'); // Used to compare canonical metal-selection constants.
const indexSource = fs.readFileSync(indexPath, 'utf8'); // Used to protect the explicit combat-module load order.
const loadoutUiSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/combat/combat-loadout-ui.js'), 'utf8'); // Used to verify aura controls are part of the loadout's authoritative render path.

function numberConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([0-9.]+)`)); // Used to read simple numeric detector constants without executing either renderer.
  assert(match, `Missing numeric constant ${name}`);
  return Number(match[1]);
}

assert(vfxSource.includes("const SOURCE_HEX = '#5A8480'"), 'enchantment VFX must use the same authored metal source key as verdigris.');
assert(verdigrisSource.includes("const SOURCE_HEX = '#5A8480'"), 'verdigris source key unexpectedly changed; update the shared VFX detector deliberately if this is intentional.');
assert.strictEqual(numberConstant(vfxSource, 'SOURCE_HUE_TOL_DEG'), numberConstant(verdigrisSource, 'DEFAULT_HUE_TOL_DEG'), 'enchantment and verdigris hue tolerances must match.');
assert.strictEqual(numberConstant(vfxSource, 'SOURCE_SAT_TOL'), numberConstant(verdigrisSource, 'DEFAULT_SAT_TOL'), 'enchantment and verdigris saturation tolerances must match.');
assert.strictEqual(numberConstant(vfxSource, 'SOURCE_ALPHA_MIN'), numberConstant(verdigrisSource, 'DEFAULT_ALPHA_MIN'), 'enchantment and verdigris alpha floors must match.');
assert(vfxSource.includes('ColorFill'), 'metal mask must reuse canonical ColorFill HSV math instead of maintaining unrelated color-distance code.');
assert(vfxSource.includes('hobunjiDualWieldDuplicate'), 'dual-wield enchantments must target the two visible copied weapon planes instead of the hidden midpoint source.');
assert(vfxSource.includes('ProceduralHandAttachments?.gameDeps'), 'runtime must resolve the exact live held-tool mesh through the existing hand/equipment seam first.');
assert(vfxSource.includes('weaponEnchantmentVisuals'), 'semi-customizable color/effect selections must persist per weapon in gearInventory.');
assert(vfxSource.includes('handDeps?.toolHolder'), 'held-weapon resolution must support the real runtime dependency bag when toolMeshMap is absent.');
assert(vfxSource.includes('generation !== scanGeneration'), 'older async mask scans must be rejected after a newer weapon/config scan starts.');
assert(!vfxSource.includes('function installLoadoutHook()'), 'VFX must not monkeypatch CombatLoadoutUI.render; the owner render path calls it directly.');
assert(loadoutUiSource.includes('window.WeaponEnchantmentVFX?.renderControls?.(pane, toolKey)'), 'the authoritative loadout render must always inject the enchantment aura controls.');
assert(vfxSource.includes("alignmentSelect.id = 'weaponEnchantmentVfxAlignment'") && vfxSource.includes("colorSelect.id = 'weaponEnchantmentVfxColor'") && vfxSource.includes("effectSelect.id = 'weaponEnchantmentVfxEffect'"), 'aura controls need stable ids so controller focus survives loadout rerenders.');
assert(vfxSource.includes("'spirit-wisp'") && vfxSource.includes("'dead-light-orb'") && vfxSource.includes("'veil-shard'"), 'Ohthic visual vocabulary must remain explicitly spectral.');

const enchantmentScriptAt = indexSource.indexOf('js/combat/combat-enchantments.js'); // Used to pin VFX dependency order against its authoritative planar state provider.
const vfxScriptAt = indexSource.search(/js\/combat\/weapon-enchantment-vfx\.js\?v=[A-Za-z0-9_-]+/); // Used to require a cache-busted runtime entry point without pinning its current token.
assert(enchantmentScriptAt >= 0 && vfxScriptAt > enchantmentScriptAt, 'weapon enchantment VFX must load directly after EnchantmentSystem with a cache-busted URL.');

const gear = {}; // Used by the VM harness as the active character's persistent gear inventory.
let activeSlot = 'weapon'; // Changes below to prove ranged, tools and holstered equipment never inherit a melee weapon's aura.
let heldMode = 'tool'; // Changes below to test the game-wide drawn/holstered equipment state.
let equippedMeleeKey = 'dagger_copper'; // Changes below to catch stale Combat weapon keys after swapping the actual equipped weapon.
let scheduledVfxUpdate = null; // Captured from RuntimeFrameScheduler so the held-slot invalidation is exercised without browser devtools.
let saves = 0; // Used to confirm player visual choices call the normal gear-save seam.
const heldToolPlane = { isObject3D: true }; // Used by the runtime-shape test to stand in for the real held PNG plane without pulling THREE into this focused VM harness.
const heldToolVisual = { visible: true, userData: { itemKey: 'dagger_copper', toolPlane: heldToolPlane } }; // Used to reproduce the supported gameplay dependency shape where toolHolder exists but toolMeshMap does not.
const context = {
  window: {
    Combat: {
      deps: {
        getGearInventory: () => gear,
        saveGearInventory: () => { saves += 1; },
        currentWeaponKey: () => 'dagger_copper',
        getActiveTool: () => activeSlot,
        getHeldMode: () => heldMode,
        equipmentSlots: { get weapon() { return equippedMeleeKey; } },
      },
    },
    EnchantmentSystem: {
      PLANES: ['Tothal', 'Hronal', 'Kanthic', 'Ohthic'],
      planarCounts: () => ({ Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 1 }),
    },
    ProceduralHandAttachments: {
      gameDeps: {
        toolHolder: { children: [heldToolVisual] },
      },
    },
    RuntimeFrameScheduler: { register(_id, callback) { scheduledVfxUpdate = callback; } },
  },
  document: { readyState: 'loading' },
  performance: { now: () => 1000 },
  requestAnimationFrame: () => 0,
  setInterval: () => 1,
  clearInterval: () => {},
  URL,
  Uint32Array,
  Map,
  Set,
  Object,
  Math,
  Number,
  Promise,
  console,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(vfxSource, context, { filename: 'weapon-enchantment-vfx.js' });

const api = context.window.WeaponEnchantmentVFX; // Used to exercise the public persistence/customization contract without THREE/DOM rendering.
assert(api, 'WeaponEnchantmentVFX must install its public API.');
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, true, 'toolHolder-only runtime dependencies must resolve the live held weapon without scene traversal or toolMeshMap.');
assert(scheduledVfxUpdate, 'weapon enchantment update must be registered with the existing frame scheduler.');
const heldDeps = context.window.ProceduralHandAttachments.gameDeps; // The same holder the runtime reads when a melee weapon, ranged weapon or tool is drawn.
const rangedVisual = { visible: true, userData: { itemKey: 'bow', toolPlane: { isObject3D: true } } }; // Unenchanted ranged weapon used to reproduce the leaking fallback.
const hoeVisual = { visible: true, userData: { itemKey: 'hoe', toolPlane: { isObject3D: true } } }; // Unenchanted tool used to reproduce the same issue.

activeSlot = 'ranged';
heldDeps.toolHolder.children = [rangedVisual];
heldDeps.toolMeshMap = { weapon: heldToolVisual, ranged: rangedVisual };
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, false, 'an enchanted equipped melee weapon must not decorate the active ranged slot.');
scheduledVfxUpdate(1100);
assert.strictEqual(api.debugSnapshot('dagger_copper').activeHeldWeaponKey, null, 'ranged weapon must stop the emission update immediately.');

activeSlot = 'hoe';
heldDeps.toolHolder.children = [hoeVisual];
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, false, 'any other tool slot must suppress the melee enchantment effect.');
scheduledVfxUpdate(1116);
assert.strictEqual(api.debugSnapshot('dagger_copper').emitters, 0, 'changing tools must not create a stray emitter.');

activeSlot = 'weapon';
heldDeps.toolHolder.children = [rangedVisual];
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, false, 'even with the weapon slot selected, the current held visual must match that weapon and be attached.');
heldDeps.toolHolder.children = [heldToolVisual, rangedVisual];
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, true, 'the matching melee visual is still selected when another plane also exists.');

heldMode = 'none';
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, false, 'holstering a weapon must suppress particles.');
scheduledVfxUpdate(1132);
assert.match(api.debugSnapshot('dagger_copper').lastEvent, /aura cleared/, 'holstering should clear on the same frame, not after the next scheduled mask scan.');
heldMode = 'item';
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, false, 'holding a bag item must suppress particles too.');
heldMode = 'tool';
equippedMeleeKey = 'hatchet';
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, false, 'an out-of-sync equipped weapon key must not adorn another weapon.');
equippedMeleeKey = 'dagger_copper';
heldDeps.toolHolder.children = [heldToolVisual];
heldDeps.toolMeshMap = undefined;
assert.strictEqual(api.debugSnapshot('dagger_copper').heldVisualFound, true, 're-equipping the matching melee weapon restores a valid particle target.');
scheduledVfxUpdate(1148);
assert.strictEqual(api.ALIGNMENTS.Tothal.dyeIds.length, 12, 'Tothal palette must mirror 3 lich hue families × 4 authored variants.');
assert.strictEqual(api.ALIGNMENTS.Hronal.dyeIds.length, 20, 'Hronal palette must mirror 5 lich hue families × 4 authored variants.');
assert.strictEqual(api.ALIGNMENTS.Kanthic.dyeIds.length, 15, 'Kanthic palette must mirror 3 hue families × 4 variants plus white/gray/charcoal.');
assert(Object.values(api.ALIGNMENTS).every(def => def.opacity >= 0.6), 'every planar origin must have at least 60% base opacity.');
assert.deepStrictEqual(Array.from(api.activeAlignments('dagger_copper')), ['Ohthic'], 'visual plane choices must be constrained to alignments actually present on the weapon.');
assert.strictEqual(api.stateFor('dagger_copper').alignment, 'Ohthic', 'an Ohthic-only weapon must default its visual source to Ohth.');
assert.strictEqual(api.setChoice('dagger_copper', 'dyeId', 'dye:CLOTH:silver'), true, 'Ohthic weapons must accept their spectral color choices.');
assert.strictEqual(api.setChoice('dagger_copper', 'effectId', 'spirit-wisp'), true, 'Ohthic weapons must accept plane-themed particle forms.');
assert.strictEqual(gear.weaponEnchantmentVisuals.dagger_copper.dyeId, 'dye:CLOTH:silver', 'selected enchantment color must persist on the literal weapon key.');
assert.strictEqual(gear.weaponEnchantmentVisuals.dagger_copper.effectId, 'spirit-wisp', 'selected particle form must persist on the literal weapon key.');
assert.strictEqual(saves, 2, 'each visual customization mutation must use saveGearInventory exactly once.');

console.log('weapon enchantment VFX tests passed');
// Legacy states preserve their palette and particle form when the origins split.
gear.weaponEnchantmentVisuals.dagger_copper = { alignment: 'Ohthic', dyeId: 'dye:CLOTH:silver', effectId: 'spirit-wisp' };
assert.strictEqual(api.stateFor('dagger_copper').colorAlignment, 'Ohthic');
context.window.EnchantmentSystem.planarCounts = () => ({ Tothal: 1, Hronal: 1, Kanthic: 0, Ohthic: 1 });
assert(api.setChoice('dagger_copper', 'colorAlignment', 'Hronal'));
assert(api.setChoice('dagger_copper', 'dyeId', api.ALIGNMENTS.Hronal.dyeIds[1]));
assert.strictEqual(api.stateFor('dagger_copper').effectId, 'spirit-wisp', 'palette origin changes preserve the particle form');
assert(api.setChoice('dagger_copper', 'alignment', 'Tothal'));
assert.strictEqual(api.stateFor('dagger_copper').colorAlignment, 'Hronal', 'particle origin changes preserve the palette origin');
assert.strictEqual(api.stateFor('dagger_copper').dyeId, api.ALIGNMENTS.Hronal.dyeIds[1], 'particle origin changes preserve the chosen color');
assert.strictEqual(api.setChoice('dagger_copper', 'colorAlignment', 'Kanthic'), false, 'absent enchantment origins remain unavailable');
assert.strictEqual(api.setChoice('dagger_copper', 'effectId', 'spirit-wisp'), false, 'form must belong to its selected origin');
assert.strictEqual(api.setChoice('dagger_copper', 'dyeId', 'dye:CLOTH:silver'), false, 'color must belong to its independent selected origin');
vm.runInContext(vfxSource, context, { filename: 'weapon-enchantment-vfx.js' });
assert.strictEqual(context.window.WeaponEnchantmentVFX.stateFor('dagger_copper').colorAlignment, 'Hronal', 'mixed origins survive module reload');
context.window.EnchantmentSystem.planarCounts = () => ({ Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 1 });
assert.strictEqual(api.stateFor('dagger_copper').colorAlignment, 'Ohthic', 'removed origins fall back to an active palette');
assert.strictEqual(api.stateFor('dagger_copper').alignment, 'Ohthic', 'removed origins fall back to an active form');
