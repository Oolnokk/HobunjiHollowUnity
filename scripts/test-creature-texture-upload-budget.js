'use strict';
const assert = require('node:assert/strict'); // Checks sharing and material-version behavior on real runtime functions.
const fs = require('node:fs'); // Loads owner code.
const vm = require('node:vm'); // Avoids booting unrelated farm UI.
async function main() {
  let uploads = 0; // Counts GPU texture objects created for concurrent consumers.
  let composes = 0; // Counts actual asynchronous compositing requests.
  let resolveCanvas; // Keeps concurrent callers pending together.
  const context = { window: { CreatureGeneticsRender: { genotypeSignature: () => 'same', composeFrame: () => { composes++; return new Promise(resolve => { resolveCanvas = resolve; }); } } }, THREE: { CanvasTexture: class { constructor() { uploads++; this.repeat = this.offset = { set() {} }; } } } }; // Texture-only farm fixture.
  vm.runInNewContext(fs.readFileSync('docs/js/creature-texture-cache.js', 'utf8'), context);
  const source = fs.readFileSync('docs/js/farm-animals.js', 'utf8'); // Actual implementation with independent cache state.
  vm.runInNewContext(source.slice(source.indexOf('  const _farmGenotypeTexCache'), source.indexOf('  function _tickFarmAnimalBlink')) + '\nwindow.apply = _applyGenotypeCompositeTexture;', context);
  function avatar() { return { group: { children: ['_front_plane', '_back_plane'].map(name => ({ name, material: { map: {}, needsUpdate: false } })) } }; }
  const first = avatar(); // First animal requesting the shared signature.
  const second = avatar(); // Second animal requesting it before the first finishes.
  const requests = [context.window.apply(first, 'wolf', 'idle', {}, false), context.window.apply(second, 'wolf', 'idle', {}, false)]; // Concurrent same-key calls used to leak a pair.
  assert.equal(composes, 1);
  resolveCanvas({ width: 64, height: 64 });
  assert.deepEqual(await Promise.all(requests), [true, true]);
  assert.equal(uploads, 2);
  assert.equal(first.group.children[0].material.map, second.group.children[0].material.map);
  assert.equal(first.group.children[0].material.needsUpdate, false, 'frame changes must not rebuild shader programs');
  await context.window.apply(first, 'wolf', 'idle', {}, false);
  assert.equal(uploads, 2, 'cache hit uploads nothing');
  const removed = avatar();
  const originalMap = removed.group.children[0].material.map;
  const late = context.window.apply(removed, 'wolf', 'run1', {}, false);
  context.window.CreatureTextureCache.releaseOwner(removed);
  resolveCanvas({ width: 64, height: 64 });
  assert.equal(await late, false, 'late loads cannot rebind a disposed avatar');
  assert.equal(removed.group.children[0].material.map, originalMap);

  const recolor = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'); // Tests the CPU cache independently of canvas rendering.
  const cacheContext = {}; // Exposes only the actual cache helpers.
  vm.runInNewContext(recolor.slice(recolor.indexOf('  const _recolorCache'), recolor.indexOf('  async function recoloredBase')) + '\nthis.cache = _recolorCache; this.put = rememberRecolor; this.get = cachedRecolor;', cacheContext);
  const retained = { canvas: { width: 10, height: 10 } }; // A live caller may retain an evicted value safely.
  cacheContext.put('old', retained);
  for (let i = 0; i < 95; i++) cacheContext.put(String(i), {});
  cacheContext.get('old');
  cacheContext.put('new', {});
  assert.equal(cacheContext.cache.size, 96);
  assert.equal(cacheContext.cache.has('old'), true, 'recent use survives eviction');
  assert.equal(cacheContext.cache.has('0'), false);
  for (let i = 0; i < 200; i++) cacheContext.put('next' + i, {});
  assert.equal(cacheContext.cache.size, 96);
  assert.equal(retained.canvas.width, 10, 'eviction never clears canvases still referenced by live visuals');
  console.log('Concurrent creature uploads, shader reuse, and bounded recolor retention passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
