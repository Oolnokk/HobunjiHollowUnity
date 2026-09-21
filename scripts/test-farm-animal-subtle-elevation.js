'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const paritySource = fs.readFileSync('docs/js/farm-building-elevation-parity.js', 'utf8');
const animalElevationSource = fs.readFileSync('docs/js/animal-subtle-elevation-bridge.js', 'utf8');
new Function(paritySource);
new Function(animalElevationSource);

// FarmBuildingElevationParity owns the exact continuous house+barn heightfield.
// Verify that its public sampler follows the active controller and stops
// reporting stale terrain after that controller is disposed/replaced.
{
  let disposed = false; // Confirms the sampler does not outlive the controller that owns its farm heightfield.
  let furnitureRefreshes = 0; // Confirms house/barn footprint changes re-ground already-placed farm furniture.
  const controller = {
    sampleWorldY() { return 0.24; },
    sync() { return true; },
    refreshGrassSuppression() { return {}; },
    debugSnapshot() { return { marker: 'combined-house-barn-heightfield' }; },
    dispose() { disposed = true; },
  };
  const context = {
    console,
    queueMicrotask(fn) { fn(); },
    window: {
      PlayerHouseElevation: {
        create() { return controller; },
      },
      HobunjiFurnitureSurfaceElevation: {
        refresh() { furnitureRefreshes++; return { decorative: 1, processing: 1 }; },
        getDebug() { return { marker: 'furniture-grounding' }; },
      },
    },
  };
  context.window.window = context.window;
  vm.runInNewContext(paritySource, context, { filename: 'farm-building-elevation-parity.js' });

  const created = context.window.PlayerHouseElevation.create({
    getPieces: () => [],
    getFarmBuildings: () => [],
    scene: null,
  });
  assert.equal(context.window.HobunjiFarmSubtleElevation.sampleHeightAt(3.75, 2.2), 0.24,
    'farm subtle-elevation sampler delegates to the live combined house+barn controller');
  assert.equal(context.window.HobunjiFarmSubtleElevation.getDebug().marker, 'combined-house-barn-heightfield',
    'farm subtle-elevation diagnostics come from the same live controller');
  assert.equal(context.window.HobunjiFarmSubtleElevation.getDebug().furnitureSurfaceElevation.marker, 'furniture-grounding',
    'farm elevation diagnostics include the current furniture grounding snapshot');

  created.sync(true);
  assert.equal(furnitureRefreshes, 1,
    'a farmhouse/barn heightfield sync re-grounds existing farm furniture');

  created.refreshGrassSuppression();
  assert.equal(furnitureRefreshes, 2,
    'the existing building-footprint refresh hook also re-grounds existing farm furniture');

  created.dispose();
  assert.equal(disposed, true, 'wrapped controller disposal preserves the original dispose call');
  assert.equal(context.window.HobunjiFarmSubtleElevation.sampleHeightAt(3.75, 2.2), 0,
    'disposed farm controller cannot leak a stale building incline into later renders');
}

// The outdoor-welfare sleep pose has already compressed/lowered this root by
// the time rendering begins. The shared animal elevation bridge must add the
// farm's exact visible incline on top of that finished pose, then restore the
// simulation-owned Y afterward so no height accumulates frame over frame.
{
  const sleeperRoot = {
    position: { x: 3.75, y: 0.45, z: 2.2 },
    visible: true,
    parent: {},
  }; // Represents an already-50%-Y-compressed unbarned livestock avatar at render time.
  const shadowRoot = {
    position: { x: 3.75, y: 0.01, z: 2.2 },
    visible: true,
    parent: {},
  }; // Confirms the livestock ground shadow follows the same building incline.
  const sleepingAnimal = {
    id: 'outdoor_sleep_test',
    animalKey: 'grehlr',
    _outdoorAppliedScaleY: 0.5,
    avatarRef: { group: sleeperRoot },
    groundShadow: shadowRoot,
  };

  let observed = null; // Captures the temporary rendered Y values before the bridge restores simulation state.
  const renderer = {
    render() {
      observed = {
        animalY: sleeperRoot.position.y,
        shadowY: shadowRoot.position.y,
      };
    },
  };
  const FarmAnimals = { init() {} };
  const PixelProbe = { init() {} };
  const context = {
    console,
    Map,
    Set,
    WeakMap,
    Symbol,
    Promise,
    Math,
    Number,
    String,
    Object,
    Array,
    JSON,
    location: { search: '', pathname: '/docs/index.html' },
    document: { readyState: 'complete', getElementById() { return null; } },
    window: {
      HobunjiTownSubtleElevation: { sampleHeightAt() { return 0.9; } },
      HobunjiFarmSubtleElevation: { sampleHeightAt() { return 0.24; } },
      HobunjiWalkableElevation: { surfaceLiftAt() { return 0.05; } },
      FarmAnimals,
      PixelProbe,
    },
  };
  context.window.window = context.window;
  vm.runInNewContext(animalElevationSource, context, { filename: 'animal-subtle-elevation-bridge.js' });

  context.window.FarmAnimals.init({
    getCurrentArea: () => 'farm',
    animalObjects: new Set([sleepingAnimal]),
  });
  context.window.PixelProbe.init({
    getCurrentArea: () => 'farm',
    renderer,
  });
  renderer.render();

  assert.ok(observed, 'renderer ran through the shared animal elevation bridge');
  assert.ok(Math.abs(observed.animalY - 0.74) < 1e-9,
    'sleep-compressed outdoor livestock receives farm terrain + support lift above the barn incline');
  assert.ok(Math.abs(observed.shadowY - 0.30) < 1e-9,
    'outdoor livestock shadow receives the same farm terrain + support lift');
  assert.equal(sleeperRoot.position.y, 0.45,
    'farm incline is render-only and restores the sleep pose Y after rendering');
  assert.equal(shadowRoot.position.y, 0.01,
    'farm incline restoration also preserves the shadow simulation Y');
  assert.ok(Math.abs(context.window.HobunjiAnimalSubtleElevation.terrainLiftAt(3.75, 2.2, 'farm') - 0.24) < 1e-9,
    'farm terrain sampler is distinct from the town subtle-elevation map');
  assert.ok(Math.abs(context.window.HobunjiAnimalSubtleElevation.totalLiftAt(3.75, 2.2, 'farm') - 0.29) < 1e-9,
    'farm terrain and walkable support compose exactly once');

  const debug = context.window.HobunjiAnimalSubtleElevation.getDebug();
  assert.equal(debug.area, 'farm', 'surface diagnostics identify the farm render');
  assert.ok(Math.abs(debug.lastTerrainLift - 0.24) < 1e-9,
    'surface diagnostics report the barn/farmhouse terrain component');
  assert.ok(Math.abs(debug.lastSupportLift - 0.05) < 1e-9,
    'surface diagnostics report the independent support component');
  assert.equal(debug.lastActor, 'outdoor_sleep_test',
    'surface diagnostics identify the corrected outdoor livestock entity');
}

console.log('farm animal subtle-elevation regression checks passed');