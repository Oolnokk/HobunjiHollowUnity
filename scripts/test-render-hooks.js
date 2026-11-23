#!/usr/bin/env node
'use strict';

// Executes docs/js/render-hooks.js: base install over an r128-style renderer,
// hook ordering/nesting, 'frame' scope (once per world frame, per-render outside
// one), appliesTo, afterRender, error isolation, enable/disable, nested renders,
// the "existing base" fallback, and a migrated owner module running through it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function loadHooks({ prototypeRender = null } = {}) {
  function WebGLRenderer() {}
  if (prototypeRender) WebGLRenderer.prototype.render = prototypeRender;
  const context = { console, performance: { now: () => 0 }, THREE: { WebGLRenderer } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('docs/js/render-hooks.js'), context, { filename: 'render-hooks.js' });
  return context;
}

function makeRenderer(window, log) {
  const renderer = Object.create(window.THREE.WebGLRenderer.prototype);
  renderer.__hobunjiR128NativeRender = (scene, camera) => { log.push(`native:${scene.name}`); if (scene.fail) throw new Error('native failed'); return `drawn:${scene.name}`; };
  return renderer;
}

// ── Base install + per-render ordering ────────────────────────────────────
{
  const window = loadHooks();
  const hooks = window.RenderHooks;
  assert.equal(typeof window.THREE.WebGLRenderer.prototype.render, 'function', 'the registry provides the prototype base render');
  assert.equal(window.THREE.WebGLRenderer.prototype.render.__hobunjiRenderHooksBase, true);
  const log = [];
  const renderer = makeRenderer(window, log);
  const scene = { name: 'world', isScene: true };
  hooks.register({ id: 'inner', order: 20, before: () => { log.push('inner+'); return 'i'; }, after: (_c, s) => log.push(`inner-${s}`) });
  hooks.register({ id: 'outer', order: 10, before: () => { log.push('outer+'); return 'o'; }, after: (_c, s) => log.push(`outer-${s}`), afterRender: () => log.push('outer:afterRender') });
  assert.equal(renderer.render(scene, {}), 'drawn:world', 'render returns the native result');
  assert.deepEqual(log, ['outer+', 'inner+', 'native:world', 'outer:afterRender', 'inner-i', 'outer-o'],
    'lower order runs first; afters unwind in reverse like nested wrappers');
  assert.deepEqual(plain(hooks.list()), ['outer', 'inner']);
  // Idempotent register by id; unregister.
  hooks.register({ id: 'outer', order: 99, before: () => log.push('dup') });
  assert.deepEqual(plain(hooks.list()), ['outer', 'inner'], 're-registering an id is a no-op');
  const off = hooks.register({ id: 'temp', before: () => log.push('temp') });
  off();
  assert.ok(!hooks.list().includes('temp'));
  // Disable one hook live.
  log.length = 0;
  hooks.setEnabled('outer', false);
  renderer.render(scene, {});
  assert.deepEqual(log, ['inner+', 'native:world', 'inner-i']);
  hooks.setEnabled('outer', true);
  // Errors are isolated and counted; the frame still draws and other afters still run.
  log.length = 0;
  const originalWarn = console.warn; console.warn = () => {};
  try {
    hooks.register({ id: 'bad-before', order: 15, before: () => { throw new Error('boom'); } });
    hooks.register({ id: 'bad-after', order: 16, after: () => { throw new Error('bust'); } });
    renderer.render(scene, {});
  } finally { console.warn = originalWarn; }
  assert.deepEqual(log, ['outer+', 'inner+', 'native:world', 'outer:afterRender', 'inner-i', 'outer-o'], 'a failing hook never blocks the draw or other restores');
  const debug = hooks.getDebug();
  assert.match(debug.hooks.find(h => h.id === 'bad-before').lastError, /before: boom/);
  assert.match(debug.hooks.find(h => h.id === 'bad-after').lastError, /after: bust/);
  // A native failure still runs every after().
  log.length = 0;
  console.warn = () => {};
  try { assert.throws(() => renderer.render({ name: 'broken', fail: true }, {}), /native failed/); }
  finally { console.warn = originalWarn; }
  assert.ok(log.includes('inner-i') && log.includes('outer-o'), 'restores run when the native render throws: ' + JSON.stringify(log));
}

// ── 'frame' scope ─────────────────────────────────────────────────────────
{
  const window = loadHooks();
  const hooks = window.RenderHooks;
  const log = [];
  const renderer = makeRenderer(window, log);
  const world = { name: 'world', isScene: true };
  const quad = { name: 'quad', isScene: true };
  let applied = 0;
  hooks.register({ id: 'body', scope: 'frame', order: 10,
    before: ctx => { applied++; log.push(`body+${ctx.scene.name}`); return applied; },
    after: (_ctx, n) => log.push(`body-${n}`),
    afterRender: () => log.push('body:capture') });
  hooks.register({ id: 'every', order: 20, before: ctx => log.push(`every+${ctx.scene.name}`) });

  const frame = hooks.beginWorldFrame({ renderer, scene: world, camera: {} });
  renderer.render(quad, {}); // An unrelated quad scene first: not the world scene.
  renderer.render(world, {});
  renderer.render(world, {});
  renderer.render(quad, {});
  assert.equal(applied, 1, 'applied once for the world scene, never for other scenes');
  assert.equal(frame.renders, 4, 'the frame counts every native render');
  assert.equal(log.filter(e => e === 'body:capture').length, 1, 'afterRender fires once, after the first draw with the hook applied');
  assert.ok(!log.includes('body-1'), 'not undone until the frame ends');
  hooks.endWorldFrame();
  assert.equal(log.at(-1), 'body-1', 'undone at endWorldFrame');
  assert.equal(log.filter(e => e.startsWith('every+')).length, 4, 'render-scope hooks still run per call');
  hooks.endWorldFrame(); // Idempotent.
  // Outside a world frame: per-render semantics.
  log.length = 0;
  renderer.render(world, {});
  assert.deepEqual(log, ['body+world', 'every+world', 'native:world', 'body:capture', 'body-2']);
  // A/B switch: frame hooks fall back to per-render inside a world frame too.
  hooks.setFrameScopeEnabled(false);
  const appliedBefore = applied;
  hooks.beginWorldFrame({ renderer, scene: world });
  renderer.render(world, {}); renderer.render(world, {});
  hooks.endWorldFrame();
  assert.equal(applied, appliedBefore + 2, 'with frame scope disabled a frame hook applies per render');
  hooks.setFrameScopeEnabled(true);
  assert.equal(hooks.getDebug().frameScopeEnabled, true);
  log.length = 0;
  renderer.render(world, {});
  // A missed end is closed by the next begin, never leaked.
  hooks.beginWorldFrame({ renderer, scene: world });
  renderer.render(world, {});
  const beforeSecondBegin = log.length;
  hooks.beginWorldFrame({ renderer, scene: world });
  assert.ok(log.slice(beforeSecondBegin).some(entry => entry.startsWith('body-')), 'an unbalanced begin restores the previous frame first');
  assert.equal(hooks.getDebug().unbalancedFrames, 1);
  hooks.endWorldFrame();
  // Nested render inside a hook's frame.
  log.length = 0;
  hooks.register({ id: 'nested', order: 30, before: ctx => { if (ctx.scene.name === 'world' && !ctx.depth) renderer.render({ name: 'inner' }, {}); } });
  hooks.beginWorldFrame({ renderer, scene: world });
  renderer.render(world, {});
  hooks.endWorldFrame();
  assert.ok(log.includes('native:inner') && log.indexOf('native:inner') < log.indexOf('native:world'), 'nested renders are dispatched too');
  assert.equal(hooks.getDebug().nestedRenders, 1);
}

// ── Existing prototype base: the registry sits directly above it ────────────
{
  const calls = [];
  const window = loadHooks({ prototypeRender: function existingBase(scene) { calls.push(['existing', this.tag, scene.name]); return 'existing'; } });
  const hooks = window.RenderHooks;
  hooks.register({ id: 'h', before: ctx => calls.push(['hook', ctx.renderer.tag]) });
  const renderer = Object.create(window.THREE.WebGLRenderer.prototype);
  renderer.tag = 'r1';
  assert.equal(renderer.render({ name: 'w' }, {}), 'existing');
  assert.deepEqual(calls, [['hook', 'r1'], ['existing', 'r1', 'w']], 'hooks run, then the pre-existing base with the real renderer as this');
}

// ── A migrated owner: NpcSocialInhibition applies once per world frame ─────
{
  const window = loadHooks();
  const walker = {
    root: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, updateMatrixWorld() {} },
    state: 'idle', area: 'test',
    currentScheduleTarget: { socialLookAt: { x: 1, z: 1 } },
  };
  window.NpcActivityPlanner = { init() {}, resolveNpcTarget: () => null };
  window.setInterval = () => 0;
  vm.runInContext(read('docs/js/npc-social-inhibition-runtime.js'), window, { filename: 'npc-social-inhibition-runtime.js' });
  window.NpcActivityPlanner.init({ listNpcWalkersInArea: () => [walker], getCurrentArea: () => 'test' });
  assert.ok(window.RenderHooks.list().includes('npc-social-inhibition'), 'the module registers with RenderHooks instead of wrapping render()');
  assert.equal(window.THREE.WebGLRenderer.prototype.render.__npcSocialInhibitionRenderHook, undefined, 'no prototype wrapper is installed');
  const log = [];
  const renderer = makeRenderer(window, log);
  const world = { name: 'world', isScene: true };
  window.RenderHooks.beginWorldFrame({ renderer, scene: world });
  for (let i = 0; i < 6; i++) renderer.render(world, {});
  assert.equal(window.NpcSocialInhibition.getDebug().facingApplications, 1, 'facing presentation computed once for six passes');
  window.RenderHooks.endWorldFrame();
  window.RenderHooks.beginWorldFrame({ renderer, scene: world });
  renderer.render(world, {});
  window.RenderHooks.endWorldFrame();
  assert.equal(window.NpcSocialInhibition.getDebug().facingApplications, 2, 'the next world frame applies again');
}

// Exercise two draws in the same frame with the production portrait hooks.
{
  const window = loadHooks();
  const source = read('docs/js/png-plane-avatar.js');
  const begin = source.indexOf('  const frozenPortraits =');
  const end = source.indexOf('  function registerSkinnedPortrait(', begin);
  vm.runInContext(`
    const NECK_BONE = 7;
    let portraitWireframeEnabled = false;
    const portraitMeshRefs = new Set(), portraitMeshBuilds = new WeakMap();
    ${source.slice(begin, end)}
    window.portraitFixture = { frozenPortraits, portraitMeshRefs, portraitMeshBuilds, savePortraitPose };
  `, window);
  const { frozenPortraits, portraitMeshRefs, portraitMeshBuilds, savePortraitPose } = window.portraitFixture;
  const world = { name: 'world', isScene: true, visible: true };
  const renderer = makeRenderer(window, []);
  const camera = { layers: { mask: 1 } };
  const skin = { attributes: { position: { version: 0, count: 48 }, uv: { version: 0 } }, drawRange: { start: 0, count: Infinity } };
  const quad = { attributes: { position: { count: 6 } } };
  const material = {
    skinning: true, version: 0,
    set needsUpdate(value) { if (value) this.version++; },
  };
  const bones = Array.from({ length: 9 }, () => ({
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 },
  }));
  const mesh = Object.assign(Object.create({ isSkinnedMesh: true }), {
    visible: true, parent: world, children: [], userData: {}, layers: { mask: 1 },
    geometry: skin, material: [material], skeleton: { bones },
  });
  const values = new Float64Array(90);
  savePortraitPose(mesh, values);
  frozenPortraits.set(mesh, {
    source: skin, skeleton: mesh.skeleton,
    attributes: [skin.attributes.position, skin.attributes.uv, undefined, undefined, undefined],
    versions: [0, 0, undefined, undefined, undefined], start: 0, count: Infinity,
    poses: [{ geometry: quad, values, flat: true }], current: new Float64Array(90),
  });
  portraitMeshRefs.add({ deref: () => mesh });
  portraitMeshBuilds.set(mesh, { freeze: true });
  const submitted = [];
  renderer.__hobunjiR128NativeRender = () => submitted.push([mesh.geometry, mesh.isSkinnedMesh, material.skinning, material.version]);
  window.RenderHooks.beginWorldFrame({ renderer, scene: world, camera });
  try {
    renderer.render(world, camera);
    assert.deepEqual(submitted.pop(), [quad, false, false, 1], 'first pass submits the frozen geometry');
    assert.equal(mesh.geometry, skin);
    bones[7].rotation.y = .2;
    renderer.render(world, camera);
    assert.deepEqual(submitted.pop(), [skin, true, true, 2], 'late head turn switches back to the live shader as well as geometry');
    bones[7].rotation.y = 0;
    renderer.render(world, camera);
    assert.deepEqual(submitted.pop(), [quad, false, false, 3], 'return to the frozen pose refreshes the program again');
    skin.attributes.uv = { version: 0 };
    renderer.render(world, camera);
    assert.deepEqual(submitted.pop(), [skin, true, true, 4], 'attribute replacement with the same version invalidates the frozen copy');
  } finally {
    window.RenderHooks.endWorldFrame();
  }
  assert.equal(mesh.geometry, skin);
  assert.equal(mesh.isSkinnedMesh, true);
  assert.equal(material.skinning, true);
}

// ── Load order: the registry precedes every renderer/bridge on the game page ──
{
  const html = require('./classic-script-group-index.js').expandClassicScriptGroups();
  const at = needle => html.indexOf(needle);
  const hooksAt = at('js/render-hooks.js?v=');
  assert.ok(at('js/render-layers.js?v=') > 0 && at('js/render-layers.js?v=') < hooksAt, 'layer registry loads first');
  assert.ok(hooksAt > at('three.min.js') && hooksAt < at('js/character-action-locks.js?v='), 'render hooks load straight after three.js, before the r128 bridge loader');
  for (const owner of ['js/combat/combat-config-loader.js', 'js/held-object-render-order.js', 'js/world-render-pipeline.js', 'src="game.js']) { // The composer/crop/drunk hooks load through combat-config-loader.js.
    assert.ok(at(owner) > hooksAt, `render hooks load before ${owner}`);
  }
}

console.log('PASS render hooks: base install, ordering, frame scope, errors, nesting, existing base, migrated owner, load order');
