// Executes the ground-pose render trace against a stubbed HeldGroundPose/RenderHooks: inert without the flag,
// registers exactly one render hook with it, and classifies clearance / matrix / hull-cache failures per draw.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/held-ground-pose-trace.js', 'utf8');

function makeWindow(search) {
  const registered = [];
  const drawn = { inScene: true, drawnHullY: 0.035, drawnPointsY: 0.035, matrixDelta: 0, target: 0.035, floor: 0,
    solvedY: 0.035, solveCalls: 1, failCalls: 0, lastSolveFrame: 1, reason: 'rotation', lastFailReason: null,
    lastFailFrame: null, itemKey: 'spear', speciesId: 'nuhongan', hullBuilds: 2, hullVertices: 43 };
  let traceFlag = null;
  const window = {
    addEventListener() {},
    RenderHooks: { register: spec => registered.push(spec) },
    HeldGroundPose: { setTrace: on => { traceFlag = on; }, traceDrawn: () => drawn, snapshot: () => ({ reason: drawn.reason }) },
    WorldRenderPipeline: { currentPass: () => 'main' },
    RuntimeFrameScheduler: { frameId: () => 1 },
  };
  const context = {
    window, location: { search, href: 'https://example.test/index.html' }, localStorage: { getItem: () => null },
    document: { body: null }, performance: { now: () => 0 }, setInterval() {}, navigator: {}, JSON, Math, Object, Number,
  };
  vm.runInNewContext(source, context);
  return { window, registered, drawn, flag: () => traceFlag };
}

// 1. Without the flag nothing is installed.
{
  const off = makeWindow('');
  assert.equal(off.registered.length, 0);
  assert.equal(off.window.HeldGroundPoseTrace, undefined);
  assert.equal(off.flag(), null);
}

// 2. With the flag: one hook, solver tracing switched on.
const on = makeWindow('?groundPoseTrace=1');
assert.equal(on.registered.length, 1);
assert.equal(on.registered[0].id, 'held-ground-pose-trace');
assert.equal(on.registered[0].scope, 'render');
assert.equal(typeof on.registered[0].afterRender, 'function');
assert.equal(on.flag(), true);

const frameA = { renders: 1 };
const draw = ctx => on.registered[0].afterRender(ctx, null);

// 3. A correct draw is not counted as bad; an out-of-scene sprite is ignored.
draw({ scene: {}, frame: frameA });
on.drawn.inScene = false; draw({ scene: {}, frame: frameA }); on.drawn.inScene = true;
let r = on.window.HeldGroundPoseTrace.report();
assert.equal(r.counts.renders, 1);
assert.equal(r.counts.bad, 0);

// 4. Each failure class is detected and labelled, and frames with mixed results are flagged.
on.drawn.drawnHullY = -0.1; on.drawn.drawnPointsY = -0.1; draw({ scene: {}, frame: frameA }); // clearance
on.drawn.drawnHullY = 0.035; on.drawn.drawnPointsY = 0.035; on.drawn.matrixDelta = 0.5; draw({ scene: {}, frame: frameA }); // matrix
on.drawn.matrixDelta = 0; on.drawn.drawnPointsY = -0.2; draw({ scene: {}, frame: frameA });  // stale hull cache
on.drawn.drawnPointsY = 0.035;
r = on.window.HeldGroundPoseTrace.report();
assert.equal(r.counts.C, 1);
assert.equal(r.counts.M, 1);
assert.equal(r.counts.H, 1);
assert.equal(r.counts.bad, 3);
assert.equal(r.recentBadDraws.map(e => e.kinds).join(','), 'C,M,H');
assert.equal(r.byPass.main.bad, 3);

// 5. A new frame flushes the previous frame's pattern; a frame right then wrong counts as mixed.
draw({ scene: {}, frame: { renders: 1 } });
r = on.window.HeldGroundPoseTrace.report();
assert.equal(r.counts.flickerFrames, 1);
assert.equal(r.recentBadFramePatterns[r.recentBadFramePatterns.length - 1], '.CMH');

console.log('held ground pose trace: flag gating, hook registration and C/M/H classification passed');
