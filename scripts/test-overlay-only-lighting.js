'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const registrySource = read('docs/js/furniture-light-registry.js');
const flatSource = read('docs/js/farmhouse-flat-lighting.js');
const windowsSource = read('docs/js/daylight-window-runtime.js');
const overlaySource = read('docs/js/cloud-forest-fog.js');

assert.doesNotThrow(() => new vm.Script(registrySource, { filename: 'furniture-light-registry.js' }));
assert.doesNotThrow(() => new vm.Script(flatSource, { filename: 'farmhouse-flat-lighting.js' }));

class Layers {
  constructor() { this.value = 0; }
  set(value) { this.value = value; }
}

class PointLight {
  constructor(color = 0xffffff, intensity = 1, distance = 0, decay = 1) {
    this.isLight = true;
    this.isPointLight = true;
    this.color = color;
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    this.layers = new Layers();
    this.userData = {};
    this.parent = null;
    this.castShadow = true;
  }
}

const registryWindow = { THREE: { PointLight } };
vm.runInNewContext(registrySource, { window: registryWindow }, { filename: 'furniture-light-registry.js' });
const bridgedPoint = new registryWindow.THREE.PointLight('#ffaa22', 1.4, 3.5, 2);
assert.strictEqual(bridgedPoint.layers.value, 31,
  'every gameplay PointLight constructor must route to the non-rendered overlay-only light layer');
assert.strictEqual(bridgedPoint.userData.furnitureLightMask, true,
  'legacy PointLights must automatically become fake-overlay local-light sources');
assert.strictEqual(bridgedPoint.castShadow, false,
  'fake-overlay PointLights must not retain Three.js shadow work');
const pointScene = { isScene: true, parent: null };
bridgedPoint.parent = pointScene;
assert.deepStrictEqual(registryWindow.FurnitureLightRegistry.list(pointScene), [bridgedPoint],
  'constructor-bridged PointLights must remain available to the 2D lighting compositor');
assert.strictEqual(registryWindow.FurnitureLightRegistry.debugSnapshot().constructorBridgeInstalled, true,
  'mobile diagnostics must prove the PointLight constructor bridge is installed');

class AmbientLight {
  constructor(color = 0xffffff, intensity = 1) {
    this.isLight = true;
    this.isAmbientLight = true;
    this.color = { value: color, set: value => { this.color.value = value; } };
    this.intensity = intensity;
    this.layers = new Layers();
    this.userData = {};
    this.parent = null;
    this.name = '';
    this.castShadow = false;
  }
}

function lightNode(kind) {
  return {
    isLight: true,
    [kind]: true,
    layers: new Layers(),
    userData: {},
    castShadow: true,
    parent: null,
    traverse(visitor) { visitor(this); },
  };
}

function makeScene(initialChildren = []) {
  const scene = {
    isScene: true,
    userData: {},
    children: [],
    add(...objects) {
      for (const object of objects) {
        object.parent = scene;
        scene.children.push(object);
      }
      return scene;
    },
    traverse(visitor) {
      visitor(scene);
      for (const child of scene.children) {
        if (typeof child.traverse === 'function') child.traverse(visitor);
        else visitor(child);
      }
    },
    getObjectByName(name) { return scene.children.find(child => child.name === name) || null; },
  };
  scene.add(...initialChildren);
  return scene;
}

(async () => {
  const map = new Map();
  const environmentCalls = []; // Records the simulated pre-existing environment wrapper so ordering against the flat-lighting wrapper is testable.
  const rawSet = map.set.bind(map); // Used below to mimic InteriorEnvironmentRuntime's real Map.set wrapper without loading the whole module into this focused test.
  map.set = function simulatedEnvironmentSet(mapId, sceneRecord) {
    const result = rawSet(mapId, sceneRecord);
    queueMicrotask(() => environmentCalls.push({ mapId, flatAlreadyInstalled: sceneRecord?.scene?.userData?.farmhouseFlatLighting === true }));
    return result;
  };
  let refreshCalls = 0;
  const flatWindow = {
    THREE: { AmbientLight },
    GridTileAccessors: { init() {} },
    CloudForestFog: { refreshLightingOverlay() { refreshCalls += 1; } },
    DaylightWindowRuntime: { version: 3 },
    WeatherFX: { __singleFullDayLightingAuthority: true },
  };
  const timers = [];
  const context = vm.createContext({
    window: flatWindow,
    performance: { now: () => 0 },
    queueMicrotask,
    setInterval(fn) { timers.push(fn); return timers.length; },
    clearInterval() {},
    Promise,
  });
  vm.runInContext(flatSource, context, { filename: 'farmhouse-flat-lighting.js' });
  flatWindow.GridTileAccessors.init({
    _buildingScenes: map,
    _isBuildingArea: area => /^map_i_/.test(String(area)) && !/^map_i_(?:den|mine|cave|cavern)/.test(String(area)),
  });

  const authoredDirectional = lightNode('isDirectionalLight');
  const authoredPoint = lightNode('isPointLight');
  const templeScene = makeScene([authoredDirectional, authoredPoint]);
  map.set('map_i_temple', { scene: templeScene });
  await Promise.resolve();
  await Promise.resolve();

  const templeEnvironmentCall = environmentCalls.find(entry => entry.mapId === 'map_i_temple');
  assert(templeEnvironmentCall && templeEnvironmentCall.flatAlreadyInstalled === false,
    'authored-building flat lighting must queue after the existing environment Map.set microtask instead of racing or applying it twice');
  assert.strictEqual(templeScene.userData.farmhouseFlatLighting, true,
    'Life Temple and other authored buildings must use the farmhouse flat-lighting baseline');
  assert.strictEqual(authoredDirectional.layers.value, 31,
    'authored building directional lights must be excluded from WebGL lighting');
  assert.strictEqual(authoredPoint.layers.value, 31,
    'authored building point lights must be excluded from WebGL lighting');
  const baseline = templeScene.getObjectByName('hobunji_overlay_flat_baseline');
  assert(baseline?.isAmbientLight, 'authored buildings need one neutral Lambert baseline after real lights are removed');
  baseline.intensity = 0.05;
  assert.strictEqual(baseline.intensity, 1,
    'legacy authored-lighting updates must not be able to turn the neutral baseline into time-varying Three.js lighting');
  assert(refreshCalls > 0,
    'routing an authored building must request an immediate redraw from the shared 2D lighting compositor');

  const denDirectional = lightNode('isDirectionalLight');
  const denScene = makeScene([denDirectional]);
  map.set('map_i_den_test', { scene: denScene });
  await Promise.resolve();
  await Promise.resolve();
  assert.notStrictEqual(denScene.userData.farmhouseFlatLighting, true,
    'dens/mines/caverns must stay on their separate underground-lighting policy rather than masquerading as authored buildings');

  assert.match(windowsSource,
    /return area === 'interior' \|\| !!lightingDeps\?\._isBuildingArea\?\.\(area\)/,
    'daylight-window runtime must route every ordinary authored building through the farmhouse window/time-of-day effect');
  assert.match(windowsSource, /updatePaneTint\(currentOutdoorLighting\(\)\)/,
    'building window panes must continue sampling the shared outdoor time/weather color');
  assert.match(overlaySource,
    /if \(ordinaryBuildingInterior\(currentArea\)\) drawWindowLightMasks\(\)/,
    'shared 2D lighting must apply daylight-window masks to authored buildings');

  console.log('overlay-only local lights + authored-building farmhouse lighting regression checks: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
