'use strict';
// Invisible offhand tool: a pose that is neither 2H nor Dual Wield may hold an invisible copy of the weapon in the free hand (default: the dual-wield
// offhand stance, optionally an authored per-pose pose). Executes the real hand-tool-grips animation sampler and the dual-wield visuals module.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const gripSource = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const visualSource = fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8');
const STANCE_OFFHAND = { x: 0.13, y: -0.04, z: 0.1, pitch: 40, yaw: 88, roll: -73 };
const tasks = new Map();
const window = {
  location: { pathname: '/index.html' },
  RuntimeFrameScheduler: { register: (id, cb) => tasks.set(id, cb) },
  WeaponToolStances: { getRuntimeState: () => ({ activeSlot: 'weapon', itemKey: 'hatchet', combatNeutralInjected: false }), stanceEngaged: () => true, poses: { dualWieldMain: { x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, roll: -114 }, dualWieldOffhand: { ...STANCE_OFFHAND } } },
  Combat: { deps: { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {} } },
};
const scope = { window, location: window.location, document: { getElementById: () => null }, performance: { now: () => 0 } };
vm.runInNewContext(gripSource, scope);
vm.runInNewContext(visualSource, scope);
const grips = window.HobunjiHandToolGrips;
const visuals = window.HobunjiDualWieldWeaponVisuals;
const near = (a, b, what) => assert(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

assert.deepEqual({ ...visuals.defaultOffhandPose() }, STANCE_OFFHAND, 'the default offhand pose is the dual-wield offhand stance');

// A one-handed swing (no 2H grip, no Dual Wield): the free hand holds the invisible tool the whole time, at the stance pose.
const oneHand = { neutral: { secondaryGrip: { enabled: false }, dualWield: { enabled: false } }, windup: { secondaryGrip: { enabled: false }, dualWield: { enabled: false } }, strike: { secondaryGrip: { enabled: false }, dualWield: { enabled: false } } };
for (const t of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
  const g = grips.animationGripAt(t, { windupFrac: 0.2, strikeFrac: 0.4, holdFrac: 0.6 }, oneHand, 'attack', 'hatchet');
  near(g.offhandIdleBlend, 1, `1H @${t} weight`);
  assert.equal(g.offhandIdlePose, null, 'unauthored: follows the live stance');
}

// A 2H windup/strike takes the hand off the invisible tool; Neutral (always 1H) keeps it: the weight lerps with the grip.
const twoHandSwing = { neutral: { secondaryGrip: { enabled: false } }, windup: { secondaryGrip: { enabled: true } }, strike: { secondaryGrip: { enabled: true } } };
const timing = { windupFrac: 0.2, strikeFrac: 0.4, holdFrac: 0.6 };
near(grips.animationGripAt(0, timing, twoHandSwing, 'attack', 'hatchet').offhandIdleBlend, 1, '2H swing: Neutral has the invisible tool');
near(grips.animationGripAt(0.2, timing, twoHandSwing, 'attack', 'hatchet').offhandIdleBlend, 0, '2H windup releases it');
const half = grips.animationGripAt(0.1, timing, twoHandSwing, 'attack', 'hatchet').offhandIdleBlend;
assert(half > 0 && half < 1, `weight eases across the windup (${half})`);

// Dual Wield owns its own offhand weapon: never both.
const dualSwing = { neutral: { dualWield: { enabled: true } }, windup: { dualWield: { enabled: true } }, strike: { dualWield: { enabled: true } } };
near(grips.animationGripAt(0.3, timing, dualSwing, 'attack', 'dagger').offhandIdleBlend, 0, 'a dual-wield weapon has no invisible tool');

// Per-pose control: disabled poses fall back to the locomotion idle; authored poses lerp channel by channel; unauthored ends use the stance.
const mixed = {
  neutral: { secondaryGrip: { enabled: false }, dualWield: { enabled: false }, offhandIdle: { enabled: false } },
  windup: { secondaryGrip: { enabled: false }, dualWield: { enabled: false }, offhandIdle: { enabled: true, pose: { x: 0.5, y: 0.2, z: 0, pitch: 0, yaw: 0, roll: 0 } } },
  strike: { secondaryGrip: { enabled: false }, dualWield: { enabled: false } },
};
near(grips.animationGripAt(0, timing, mixed, 'attack', 'hatchet').offhandIdleBlend, 0, 'a disabled Neutral keeps the locomotion idle');
const atWindup = grips.animationGripAt(0.2, timing, mixed, 'attack', 'hatchet');
near(atWindup.offhandIdleBlend, 1, 'enabled windup'); near(atWindup.offhandIdlePose.x, 0.5, 'authored windup pose');
const between = grips.animationGripAt(0.3, timing, mixed, 'attack', 'hatchet').offhandIdlePose;
near(between.x, (0.5 + STANCE_OFFHAND.x) / 2, 'lerps from the authored windup toward the stance default at the strike');

// Ranged / load-fire sequences never use it.
near(grips.animationGripAt(0.3, timing, oneHand, 'fire', 'hatchet').offhandIdleBlend, 0, 'ranged');

// Driver-facing state for the active tool, and the visuals module's invisible mode (state keyed on the idle weight, real weapon left visible).
const state = grips.offhandIdleStateForTool('hatchet', 'melee', { animationGripState: grips.animationGripAt(0, timing, oneHand, 'attack', 'hatchet') });
assert.equal(state.blend, 1); assert.equal(state.pose, null);
assert.equal(grips.offhandIdleStateForTool('hatchet', 'ranged'), null, 'ranged context');
visuals.setCarriedSample({ x: 0.1, y: 0.2, z: 0.3, pitchRad: Math.PI / 2, yawRad: 0, rollRad: 0 });
assert.equal(typeof visuals.setCarriedPose, 'function');
console.log('offhand-idle-pose OK');
