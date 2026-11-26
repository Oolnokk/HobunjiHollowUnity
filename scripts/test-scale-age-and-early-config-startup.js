'use strict';
// Regression for the blank Full Character Scale workspace and config.js THREE-before-load crash.
const assert = require('node:assert/strict'); // Checks startup failures and unchanged road-height transforms.
const fs = require('node:fs'); // Inspects the actual shipped modules, not an inline copy of their logic.
const vm = require('node:vm'); // Runs early configuration with THREE intentionally missing.
const { URL } = require('node:url'); // Supplies a real URL constructor to the isolated browser bootstrap fixture.

const editor = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Editor's real stage normalization and controls.
const config = fs.readFileSync('docs/config/config.js', 'utf8'); // Global configuration executes before Three.js.
const precision = (a, b) => Math.abs(a - b) < 1e-5; // Float32 matrix translations have rounding noise.

const world = {
  TerrainPreview: { sampleVisualHeight(_heights, x, z) { return (x + z) * 0.1; } },
  __hobunjiTownElevationMap: { visualHeights: { tile: 1 }, cols: 10, rows: 10 },
  async fetch() { return { ok: false }; }, // Real browser boot has fetch available before Three.js.
}; // No window.THREE, self.THREE or injected Three.js module exists during config initialization.
vm.runInNewContext(config, { self: world, document: { currentScript: { src: 'https://game.test/docs/config/config.js' } }, URL, console, setTimeout }, { filename: 'docs/config/config.js' });
assert(world.fetch.hobunjiBuildingElevationDefaults, 'early fetch compatibility also survives startup without Three.js');
assert(world.HOBUNJI_CONFIG, 'early global configuration still initializes');
assert(world.HobunjiTownSubtleElevation?.refresh, 'town elevation compatibility must register without Three.js');

const matrices = new Float32Array(32); // Two authored road instances with different transforms.
for (let i = 0; i < 2; i++) {
  const o = i * 16;
  matrices[o] = 1; matrices[o + 5] = i ? 2 : 1; matrices[o + 10] = 1; matrices[o + 15] = 1;
}
matrices[12] = 1; matrices[13] = 2; matrices[14] = 1;
matrices[28] = 3; matrices[29] = 4; matrices[30] = 2;
const mesh = {
  isInstancedMesh: true, count: 2, userData: {},
  instanceMatrix: { array: matrices, needsUpdate: false },
  computeBoundingSphere() { this.boundsUpdated = (this.boundsUpdated || 0) + 1; },
}; // Mimics Three.js InstancedMesh's matrix buffer, without needing constructors.
const road = {
  isGroup: true, name: 'WallBuilder_Instances', userData: { cullSphere: true }, children: [], // A real THREE.Group always has children, even when the test traverses manually.
  traverse(callback) { callback(mesh); },
};
const scene = { children: [road], userData: {}, add(...objects) { this.children.push(...objects); return this; } };
world.TownZoneBuildings = { init() {}, spawnTownBuildings() {} }; // Test the real late-bound global API wrapper.
world.TownZoneBuildings.init({ getTownScene: () => scene, getTownZone: () => world.__hobunjiTownElevationMap });
world.TownZoneBuildings.refreshTownVisualHeightFollowers();
assert(precision(matrices[13], 2.2), 'first road uses original 2 plus sampled height .2');
assert(precision(matrices[29], 4.5), 'second road uses original 4 plus sampled height .5');
assert(precision(matrices[21], 2), 'nonuniform authored instance scale is unchanged');
assert(mesh.instanceMatrix.needsUpdate, 'GPU instance buffer invalidated');
matrices[21] = 99; // A rerun must restore the authored base transform, not retain an accidental edit.
world.TownZoneBuildings.refreshTownVisualHeightFollowers();
assert(precision(matrices[13], 2.2) && precision(matrices[29], 4.5), 'refresh never accumulates elevation offsets');
assert(precision(matrices[21], 2), 'rerun restores source rotation and scale');
assert.equal(world.HobunjiTownSubtleElevation.groundYAt(1, 2), null,
  'optional raycast stays safe when Three.js has not been loaded');

function section(from, to) {
  const start = editor.indexOf('  function ' + from + '(');
  const end = editor.indexOf('  function ' + to + '(', start + 5);
  assert(start >= 0 && end > start, 'expected production functions ' + from + ' through ' + to);
  return editor.slice(start, end);
} // Extracts production function bodies without duplicating the stage math in the test.
const ageSource = [
  "  const AGE_SAVE_KEY = 'hobunjiFullCharacterScale.ageModes.v1';",
  "  const AGE_AXES = ['width','height','head','hand','foot','widthConvergence','heightConvergence'];",
  "  const AGE_MODES = ['adult','baby','toddler','child'];",
  "  let ageMode = 'adult', ageModifiers = {}, selected = null, ageProfiles = {}, ageOverall = {}, stageBasisCache = null;",
  section('repositoryAgeModifiers','host'),
  section('syncAgeControls','syncAgeLimbs'),
  '  window.__testAge = { loadAgeModifiers, syncAgeControls, repositoryAgeModifiers, ageValues, setMode: value => { ageMode = value; } };',
].join('\n'); // Drives the same age stage code used on browser startup.
const nodes = new Map(); // Touch-device controls have no dependency on devtools.
const document = {
  activeElement: null,
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', textContent: '', hidden: false, closest() { return { hidden: false }; } });
    return nodes.get(id);
  },
};
const storage = new Map(); // Missing or malformed draft autosaves must not break initial editor display.
const localStorage = { getItem: key => storage.get(key) || null };
const familyStages = {
  baby: { width: 0.3, height: 0.3, head: 0.5, hand: 1.2, foot: 1.2, widthConvergence: 0, heightConvergence: 0 },
  toddler: { width: 0.4, height: 0.4, head: 0.65, hand: 1, foot: 1, widthConvergence: 0, heightConvergence: 0 },
  child: { width: 0.6, height: 0.6, head: 0.8, hand: 1, foot: 1, widthConvergence: 0, heightConvergence: 0 },
};
const window = {
  HobunjiCharacterAgeRigConfig: {
    repositoryDefaults: () => JSON.parse(JSON.stringify(familyStages)), // Shared runtime API intentionally omits adult.
    snapshot: () => ({ applied: false }),
  },
};
vm.runInNewContext(ageSource, { window, localStorage, document, console }, { filename: 'age-stage-production-functions.js' });
const age = window.__testAge;
age.loadAgeModifiers();
assert.deepEqual(JSON.parse(JSON.stringify(age.ageValues())), { width: 1, height: 1, head: 1, hand: 1, foot: 1, widthConvergence: 0, heightConvergence: 0 },
  'adult stage must be unity even when shared game config exports only growth stages');
age.syncAgeControls(); // This used to throw TypeError reading undefined.body before the lineup rendered.
assert.equal(document.getElementById('maaFullScaleAgeRangeHeight').value, '100', 'adult global body slider initializes');
age.setMode('baby');
age.syncAgeControls();
assert.equal(document.getElementById('maaFullScaleAgeRangeHeight').value, '30', 'baby inherits game defaults');
age.setMode('child');
age.syncAgeControls();
assert.equal(document.getElementById('maaFullScaleAgeRangeHead').value, '80', 'child inherits game defaults');
storage.set('hobunjiFullCharacterScale.ageModes.v1', JSON.stringify({
  schema: 'hobunji.character-age-rig-modifiers.v1',
  modifiers: { baby: { body: -5, head: 'not-a-number' }, toddler: { body: 0.45 } },
}));
age.loadAgeModifiers();
age.setMode('adult');
age.syncAgeControls();
assert.equal(age.ageValues().height, 1, 'malformed autosave cannot erase adult unity');
age.setMode('baby');
age.syncAgeControls();
assert.equal(age.ageValues().height, 0.3, 'malformed baby scale falls back to checked-in stage');
delete window.HobunjiCharacterAgeRigConfig;
age.loadAgeModifiers();
age.setMode('adult');
age.syncAgeControls();
assert.equal(age.ageValues().height, 1, 'late/missing shared config also keeps adult stage');
assert.match(editor, /function showStartupError\(/, 'startup errors remain visible outside the hidden comparison panel');
assert.match(editor, /id = 'maaFullScaleErrorBanner'/, 'mobile banner remains copyable after tab restoration');
console.log('PASS age stage: adult unity, shared-bridge and missing-bridge initialization, malformed autosave, mobile diagnostics');
console.log('PASS town early config: no global THREE, road heights, persistent base matrices, and optional ground raycast');
