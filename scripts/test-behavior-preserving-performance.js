'use strict';

const assert = require('node:assert/strict'); // Checks exact HUD outputs and live stance-state parity.
const fs = require('node:fs'); // Loads the real browser modules under test.
const vm = require('node:vm'); // Replays browser callbacks in a deterministic fixture.
const cp = require('node:child_process'); // Reads an optional comparison revision without altering the worktree.
const read = path => fs.readFileSync(path, 'utf8'); // Loads working-tree sources for all checks.
const plain = value => JSON.parse(JSON.stringify(value)); // Normalizes cross-context objects for assertions.

function replayReticle(source, kind) {
  let writes = 0; // Counts DOM assignments after construction, not elapsed runtime.
  let hitCalls = 0; // Ensures DOM optimizations never throttle targeting queries.
  let drawn = true; // Simulates drawing and putting away the selected weapon.
  let hits = true; // Changes readiness while the same target remains selected.
  let frameId = 0; // Allocates browser-style RAF handles for disposal checks.
  const frames = new Map(); // Keeps the original private frame callback cadence observable.
  const nodes = new Map(); // Supplies id-based lookup and replacement of disconnected roots.
  const outputs = []; // Captures every tested player's-visible state and diagnostic snapshot.
  function node() {
    const element = { // Minimal DOM node; style assignments are counted even when unchanged.
      style: new Proxy({}, { set(object, key, value) { writes++; object[key] = value; return true; } }),
      dataset: {}, children: [], isConnected: true,
      setAttribute() {}, addEventListener() {},
      appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); },
      remove() { this.isConnected = false; nodes.delete(this.id); },
    };
    return new Proxy(element, { set(object, key, value) { if (key === 'title') writes++; object[key] = value; return true; } });
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    normalize() { const length = Math.hypot(this.x, this.y, this.z) || 1; this.x /= length; this.y /= length; this.z /= length; return this; }
    distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  }
  nodes.set('canvasWrap', node());
  nodes.set('btnWeaponSwitch', {
    classList: { contains: () => drawn },
    getAttribute: () => kind === 'ranged' ? 'Switch to melee weapon' : 'Switch to ranged weapon',
  });
  const target = { id: 'fallback-hostile', x: 32, y: 0, health: 100, areaId: 'town' }; // Exercises the broad melee fallback, not just explicit combat targets.
  const loadout = { tap1: 'combo', tap2: 'quick', hold1: 'chargedBreaker', hold2: 'counterShield' }; // Mutable selection verifies uncached loadout changes.
  const window = {
    RangedWeapons: { equippedRangedKey: () => 'crossbow', wouldHitHostile: () => { hitCalls++; return hits; } },
    Combat: {
      deps: {
        player: { x: 0, y: 0 }, TILE: 64, hostileObjects: [target, target],
        getCurrentArea: () => 'town', currentWeaponKey: () => 'hatchet',
        weaponAbility: () => ({ rangePx: 64 }), getActiveTool: () => 'weapon', getHeldMode: () => drawn ? 'tool' : 'none',
      },
      loadout: { get: () => loadout }, comboData: { combo: [{ rangeMul: 1 }] },
      quickAttackData: { TECHNIQUES: { quick: { rangeMul: 1 } } },
      meleeHit: () => { hitCalls++; return { hit: hits }; },
    },
  }; // Browser globals shared by the actual reticle code.
  const context = { window, console, THREE: { Vector3, MathUtils: { degToRad: d => d * Math.PI / 180 } },
    document: { readyState: 'complete', getElementById: id => nodes.get(id), createElement: node },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  }; // Deterministic browser environment for unmodified module execution.
  vm.runInNewContext(source, context);
  const api = window[kind === 'ranged' ? 'RangedHudReticle' : 'MeleeHudReticle']; // Public runtime API under test.
  function capture() {
    const snapshot = plain(api.snapshot()); // Excludes only the intentionally updated change-summary text.
    delete snapshot.latestChange;
    function appearance(element) { return { style: { ...element.style }, title: element.title || '', children: element.children.map(appearance) }; }
    outputs.push({ snapshot, appearance: appearance(nodes.get(kind + 'HudReticle')), hitCalls });
  }
  function tick() {
    assert.equal(frames.size, 1, 'exactly the original one private RAF remains scheduled');
    const [id, callback] = frames.entries().next().value; // Executes one real browser callback at a time.
    frames.delete(id); callback(); capture();
  }
  capture();
  writes = 0;
  for (let i = 0; i < 60; i++) tick();
  const steadyWrites = writes; // Isolates redundant DOM work from legitimate transition writes.
  hits = false; tick();
  drawn = false; tick(); tick();
  drawn = true; hits = true; tick();
  loadout.tap2 = null; tick();
  target.health = 0; tick();
  target.health = 100; target.areaId = 'elsewhere'; tick();
  target.areaId = 'town'; tick();
  // Include root replacement in parity checks; do not bundle unrelated visual fixes.
  nodes.get(kind + 'HudReticle').remove(); tick();
  api.dispose();
  assert.equal(frames.size, 0, 'dispose cancels the scheduled callback');
  return { outputs, steadyWrites };
}

for (const kind of ['melee', 'ranged']) {
  const path = `docs/js/combat/${kind}-hud-reticle.js`; // Selects the actual HUD runtime.
  const current = replayReticle(read(path), kind); // Replays the current implementation.
  assert.equal(current.steadyWrites, 0, `${kind}: unchanged frames perform no DOM writes`);
  if (process.env.PERF_BASE_REF) {
    const baseline = replayReticle(cp.execFileSync('git', ['show', `${process.env.PERF_BASE_REF}:${path}`], { encoding: 'utf8' }), kind); // Optional exact before/after replay.
    assert.deepEqual(current.outputs, baseline.outputs, `${kind}: gameplay outputs and hit-query cadence match baseline`);
    console.log(`${kind}: 60 unchanged frames, DOM assignments ${baseline.steadyWrites} -> ${current.steadyWrites}`);
  }
}

let stanceNow = 1000; // Advances actual owner animation progress through its matrix hook.
const stanceTimers = []; // Flushes the owner's existing deferred completion cleanup explicitly.
const stanceHolder = { updateMatrixWorld() {}, matrixWorld: { clone: () => ({}) } }; // No visible mesh is needed to test live animation-state timing.
const stanceContext = { // Runs owner-maintained state against its preexisting diagnostic API.
  window: { Combat: { deps: { triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {}, releaseWeaponSwingHold() {}, cancelWeaponSwingHold() {} } } },
  localStorage: { getItem: () => null }, fetch: async () => { throw Error('offline fixture'); }, performance: { now: () => stanceNow },
  setTimeout: callback => stanceTimers.push(callback),
};
vm.runInNewContext(read('docs/js/weapon-tool-stances.js'), stanceContext);
const stances = stanceContext.window.WeaponToolStances; // Public state owner with live combat hooks.
const equipmentSlots = { weapon: 'axe', hoe: 'hoe' }; // Mutated to verify immediate, not cached, reads.
let activeSlot = 'weapon'; // Switches tool/weapon/dequipped state without synthetic lifecycle events.
stances.init({ getActiveTool: () => activeSlot, equipmentSlots, TOOL_ITEM_DEFS: {
  axe: { shapeKey: 'hatchet', animStyle: 'sweep' }, hoe: { shapeKey: 'hoe', animStyle: 'thrust' },
}, toolMeshMap: {}, toolHolder: stanceHolder });
const borrowed = stances.getRuntimeState(); // Identity must remain stable across owner reads.
function assertState() {
  const live = stances.getRuntimeState(); // Refreshes from live owner fields at the same cadence as old diagnostics.
  const debug = stances.debugSnapshot(); // Existing independent reference for the accessor's values.
  assert.equal(live, borrowed);
  for (const key of Object.keys(live)) assert.deepEqual(live[key], debug[key], `runtime field ${key}`);
}
assertState();
stanceContext.window.Combat.deps.triggerWeaponSwingVisual(1, { anim: 'sweep' }); assertState();
for (const elapsed of [50, 160, 300, 700, 1000]) {
  stanceNow = 1000 + elapsed;
  stanceHolder.updateMatrixWorld(); assertState();
}
for (const callback of stanceTimers.splice(0)) callback();
assertState();
assert.equal(stances.getRuntimeState().combatNeutralInjected, false, 'completion clears live state on the same deferred callback');
stanceContext.window.Combat.deps.triggerWeaponHoldVisual(1, { anim: 'thrust' }); assertState();
stanceNow += 600; stanceHolder.updateMatrixWorld(); assertState();
stanceContext.window.Combat.deps.releaseWeaponSwingHold(); assertState();
stanceContext.window.Combat.deps.cancelWeaponSwingHold(); assertState();
activeSlot = 'hoe'; assertState();
activeSlot = null; assertState();
activeSlot = 'weapon'; equipmentSlots.weapon = 'missing'; assertState();

const driver = read('docs/js/procedural-hand-frame-driver.js'); // Guards that expensive copies are confined to explicit diagnostics.
function replayHandSync(source, diagnostic) {
  let copies = 0; // Counts expensive diagnostic deep copies separately from pose work.
  const calls = []; // Records every actual placement/fallback operation in order.
  const primaryGrip = { position: { x: 1, y: 2, z: 3 } }; // Authored primary socket consumed by the unchanged solver.
  const secondaryGrip = { position: { x: 4, y: 5, z: 6 } }; // Authored secondary socket for two-hand coverage.
  let useSecondary = true; // Switches to free-left-hand fallback in the same replay.
  const record = { rig: { placeHandWorld: (...args) => calls.push(args) }, fallback: { owners: {} } }; // Managed rig receiving frame and render synchronization.
  const context = {
    syncing: false, global: { HobunjiHandGripModes: { currentModeKey: () => 'test' } },
    JSON: { stringify: value => { copies++; return JSON.stringify(value); }, parse: JSON.parse },
    currentToolKey: () => 'axe',
    toolGrips: { primaryGripForTool: () => primaryGrip, secondaryGripForTool: () => useSecondary ? secondaryGrip : null },
    toolSocketWorld: (_record, _holder, grip) => grip,
    handWorldFromSocket: (_record, grip) => ({ position: grip.position, quaternion: { w: 1 }, authored: {}, visualBasis: 'test' }), // Baseline helper retained for PERF_BASE_REF replay.
    handSocketAfterGripMode: (_record, grip) => ({ position: grip.position, quaternion: { w: 1 }, mode: {}, visualBasis: 'test' }), // Current socket-only helper; model calibration is mocked as a downstream child.
    modelCalibrationForRecord: () => ({ modelKey: 'feline', position: { x: 0, y: 0, z: 0 }, rotationQuaternion: { x: 0, y: 0, z: 0, w: 1 } }), // Exact selected-model calibration passed to each held-hand placement.
    profiles: { data: { models: { feline: { handFromTool: {} } } } },
    ensureFallbackState: entry => entry.fallback,
    applyFallbackSide: (_record, side) => calls.push(['fallback', side]),
    applyFallbackBoth: () => calls.push(['fallback', 'both']),
  }; // Isolates synchronization control flow while recording all pose-solver outputs.
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function syncRigToTool('), source.indexOf('  const originalInstallGameRuntime')), context);
  const holder = { parent: {}, visible: true }; // Visible equipped tool, then hidden below.
  const snapshots = []; // Explicit syncNow must retain its original diagnostic payload.
  for (let i = 0; i < 60; i++) snapshots.push(context.syncRigToTool(record, holder, diagnostic));
  useSecondary = false; snapshots.push(context.syncRigToTool(record, holder, diagnostic));
  holder.visible = false; snapshots.push(context.syncRigToTool(record, holder, diagnostic));
  return { calls: plain(calls), snapshots: plain(snapshots), copies, secondaryActive: record.secondaryActive, lastToolKey: record.lastToolKey };
}
const hotHands = replayHandSync(driver, false); // Ordinary RAF/render calls should not build discarded diagnostics.
const debugHands = replayHandSync(driver, true); // Explicit probes still return full cloned authored settings.
assert.equal(hotHands.copies, 0);
assert.deepEqual(hotHands.calls, debugHands.calls);
if (process.env.PERF_BASE_REF) {
  const baselineDriver = cp.execFileSync('git', ['show', `${process.env.PERF_BASE_REF}:docs/js/procedural-hand-frame-driver.js`], { encoding: 'utf8' }); // Untouched synchronization reference.
  const baseline = replayHandSync(baselineDriver, true); // Captures original poses, fallbacks and diagnostic copies.
  assert.deepEqual(debugHands.calls, baseline.calls, 'socket placement/fallback cadence remains behaviorally equivalent after calibration ownership moves downstream');
  assert.deepEqual(hotHands.calls, baseline.calls, 'ordinary hand sync emits the same socket placements and fallbacks');
  assert.equal(debugHands.secondaryActive, baseline.secondaryActive, 'secondary-hand ownership remains unchanged');
  assert.equal(debugHands.lastToolKey, baseline.lastToolKey, 'tool ownership remains unchanged');
  console.log(`hand sync: diagnostic deep copies ${baseline.copies} -> ${hotHands.copies}; socket cadence unchanged while calibration moves to the visual child`);
}
assert.match(driver, /if \(!diagnostic\) return null;[\s\S]*primaryGrip: JSON.parse/);
assert.match(driver, /results.push\(syncRigToTool\(record, holder, true\)\)/);
assert.match(driver, /sentinel.renderOrder = -100000/);
assert.match(read('docs/js/livestock-nursery.js'), /PerfProfiler\?\.traceLivestockCallers === true/);
console.log('Behavior-preserving performance checks passed.');
