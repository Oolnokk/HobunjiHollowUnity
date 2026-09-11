const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('docs/js/gravity-ragdoll-fall-bridge.js', 'utf8');
const player = {
  x: 0,
  y: 0,
  vx: 99,
  vy: -42,
  inputX: 0,
  inputY: 0,
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
let freshInput = { x: 0, y: 0 };
const ragdollTriggers = [];

const window = {
  Combat: { deps: { player, TILE: 64 } },
  HobunjiPlateauFalls: { probe() { probeCalls++; return false; } },
  ClimbSystem: {
    init() {},
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
window.ClimbSystem.init({ player, TILE: 64, getMovementInput: () => freshInput });

const Falls = window.HobunjiGravityRagdollFalls;
assert.ok(Falls, 'fall controller is exported');
assert.equal(Falls.simHz, 30, 'air physics uses a Mario-64-style 30 Hz fixed simulation');
assert.equal(Falls.quarterSteps, 4, 'each airborne tick is split into four movement qsteps');
assert.equal(Falls.gravityPerStepWorld, 0.01, 'vertical speed loses a fixed amount each simulation tick');
assert.equal(Falls.terminalFallPerStepWorld, 0.1875, 'fall speed has a terminal cap');
assert.equal(Falls.terminalFallPerStepWorld / Falls.gravityPerStepWorld, 18.75, 'scaled controller preserves SM64 terminal/gravity ratio 75:4');
assert.equal(Falls.ragdollBank, 'breakThrow', 'fall uses the zero-Footing knockdown animation bank');
assert.equal(probeCalls, 1, 'existing plateau hook is installed before the presentation wrapper');
assert.equal(Falls.getDebug().updateHookInstalled, true, 'ClimbSystem fall presentation hook is installed');
assert.equal(Falls.getDebug().climbDepsCaptured, true, 'fall controller captures ClimbSystem fresh-input deps');

assert.equal(Falls.fallStepCount(1), 15, 'one-world-unit drop resolves in discrete fixed ticks from rest');
assert.equal(Falls.gravityDuration(1), 0.5, 'predicted one-unit fall duration is derived from those fixed ticks');

window.ClimbSystem.updateClimb(0.1);
const state = player._hobunjiFallState;
assert.ok(state, 'fall remains airborne after the first three fixed ticks');
assert.equal(baseUpdateCalls, 0, 'old eased fall updater does not run while airborne');
assert.ok(Math.abs(player.climbSurfaceY - 1.97) < 1e-9, 'vertical position follows frame-stepped gravity after three ticks');
assert.ok(Math.abs(player.x - 2) < 1e-9, 'horizontal carry advances by fixed per-tick authored velocity with neutral input');
assert.ok(Math.abs(player.y - 4) < 1e-9, 'second ground-plane axis advances by the same fixed-tick model');
assert.ok(Math.abs(player.vx - 20) < 1e-9, 'horizontal carry is exposed as kinematic velocity rather than rigid-body momentum');
assert.ok(Math.abs(player.vy - 40) < 1e-9, 'second ground-plane carry remains kinematic');
assert.equal(ragdollTriggers.length, 1, 'breakThrow starts once for the fall');
assert.equal(ragdollTriggers[0].bank, 'breakThrow');
assert.equal(ragdollTriggers[0].direction, 'front');
assert.ok(Math.abs(ragdollTriggers[0].opts.durationMultiplier - 0.5) < 1e-12, 'ragdoll playback is stretched to the predicted fixed-step fall duration');

freshInput = { x: 1, y: 0 };
const beforeSteerX = player.x;
window.ClimbSystem.updateClimb(1 / 30);
assert.ok(player.x > beforeSteerX + (10 / 15) - 1e-9, 'fresh airborne input adds a limited steering component on top of authored carry');
assert.equal(Falls.getDebug().airInput.source, 'getMovementInput', 'air steering uses the current-frame ClimbSystem input authority');
assert.ok(Falls.getDebug().airControlVelocity.x > 0, 'air-control velocity responds to held input');

for (let i = 0; i < 20 && player._hobunjiFallState; i++) window.ClimbSystem.updateClimb(1 / 30);
assert.equal(player._hobunjiFallState, null, 'existing landing owner executes when fixed-step gravity reaches the authored lower surface');
assert.equal(baseUpdateCalls, 1, 'underlying fall/climb updater runs only for the authoritative landing tick');
assert.equal(ragdollStopCalls, 1, 'breakThrow visual hold is released at landing');
assert.equal(Falls.getDebug().active, false, 'debug state reports the completed fall');
assert.ok(Falls.getDebug().verticalVelocityPerStep >= -Falls.terminalFallPerStepWorld, 'debugged vertical velocity never exceeds terminal fall speed');

console.log('SM64-style gravity ragdoll fall tests passed');
