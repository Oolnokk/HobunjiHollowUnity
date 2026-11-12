'use strict';
// Regression contract: fitted weapon attack style + selected tool Neutral, overhead pick/harpoon, reversible Pick-Shovel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = path => fs.readFileSync(path, 'utf8'); // Loads the exact shipped gameplay modules, not stand-in implementation copies.
const store = new Map(); // Simulates a browser's previous Foundry authoring draft for one-time migration tests.
const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
const window = { localStorage: storage, __farmLog() {}, Combat: { deps: {} } }; // Real module namespace, with no browser rendering needed.
const context = vm.createContext({
  window, localStorage: storage, fetch: async () => { throw new Error('offline unit test'); },
  setTimeout: () => 1, clearTimeout() {}, performance: { now: () => 0 },
});
const load = path => vm.runInContext(source(path), context, { filename: path });
const plain = value => JSON.parse(JSON.stringify(value));
load('docs/config/weapon-sprite-assemblies.js');
load('docs/config/modular-weapons.js');
load('docs/js/modular-weapon-bridge-fill.js');
load('docs/js/modular-weapons.js');
load('docs/js/combat/shared-attack-pose.js');
load('docs/js/combat/attack-pose-templates.js');
load('docs/js/tool-activity-stages.js');
load('docs/js/weapon-tool-stances.js');

const api = window.ModularWeapons; // Shared Foundry compatibility and gear-definition resolver.
const config = api.getConfig(); // Current, committed shaft/head authoring rather than mocked test pair flags.
assert.equal(config.shafts['pick-shovel'].editorOnly, false, 'Pick-Shovel must be forgeable, not silently editor-only');
const shapes = {
  pickshovel: { animStyle: 'thrust' }, fishingspear: { animStyle: 'sweep' },
  grappleFlail: { animStyle: 'sweep' }, fishingmace: { animStyle: 'sweep' },
  kylie: { animStyle: 'sweep' }, dagger: { animStyle: 'thrust' },
};
const defs = {}; // Registered catalog for real metal-variant keys and slot eligibility.
api.registerDefinitions(defs, shapes, { nativeCopper: { label: 'Copper' } }, ['nativeCopper']);
const key = (shaft, head) => `modular:${shaft}:${head}:nativeCopper`; // Live composition key used by game.js equipmentSlots.
const pickShaftHatchet = key('pick-shovel', 'hatchet');
const pickShaftSword = key('pick-shovel', 'harlyao-longsword');
const fishShaftPick = key('fishing-spear', 'pick-shovel-pick');
const flexShaftPick = key('grapple-flail', 'pick-shovel-pick');
for (const item of [pickShaftHatchet, pickShaftSword, fishShaftPick, flexShaftPick]) assert(defs[item], item + ' must register');
assert.deepEqual(plain(defs[pickShaftHatchet].slots), ['weapon', 'axe', 'pick']);
assert.deepEqual(plain(defs[pickShaftSword].slots), ['weapon', 'pick'], 'Even a non-pick head uses the Pick-Shovel haft as a pick');
assert.deepEqual(plain(defs[fishShaftPick].slots), ['weapon', 'pick'], 'Pick head mounted on another tool-worthy shaft remains a pick');
assert.equal(defs[fishShaftPick].animStyle, 'thrust', 'An authored pair still controls its own attack animation');
assert.equal(defs[pickShaftHatchet].animStyle, 'thrust', 'Pick-Shovel weapon attack style is not overridden by the new pick role');
assert.equal(api.isDisallowed('pick-shovel', 'pick-shovel-pick'), true, 'Mount compatibility restrictions remain intact');
assert(api.unlockedParts(['pickshovel', 'hatchet'], { tools: {} }, defs).shafts.includes('pick-shovel'));

const oldDraft = plain(window.MODULAR_WEAPON_CONFIG); // Simulates a saved editor draft from before the shaft was enabled.
oldDraft.shafts['pick-shovel'].editorOnly = true;
store.set('hobunji.modularWeapons.v5', JSON.stringify(oldDraft));
store.delete('hobunji.modularWeapons.pickShovelForgeable.v1');
const secondWindow = { localStorage: storage, __farmLog() {} }; // Fresh session checks one-time local migration.
const secondContext = vm.createContext({ window: secondWindow });
for (const f of ['docs/config/modular-weapons.js', 'docs/js/modular-weapons.js']) vm.runInContext(source(f), secondContext, {filename:f});
assert.equal(secondWindow.ModularWeapons.getConfig().shafts['pick-shovel'].editorOnly, false,
  'One-time migration unblocks old local editor-only Pick-Shovel drafts');
assert.equal(store.get('hobunji.modularWeapons.pickShovelForgeable.v1'), '1');

const active = { slot: 'pick', item: fishShaftPick }; // Live player tool selection; reused while cycling different slots.
const deps = {
  TOOL_ITEM_DEFS: defs, equipmentSlots: {
    axe: pickShaftHatchet, pick: fishShaftPick, harpoon: flexShaftPick,
    hoe: pickShaftHatchet, shovel: pickShaftSword,
  },
  getActiveTool: () => active.slot,
  triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {}, releaseWeaponSwingHold() {}, cancelWeaponSwingHold() {},
};
window.Combat.deps = deps;
window.WeaponToolStances.init(deps);
const stances = window.WeaponToolStances; // Runtime's actual slot-aware idle resolver.
const work = window.ToolActivityStages; // Shared work-style adapter used from the in-game beginChargeStage.
for (const [slot, expected] of [
  ['axe', 'topHeavyTool'], ['hoe', 'topHeavyTool'], ['pick', 'longHaftedTool'],
  ['shovel', 'longHaftedTool'], ['harpoon', 'longHaftedTool'],
]) {
  active.slot = slot;
  const k = deps.equipmentSlots[slot];
  assert.deepEqual(plain(stances.toolNeutralPose(slot, k, defs[k])), plain(stances.poses[expected]),
    `${slot} must use its tool type's idle, regardless of the assembled haft`);
}
// Tool Neutral presets may intentionally share defaults; their independent keys (not numeric differences) define the slot contract.
const pickStyle = work.workStyleFor('pick', fishShaftPick, defs[fishShaftPick]);
assert.equal(pickStyle, 'thrust');
const pickThrust = work.workPoseFor('pick', fishShaftPick, defs[fishShaftPick]);
assert.deepEqual(plain(pickThrust.neutral), { ...plain(window.AttackPoseTemplates.poseFor('pickshovel_swing').neutral), ...plain(stances.poses.longHaftedTool) });
assert(pickThrust.windup.y > pickThrust.neutral.y && pickThrust.strike.y < pickThrust.neutral.y,
  'Another shaft with a Pick Head rotates the weapon thrust into an overhead stab');
assert.equal(work.workStyleFor('pick', pickShaftHatchet, defs[pickShaftHatchet]), 'thrust',
  'Any fitted Pick-Shovel head borrows the shaft-specific original thrust');
assert.equal(work.workPoseFor('pick', pickShaftHatchet, defs[pickShaftHatchet]), null,
  'Pick-Shovel shaft retains legacy flipped pick jab, not the generic overhead transform');
const sweep = work.workPoseFor('pick', flexShaftPick, defs[flexShaftPick]);
assert.equal(work.workStyleFor('pick', flexShaftPick, defs[flexShaftPick]), 'sweep');
assert(sweep.windup.pitch !== sweep.neutral.pitch && sweep.strike.pitch !== sweep.neutral.pitch);
assert.equal(sweep.windup.bodyYaw, sweep.neutral.bodyYaw, 'Overhead sweep converts yaw travel into pitch');
const axePose = work.workPoseFor('axe', pickShaftHatchet, defs[pickShaftHatchet]);
assert.equal(axePose.neutral.pitch, stances.poses.topHeavyTool.pitch);
assert.equal(axePose.windup.pitch, axePose.neutral.pitch, 'Non-overhead axe preserves authored thrust pitch');
assert.equal(work.workStyleFor('pick', 'pickshovel', {animStyle:'thrust'}), null,
  'Non-modular pick keeps its existing mining choreography');
assert.equal(work.ACTIVITIES.mine.stages[0].anim, 'thrust', 'NPC mining is not redirected by player equipment');
assert.equal(work.ACTIVITIES.chop.stages[0].pose, true, 'NPC tree-chopping remains its authored attack');

const game = source('docs/game.js'); // Ensure the big gameplay monolith actually calls the extracted adapter.
assert(game.includes("workPoseFor?.(chargeAction.tool, workItemKey, workDef)"));
assert(game.includes("slotDef.modular.shaft === 'pick-shovel'"));
assert(game.includes('TOOL_ITEM_DEFS, // Modular harpoon casting needs'));
const fishing = source('docs/js/fishing-minigame.js');
assert(fishing.includes("workStyleFor?.('harpoon', itemKey, def)"));
console.log('Modular tool work: actual Foundry slots, saved-draft migration, idle poses, overhead strokes, native/NPC isolation and game integration passed.');
