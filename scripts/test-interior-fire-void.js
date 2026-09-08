'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/interior-fire-void-runtime.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(source, { filename: 'interior-fire-void-runtime.js' }));

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  setFromMatrixColumn() { this.x = 1; this.y = 0; this.z = 0; return this; }
}
class Box3 {
  setFromObject() { this.empty = false; return this; }
  isEmpty() { return !!this.empty; }
  getCenter(target) { target.x = 10; target.y = 1; target.z = 12; return target; }
  getSize(target) { target.x = 20; target.y = 4; target.z = 24; return target; }
}
class BoxGeometry {
  constructor(width, height, depth) { this.parameters = { width, height, depth }; }
}
class MeshBasicMaterial {
  constructor(options = {}) {
    this.type = 'MeshBasicMaterial';
    this.color = { value: options.color, set: value => { this.color.value = value; } };
    this.side = options.side;
    this.depthWrite = options.depthWrite;
    this.fog = true;
    this.toneMapped = true;
    this.needsUpdate = false;
  }
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.name = '';
    this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
    this.userData = {};
  }
}

const calls = [];
const campfireRecipe = [
  { kind: 'cylinder', transform: { x: 0.2, y: 0.1, z: -0.3, sx: 0.7, sy: 0.16, sz: 0.16 } },
  { kind: 'cylinder', transform: { x: -0.2, y: 0.08, z: 0.25, sx: 0.22, sy: 0.14, sz: 0.22 } },
];
const furniture = {
  CATALOG: { campfire: JSON.parse(JSON.stringify(campfireRecipe)), bonfire: [] },
  buildFurnitureGroup(key, baseColor) { calls.push([key, baseColor]); return { key, children: [{}] }; },
};
const GridTileAccessors = { init() {}, isBuildingArea: area => String(area).startsWith('map_i_') };
let now = 1000;
const context = {
  window: {
    THREE: { Box3, Vector3, BoxGeometry, MeshBasicMaterial, Mesh, BackSide: 'BackSide' },
    ProceduralFurniture: furniture,
    GridTileAccessors,
  },
  performance: { now: () => (now += 101) },
  setTimeout(fn) { fn(); return 1; },
  queueMicrotask(fn) { fn(); },
  console,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'interior-fire-void-runtime.js' });

const api = context.window.InteriorFireVoidRuntime;
assert(api?.installed, 'fire/void runtime must install');
assert.strictEqual(api.canonicalFireKey('campfireFurniture'), 'campfire');
assert.strictEqual(api.canonicalFireKey('bonfireFurniture'), 'bonfire');
assert.strictEqual(api.canonicalFireKey('chairSimpleFurniture'), 'chairSimpleFurniture');

assert.strictEqual(furniture.CATALOG.bonfire.length, campfireRecipe.length,
  'bonfire needs immediate non-empty procedural geometry while authored data loads');
assert.strictEqual(furniture.CATALOG.bonfire[0].transform.sx, campfireRecipe[0].transform.sx * 2,
  'immediate bonfire geometry must be exactly doubled from the campfire recipe');
assert.strictEqual(furniture.CATALOG.bonfireFurniture, furniture.CATALOG.bonfire,
  'bonfireFurniture catalog lookup must resolve to the canonical bonfire recipe');

furniture.buildFurnitureGroup('campfireFurniture', 0x123456);
furniture.buildFurnitureGroup('bonfireFurniture', 0x654321);
assert.deepStrictEqual(calls.slice(-2).map(call => call[0]), ['campfire', 'bonfire'],
  'item keys must be canonicalized before the visual builder can fall through to a placeholder cube');

const decorativeBridge = vm.runInContext(`(() => {
  const defs = { basicBedFurniture: {}, chairSimpleFurniture: {}, rugFurniture: {} };
  return [
    defs.campfireFurniture?.procKey,
    defs.bonfireFurniture?.procKey,
    defs.bonfireFurniture?.fw,
    defs.bonfireFurniture?.fd,
    defs.bonfireFurniture?.key,
    defs.bonfireFurniture?.label,
    defs.bonfireFurniture?.col,
  ];
})()`, context);
assert.deepStrictEqual(Array.from(decorativeBridge), ['campfire', 'bonfire', 2, 2, 'bonfireFurniture', 'Bonfire', 0x6d3e20],
  'definition bridge must satisfy both gameplay and Interior Editor catalog fields');

const children = [];
const scene = {
  add(child) { children.push(child); child.parent = this; },
  getObjectByName(name) { return children.find(child => child.name === name) || null; },
};
const backdrop = api.blackVoidForScene({ scene }, 'map_i_temple');
assert(backdrop, 'interior scene must receive a void backdrop');
assert.strictEqual(backdrop.material.type, 'MeshBasicMaterial', 'void must use an unlit material');
assert.strictEqual(backdrop.material.color.value, 0x000000, 'void must be pure black, not brown');
assert.strictEqual(backdrop.material.fog, false, 'fog must not tint the black void');
assert.strictEqual(backdrop.material.toneMapped, false, 'tone mapping must not alter the black void');
assert.strictEqual(backdrop.material.depthWrite, false, 'void must not write depth over real interior geometry');
assert.strictEqual(backdrop.renderOrder, -10000, 'void must render behind the interior');
assert.strictEqual(backdrop.userData.unlitBlack, true);
assert.strictEqual(backdrop.raycast(), undefined, 'void backdrop must be ignored by interaction rays');

// Enclosed-area recognition intentionally includes authored interiors, mine floors,
// dens and cavern/burrow aliases while leaving ordinary exterior zones alone.
assert.strictEqual(api.isEnclosedArea('map_i_temple'), true);
assert.strictEqual(api.isUndergroundArea('map_i_town_mine_safe'), true);
assert.strictEqual(api.isUndergroundArea('map_i_town_mine_f_3'), true);
assert.strictEqual(api.isUndergroundArea('map_i_den_cloudforest_12'), true);
assert.strictEqual(api.isEnclosedArea('town'), false);
assert(Math.abs(api.enclosedDarknessAlphaForIllumination(0) - 0.80) < 1e-9,
  'zero illumination must reach the same darkness ceiling as full night');
assert(Math.abs(api.enclosedDarknessAlphaForIllumination(1) - 0.28) < 1e-9,
  'normal authored illumination must preserve the historical 0.28 interior baseline');
assert(api.enclosedDarknessAlphaForIllumination(0.06) > 0.70,
  'the temple super-dark base setting must visibly darken unlit character planes too');
assert(api.enclosedDarknessAlphaForIllumination(2.4) < 0.08,
  'strong daylight influence must be able to clear most of the enclosed darkness');

// WeatherFX is assigned after this companion in index.html. The bridge must catch
// that future assignment, survive cloud-forest-fog replacing drawLightingOverlay,
// and use the same lighting canvas for interiors/mines/dens.
let upstreamDraws = 0;
let baseInitCalls = 0;
context.window.WeatherFX = {
  init() { baseInitCalls += 1; },
  drawLightingOverlay() { upstreamDraws += 1; },
  getLightingState() { return { r: 10, g: 10, b: 40, a: 0.80 }; },
};
const capturedInit = context.window.WeatherFX.init;
context.window.WeatherFX.init = function cloudForestStyleInit(deps) { return capturedInit.call(this, deps); };
context.window.WeatherFX.drawLightingOverlay = function cloudForestStyleDraw() { upstreamDraws += 1; };

const canvasOps = [];
const gradient = () => ({ addColorStop(offset, color) { canvasOps.push(['stop', offset, color]); } });
const lctx = {
  globalCompositeOperation: 'source-over',
  fillStyle: '',
  clearRect(x, y, w, h) { canvasOps.push(['clear', x, y, w, h]); },
  fillRect(x, y, w, h) { canvasOps.push(['fillRect', this.globalCompositeOperation, this.fillStyle, x, y, w, h]); },
  createRadialGradient() { return gradient(); },
  beginPath() {},
  arc() {},
  fill() { canvasOps.push(['fill', this.globalCompositeOperation, this.fillStyle]); },
};
let currentArea = 'map_i_town_mine_safe';
const deps = {
  lctx,
  camera: { matrixWorld: {} },
  player: { x: 20, y: 30 },
  TILE: 10,
  npcWalkers: [],
  getPlayerWorldY: () => 0.5,
  getCurrentArea: () => currentArea,
  worldToOverlay: (x, y, z) => ({ x: x * 10, y: z * 10, visible: true }),
  getFurnitureLightSources: () => [{ x: 3, y: 0.5, z: 3, distance: 4, intensity: 1.2, color: { r: 255, g: 120, b: 50 } }],
  getThreeRect: () => ({ width: 640, height: 360 }),
  getSceneTransAlpha: () => 0,
};
context.window.WeatherFX.init(deps);
assert.strictEqual(baseInitCalls, 1, 'WeatherFX init capture must preserve the original init chain');
context.window.WeatherFX.drawLightingOverlay();
assert.strictEqual(upstreamDraws, 0, 'enclosed mine lighting must replace, not stack on, the older warm overlay');
assert(canvasOps.some(op => op[0] === 'fillRect' && /^rgba\(0,0,0,0\.[67]/.test(op[2])),
  'an unconfigured mine must receive near-night black screen-space darkness');
assert(canvasOps.some(op => op[0] === 'fill' && op[1] === 'destination-out'),
  'lantern/local lights must punch holes through enclosed darkness');

currentArea = 'town';
context.window.WeatherFX.drawLightingOverlay();
assert.strictEqual(upstreamDraws, 1, 'ordinary exterior areas must delegate to the existing WeatherFX/cloud-forest renderer unchanged');
const debug = api.debugSnapshot();
assert.strictEqual(debug.enclosedOverlay.weatherBridgeInstalled, true);
assert.strictEqual(debug.enclosedOverlay.depsCaptured, true);
assert.strictEqual(debug.enclosedOverlay.lastArea, 'map_i_town_mine_safe');
assert(debug.enclosedOverlay.lastLocalLights >= 2, 'debug snapshot must report carried lantern + local room light masks');

console.log('interior fire + black void + night-style enclosed overlay lighting regression checks: PASS');