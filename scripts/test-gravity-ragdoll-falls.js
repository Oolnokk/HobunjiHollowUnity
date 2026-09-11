const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('docs/js/gravity-ragdoll-fall-bridge.js', 'utf8');
const player = {
  x: 0,
  y: 0,
  vx: 99,
  vy: -42,
  climbSurfaceY: 2,
  _hobunjiFallState: {
    elapsed: 0,
    duration: 99,
    startX: 0,
    startY: 0,
    endX: 10,
    endY: 20,
    startSurfaceY: 2,
    endSurfaceY: 1,
    dropWorld: 1,
    tierDrop: 1,
    rolling: true,
    dir: { x: 1, y: 0 },
  },
};

let baseUpdateCalls = 0;
let probeCalls = 0;
let ragdollStopCalls = 0;
const ragdollTriggers = [];

const window = {
  Combat: { deps: { player } },
  HobunjiPlateauFalls: { probe() { probeCalls++; return false; } },
  ClimbSystem: {
    updateClimb() {
      baseUpdateCalls++;
      const state = player._hobunjiFallState;
      if (state && state.elapsed >= state.duration) player._hobunjiFallState = null;
      return true;
    },
  },
  ImpactBlendLibrary: {
    getClip(bank, direction) {
      assert.equal(bank, 'breakThrow');
      assert.equal(direction, 'front');
      return { durationSeconds: 1, frames: [{}] };
    },
  },
  ImpactRagdollPlayback: {
    trigger(bank, direction, opts) { ragdollTriggers.push({ bank, direction, opts }); return opts.durationMultiplier; },
    stop() { ragdollStopCalls++; },
  },
  requestAnimationFrame() { return 1; },
};
window.window = window;

const context = vm.createContext({
  window,
  document: {
    readyState: 'complete',
    getElementById: () => null,
    addEventListener() {},
  },
  MutationObserver: undefined,
  console,
  Math,
  Number,
});
vm.runInContext(source, context, { filename: 'gravity-ragdoll-fall-bridge.js' });

const Falls = window.HobunjiGravityRagdollFalls;
assert.ok(Falls, 'gravity/ragdoll bridge is exported');
assert.equal(Falls.gravityWorldPerSec2, 9.8, 'gravity is the sole physical acceleration');
assert.equal(Falls.ragdollBank, 'breakThrow', 'fall uses the zero-Footing knockdown animation bank');
assert.equal(probeCalls, 1, 'existing plateau hook is installed before the presentation wrapper');
assert.equal(Falls.getDebug().updateHookInstalled, true, 'ClimbSystem fall presentation hook is installed');

const expectedDuration = Math.sqrt(2 / 9.8);
assert.ok(Math.abs(Falls.gravityDuration(1) - expectedDuration) < 1e-12, 'fall duration follows constant gravity from rest');

window.ClimbSystem.updateClimb(0.1);
const state = player._hobunjiFallState;
assert.ok(state, 'fall remains airborne after the first gravity tick');
assert.equal(baseUpdateCalls, 0, 'old eased fall updater does not run while airborne');
assert.ok(Math.abs(player.climbSurfaceY - 1.951) < 1e-9, 'vertical position is y = y0 - 1/2*g*t^2');
assert.ok(Math.abs(player.x - 10 * (0.1 / expectedDuration)) < 1e-9, 'horizontal travel is deterministic linear authored-path progress');
assert.ok(Math.abs(player.y - 20 * (0.1 / expectedDuration)) < 1e-9, 'second horizontal axis is deterministic authored-path progress');
assert.equal(player.vx, 0, 'no horizontal velocity physics is retained');
assert.equal(player.vy, 0, 'no second-axis velocity physics is retained');
assert.equal(ragdollTriggers.length, 1, 'breakThrow starts once for the fall');
assert.equal(ragdollTriggers[0].bank, 'breakThrow');
assert.equal(ragdollTriggers[0].direction, 'front');
assert.ok(Math.abs(ragdollTriggers[0].opts.durationMultiplier - expectedDuration) < 1e-12, 'ragdoll playback is stretched to the gravity fall duration');

for (let i = 0; i < 10 && player._hobunjiFallState; i++) window.ClimbSystem.updateClimb(0.1);
assert.equal(player._hobunjiFallState, null, 'existing landing owner executes once gravity reaches the authored surface');
assert.equal(baseUpdateCalls, 1, 'underlying fall/climb updater runs only for the authoritative landing tick');
assert.equal(ragdollStopCalls, 1, 'breakThrow visual hold is released at landing');
assert.equal(Falls.getDebug().active, false, 'debug state reports the completed fall');

console.log('gravity ragdoll fall tests passed');
