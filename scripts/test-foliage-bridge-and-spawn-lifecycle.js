#!/usr/bin/env node
'use strict';

// Two leaks that together kept every wilderness zone scene alive after the zone cache evicted it
// (found with heap snapshots: about 87% of the memory that outlived eviction was held by this chain).
//
// 1. docs/js/foliage-furniture-renderer.js builds its V27 generator by loading a whole page into a hidden
//    iframe. When that failed it abandoned the iframe in the DOM and let the next caller start another one, so
//    each furniture record of each zone could add another iframe and another 25 s wait.
// 2. docs/js/foliage-furniture-runtime.js spawnForMap() loops over a zone's furniture awaiting that generator
//    and captured the zone's scene; disposeMap() did not cancel it, so while the generator was slow or failing
//    the loop (and with it the scene, its render lists and its geometry buffers) stayed reachable.
//
// This runs the real modules. FOLIAGE_JS_DIR points at another copy of docs/js, which is how the "fails before,
// passes after" check was done.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const jsDir = process.env.FOLIAGE_JS_DIR || path.join(root, 'docs/js');
const flush = async (turns = 8) => { for (let i = 0; i < turns; i++) await new Promise(resolve => setImmediate(resolve)); };

function loadRuntime() {
  const file = path.join(jsDir, 'foliage-furniture-runtime.js');
  delete require.cache[require.resolve(file)];
  return require(file);
}

const stumps = n => ({ objects: Array.from({ length: n }, (_, i) => ({ type: 'stump', id: `s${i}`, col: 2 + i * 3, row: 4 })) });

// ---- 1. a failed generator bridge removes its iframe and backs off -------------------------------------------
function loadRenderer() {
  const timers = [], frames = [];
  let now = 1_000_000;
  const document = {
    body: { appendChild(frame) { frame.attached = true; } },
    createElement(tag) {
      assert.equal(tag, 'iframe');
      const frame = { attached: false, removed: 0, style: {}, listeners: {}, setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; }, remove() { this.removed++; this.attached = false; } };
      frames.push(frame);
      return frame;
    },
  };
  const v27 = '<html><head></head><body></body>\n// Boot\nloadParamsFromLocal();\n</html>';
  const sandbox = {
    document, location: { href: 'http://localhost/index.html' }, URL, console,
    performance: { now: () => now },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    fetch: async () => ({ ok: true, text: async () => v27, json: async () => ({}) }),
  };
  sandbox.window = { THREE: {}, __farmLog() {}, AuthoredFurniture: { load: async key => ({ key, foliageFurniture: { sourcePath: 'docs/config/furniture-authored/x.json' } }), buildGroup: () => ({}) } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(jsDir, 'foliage-furniture-renderer.js'), 'utf8'), sandbox);
  return { api: sandbox.window.FoliageFurnitureRenderer, frames, timers, advance: ms => { now += ms; } };
}

async function bridgeTests() {
  const record = { id: 'r1', furnitureKey: 'chairstump', centerX: 1, centerZ: 1, yawDeg: 0 };

  // Callers that arrive while an attempt is in flight share it.
  {
    const r = loadRenderer();
    const a = r.api.buildInstance(record, {}, {}).catch(e => e);
    const b = r.api.buildInstance({ ...record, id: 'r2' }, {}, {}).catch(e => e);
    await flush();
    assert.equal(r.frames.length, 1, 'two callers share one hidden iframe');
    r.timers.find(t => t.ms === 15000).fn();
    await Promise.all([a, b]);
  }

  const r = loadRenderer();
  const attempt = () => r.api.buildInstance(record, {}, {});
  const first = attempt().catch(e => e);
  await flush();
  assert.equal(r.frames.length, 1, 'the first attempt creates one hidden iframe');
  const loadTimeout = r.timers.find(t => t.ms === 15000);
  assert.ok(loadTimeout, 'the iframe load has a timeout');
  loadTimeout.fn(); // The generator page never finishes loading.
  const firstError = await first;
  assert.match(String(firstError?.message), /timed out/);
  assert.equal(r.frames[0].removed, 1, 'a failed attempt removes its iframe instead of leaving a whole V27 page in the DOM');

  // The rest of that zone\'s furniture, and anything built soon after, fails fast and creates nothing.
  const secondError = await attempt().catch(e => e);
  assert.equal(r.frames.length, 1, 'no new iframe while the bridge is cooling down');
  assert.match(String(secondError?.message), /timed out/, 'callers still see the original failure');
  r.advance(30_000);
  await attempt().catch(() => {});
  assert.equal(r.frames.length, 1, 'still cooling down after 30 s');

  // A later visit tries again, once, and cleans up again.
  r.advance(31_000);
  const third = attempt().catch(e => e);
  await flush();
  assert.equal(r.frames.length, 2, 'one new attempt after the cooldown');
  r.timers.filter(t => t.ms === 15000).pop().fn();
  await third;
  assert.equal(r.frames[1].removed, 1, 'and that one is removed too');
  assert.ok(r.frames.every(f => !f.attached), 'no iframe is left attached');
}

// ---- 2. the spawn loop's cancellation contract (the old loop already stopped after eviction; this keeps it that way) ----
async function spawnTests() {
  const rt = loadRuntime();
  const calls = [];
  globalThis.FoliageFurnitureRenderer = {
    buildInstance(record) {
      return new Promise(resolve => calls.push({ record, finish: () => resolve({ instance: { id: record.id }, data: { seatAnchors: [], footprint: { w: 1, d: 1 } } }) }));
    },
  };
  try {
    const makeDeps = scene => ({ zoneScenes: new Map([['m', { scene }]]), zoneLayouts: new Map([['m', stumps(3)]]), zoneDecorFurnitureGroups: new Map(), debugLog() {} });
    const makeScene = () => ({ added: [], add(o) { this.added.push(o); } });

    // Evicted between two records: the record in flight finishes, but nothing more is added or started.
    {
      const scene = makeScene(); calls.length = 0; rt.init(makeDeps(scene));
      const spawned = rt.spawnForMap('m');
      await flush();
      assert.equal(calls.length, 1, 'the first record is being built');
      calls[0].finish(); await flush();
      assert.deepEqual(scene.added.map(o => o.id), ['s0'], 'the first record is added to the live scene');
      assert.equal(calls.length, 2, 'and the second is now being built');
      rt.disposeMap('m'); // The zone cache evicts the zone.
      calls[1].finish();
      await spawned;
      assert.deepEqual(scene.added.map(o => o.id), ['s0'], 'nothing is added to an evicted zone\'s scene');
      assert.equal(calls.length, 2, 'and the third record is never started');
      assert.equal(rt.debugState('m')[0]?.status || 'not-spawned', 'not-spawned');
    }

    // Evicted before the first record finishes.
    {
      const scene = makeScene(); calls.length = 0; rt.init(makeDeps(scene));
      const spawned = rt.spawnForMap('m');
      await flush();
      rt.disposeMap('m');
      calls[0].finish();
      await spawned;
      assert.equal(scene.added.length, 0, 'a record that finishes after eviction is discarded');
      assert.equal(calls.length, 1);
    }

    // Rebuilding the zone (a new scene) starts a fresh spawn instead of reusing the cancelled one.
    {
      const first = makeScene(), second = makeScene(); calls.length = 0;
      const deps = makeDeps(first); rt.init(deps);
      const spawned = rt.spawnForMap('m'); await flush();
      deps.zoneScenes.set('m', { scene: second });
      const again = rt.spawnForMap('m'); await flush();
      assert.equal(calls.length, 2, 'a different scene gets its own spawn');
      calls[0].finish(); calls[1].finish(); await flush();
      assert.equal(first.added.length, 0, 'the superseded spawn does not touch the old scene');
      assert.deepEqual(second.added.map(o => o.id), ['s0']);
      rt.disposeMap('m'); calls[2]?.finish(); await Promise.all([spawned, again]);
    }
  } finally { delete globalThis.FoliageFurnitureRenderer; }
}

// ---- 3. a spawn loop stuck on a generator that never answers does not keep the scene alive (needs real GC) -----
async function retentionTest() {
  assert.equal(typeof global.gc, 'function', 'run with --expose-gc');
  const rt = loadRuntime();
  // The stuck promise must stay REACHABLE, as it is in the real module (prototypePromises is a module-level cache):
  // a pending promise that nothing holds is garbage together with everything waiting on it, and would hide the leak.
  const cache = new Map();
  globalThis.FoliageFurnitureRenderer = { buildInstance: record => { const stuck = new Promise(() => {}); cache.set(record.id, stuck); return stuck; } };
  const holder = { scene: { add() {} } };
  const ref = new WeakRef(holder.scene);
  const deps = { zoneScenes: new Map([['m', { scene: holder.scene }]]), zoneLayouts: new Map([['m', stumps(2)]]), zoneDecorFurnitureGroups: new Map(), debugLog() {} };
  rt.init(deps);
  rt.spawnForMap('m'); // stays pending on the cached, never-settling promise
  await flush();
  assert.equal(cache.size, 1, 'the spawn loop is waiting on the generator');
  rt.disposeMap('m'); // evict
  deps.zoneScenes.delete('m');
  holder.scene = null;
  for (let i = 0; i < 12 && ref.deref(); i++) { await flush(2); global.gc(); }
  assert.equal(ref.deref(), undefined, 'an evicted zone\'s scene is collected even though its spawn loop is still waiting on a promise that is still reachable');
  delete globalThis.FoliageFurnitureRenderer;
}

async function main() {
  const only = process.env.FOLIAGE_TEST_ONLY || ''; // bridge | spawn | retention: run one part alone
  if (!only || only === 'bridge') await bridgeTests();
  if (!only || only === 'spawn') await spawnTests();
  if (!only || only === 'retention') {
    const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--retention-child'], { stdio: 'inherit', env: process.env });
    assert.equal(child.status, 0, 'retention check (real GC) passed');
  }
  console.log('foliage bridge and spawn lifecycle: ok' + (only ? ` (${only} only)` : ''));
}

if (process.argv.includes('--retention-child')) {
  retentionTest().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
} else {
  main().catch(error => { console.error(error); process.exit(1); });
}
