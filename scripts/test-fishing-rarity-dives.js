'use strict';
const assert = require('node:assert/strict'); // Checks the actual patrol, dive and surface escape owners.
const fs = require('node:fs'); // Reads production modules without copying their algorithms into the fixture.
const vm = require('node:vm'); // Runs the minigame without a DOM renderer.
let seed = 12345; // Reproducible random sequence for the long cadence simulation.
const math = Object.create(Math); // Keeps deterministic randomness confined to this VM.
math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
const sandbox = {
  window: { RuntimeFrameScheduler: { register() {} } },
  document: { getElementById: () => null }, Image: class {},
  performance: { now: () => 1000 }, Math: math, console,
}; // Only browser IO is stubbed; movement and timer decisions remain production code.
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('docs/js/fishing-events.js', 'utf8').replace('  hookWildTreasureInit();', '  window.testGullet = { state: gulletState, updateGullet, updateSurfaceSpritePosition };\n  hookWildTreasureInit();'), sandbox);
vm.runInContext(fs.readFileSync('docs/js/fishing-minigame.js', 'utf8').replace('  window.Fishing = {', '  window.testFish = { fishingWaterSurfaceY, fishRarityFactor, fishStepMotion, fishMaybeStartDive, fishUpdateDiveOverlay, respawnNextFish };\n  window.Fishing = {'), sandbox);
const { window: game } = sandbox; // Public game-facing APIs share the same load order as index.html.
const fish = game.testFish; // Test-only references to closure owners avoid adding a second production API.
const pool = [{ rarity: 'common' }, { rarity: 'uncommon' }, { rarity: 'rare' }]; // Three tiers expose intermediate scaling as well as the hardest benchmark.
game.Fishing.init({ FISH_DEFS: { farm: pool }, clamp: (value, min, max) => Math.max(min, Math.min(max, value)) });
assert.equal(fish.fishRarityFactor(pool[0]), 0);
assert.equal(fish.fishRarityFactor(pool[1]), 0.5);
assert.equal(fish.fishRarityFactor(pool[2]), 1);
pool.pop();
assert.equal(fish.fishRarityFactor(pool[1]), 1, 'the current catalog has only common/uncommon; its rarest fish still reaches the Gullet benchmark');
assert.equal(fish.fishRarityFactor({}), 0, 'missing rarity safely retains common movement');

function catchState(rarityFactor, fishClass = 'mixed') {
  return {
    rarityFactor, fishClass, difficulty: 100,
    fish: { pos: 0.3, angle: 108, renderAngle: 108, renderRadius: 96, moveDir: 1, vel: 0, targetVel: 0, localFacingScale: 1 },
    dive: { active: false, cooldown: 0, timer: 0 },
  }; // Each instance owns its patrol and overlay; no shared fish definition is mutated.
}
const medium = catchState(0.5), rare = catchState(1); // Compare both rarities with identical random rolls.
math.random = () => 0.5;
fish.fishStepMotion(medium, 0.01);
fish.fishStepMotion(rare, 0.01);
assert.equal(rare.fish.patrol.orbitSpeedDegPerSec, 195);
assert(medium.fish.patrol.orbitSpeedDegPerSec < rare.fish.patrol.orbitSpeedDegPerSec);
const expected = { angleDeg: 0.3 * 359, orbitDirection: 1 }; // A real Gullet patrol must produce exactly the same sequence as the rarest main fish.
game.FishingMovement.startPatrol('sprint', expected, 1);
game.FishingMovement.updatePatrol(0.01, expected, 1);
for (let step = 0; step < 600; step++) {
  fish.fishStepMotion(rare, 1 / 60);
  game.FishingMovement.updatePatrol(1 / 60, expected, 1);
  assert.equal(rare.fish.angle, expected.angleDeg);
  assert.equal(rare.fish.patrol.locomotionPhase, expected.locomotionPhase);
}
assert.notStrictEqual(medium.fish.patrol, rare.fish.patrol);

math.random = () => 0;
for (const rarity of [0, 0.5, 1]) {
  const fm = catchState(rarity); // Force one dive to inspect entry, midpoint, return and collision eligibility.
  assert(fish.fishMaybeStartDive(fm, 1 / 60));
  assert(fm.dive.lastDuration <= game.FishingMovement.config.baseEscapeSeconds * 0.8);
  fish.fishUpdateDiveOverlay(fm, fm.dive.lastDuration / 2);
  assert(fm.dive.active);
  assert(fm.fish.renderRadius < 30);
  if (rarity === 1) assert.equal(fm.fish.renderRadius, 0, 'Gullet-style dash crosses the exact center');
  fish.fishUpdateDiveOverlay(fm, fm.dive.lastDuration / 2);
  assert.equal(fm.dive.active, false);
  assert.equal(fm.fish.renderRadius, 96);
  assert.equal(fm.fish.renderAngle, fm.fish.angle);
  assert.equal(fm.fish.dimmed, false);
  if (rarity === 1) assert.equal(fm.fish.angle, 288, 'dash lands on the opposite ring edge');
}
math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
for (const cls of ['smooth', 'mixed', 'sinker', 'floater', 'dart']) {
  for (const rarity of [0, 0.5, 1]) {
    const fm = catchState(rarity, cls); // Simulates every class at common, intermediate and hardest rarity.
    let dives = 0; // Counts actual entries over two minutes rather than asserting source tuning literals.
    for (let frame = 0; frame < 7200; frame++) {
      fish.fishStepMotion(fm, 1 / 60);
      if (fish.fishMaybeStartDive(fm, 1 / 60)) dives++;
      if (fm.dive.active) fish.fishUpdateDiveOverlay(fm, 1 / 60);
      assert(fm.dive.timer <= 1.2 + 1 / 60 + 1e-10, 'every dip, including its return, stays brief');
    }
    assert(dives > 40, `${cls}/${rarity} should dive frequently (got ${dives} in two minutes)`);
  }
}

const gullet = game.testGullet.state; // Drives the actual surfaced Gullet update, including teardown at its escape deadline.
let removed = false; // Captures whether the visible fish escaped.
Object.assign(gullet, { mode: 'surface', surfaceElapsed: 0, surfaceStart: { x: 0, y: 0 }, surfaceEnd: { x: 100, y: 0 }, surfaceSprite: { style: {}, remove() { removed = true; } } });
game.testGullet.updateGullet(10, {});
assert.equal(gullet.surfaceSprite.style.left, '50px', 'ten seconds now covers half the old escape distance');
assert.equal(removed, false);
game.testGullet.updateGullet(9.99, {});
assert.equal(gullet.mode, 'surface');
game.testGullet.updateGullet(0.01, {});
assert.equal(gullet.mode, 'escaped');
assert.equal(removed, true);
assert.equal(game.FishingFeatureDebug.status().maxDiveSeconds, 8, 'halving drift must not double the original eight-second dive ceiling');
const anchor = { x: 4.5, y: 7.3, z: 2.5 }; // Elevated tile center distinguishes the old bed-offset target from the rendered surface.
const waterMesh = { visible: true, userData: { waterSurfaceRole: 'permanent' } }; // Uses the production water tag, including visible flood/local variants.
let matrixUpdates = 0; // Proves the ray sees current transforms before intersecting the water mesh.
game.Fishing.init({ getActiveScene: () => ({ children: [waterMesh, { visible: false, userData: { waterSurfaceRole: 'flood' } }, { visible: true, userData: {} }], updateMatrixWorld() { matrixUpdates++; } }) });
sandbox.THREE = {
  Vector3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  Raycaster: class {
    constructor(origin, direction) { assert.equal(origin.x, anchor.x); assert.equal(origin.z, anchor.z); assert(origin.y > anchor.y); assert.equal(direction.y, -1); }
    intersectObjects(meshes, recursive) { assert.equal(meshes.length, 1); assert.strictEqual(meshes[0], waterMesh); assert.equal(recursive, false); return [{ point: { y: 7.415 } }]; }
  },
}; // Only intersection IO is stubbed; selection/filtering/fallback are the actual fishing owner.
assert.equal(fish.fishingWaterSurfaceY(anchor), 7.415);
assert.equal(matrixUpdates, 1);
game.Fishing.init({ getActiveScene: () => ({ children: [] }) });
assert.equal(fish.fishingWaterSurfaceY(anchor), anchor.y, 'unavailable geometry preserves the finite elevated fallback');
console.log('Rarity patrols, frequent brief dives, center crossings and half-speed surface drift passed');
