'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/seat-surface-placement-transform.js', 'utf8'); // Executes the runtime alias adapter against a browser-like furniture harness.

function makeGroup(name, childName = null) {
  const group = {
    name,
    userData: {},
    children: [],
    add(child) {
      if (!child) return;
      if (child.parent?.remove) child.parent.remove(child);
      child.parent = this;
      this.children.push(child);
    },
    remove(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      if (child?.parent === this) child.parent = null;
    },
    updateMatrixWorld() { this.matrixUpdated = true; },
    traverse(visitor) {
      visitor(this);
      for (const child of this.children) child.traverse ? child.traverse(visitor) : visitor(child);
    },
  }; // Minimal THREE.Group-compatible surface used to verify in-place fallback replacement without requiring WebGL.
  if (childName) {
    group.add({
      name: childName,
      parent: null,
      geometry: { disposed: false, dispose() { this.disposed = true; } },
      material: { disposed: false, dispose() { this.disposed = true; } },
    });
  }
  return group;
}

const authoredCache = new Map([
  ['chairSimple', { key: 'chairSimple', footprint: { w: 1, d: 1 }, parts: [{ id: 'chair-part' }], seatAnchors: [] }],
]); // Starts with one cached authored chair so the synchronous alias-render path can be proven.
const authoredSource = new Map([
  ...authoredCache,
  ['benchSimple', { key: 'benchSimple', footprint: { w: 2, d: 1 }, parts: [{ id: 'bench-part' }], seatAnchors: [] }],
]); // Includes an uncached bench so the async fallback-upgrade path can also be proven.
const proceduralCalls = []; // Records every fallback key so a runtime alias leaking into the procedural catalog fails loudly.
const loadCalls = []; // Records authored loads to prove the adapter requests the real base key, never the synthetic alias.

const window = {
  FarmEditor: {
    init(deps) { this.lastDeps = deps; return true; },
  },
  AuthoredFurniture: {
    peek(key) { return authoredCache.get(key) || null; },
    load(key) {
      loadCalls.push(key);
      return Promise.resolve().then(() => {
        const data = authoredSource.get(key) || null;
        if (data) authoredCache.set(key, data);
        return data;
      });
    },
    buildGroup(data) {
      const group = makeGroup(`authored_furniture_${data.key}`, `authored_part_${data.key}`);
      group.userData.authoredFurnitureImported = true;
      group.userData.authoredFurnitureKey = data.key;
      return group;
    },
  },
  ProceduralFurniture: {
    buildFurnitureGroup(key) {
      proceduralCalls.push(key);
      const group = makeGroup(`procedural_${key}`, `brown_fallback_${key}`);
      group.userData.proceduralFurnitureKey = key;
      return group;
    },
  },
  MapLayoutSystem: {
    getEffectiveMapData(mapData) { return { ...mapData, furniture: (mapData.furniture || []).map(piece => ({ ...piece })) }; },
  },
  __farmLog() {},
}; // Supplies only the runtime surfaces the seat adapter is allowed to depend on.

const context = vm.createContext({ window, console, Math, Number, String, Object, Array, Map, Set, Promise });
vm.runInContext(source, context, { filename: 'seat-surface-placement-transform.js' });

const defs = {
  chairSimple: { itemKey: 'chairSimpleFurniture', name: 'Simple Chair', sit: true, fw: 1, fd: 1 },
  benchSimple: { itemKey: 'benchSimpleFurniture', name: 'Simple Bench', sit: true, fw: 2, fd: 1 },
}; // Mirrors the live decorative furniture table used to translate map item keys to furniture keys.
window.FarmEditor.init({ DECORATIVE_FURNITURE_DEFS: defs });

function aliasKeyFor(itemKey) {
  return Object.keys(defs).find(key => defs[key]?.itemKey === itemKey) || '';
}

(async () => {
  const cachedMap = window.MapLayoutSystem.getEffectiveMapData({
    id: 'visual-cached-seat',
    furniture: [{ id: 'chair-a', itemKey: 'chairSimpleFurniture', col: 1, row: 1, postY: 0.2 }],
  });
  const cachedAlias = aliasKeyFor(cachedMap.furniture[0].itemKey);
  assert(cachedAlias.startsWith('__seat_surface_xform_'), 'transformed cached chair should use a runtime seat alias');

  const cachedVisual = window.ProceduralFurniture.buildFurnitureGroup(cachedAlias, 0x7a5c3a);
  assert.strictEqual(cachedVisual.name, 'authored_furniture_chairSimple', 'cached transformed seat must render the authored chair, not the procedural brown box');
  assert.strictEqual(cachedVisual.userData.authoredFurnitureKey, 'chairSimple', 'cached alias visual should retain the real authored base key');
  assert.strictEqual(cachedVisual.userData.seatSurfaceVisualBaseKey, 'chairSimple', 'cached alias visual should expose its base render key for diagnostics');
  assert(cachedVisual.children.some(child => child.name === 'authored_part_chairSimple'), 'cached alias visual should contain authored furniture parts');
  assert.deepStrictEqual(proceduralCalls, [], 'cached authored seat must never touch the procedural fallback builder');

  const asyncMap = window.MapLayoutSystem.getEffectiveMapData({
    id: 'visual-async-seat',
    furniture: [{ id: 'bench-a', itemKey: 'benchSimpleFurniture', col: 4, row: 5, postSX: 1.5, postSZ: 0.75 }],
  });
  const asyncAlias = aliasKeyFor(asyncMap.furniture[0].itemKey);
  assert(asyncAlias.startsWith('__seat_surface_xform_'), 'transformed uncached bench should use a runtime seat alias');

  const asyncVisual = window.ProceduralFurniture.buildFurnitureGroup(asyncAlias, 0x7a5c3a);
  assert.strictEqual(asyncVisual.name, 'procedural_benchSimple', 'uncached authored furniture may use the ordinary base fallback while JSON is loading');
  assert.deepStrictEqual(proceduralCalls, ['benchSimple'], 'fallback builder must receive the real base key, never the synthetic alias key');
  assert.deepStrictEqual(loadCalls, ['benchSimple'], 'authored async load must target the real bench key');

  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));

  assert.strictEqual(asyncVisual.name, 'authored_furniture_benchSimple', 'loaded transformed bench must replace the brown fallback in place');
  assert.strictEqual(asyncVisual.userData.authoredFurnitureUpgraded, true, 'async transformed seat should be marked as authored-upgraded');
  assert.strictEqual(asyncVisual.userData.authoredFurnitureKey, 'benchSimple', 'async alias visual should retain the real authored base key');
  assert.strictEqual(asyncVisual.userData.seatSurfaceVisualBaseKey, 'benchSimple', 'async alias diagnostics should retain the real visual key');
  assert(asyncVisual.children.some(child => child.name === 'authored_part_benchSimple'), 'async fallback should be replaced by authored bench parts');
  assert(!asyncVisual.children.some(child => child.name?.startsWith('brown_fallback_')), 'brown procedural placeholder must not survive the authored load');

  const debug = window.SeatSurfacePlacementTransform.debugSnapshot();
  assert(debug.visualAuthoredBuilds >= 1, 'debug snapshot should count synchronous authored alias builds');
  assert(debug.visualAsyncUpgrades >= 1, 'debug snapshot should count async authored alias upgrades');
  assert.strictEqual(debug.visualUpgradeFailures, 0, 'successful visual alias regression should report no upgrade failures');

  console.log('Interior transformed-seat authored visual regression passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
