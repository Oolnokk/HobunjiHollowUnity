'use strict';
// Exercise the real player release scheduler and projectile integration in the same update frame.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/combat/ranged-weapons.js'), 'utf8');
function functionSource(name, followingName) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  function ' + followingName + '(', start);
  assert(start >= 0 && end > start, name + ' must remain a testable shared function');
  return source.slice(start, end);
}

const MAX_FIRE_TRIGGER_TO_PROJECTILE_S = 0.012; // Caps the player fire-to-spawn interval under test.
const player = { x: 0, y: 0 }; // Shooter used by the actual shared player-action scheduler.
const projectiles = []; // Captures physical shots spawned by the live release handler.
const shots = []; // Records launches independently of projectile movement.
const reloads = []; // Ensures firing still unloads each ordinary ranged weapon.
const sounds = []; // Ensures firing SFX remains tied to spawning.
const deps = {
  player, TILE: 64,
  getCurrentArea: () => 'test',
  getHeldRangedWorldTransform: () => null,
  getPlayerAimAngle: () => 0,
  getPlayerAimPitch: () => 0,
  getActiveScene: () => null,
  getHeldRangedTexture: () => null,
  canOccupyAt: () => true,
  worldSurfaceY: () => 0,
  refreshActionBar: () => {},
};
const sandbox = {
  Math, window: {}, deps, projectiles, shots, reloads, sounds, MAX_FIRE_TRIGGER_TO_PROJECTILE_S,
  AIM_EPSILON: 1e-6,
  setLoaded: (key, loaded) => reloads.push([key, loaded]),
  playRangedActionSfx: (key, kind) => sounds.push([key, kind]),
  playerAimSolution: () => ({ angle: 0, pitch: 0 }),
  playerAmmoPayload: () => null,
  consumeSpecialAmmo: () => {},
  restoreHeldThrownWeapon: () => {},
  spawnVolley: (itemKey) => {
    const projectile = {
      itemKey, areaId: 'test', dead: false, embedded: false, x: 0, y: 0, worldY: 1,
      prevX: 0, prevY: 0, prevWorldY: 1, vx: 500, vy: 0, vyWorld: 0,
      projectileGravityWorldS2: 0, dropStartPx: Infinity, distancePx: 0,
      maxDistancePx: 1000, def: { projectileRadiusPx: 3 },
      mesh: { position: { set() {} } },
    }; // Fresh in-flight shot with enough range to test its first physical step.
    projectiles.push(projectile);
    shots.push(itemKey);
    return [projectile];
  },
  updateProjectileVisual: () => {},
  terrainImpactForStep: () => null,
  projectileHit: () => null,
  updateProjectileTrails: () => {},
  disposeProjectile: p => { p.dead = true; },
  updateAmmoDebuffs: () => {},
  updateBanditAimLabel: () => {},
};
vm.createContext(sandbox);
vm.runInContext(
  'let playerAction = null;\n' +
  functionSource('fireReleaseFrac', 'isLoaded') + '\n' +
  functionSource('updatePlayerAction', 'createProjectileMesh') + '\n' +
  functionSource('updateProjectiles', 'banditAimPitch') + '\n' +
  functionSource('update', 'playerLockRangePx') + '\n' +
  'globalThis.sim = { fire(itemKey, def) { playerAction = { itemKey, def, kind: "fire", t: 0, durationS: def.fireDurationS, fired: false, damageScale: 1, heldHidden: false }; }, update, fireReleaseFrac };',
  sandbox
);
const sim = sandbox.sim;

const configurations = {
  crossbow: { fireDurationS: 1.04, fireAtFrac: 0.08, rangedType: 'crossbow' },
  scatterbow: { fireDurationS: 1.04, fireAtFrac: 0.08, rangedType: 'crossbow' },
  bshuakauitl: { fireDurationS: 0.475, fireAtFrac: 0.08, rangedType: 'blowgun' },
  fishingspear: { fireDurationS: 0.53, fireAtFrac: 0.16, rangedType: 'thrown' },
}; // Covers the four distinct player release families without changing their animation/reload durations.
for (const [key, def] of Object.entries(configurations)) {
  const previousShotCount = shots.length;
  const previousSoundCount = sounds.length;
  const previousUnloadCount = reloads.length;
  assert(def.fireDurationS * sim.fireReleaseFrac(def) <= MAX_FIRE_TRIGGER_TO_PROJECTILE_S + 1e-9,
    key + ' must schedule release no later than 12ms after fire starts');
  sim.fire(key, def); // For a thrown weapon this is called after the user has released the charge.
  sim.update(1 / 60);
  assert.equal(shots.length, previousShotCount + 1, key + ' spawns during its first firing frame');
  assert.equal(sounds.length, previousSoundCount + 1, key + ' plays shot SFX when the projectile spawns');
  assert.deepEqual(reloads.at(-1), [key, false], key + ' unloads on the release frame');
  assert.equal(reloads.length, previousUnloadCount + 1, key + ' unloads exactly once');
  const projectile = projectiles.at(-1);
  assert(projectile.x > 0, key + ' moves its projectile during that same frame');
  assert(projectile.distancePx > 0 && projectile.prevX === 0, key + ' retains a swept first-frame collision segment');
  projectiles.length = 0;
}
assert.equal(sim.fireReleaseFrac({ fireDurationS: 1, fireAtFrac: 0 }), 0, 'authored instant fire remains instant');
assert.equal(sim.fireReleaseFrac({ fireDurationS: 1, fireAtFrac: -1 }), 0, 'negative authored timing cannot delay fire');
console.log('Player ranged firing spawns and advances projectiles in the first update frame.');
