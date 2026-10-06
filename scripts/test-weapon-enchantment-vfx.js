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
assert(vfxSource.includes("'spirit-wisp'") && vfxSource.includes("'dead-light-orb'") && vfxSource.includes("'veil-shard'"), 'Ohthic visual vocabulary must remain explicitly spectral.');
assert(vfxSource.includes('opacity: 0.38'), 'Ohthic particles must remain ghostly/semi-transparent rather than sharing the opaque planar defaults.');
const enchantmentScriptAt = indexSource.indexOf('js/combat/combat-enchantments.js'); // Used to pin VFX dependency order against its authoritative planar state provider.
const vfxScriptAt = indexSource.indexOf('js/combat/weapon-enchantment-vfx.js?v=20261006planar1'); // Used to pin the cache-busted runtime entry point.
assert(enchantmentScriptAt >= 0 && vfxScriptAt > enchantmentScriptAt, 'weapon enchantment VFX must load directly after EnchantmentSystem with a cache-busted URL.');

const gear = {}; // Used by the VM harness as the active character's persistent gear inventory.
let saves = 0; // Used to confirm player visual choices call the normal gear-save seam.
const context = {
  window: {
    Combat: {
      deps: {
        getGearInventory: () => gear,
        saveGearInventory: () => { saves += 1; },
        currentWeaponKey: () => 'dagger_copper',
      },
    },
    EnchantmentSystem: {
      PLANES: ['Tothal', 'Hronal', 'Kanthic', 'Ohthic'],
      planarCounts: () => ({ Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 1 }),
    },
    RuntimeFrameScheduler: { register() {} },
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
assert.strictEqual(api.ALIGNMENTS.Tothal.dyeIds.length, 12, 'Tothal palette must mirror 3 lich hue families × 4 authored variants.');
assert.strictEqual(api.ALIGNMENTS.Hronal.dyeIds.length, 20, 'Hronal palette must mirror 5 lich hue families × 4 authored variants.');
assert.strictEqual(api.ALIGNMENTS.Kanthic.dyeIds.length, 15, 'Kanthic palette must mirror 3 hue families × 4 variants plus white/gray/charcoal.');
assert(api.ALIGNMENTS.Ohthic.opacity < 0.5, 'Ohthic base opacity must stay visibly spectral.');
assert.deepStrictEqual(Array.from(api.activeAlignments('dagger_copper')), ['Ohthic'], 'visual plane choices must be constrained to alignments actually present on the weapon.');
assert.strictEqual(api.stateFor('dagger_copper').alignment, 'Ohthic', 'an Ohthic-only weapon must default its visual source to Ohth.');
assert.strictEqual(api.setChoice('dagger_copper', 'dyeId', 'dye:CLOTH:silver'), true, 'Ohthic weapons must accept their spectral color choices.');
assert.strictEqual(api.setChoice('dagger_copper', 'effectId', 'spirit-wisp'), true, 'Ohthic weapons must accept plane-themed particle forms.');
assert.strictEqual(gear.weaponEnchantmentVisuals.dagger_copper.dyeId, 'dye:CLOTH:silver', 'selected enchantment color must persist on the literal weapon key.');
assert.strictEqual(gear.weaponEnchantmentVisuals.dagger_copper.effectId, 'spirit-wisp', 'selected particle form must persist on the literal weapon key.');
assert.strictEqual(saves, 2, 'each visual customization mutation must use saveGearInventory exactly once.');

console.log('weapon enchantment VFX tests passed');
