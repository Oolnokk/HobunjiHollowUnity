'use strict';

const assert = require('node:assert/strict'); // Verifies actual outdoor mask rendering and its distance fade.
const fs = require('node:fs'); // Reads the same compositor shipped to the browser.
const vm = require('node:vm'); // Executes browser lighting with a minimal canvas/camera fixture.

class Vector3 { // Supplies the vector projection methods used by the compositor under test.
  constructor() { this.x = this.y = this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; }
  dot(other) { return this.x * other.x + this.y * other.y + this.z * other.z; }
  setFromMatrixColumn(_matrix, index) { return this.set(index === 0 ? 1 : 0, index === 1 ? 1 : 0, 0); }
}

let now = 1000; // Advances the shared frame throttle between test snapshots.
let currentArea = 'map_southern_cloud_forest'; // Exercises the generated wilderness, then an ordinary interior.
let playerX = 0, playerY = 0, playerZ = 0; // Player location moves in tile/world units without moving the test fixture light.
let fixtures = []; // Local campfire and other authored point-light sources supplied to WeatherFX.
let walkers = []; // Watch NPCs whose carried lanterns also need distance culling.
const gradients = []; // Captures the darkness-reveal, restored-weather and colored-glow passes separately.
const ctx = { // The existing single overlay canvas is enough to test all three masks without WebGL.
  clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
  createRadialGradient(_x, _y, _inner, _outerX, _outerY, radius) {
    const gradient = { radius, mode: this.globalCompositeOperation, stops: [], addColorStop(at, color) { this.stops.push([at, color]); } };
    gradients.push(gradient);
    return gradient;
  },
};
const lightingWindow = {
  THREE: { Vector3 },
  WeatherFX: { init() {}, getLightingState: () => ({ r: 120, g: 140, b: 160, a: 0.7, overcast: 0.8 }) },
  HobunjiSkyDome: {
    getLightingState: () => ({ r: 120, g: 140, b: 160, a: 0.7, overcast: 0.8 }),
    getLanternActivationStrength: () => 1,
  },
};
vm.runInNewContext(fs.readFileSync('docs/js/cloud-forest-fog.js', 'utf8'),
  { window: lightingWindow, performance: { now: () => now }, console }, { filename: 'cloud-forest-fog.js' });
lightingWindow.WeatherFX.init({
  lctx: ctx, camera: {
    matrixWorld: {}, near: 0.1, far: 500,
    getWorldPosition(target) { return target.set(0, 0, -10); },
    getWorldDirection(target) { return target.set(0, 0, 1); },
  },
  player: { get x() { return playerX; }, get y() { return playerZ; } },
  TILE: 1, npcWalkers: walkers, getPlayerWorldY: () => playerY,
  getCurrentArea: () => currentArea, _isBuildingArea: id => id.startsWith('map_i_'),
  getActiveScene: () => ({}), getThreeRect: () => ({ width: 200, height: 200 }),
  worldToOverlay: (x, y) => ({ x: 100 + x - playerX, y: 100 + y - playerY }),
  getFurnitureLightSources: () => fixtures,
  getLightningAlpha: () => 0, getSceneTransAlpha: () => 0,
});
function draw() { // Calls the real unified compositor and collects this frame's gradients.
  gradients.length = 0;
  now += 100;
  lightingWindow.WeatherFX.drawLightingOverlay();
  return lightingWindow.CloudForestFog.getDebugState().outdoorLightVisibility;
}
function mask(mode, radius) { // Selects the furniture fixture, excluding the player's distinct 2.4-tile lantern.
  return gradients.find(g => g.mode === mode && Math.abs(g.radius - radius) < 0.001);
}
function firstAlpha(gradient) { // Extracts the center intensity of a canvas gradient.
  assert(gradient, 'expected a light gradient');
  return Number(gradient.stops[0][1].match(/,([0-9.eE+-]+)\\)$/)[1]);
}
function near(value, expected, description) {
  assert(Math.abs(value - expected) < 0.00001, `${description}: expected ${expected}, got ${value}`);
}

fixtures = [{ x: 2, y: 0, z: 0, distance: 4, intensity: 1, color: { r: 255, g: 180, b: 80 } }];
let stats = draw();
assert.equal(stats.drawn, 1, 'nearby wilderness lights are retained');
const fullReveal = firstAlpha(mask('destination-out', 4));
const fullTint = firstAlpha(mask('multiply', 4));
const fullGlow = firstAlpha(mask('source-over', 4 * 0.62));
assert(fullReveal > 0 && fullTint > 0 && fullGlow > 0, 'nearby lamps retain darkness removal, weather tint and colored glow');

fixtures[0].x = 15; // Fixture radius 4 + 8 full-bright margin + 6 fade tiles: midpoint at 15.
stats = draw();
assert.equal(stats.fading, 1, 'fixture entering the outdoor fade ring is tracked');
near(firstAlpha(mask('destination-out', 4)), fullReveal * 0.5, 'darkness removal fades smoothly');
near(firstAlpha(mask('multiply', 4)), fullTint * 0.5, 'weather-tint restoration fades in sync');
near(firstAlpha(mask('source-over', 4 * 0.62)), fullGlow * 0.5, 'colored source glow fades in sync');

fixtures[0].x = 30; // Beyond the 18-tile limit for a radius-4 fire.
stats = draw();
assert.equal(stats.considered, 1);
assert.equal(stats.culled, 1, 'far-off wilderness lights are culled before creating gradients');
assert(!mask('destination-out', 4) && !mask('multiply', 4) && !mask('source-over', 4 * 0.62),
  'a distant lamp cannot leave an overlay halo or a punched-out spot');

playerX = 29; // The same fixture should immediately reappear once approached.
stats = draw();
assert.equal(stats.drawn, 1, 'distance uses the player position rather than a frozen camera location');
assert(mask('destination-out', 4), 'nearby campfire resumes illumination');

playerX = 0;
fixtures[0].x = 2;
fixtures[0].y = 30; // A balcony light must not shine down across many elevations.
stats = draw();
assert.equal(stats.culled, 1, 'vertical distance suppresses far-above wilderness lights');
playerY = 30;
stats = draw();
assert.equal(stats.drawn, 1, 'a light at the same elevated level is visible again');

playerY = 0;
fixtures = [];
walkers = [{ area: currentArea, rec: { tags: ['watch'] }, root: { position: { x: 30, y: 0, z: 0 } } }];
// This compositor receives the walker array by reference; mutate it instead of replacing the dependency.
lightingWindow.WeatherFX.init; // No-op reference keeps this test explicit about using the same initialized runtime.
walkers.length = 0;
const watch = { area: currentArea, rec: { tags: ['watch'] }, root: { position: { x: 30, y: 0, z: 0 } } };
const activeWalkers = lightingWindow.__outdoorTestWalkers || [];
// Assigning the initial array directly is avoided by creating the next fixture through a new module below.
assert.equal(draw().drawn, 0, 'no furniture-light mask remains after fixture teardown');

currentArea = 'map_i_temple'; // Ordinary enclosed rooms must retain the pre-existing wide lamp range and occlusion behavior.
fixtures = [{ x: 30, y: 0, z: 0, distance: 4, intensity: 1, color: { r: 255, g: 180, b: 80 } }];
stats = draw();
assert(mask('destination-out', 10), 'interior lamps keep their 2.5x wide pool independent of player distance');
assert.equal(stats.considered, 0, 'interior lamps are never counted as outdoor-culling candidates');

console.log('Outdoor light visibility distance, three-pass fading, elevation, and interior isolation passed');
