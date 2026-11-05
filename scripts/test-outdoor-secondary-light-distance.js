'use strict';

const assert = require('node:assert/strict'); // Behavioral assertions for lighting paths outside the primary wilderness compositor.
const fs = require('node:fs'); // Reads the actual shipped sources.
const vm = require('node:vm'); // Runs secondary browser overlay adapters against tiny camera/canvas fixtures.

class Vector3 { // Implements only the Three.js vector operations needed for projection/culling.
  constructor() { this.x = this.y = this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; }
  dot(other) { return this.x * other.x + this.y * other.y + this.z * other.z; }
  setFromMatrixColumn(_matrix, index) { return this.set(index === 0 ? 1 : 0, index === 1 ? 1 : 0, 0); }
}
class Color { // Normalizes the existing ghost hue without requiring a WebGL renderer.
  constructor() { this.r = 0.2; this.g = 0.8; this.b = 1; }
}
function canvasRecorder() {
  const gradients = []; // Each draw records its radius, compositor mode and authored fade strengths.
  const ctx = {
    clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, save() {}, restore() {},
    createRadialGradient(_x, _y, _r, _ex, _ey, radius) {
      const gradient = { radius, mode: this.globalCompositeOperation, stops: [], addColorStop(at, value) { this.stops.push([at, value]); } };
      gradients.push(gradient);
      return gradient;
    },
  };
  return { ctx, gradients };
}
function opacity(gradient) { // Captures real alpha emitted to Canvas2D, not a parallel copy of the fade formula.
  assert(gradient, 'expected the light to create a gradient');
  return Number(gradient.stops[0][1].match(/,([0-9.eE+-]+)\)$/)[1]);
}
const read = path => fs.readFileSync(path, 'utf8'); // Gets the actual repository code, not synthetic test implementations.
let now = 1200; // Keeps the Ghostify overlay beyond its 100ms draw throttle.
const area = 'map_southern_cloud_forest'; // Real outdoor Harlyao-night-march wilderness area.
const camera = {
  matrixWorld: {}, near: 0.1, far: 500,
  getWorldPosition(target) { return target.set(0, 0, -10); },
  getWorldDirection(target) { return target.set(0, 0, 1); },
};
const projection = (ctx, sources, walkers) => ({
  lctx: ctx, camera, player: { x: 0, y: 0 }, TILE: 1, npcWalkers: walkers,
  getPlayerWorldY: () => 0, getCurrentArea: () => area,
  getFurnitureLightSources: () => sources,
  getThreeRect: () => ({ width: 200, height: 200 }),
  worldToOverlay: (x, y) => ({ x: 100 + x, y: 100 + y, visible: true }),
  getLightningAlpha: () => 0, getSceneTransAlpha: () => 0,
});
const visibility = x => x >= 25 ? 0 : x >= 14 ? 0.5 : 1; // Models the exported visibility interface at full, half, and culled range.

{
  const { ctx, gradients } = canvasRecorder();
  const sources = [{ x: 30, y: 0, z: 0, distance: 4, intensity: 1, color: { r: 255, g: 120, b: 40 } }]; // Wilderness campfire on the distant horizon.
  const walkers = [{ area, rec: { tags: ['watch'] }, root: { position: { x: 30, y: 0, z: 0 } } }]; // Watch lantern with the same remoteness.
  const weather = { init() {}, drawLightingOverlay() { ctx.clearRect(0, 0, 200, 200); } }; // Base compositor whose clearRect triggers the real Harlyao second pass.
  const win = {
    THREE: { Vector3 }, WeatherFX: weather, __farmLog() {},
    HarlyaoNightMarch: { debugSnapshot: () => ({ scheduled: { zoneId: area } }) },
    CloudForestFog: { outdoorLightVisibilityAt: visibility },
    HobunjiSkyDome: { getLightingState: () => ({ r: 5, g: 8, b: 23, a: 0.75 }) },
  };
  vm.runInNewContext(read('docs/js/harlyao-night-march-atmosphere.js'),
    { window: win, fetch: async () => ({ ok: true, json: async () => ({ zoneAtmosphere: { darknessMultiplier: 2 } }) }), console }, { filename: 'harlyao-night-march-atmosphere.js' });
  weather.init(projection(ctx, sources, walkers));
  function draw() { gradients.length = 0; weather.drawLightingOverlay(); }
  draw();
  assert.equal(gradients.filter(g => g.radius === 4).length, 0,
    'night march must not re-punch dark sky around a faraway campfire');
  assert.equal(gradients.filter(g => g.radius === 2.4).length, 1,
    'only the nearby player lantern remains while distant watch lanterns are culled');
  sources[0].x = 15;
  walkers[0].root.position.x = 15;
  draw();
  const fire = gradients.find(g => g.radius === 4 && g.mode === 'destination-out');
  const watch = gradients.filter(g => g.radius === 2.4 && g.mode === 'destination-out');
  assert(Math.abs(opacity(fire) - 0.4) < 1e-8, 'night march half-fades campfire dark-reveal strength');
  assert.equal(watch.length, 2, 'watch lantern transitions into view during the Harlyao march');
  assert(Math.abs(opacity(watch[1]) - 0.46) < 1e-8, 'watch lantern alpha uses the same half-fade');
  const glow = gradients.find(g => g.radius === 4 * 0.62 && g.mode === 'source-over');
  assert(Math.abs(opacity(glow) - 0.055) < 1e-8, 'night march decorative glow also half-fades');
}

{
  const { ctx, gradients } = canvasRecorder();
  const sources = []; // Ghostify light comes from providers rather than the furniture registry.
  const win = {
    THREE: { Vector3, Color }, WeatherFX: { init() {}, drawLightingOverlay() { ctx.clearRect(0, 0, 200, 200); } },
    CloudForestFog: { outdoorLightVisibilityAt: visibility },
    HarlyaoNightMarchAtmosphere: { install() {} }, HarlyaoNightMarchBeacon: { ensureWeatherBridge() {} },
  };
  vm.runInNewContext(read('docs/js/ghostify.js'),
    { window: win, performance: { now: () => now }, console }, { filename: 'ghostify.js' });
  win.WeatherFX.init(projection(ctx, sources, []));
  const regular = { x: 30, y: 0, z: 0, radiusTiles: 4, intensity: 1, color: '#4fd9c6' }; // Ordinary ghost must stop glowing after the fade.
  const beacon = { x: 30, y: 0, z: 0, radiusTiles: 5, intensity: 1, color: '#b0f0ff', keepVisibleAtDistance: true }; // Harlyao's deliberate navigation cue is exempt.
  const stopRegular = win.Ghostify.registerGlowSource(() => regular); // Existing registered provider API, as used by the Harlyao runtime.
  const stopBeacon = win.Ghostify.registerGlowSource(() => beacon);
  function draw() { gradients.length = 0; now += 150; win.WeatherFX.drawLightingOverlay(); }
  draw();
  assert.equal(gradients.filter(g => g.radius === 4).length, 0,
    'regular spectral halo is culled on a distant wilderness horizon');
  assert.equal(gradients.filter(g => g.radius === 5).length, 1,
    'navigation beacon retains an intentional distant darkness reveal');
  regular.x = 15;
  draw();
  const glow = gradients.find(g => g.radius === 4 && g.mode === 'destination-out');
  assert(Math.abs(opacity(glow) - 0.31) < 1e-8,
    'generic ghost light reveals half its nearby darkness at the fade midpoint');
  regular.x = 5;
  draw();
  assert(Math.abs(opacity(gradients.find(g => g.radius === 4 && g.mode === 'destination-out')) - 0.62) < 1e-8,
    'regular spectral halo retains full intensity nearby');
  stopRegular();
  stopBeacon();
}

assert.match(read('docs/js/harlyao-night-march-beacon.js'), /keepVisibleAtDistance: true/,
  'the special all-distance beacon explicitly declares its exception');
console.log('Secondary outdoor lighting: Harlyao darkness, watch lanterns, generic spectral glows, and beacon exception passed');
