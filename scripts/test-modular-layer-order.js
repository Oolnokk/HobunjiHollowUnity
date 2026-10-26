'use strict';

const assert = require('node:assert/strict'); // Pair-only sprite layer order regression checks.
const fs = require('node:fs'); // Test actual editor/runtime modules.
const vm = require('node:vm'); // Execute browser implementation with a small canvas harness.

async function run() {
  const canvases = []; // Every composed PNG receives its own recorded draw list.
  class Image {
    set src(value) {
      this.key = value.includes('weaponhead_') ? 'head' : 'haft'; // Identify which image the production compositor paints.
      this.onload?.(); // Simulate successful CORS image loading.
    }
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas'); // Production compositor creates one alpha-inspection canvas plus an output canvas.
      const canvas = { width: 0, height: 0, operations: [] };
      const ctx = {
        drawImage(image) { canvas.operations.push('paint:' + (image?.key || 'unknown')); },
        getImageData() {
          const data = new Uint8ClampedArray(450 * 1204 * 4); // One opaque head pixel for real bounds math.
          data[(100 * 450 + 200) * 4 + 3] = 255;
          return { data };
        },
        save() { canvas.operations.push('save'); }, restore() { canvas.operations.push('restore'); },
        rect() {}, clip() { canvas.operations.push('clip'); }, beginPath() {},
        scale() {}, translate() {}, transform() {}
      };
      canvas.getContext = () => ctx;
      canvases.push(canvas);
      return canvas;
    }
  };
  const window = {}; // Shared game namespace for config, cache and sprite composition.
  const ctx = vm.createContext({ window, Image, document, console, Uint8ClampedArray }); // Real browser module can run unaltered.
  for (const path of ['docs/config/modular-weapons.js', 'docs/js/modular-weapons.js']) {
    vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  }
  const api = window.ModularWeapons;
  const config = api.getConfig();
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'haft-over-head', 'Default is haft in the foreground.');
  assert.equal(config.shafts.dagger.overrides['fishing-spear']?.layerOrder, undefined, 'Default need not be explicitly stored.');
  function paints(canvas) { return canvas.operations.filter(op => op.startsWith('paint:')); }
  const defaultCanvas = await api.compose('dagger', 'fishing-spear'); // Compatible single-headed weapon.
  assert.deepEqual(paints(defaultCanvas), ['paint:head', 'paint:haft'], 'Default renderer paints head first.');

  const draft = JSON.parse(JSON.stringify(api.getConfig())); // Simulates editor save/export into a validated draft.
  draft.shafts.dagger.overrides['fishing-spear'].layerOrder = 'head-over-haft'; // Override only one exact pair.
  api.replace(draft, true);
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'head-over-haft');
  assert.equal(api.settings('dagger', 'dagger-sword').layerOrder, 'haft-over-head', 'Override must not leak to other heads.');
  const swapped = await api.compose('dagger', 'fishing-spear'); // Revision change invalidates previous canvas.
  assert.notEqual(swapped, defaultCanvas, 'Switching layer order recomposes cached artwork.');
  assert.deepEqual(paints(swapped), ['paint:haft', 'paint:head'], 'Head-over-haft paints the haft first.');

  const copy = JSON.parse(JSON.stringify(api.getConfig())); // Pair preference survives export -> import validation.
  api.replace(copy);
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'head-over-haft');

  copy.shafts.dagger.overrides['fishing-spear'].layerOrder = 'invalid';
  api.replace(copy);
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'haft-over-head', 'Unknown layer values fall back safely.');
  const restored = await api.compose('dagger', 'fishing-spear');
  assert.deepEqual(paints(restored), ['paint:head', 'paint:haft']);

  // Multi-ended weapon draws EVERY matching head below a single shaft, not interleaved with it.
  const doubled = await api.compose('bshuakauitl', 'warhammer');
  assert.deepEqual(paints(doubled), ['paint:head', 'paint:head', 'paint:haft'], 'Both heads stay below haft by default.');
  const multi = JSON.parse(JSON.stringify(api.getConfig()));
  multi.shafts.bshuakauitl.overrides.warhammer = {
    ...multi.shafts.bshuakauitl.overrides.warhammer, layerOrder: 'head-over-haft'
  };
  api.replace(multi);
  assert.deepEqual(paints(await api.compose('bshuakauitl', 'warhammer')),
    ['paint:haft', 'paint:head', 'paint:head'], 'Reverse order handles two mounts correctly.');

  // Old schema imports still use implicit haft-over-head unless an explicit v2 override is provided.
  api.replace({ schema: 'hobunji_modular_weapons.v1', heads: {}, shafts: {} });
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'haft-over-head');

  const html = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8');
  const editor = fs.readFileSync('docs/tools/modular-weapon-editor/editor.js', 'utf8');
  assert(html.includes('id="layer-order"') && html.includes('value="haft-over-head"')
    && html.includes('value="head-over-haft"'), 'Editor exposes both order options.');
  assert(editor.includes("byId('layer-order').onchange"), 'Layer select has active change handler.');
  assert(editor.includes("delete pair.layerOrder"), 'Default remains sparse in exported config.');
  console.log('Modular layering: default, per-pair override, render order, cache, multi-mount, import and editor wiring passed.');
}

module.exports = run; // Allows tests to run inside a library harness without spawning subprocesses.
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
