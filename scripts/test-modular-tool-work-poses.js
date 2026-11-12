'use strict';
// Regression contract: fitted weapon attack style + selected tool Neutral, reversible Pick-Shovel and distinct fishing throws.
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
assert.deepEqual(plain(pickThrust.neutral), { ...plain(window.AttackPoseTemplates.poseFor('pickshovel_swing').neutral), ...plain(stances.poses.longHaftedTool), bodyYaw: 0 }, 'Work Neutral applies the holder stance without rotating the actor body at rest');
assert(pickThrust.windup.z < pickThrust.neutral.z && pickThrust.strike.z > pickThrust.neutral.z,
  'Pick head on another shaft uses the assembled weapon thrust trajectory, not Pick-Shovel-only jab');
assert.equal(work.workStyleFor('pick', pickShaftHatchet, defs[pickShaftHatchet]), 'thrust',
  'Any fitted Pick-Shovel head borrows the shaft-specific original thrust');
assert.equal(work.workPoseFor('pick', pickShaftHatchet, defs[pickShaftHatchet]), null,
  'Pick-Shovel shaft retains legacy flipped pick jab, not the generic overhead transform');
const sweep = work.workPoseFor('pick', flexShaftPick, defs[flexShaftPick]);
assert.equal(work.workStyleFor('pick', flexShaftPick, defs[flexShaftPick]), 'sweep');
assert(sweep.windup.bodyYaw !== sweep.neutral.bodyYaw && sweep.strike.bodyYaw !== sweep.neutral.bodyYaw, 'Sweep motion retains its authored body turn');
assert.equal(sweep.windup.pitch, sweep.neutral.pitch, 'Tool-role work preserves the authored sweep plane');
const axePose = work.workPoseFor('axe', pickShaftHatchet, defs[pickShaftHatchet]);
assert.equal(axePose.neutral.pitch, stances.poses.topHeavyTool.pitch);
assert.equal(axePose.windup.pitch, axePose.neutral.pitch, 'Non-overhead axe preserves authored thrust pitch');
assert.equal(work.workStyleFor('pick', 'pickshovel', {animStyle:'thrust'}), null,
  'Non-modular pick keeps its existing mining choreography');
assert.equal(work.ACTIVITIES.mine.stages[0].anim, 'thrust', 'NPC mining is not redirected by player equipment');
assert.equal(work.ACTIVITIES.chop.stages[0].pose, true, 'NPC tree-chopping remains its authored attack');


// A backhand must reverse the WORK MOTION, not mirror the Tool Neutral itself.
const sweepAxeKey = key('fishing-spear', 'hatchet'); // Existing sweep-style axe on a long fishing haft.
assert(defs[sweepAxeKey]?.slots.includes('axe'), 'sweep-axe fixture qualifies for regular tree felling');
const axeForward = work.workPoseFor('axe', sweepAxeKey, defs[sweepAxeKey], 1); // First forehand stroke.
const axeBackhand = work.workPoseFor('axe', sweepAxeKey, defs[sweepAxeKey], -1); // Next stroke must not jump to a mirrored rest pose.
assert.deepEqual(plain(axeForward.neutral), plain(axeBackhand.neutral), 'Both alternating attacks share one idle Neutral');
for (const channel of ['x', 'yaw', 'roll', 'bodyYaw']) {
  const forehandDelta = axeForward.windup[channel] - axeForward.neutral[channel]; // Directional windup offset from the same idle.
  const backhandDelta = axeBackhand.windup[channel] - axeBackhand.neutral[channel]; // Corresponding mirrored stroke.
  assert(Math.abs(forehandDelta + backhandDelta) < 1e-8, `${channel}: mirrored attack delta, stable idle`);
}
const sampleA = window.SharedAttackPose.createSample(); // Samples both source poses through the actual renderer's shared interpolation.
const sampleB = window.SharedAttackPose.createSample();
const styleNeutral = window.SharedAttackPose.STYLE_NEUTRAL_POSE.sweep; // Same built-in sweep fallback as updateToolMesh.
window.SharedAttackPose.samplePose(sampleA, axeForward, styleNeutral, 0, .22, .55, .7, 1, 1, 'attack');
window.SharedAttackPose.samplePose(sampleB, axeBackhand, styleNeutral, 0, .22, .55, .7, 1, 1, 'attack');
for (const channel of ['x', 'y', 'z', 'pitchRad', 'yawRad', 'rollRad', 'bodyYawRad']) {
  assert(Math.abs(sampleA[channel] - sampleB[channel]) < 1e-8, `${channel}: neither start frame may pop or flip`);
}
const pickBackhand = work.workPoseFor('pick', flexShaftPick, defs[flexShaftPick], -1); // Mirrored pick sweep preserves the same working Neutral.
assert.equal(pickBackhand.neutral.bodyYaw, sweep.neutral.bodyYaw);
assert(Math.abs((pickBackhand.windup.bodyYaw - pickBackhand.neutral.bodyYaw) +
  (sweep.windup.bodyYaw - sweep.neutral.bodyYaw)) < 1e-8, 'backhand mirrors the body turn, not the carried tool Neutral');

// Fishing selects the shipped non-spinning spear and spinning weapon throws; flail heads spin on their tether instead.
window.HeldActionAnimations = {
  weaponThrowSpin: { durationS: 1.04, spinRevolutions: 2.5, projectileSpin: true, poses: { neutral: { shoulderAim: { grip: true } }, windup: { shoulderAim: { grip: false } }, strike: { shoulderAim: { grip: false } } } },
  weaponThrowSpearSpin: { durationS: 1.04, toolEndFlip: true, projectileSpin: false, poses: { neutral: { shoulderAim: { grip: true } }, windup: { shoulderAim: { grip: false } }, strike: { shoulderAim: { grip: false } } } },
};
const fishingSource = source('docs/js/fishing-minigame.js'); // Extract the live fishing animation selector without loading its DOM-bound render loop.
const startFishingSelector = fishingSource.indexOf('  function selectedFishingThrowAnimation() {');
const endFishingSelector = fishingSource.indexOf('\n  function beginFishingThrowWindup(', startFishingSelector);
assert(startFishingSelector >= 0 && endFishingSelector > startFishingSelector);
const sweepingHarpoon = key('fishing-spear', 'fishing-mace'); // A normal swinging modular harpoon.
const thrustingHarpoon = key('pick-shovel', 'fishing-mace'); // A non-spinning modular harpoon.
const flailHarpoon = key('fishing-mace', 'grapple-flail'); // A flexible fishing head carried on an ordinary tool-worthy haft.
for (const k of [sweepingHarpoon, thrustingHarpoon, flailHarpoon]) assert(defs[k]?.slots.includes('harpoon'), k + ' must qualify for fishing');
const fishingContext = vm.createContext({ window, deps: { equipmentSlots: { harpoon: sweepingHarpoon }, TOOL_ITEM_DEFS: defs } });
vm.runInContext(fishingSource.slice(startFishingSelector, endFishingSelector) + '\nthis.select = selectedFishingThrowAnimation;', fishingContext);
const sweepingThrow = fishingContext.select();
assert.equal(sweepingThrow.animation, window.HeldActionAnimations.weaponThrowSpin,
  'Sweeping modular fishing reuses the exact existing spinning throw animation');
assert.equal(sweepingThrow.projectileMode, 'spin', 'Sweeping modular projectiles spin during outbound flight');
fishingContext.deps.equipmentSlots.harpoon = thrustingHarpoon;
const thrustingThrow = fishingContext.select();
assert.equal(thrustingThrow.animation, window.HeldActionAnimations.weaponThrowSpearSpin,
  'Thrusting modular fishing reuses the exact existing non-tumbling harpoon throw');
assert.equal(thrustingThrow.projectileMode, 'spear', 'Thrusting modular projectiles do not spin in flight');
fishingContext.deps.equipmentSlots.harpoon = flailHarpoon;
const flailThrow = fishingContext.select();
assert.equal(flailThrow.projectileMode, 'flail');
assert.equal(flailThrow.animation.heldSpin, false, 'Flail handle is never spun or detached in-hand');
assert.equal(flailThrow.animation.flailHeadSpin, true, 'Spin only the flail head/chain at the real attachment point');
assert.equal(flailThrow.animation.toolEndFlip, false, 'Flail handle is not end-flipped during the throw');
assert.equal(flailThrow.animation.poses, window.HeldActionAnimations.weaponThrowSpin.poses,
  'Flail keeps the existing spinning throw body/arm path');
assert.equal(flailThrow.flailHead, defs[flailHarpoon].weaponAssembly.flail.head,
  'Fishing ring uses all fitted flail-head art layers rather than a generic mace');
assert(flailThrow.flailHead.layers.length > 1, 'Multi-layer Grapple-Flail head must not be reduced to one sprite');
fishingContext.deps.equipmentSlots.harpoon = 'fishingspear';
const nativeThrow = fishingContext.select();
assert.equal(nativeThrow.animation, window.HeldActionAnimations.weaponThrowSpearSpin,
  'Unmodified native Fishing Spear keeps its original thrown-weapon animation');
assert.equal(nativeThrow.projectileMode, 'spear');
assert(fishingSource.includes("const flailFishingHeadImages = new WeakMap()"), 'Fishing composites each multi-layer head only once');
assert(fishingSource.includes("const mode = bridge?.projectileMode"), 'Projectile ring uses its snapped throw type');
assert(fishingSource.includes("flailFishingHeadImages.get(bridge.flailHead)"), 'Projectile sprite uses the flexible head, not the detached shaft');
assert(fishingSource.includes("b.projectileMode === 'flail' ? b.weaponSpinDeg : 0"), 'Flail head returns from its final spun angle without snapping');

const game = source('docs/game.js'); // Ensure the big gameplay monolith actually calls the extracted adapter.
assert(game.includes("workPoseFor?.(chargeAction.tool, workItemKey, workDef, stageDef.dirSign)"));
assert(game.includes("slotDef.modular.shaft === 'pick-shovel'"));
assert(game.includes('toolHolder.userData.authoredToolActionActive ='), 'Game advertises an active tool pose before the stance hook runs');
assert(game.includes('const modularWorkSweep ='), 'Tool swing smoothly restores the sprite-plane basis at the attack boundaries');
const stancesSource = source('docs/js/weapon-tool-stances.js');
assert(stancesSource.includes('authoredToolActionActive || holderIsMoving(now)'), 'Idle stance must not reapply itself over an authored tool attack');
assert(game.includes('TOOL_ITEM_DEFS, // Modular harpoon casting needs'));
const fishing = source('docs/js/fishing-minigame.js');
assert(fishing.includes("workStyleFor?.('harpoon', itemKey, def)"));
assert(game.includes('fishingFlailHeadSpin: activeTool ==='), 'Game forwards flail-head spin mode without turning the shaft');
console.log('Modular tool work and fishing: shaft/pick roles, carried neutrals, shipped spear/spin throws, tethered flail-head-only spin and native/NPC isolation passed.');
