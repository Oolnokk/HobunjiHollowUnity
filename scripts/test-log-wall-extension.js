'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..'); // Repository root used for source-wiring assertions below.
const api = require(path.join(repoRoot, 'docs/js/log-wall-extension.js')); // Pure recipe/runtime extension API under test.
assert.equal(api.DEFAULTS.barkColor, '#6e5e30', 'default cabin-log bark keeps the approved dark-olive hue, lifted so the painterly filter does not flatten it');

const liveMeta = api.normalizeLogMeta({ // Representative authored settings used to verify stable generated/baked serialization.
  sourceMode: 'generated',
  seed: 'test-cabin',
  glbName: 'TestCabinLog.glb',
  logDiameter: 0.42,
  trunkWonk: 0.31,
  trunkWonkScale: 1.8,
  overhang: 0.17,
  courseGap: -0.05,
  rowRollDeg: 2.25,
  rowDepthJitter: 0.02,
});
const bakedMeta = api.normalizeLogMeta({ ...liveMeta, sourceMode: 'glb' }); // Same geometry settings with only the runtime source changed to baked GLB.

assert.equal(api.signature(liveMeta), api.signature(bakedMeta), 'source mode must not change generated/baked geometry signature');
assert.notEqual(api.signature(liveMeta), api.signature({ ...liveMeta, trunkWonk: 0.32 }), 'wonkiness must participate in the geometry signature');
assert.notEqual(api.signature(liveMeta), api.signature({ ...liveMeta, logDiameter: 0.43 }), 'log width must participate in the geometry signature');

const liveRecipe = api.makeRecipe(5, 2.6, liveMeta); // Generated-live recipe expected to remain a normal WallBuilder wall recipe.
const bakedRecipe = api.makeRecipe(5, 2.6, bakedMeta); // Baked recipe expected to have identical placement dimensions/settings.
assert.equal(liveRecipe.version, 1);
assert.equal(liveRecipe.settings.kind, 'wall');
assert.equal(liveRecipe.settings.unitSize.x, 5.34);
assert.equal(liveRecipe.settings.unitSize.y, 0.42);
assert.equal(liveRecipe.settings.unitSize.z, 0.42);
assert.equal(liveRecipe.settings.gapBase.y, -0.05);
assert.equal(liveRecipe.meta.logWall.sourceMode, 'generated');
assert.equal(bakedRecipe.meta.logWall.sourceMode, 'glb');
assert.equal(liveRecipe.meta.logWall.signature, bakedRecipe.meta.logWall.signature);
assert.deepEqual(liveRecipe.settings, bakedRecipe.settings, 'generated and baked recipes must serialize identical placement settings');

class FakeGroup { // Minimal Object3D group implementing parent-aware add so the extension's moveChildren loop behaves like Three.js.
  constructor() { this.children = []; this.userData = {}; this.name = ''; }
  add(child) {
    if (child?.parent) {
      const oldIndex = child.parent.children.indexOf(child); // Child index removed when reparenting between delegated WallBuilder groups.
      if (oldIndex >= 0) child.parent.children.splice(oldIndex, 1);
    }
    this.children.push(child);
    child.parent = this;
    return this;
  }
}
const fakeThree = { Group: FakeGroup }; // Three.js subset sufficient for baked-path placement delegation coverage.

class FakeWallBuilder { // Captures delegated build calls without constructing render geometry.
  constructor() {
    this.recipeLibrary = new Map(); // Registered normal/log recipes resolved by the patched build method.
    this.glbLibrary = new Map(); // Pretend GLB library populated for baked-path testing.
    this.defaultRecipeId = 'ordinary';
    this.glbBasePath = 'assets/models/';
    this.calls = []; // Delegated original build calls inspected after extension wrapping.
  }
  addRecipe(id, recipe) {
    assert.equal(recipe.version, 1);
    assert.ok(recipe.settings?.kind === 'wall' || recipe.settings?.kind === 'stacks');
    this.recipeLibrary.set(id, recipe);
    return id;
  }
  loadGlbFromUrl(url, name) {
    this.glbLibrary.set(name, { fake: true, url });
    return Promise.resolve(name);
  }
  build(panels, opts = {}) {
    const resolved = panels.map(panel => ({
      panel: { ...panel },
      recipe: JSON.parse(JSON.stringify(this.recipeLibrary.get(panel.wallRecipeId || opts.defaultRecipeId || this.defaultRecipeId))),
    })); // Snapshot ephemeral fitted recipes before the extension deletes them after delegation.
    this.calls.push({ panels: resolved, opts: { ...opts } });
    const group = new FakeGroup(); // Result group shaped like the real WallBuilder return contract.
    for (const entry of resolved) group.add({ name: `fake:${entry.panel.id}`, parent: null });
    return group;
  }
}

assert.equal(api.install({ THREE: fakeThree, WallBuilder: FakeWallBuilder }), true, 'extension should install on a compatible WallBuilder prototype');
assert.equal(api.install({ THREE: fakeThree, WallBuilder: FakeWallBuilder }), false, 'extension installation must be idempotent');

const builder = new FakeWallBuilder(); // Mixed ordinary+baked wall builder used to verify per-panel fitting and option isolation.
builder.recipeLibrary.set('ordinary', {
  version: 1,
  seed: 'ordinary',
  settings: { kind: 'wall', unitSize: { x: 1, y: 1, z: 1 } },
});
builder.recipeLibrary.set('logs', bakedRecipe);
builder.glbLibrary.set('TestCabinLog.glb', { fake: true });
const result = builder.build([
  { id: 'stone', width: 3, height: 2, wallRecipeId: 'ordinary' },
  { id: 'logs-a', width: 4.7, height: 2.6, wallRecipeId: 'logs' },
  { id: 'logs-b', width: 6.1, height: 2.6, wallRecipeId: 'logs' },
], { unitMult: 0.4, densityMult: 3, rockScale: 1.7, usePlaceholder: true });

assert.equal(result.children.length, 3, 'mixed ordinary/log panels must be recombined into one WallBuilder-compatible group');
assert.equal(result.userData.logWallStats.logPanels, 2);
assert.equal(result.userData.logWallStats.bakedPanels, 2);
assert.deepEqual(result.userData.logWallStats.missingBakedGlbs, []);
assert.equal(builder.calls.length, 3, 'ordinary walls stay batched while each log panel gets an exact-width delegated build');
assert.equal(builder.calls[0].opts.unitMult, 0.4, 'ordinary wall options remain untouched');
for (const call of builder.calls.slice(1)) {
  assert.equal(call.opts.unitMult, 1, 'global brick unit scaling must not distort authored log width');
  assert.equal(call.opts.densityMult, 1, 'global brick density must not alter authored log course count');
  assert.equal(call.opts.rockScale, 1, 'global rock scaling must not distort log geometry');
  assert.equal(call.opts.usePlaceholder, false, 'baked log walls must never silently substitute Roughbrick placeholder geometry');
}
assert.equal(builder.calls[1].panels[0].recipe.settings.unitSize.x, 4.7 + 0.34, 'first panel receives its own exact log span plus both end overhangs');
assert.equal(builder.calls[2].panels[0].recipe.settings.unitSize.x, 6.1 + 0.34, 'second panel receives its own exact log span rather than the preview width');
assert.equal(builder.recipeLibrary.has(builder.calls[1].panels[0].panel.wallRecipeId), false, 'ephemeral per-panel recipes are removed after build');

const formatUtilsSource = fs.readFileSync(path.join(repoRoot, 'docs/js/format-utils.js'), 'utf8'); // Main-game bootstrap source checked for runtime installation wiring.
const panelUiSource = fs.readFileSync(path.join(repoRoot, 'docs/js/panel-ui.js'), 'utf8'); // Shared tool bootstrap source checked for Wall Builder-only authoring wiring.
const toolSource = fs.readFileSync(path.join(repoRoot, 'docs/js/wall-builder-log-tool.js'), 'utf8'); // Authoring UI source checked for both required export modes.
assert.match(formatUtilsSource, /log-wall-extension\.js\?v=/, 'main game must synchronously load the log-wall runtime after WallBuilder');
assert.match(panelUiSource, /wall-builder-log-tool\.js\?v=/, 'Wall Builder must load its log-cabin authoring controls with a cache token');
assert.match(toolSource, /Export generated log GLB/);
assert.match(toolSource, /Download live recipe/);
assert.match(toolSource, /Download baked recipe/);
assert.match(toolSource, /applyPreview\('generated'\)/);
assert.match(toolSource, /applyPreview\('glb'\)/);
assert.match(toolSource, /exporter\.parse\(root,[\s\S]*?\}, \{ binary: true, onlyVisible: true \}\);/, 'Three.js r128 GLTFExporter options must be the third parse argument');
assert.doesNotMatch(toolSource, /\},\s*reject,\s*\{\s*binary:\s*true/, 'r128 must not receive an onError callback in the options slot');

console.log('log wall extension tests passed');