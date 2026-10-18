'use strict';

const assert = require('node:assert/strict'); // Verifies production orbit timing, stage resets, and wall squeeze.
const fs = require('node:fs'); // Loads the real shipped scripts rather than duplicating the camera algorithms.
const vm = require('node:vm'); // Runs the relevant seams without requiring a WebGL scene.
const read = file => fs.readFileSync(file, 'utf8'); // Shared shipping-source loader.
const game = read('docs/game.js'); // Live stage dispatcher and camera collision math.

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(other) { return this.set(this.x + other.x, this.y + other.y, this.z + other.z); }
  multiplyScalar(amount) { return this.set(this.x * amount, this.y * amount, this.z * amount); }
  lerp(other, amount) { return this.set(this.x + (other.x - this.x) * amount, this.y + (other.y - this.y) * amount, this.z + (other.z - this.z) * amount); }
  lerpVectors(a, b, amount) { return this.copy(a).lerp(b, amount); }
}
let clock = 0; // Drives reproducible orbit angles and focus easing.
const runtimeContext = vm.createContext({ window: { THREE: { Vector3: Vec3 } }, performance: { now: () => clock } }); // Shared camera owner in a minimal scene.
vm.runInContext(read('docs/js/cinematic-camera-runtime.js'), runtimeContext);
const cinematic = runtimeContext.window.CinematicCameraRuntime; // Production reusable procedural camera API.
const actors = [ // Two ordinary live cutscene actors, one of which may be the player.
  { id: 'player', root: { position: new Vec3(9.5, 0, 8.5) }, walker: { avatarHeight: 1.2 } },
  { id: 'jubmir', root: { position: new Vec3(10.5, 0, 8.5) }, walker: { avatarHeight: 1.2 } },
];
const first = cinematic.createActorOrbitShot(actors, { id: 'intro', focusActorId: 'jubmir', zoomPercent: 105, distanceTiles: 3.7, speedDegPerSec: 6 }); // First reset favors Jubmir.
assert(first);
assert(first.targetProvider().x > 10.25, 'initial gaze favors the requested speaker');
const initialPosition = first.positionProvider().clone(); // Saves first angle for consistent-speed assertion.
clock = 5000;
const nextPosition = first.positionProvider().clone(); // Six degrees/second produces a thirty-degree revolution in five seconds.
const radius = first.orbitDebug.radius; // Tests actual authored 105% zoom rather than an unrelated camera setting.
assert(Math.abs(Math.hypot(nextPosition.x - 10, nextPosition.z - 8.5) - radius) < 1e-8);
assert(Math.abs(Math.hypot(initialPosition.x - nextPosition.x, initialPosition.z - nextPosition.z) - 2 * radius * Math.sin(Math.PI / 12)) < 1e-8);
clock = 20000;
assert(Math.abs(first.targetProvider().x - 10) < 0.01, 'the gaze eases naturally back toward the midpoint');
const second = cinematic.createActorOrbitShot(actors, { id: 'next', focusActorId: 'player', zoomPercent: 110, distanceTiles: 3.7, speedDegPerSec: 6 }); // Next paragraph resets to the player and zooms another 5%.
assert(second.targetProvider().x < 9.75);
assert(second.orbitDebug.radius < radius, 'higher intended zoom requests a shorter boom');
assert.equal(cinematic.createActorOrbitShot([actors[0]], {}), null, 'invalid orbit subjects cannot crash a cutscene');

const stageStart = game.indexOf('        function runStage(stageId)'); // Actual live Director stage dispatcher.
const stageEnd = game.indexOf('        function runMove(stage)', stageStart); // Excludes unrelated movement mechanics.
assert(stageStart !== -1 && stageEnd > stageStart);
const orbitSettings = []; // Captures reset order, focus selection, and progressive zoom handed to the shared camera.
const cutsceneActors = new Map(actors.map(actor => [actor.id, { ...actor, kind: 'npc', rec: { id: actor.id } }])); // Maps authored actor IDs to their live stand-ins.
const cards = new Map(['one', 'two', 'optional', 'three'].map(id => [id, { id, type: 'talk', speakerId: 'jubmir', addressedActorId: 'player', text: id,
  cameraMode: 'orbit', orbitActorIds: ['player', 'jubmir'], orbitAlternateFocus: true, orbitZoomStepPercent: 5 }]));
const stageContext = vm.createContext({
  running: true, stagesById: cards, payload: { title: 'Orbit test' }, area: 'room',
  actorsById: new Map(actors.map(actor => [actor.id, { name: actor.id }])), entities: cutsceneActors,
  externallyDrivenActorIds: new Set(), report() {}, cinematicCameraReady: false, povShot: null,
  window: { CinematicCameraRuntime: { createActorOrbitShot(subjects, settings) { orbitSettings.push(settings); return { id: settings.id }; }, activate() {} } },
  openLine() { return Promise.resolve(); }, console, runtimeOptions: {},
  cutscenePreviewStageId: null, dialogueAddressedActorId: null,
}); // Only the orbit-and-talk branch runs; no timers, renderer, or gameplay globals are needed.
vm.runInContext('let orbitResetCount=0;\n' + game.slice(stageStart, stageEnd) + '\nrunStage("one"); runStage("two"); runStage("three");', stageContext);
assert.deepEqual(orbitSettings.map(setting => setting.zoomPercent), [105, 110, 115], 'only visited paragraphs advance the 5% zoom');
assert.deepEqual(orbitSettings.map(setting => setting.focusActorId), ['jubmir', 'player', 'jubmir'], 'each visited paragraph alternates initial focus');
assert(!orbitSettings.some(setting => setting.id.endsWith('optional')), 'skipped branch does not affect progression');

const solverStart = game.indexOf('      const CAMERA_FLOOR_CLEARANCE ='); // Includes the same constants and ground slide as the game camera.
const solverEnd = game.indexOf('      // How far under a tree canopy', solverStart); // Ends at the production solver boundary.
assert(solverStart !== -1 && solverEnd > solverStart);
const rayOrigin = { set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }; // Shared Raycaster origin scratch.
const rayDirection = { set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }; // Shared Raycaster direction scratch.
let lateralCalls = 0, directCalls = 0; // Distinguishes lateral clearance from the existing 3D ray.
const raycaster = {
  set(origin, direction) { this.origin = { ...origin }; this.direction = { ...direction }; },
  intersectObjects() {
    if (Math.abs(this.direction.y) < 1e-9) {
      lateralCalls++;
      return this.origin.x > 0.1 ? [{ distance: 1.1 }] : []; // Only the right side of the camera collides with the wall.
    }
    directCalls++;
    return []; // The center 3D ray alone would incorrectly allow the full boom.
  },
};
const collisionContext = vm.createContext({
  activeCameraMode: 'npcDialogue', SHOULDER_SURF_MODE: 'shoulderSurf',
  cutscenePreviewActive: true, dialogueZoomActive: () => false,
  camTargetY: 0, _playerGroundY: () => 0, activeSurfaceYAtWorld: () => 0,
  currentArea: 'map_i_inn_F2_jubmir', _isBuildingArea: () => true, currentAreaOcclusionMeshes: () => [{}],
  performance: { now: () => 1000 }, THREE: { MathUtils: { degToRad: n => n * Math.PI / 180 } },
  window: { FormatUtils: { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)) }, CinematicCameraRuntime: { isActive: () => true } },
  _cameraOcclusionOriginVec: rayOrigin, _cameraOcclusionDirVec: rayDirection, _cameraOcclusionRaycaster: raycaster,
});
vm.runInContext(game.slice(solverStart, solverEnd) + '\nthis.solve=occlusionSafeCameraPosition;this.horizontalDebug=()=>_cameraHorizontalDebug;', collisionContext);
const squeezed = collisionContext.solve(0, 1, 0, 0, 1.6, 3); // A wall barely crossing the camera's right edge must pull the X/Z orbit inward.
assert(squeezed.z < 1.1, 'horizontal wall squeeze shortens the orbit despite a clear central 3D ray');
assert(Math.abs(squeezed.y - 1.6) < 1e-9, 'horizontal squeeze preserves intentional camera height');
assert(collisionContext.horizontalDebug().factor < 1 && lateralCalls === 3 && directCalls > 0, 'camera probes all three lateral lanes and still uses the 3D collision solve');
console.log('Procedural dialogue orbit: timing, character focus, 5% dialogue resets, zoom, and interior horizontal collision passed.');
