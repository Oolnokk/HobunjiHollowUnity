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
assert.equal(first.horizontalCameraCollision, false, 'ordinary procedural orbits default to no horizontal squeeze');
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
assert.equal(cinematic.createStageOrbitShot({id:'duplicate'}, [actors[0], actors[0]], 1), null, 'one actor cannot be both orbit subjects');

// Height modes use rig-specific face heights; the fallback face ratio must not
// override the provided real skinned head positions for actors of unequal sizes.
const unequalActors = [
  { id: 'player', root: { position: new Vec3(9.5, 0, 8.5) }, walker: { avatarHeight: 1.3 }, faceWorldPosition: () => ({y: 1.4}) },
  { id: 'jubmir', root: { position: new Vec3(10.5, 0, 8.5) }, walker: { avatarHeight: 2.7 }, faceWorldPosition: () => ({y: 2.8}) },
];
const focusFace = cinematic.createActorOrbitShot(unequalActors, { heightMode: 'focusFace', focusActorId: 'jubmir' });
assert(Math.abs(focusFace.positionProvider().y - 2.8) < 1e-9, 'face-height orbit uses the selected actor\'s actual head height');
const offsetFace = cinematic.createActorOrbitShot(unequalActors, { heightMode: 'focusFaceOffset', faceHeightOffset: -0.35, focusActorId: 'player' });
assert(Math.abs(offsetFace.positionProvider().y - 1.05) < 1e-9, 'face height offset is in world units and may be negative');
const arcOrigin = clock;
const tilted = cinematic.createActorOrbitShot(unequalActors, { heightMode: 'oppositeFaceArc', focusActorId: 'player', speedDegPerSec: 90, zoomPercent: 125 });
let cameraEnd = tilted.positionProvider().clone(), oppositeEnd = tilted.targetProvider().clone();
assert(Math.abs(cameraEnd.y - 2.8) < 1e-9 && Math.abs(oppositeEnd.y - 1.4) < 1e-9,
  'focused player begins at the opposing Jubmir-height end and looks to the player-height end');
const middlePoint = cameraEnd.clone().add(oppositeEnd).multiplyScalar(0.5);
const arcRadius = Math.hypot(cameraEnd.x - middlePoint.x, cameraEnd.y - middlePoint.y, cameraEnd.z - middlePoint.z);
assert(Math.abs(oppositeEnd.x + cameraEnd.x - 20) < 1e-9
  && Math.abs(oppositeEnd.z + cameraEnd.z - 17) < 1e-9, 'opposite look-at remains diametrically opposite the camera');
clock = arcOrigin + 1000; // A quarter turn: height midpoint and constant 3D radius.
const quarterCamera = tilted.positionProvider().clone(), quarterTarget = tilted.targetProvider().clone();
assert(Math.abs(quarterCamera.y - 2.1) < 1e-9 && Math.abs(quarterTarget.y - 2.1) < 1e-9,
  'tilted orbit crosses the midpoint of the two face heights at a quarter turn');
assert(Math.abs(Math.hypot(quarterCamera.x - middlePoint.x, quarterCamera.y - middlePoint.y, quarterCamera.z - middlePoint.z) - arcRadius) < 1e-9,
  'face-height endpoints define a true tilted circular orbit, not a changing-radius ellipse');
clock = arcOrigin + 2000;
cameraEnd = tilted.positionProvider(); oppositeEnd = tilted.targetProvider();
assert(Math.abs(cameraEnd.y - 1.4) < 1e-9 && Math.abs(oppositeEnd.y - 2.8) < 1e-9,
  'a half-turn swaps camera and gaze endpoint face elevations');
const tighter = cinematic.createStageOrbitShot({
  id: 'fey_first', orbitInitialZoomPercent: 131.25, orbitZoomStepPercent: 5,
  orbitHeightMode: 'oppositeFaceArc', orbitAlternateFocus: true,
}, unequalActors, 1);
const followUp = cinematic.createStageOrbitShot({
  id: 'fey_second', orbitInitialZoomPercent: 131.25, orbitZoomStepPercent: 5,
  orbitHeightMode: 'oppositeFaceArc', orbitAlternateFocus: true,
}, unequalActors, 2);
assert.equal(tighter.orbitDebug.zoomPercent, 131.25);
assert.equal(followUp.orbitDebug.zoomPercent, 136.25);
assert.equal(tighter.orbitDebug.heightMode, 'oppositeFaceArc');
assert(Math.abs(tighter.orbitDebug.radius / (3.7 * 100 / 105) - 0.8) < 1e-12,
  'Jubmir initial boom is exactly 20% shorter than the old 105% zoom framing');
clock = 20000;

// The spoken paragraphs alternate focus each time but orbit direction in PAIRS:
// Jubmir clockwise, player clockwise, Jubmir counterclockwise, player
// counterclockwise, then back to the first state. Starting angles are offset
// by 30 degrees *in that direction*, and the gaze stays on the antipodal end.
const pairedDirectionStage = {
  id: 'fey_turn', orbitActorIds: ['player', 'jubmir'],
  orbitAlternateFocus: true, orbitDirection: 'clockwise',
  orbitDirectionSwitchEvery: 2, orbitDirectionalStartOffsetDeg: 30,
  orbitHeightMode: 'oppositeFaceArc', orbitInstantCut: true,
  orbitBlendSeconds: 1, orbitSpeedDegPerSec: 6,
};
const orbitSequence = [];
for (let visit = 1; visit <= 8; visit++) {
  const orbit = cinematic.createStageOrbitShot(pairedDirectionStage, unequalActors, visit);
  const p0 = orbit.positionProvider().clone();
  const gaze = orbit.targetProvider().clone();
  const baseDeg = visit % 2 ? 180 : 0; // Camera begins opposite the focused character.
  const offset = orbit.orbitDebug.startOffsetDeg;
  const expectedAngle = (baseDeg + offset) * Math.PI / 180;
  const halfHeightDifference = (2.8 - 1.4) * 0.5;
  const actualAngle = Math.atan2((p0.z - 8.5) / Math.hypot(orbit.orbitDebug.radius, halfHeightDifference), (p0.x - 10) / orbit.orbitDebug.radius);
  const angularError = Math.atan2(Math.sin(actualAngle - expectedAngle), Math.cos(actualAngle - expectedAngle));
  assert(Math.abs(angularError) < 1e-9, 'initial angle follows the focus and signed 30-degree offset');
  assert(Math.abs(p0.x + gaze.x - 20) < 1e-9 && Math.abs(p0.y + gaze.y - 4.2) < 1e-9,
    'each offset cut keeps the opposite-end look-at aligned to the pair');
  clock += 1000;
  const p1 = orbit.positionProvider().clone();
  const nextAngle = Math.atan2((p1.z - 8.5) / Math.hypot(orbit.orbitDebug.radius, halfHeightDifference), (p1.x - 10) / orbit.orbitDebug.radius);
  const angularChange = Math.atan2(Math.sin(nextAngle - actualAngle), Math.cos(nextAngle - actualAngle));
  assert(Math.abs(angularChange - orbit.orbitDebug.speedDegPerSec * Math.PI / 180) < 1e-9,
    'constant angular speed uses the authored clockwise or counterclockwise sign');
  assert.equal(orbit.blendSeconds, 0, 'instant cut disables the camera reset interpolation');
  orbitSequence.push({
    focus: orbit.orbitDebug.focusActorId, direction: orbit.orbitDebug.direction,
    offset, blendSeconds: orbit.blendSeconds,
  });
  clock -= 1000;
}
assert.deepEqual(orbitSequence.map(({focus, direction}) => [focus, direction]), [
  ['jubmir', 'clockwise'], ['player', 'clockwise'],
  ['jubmir', 'counterclockwise'], ['player', 'counterclockwise'],
  ['jubmir', 'clockwise'], ['player', 'clockwise'],
  ['jubmir', 'counterclockwise'], ['player', 'counterclockwise'],
], 'the direction reverses after every two visited paragraphs, not every paragraph');
assert.deepEqual(orbitSequence.map(({offset}) => offset), [-30,-30,30,30,-30,-30,30,30],
  'each pair begins with a thirty-degree offset matching its rotation direction');

// Keeping the checkbox off preserves the original one-second smooth lerp.
const smoothStage = { ...pairedDirectionStage, orbitInstantCut: false };
const smoothShot = cinematic.createStageOrbitShot(smoothStage, unequalActors, 2);
assert.equal(smoothShot.blendSeconds, 1);
const smoothCamera = { position: new Vec3(-10, 5, -10), fov: 42, lookAt() {}, updateProjectionMatrix() {} };
const smoothTarget = new Vec3();
const smoothBlend = cinematic.createBlendController({ camera: smoothCamera, lookPoint: smoothTarget });
const smoothRecord = { camera: smoothShot };
smoothBlend.apply(smoothRecord);
assert(Math.abs(smoothCamera.position.x + 10) < 1e-9, 'unchecked instant cut starts from the old camera pose');
clock += 500;
const halfwayDesiredX = smoothShot.positionProvider().x;
smoothBlend.apply(smoothRecord); // A stable active record preserves progress through the transition.
assert(Math.abs(smoothCamera.position.x - (-10 + (halfwayDesiredX + 10) * 0.5)) < 1e-9,
  'unchecked instant cut preserves the previous smoothstep blend exactly halfway through the authored second');
clock -= 500;
const cutShot = cinematic.createStageOrbitShot(pairedDirectionStage, unequalActors, 2);
const cutCamera = { position: new Vec3(-10, 5, -10), fov: 42, lookAt() {}, updateProjectionMatrix() {} };
const cutBlend = cinematic.createBlendController({ camera: cutCamera, lookPoint: new Vec3() });
const cutRecord = { camera: cutShot };
cutBlend.apply(cutRecord);
assert(Math.abs(cutCamera.position.x - cutShot.positionProvider().x) < 1e-9
  && Math.abs(cutCamera.fov - cutShot.fovDeg) < 1e-9,
  'checked instant cut applies the actual camera position and field of view on its first frame');

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
  window: { CinematicCameraRuntime: {
    createStageOrbitShot(stage, subjects, sequence) {
      const shot = cinematic.createStageOrbitShot(stage, subjects, sequence); // Use the production authoring rules, not a second test-side copy.
      if (shot) orbitSettings.push({ ...shot.orbitDebug, id: shot.id, shotKey: shot.shotKey });
      return shot;
    },
    activate() {},
  } },
  openLine() { return Promise.resolve(); }, console, runtimeOptions: {},
  cutscenePreviewStageId: null, dialogueAddressedActorId: null,
}); // Only the orbit-and-talk branch runs; no timers, renderer, or gameplay globals are needed.
vm.runInContext('let orbitResetCount=0;\n' + game.slice(stageStart, stageEnd) + '\nrunStage("one"); runStage("two"); runStage("three");', stageContext);
assert.deepEqual(orbitSettings.map(setting => setting.zoomPercent), [105, 110, 115], 'only visited paragraphs advance the 5% zoom');
assert.deepEqual(orbitSettings.map(setting => setting.focusActorId), ['jubmir', 'player', 'jubmir'], 'each visited paragraph alternates initial focus');
assert(!orbitSettings.some(setting => setting.id.endsWith('optional')), 'skipped branch does not affect progression');
assert.equal(orbitSettings[0].shotKey, 'one:1', 'first stage visit starts its own transition');
vm.runInContext('runStage("one");', stageContext);
assert.equal(orbitSettings[3].shotKey, 'one:4', 'revisiting the same card creates a new blend identity');
assert.equal(orbitSettings[3].focusActorId, 'player', 'revisits count as new focus resets');
const author = read('docs/tools/cutscene-director/camera-author.js'); // Real Director preview adapter must call this same stage orbit API.
const authorOrbitStart = author.indexOf('    function orbitShot(st, visit) {');
const authorOrbitEnd = author.indexOf('    function proceduralShot(st) {', authorOrbitStart);
assert(authorOrbitStart !== -1 && authorOrbitEnd > authorOrbitStart);
const authorContext = vm.createContext({
  actor: id => actors.find(a => a.id === id) && ({root: actors.find(a => a.id === id).root, avatarHeight: 1.2}),
  runtime: cinematic,
});
vm.runInContext(author.slice(authorOrbitStart, authorOrbitEnd) + '\nthis.previewOrbit=orbitShot;', authorContext);
const directorStage = cards.get('one'); // The same authored stage is used in real gameplay and the Director.
const previewOrbit = authorContext.previewOrbit(directorStage, 1);
const liveOrbit = cinematic.createStageOrbitShot(directorStage, actors, 1);
assert.equal(liveOrbit.horizontalCameraCollision, false, 'unmarked cutscene orbits never opt in implicitly');
assert.equal(cinematic.createStageOrbitShot({ ...directorStage, horizontalCameraCollision: true }, actors, 1).horizontalCameraCollision, true,
  'a cutscene paragraph may explicitly enable the horizontal collider');
assert(previewOrbit && previewOrbit.orbitDebug.focusActorId === liveOrbit.orbitDebug.focusActorId
  && previewOrbit.orbitDebug.zoomPercent === liveOrbit.orbitDebug.zoomPercent,
  'Director preview and game agree about the first focus and requested zoom');
assert(author.includes("st.cameraMode==='orbit'"), 'Director stage playback recognizes the new orbit mode');
assert(read('docs/tools/cutscene-director/index.html').includes('editOrbitHeightMode')
  && read('docs/tools/cutscene-director/index.html').includes('editOrbitInitialZoom')
  && read('docs/tools/cutscene-director/index.html').includes('editOrbitFaceHeightOffset')
  && read('docs/tools/cutscene-director/index.html').includes('editOrbitInstantCut')
  && read('docs/tools/cutscene-director/index.html').includes('editOrbitDirectionSwitchEvery')
  && read('docs/tools/cutscene-director/index.html').includes('editOrbitDirectionalStartOffset')
  && read('docs/tools/cutscene-director/index.html').includes('editHorizontalCameraCollision'),
  'Director exposes face height, initial zoom, instant cut and paired direction authoring controls');
const previewDirection = authorContext.previewOrbit(pairedDirectionStage, 3);
const liveDirection = cinematic.createStageOrbitShot(pairedDirectionStage, actors, 3);
assert(previewDirection.orbitDebug.direction === liveDirection.orbitDebug.direction
  && previewDirection.orbitDebug.startOffsetDeg === liveDirection.orbitDebug.startOffsetDeg
  && previewDirection.blendSeconds === liveDirection.blendSeconds,
  'Director and live runtime agree on direction, phase offset and instant cuts');

const solverStart = game.indexOf('      const CAMERA_FLOOR_CLEARANCE ='); // Includes the same constants and ground slide as the game camera.
const solverEnd = game.indexOf('      // How far under a tree canopy', solverStart); // Ends at the production solver boundary.
assert(solverStart !== -1 && solverEnd > solverStart);
const rayOrigin = { set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }; // Shared Raycaster origin scratch.
const rayDirection = { set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }; // Shared Raycaster direction scratch.
let lateralCalls = 0, directCalls = 0; // Distinguishes off-center clearance rays from the direct 3D sightline.
let wallVisible = true; // Toggles a side wall without changing the camera heading.
let shotSignature = 'paragraph:1'; // Switching authored orbit shots must clear the previous paragraph's camera squeeze.
let horizontalRequested = true; // Fake active cutscene shot lets this test enable/disable the production horizontal solver.
let elapsedMs = 1000; // Allows frame-rate-independent outward camera recovery checks.
const raycaster = {
  set(origin, direction) { this.origin = { ...origin }; this.direction = { ...direction }; },
  intersectObjects() {
    if (Math.abs(this.origin.x) > 0.1) lateralCalls++;
    else directCalls++;
    if (wallVisible && this.origin.x > 0.1 && this.direction.y > 0.1) return [{ distance: 1.1 }]; // Camera-edge wall at the interpolated boom height; a fixed-altitude horizontal ray would miss it.
    return []; // The center 3D ray alone incorrectly allows full boom clearance.
  },
};
const roomTiles = Object.create(null); // Dense clear room allows an isolated furniture/wall tile to be swapped into the actual camera ray.
for (let r = -2; r < 8; r++) {
  roomTiles[r] = Object.create(null);
  for (let c = -3; c < 4; c++) roomTiles[r][c] = { type: 'floor' };
}
const collisionContext = vm.createContext({
  activeCameraMode: 'npcDialogue', SHOULDER_SURF_MODE: 'shoulderSurf',
  cutscenePreviewActive: true, dialogueZoomActive: () => false,
  camTargetY: 0, _playerGroundY: () => 0, activeSurfaceYAtWorld: () => 0,
  currentArea: 'map_i_inn_F2_jubmir', _isBuildingArea: () => true, currentAreaOcclusionMeshes: () => [{}],
  npcGridForArea: () => roomTiles, tileSurfaceYInArea: () => 0,
  isNpcTileWalkable: (_, c, r) => !!roomTiles[r]?.[c] && roomTiles[r][c].type !== 'rock' && !roomTiles[r][c].npcFurnitureCollider,
  performance: { now: () => elapsedMs }, THREE: { MathUtils: { degToRad: n => n * Math.PI / 180 } },
  window: { FormatUtils: { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)) }, CinematicCameraRuntime: { isActive: () => true, activeRecord: () => ({signature:shotSignature, camera:{horizontalCameraCollision:horizontalRequested}}) } },
  _cameraOcclusionOriginVec: rayOrigin, _cameraOcclusionDirVec: rayDirection, _cameraOcclusionRaycaster: raycaster,
});
vm.runInContext(game.slice(solverStart, solverEnd) + '\nthis.solve=occlusionSafeCameraPosition;this.horizontalDebug=()=>_cameraHorizontalDebug;this.tileDistance=cameraTileCollisionDistance;', collisionContext);
const squeezed = collisionContext.solve(0, 1, 0, 0, 1.6, 3); // A wall barely crossing the camera's right edge must pull the X/Z orbit inward.
assert(squeezed.z < 1.1, 'horizontal wall squeeze shortens the orbit despite a clear central 3D ray');
assert(Math.abs(squeezed.y - 1.6) < 1e-9, 'horizontal squeeze preserves intentional camera height');
assert(collisionContext.horizontalDebug().factor < 1 && lateralCalls === 2 && directCalls >= 2, 'three width probes and the original direct 3D collision solve all execute');
const blockedReach = squeezed.z; // Camera should pull in immediately but ease out after the obstruction clears.
wallVisible = false;
elapsedMs = 1100;
const recovering = collisionContext.solve(0, 1, 0, 0, 1.6, 3);
assert(recovering.z > blockedReach && recovering.z < 3, 'camera extends smoothly after wall clearance rather than popping outward');
elapsedMs = 1200;
const recoveredMore = collisionContext.solve(0, 1, 0, 0, 1.6, 3);
assert(recoveredMore.z > recovering.z, 'clearance recovery progresses with elapsed real time');
wallVisible = true;
elapsedMs = 1300;
const priorParagraph = collisionContext.solve(0, 1, 0, 0, 1.6, 3);
assert(priorParagraph.z < 1.1, 'prior paragraph is still clamped by a nearby wall');
wallVisible = false;
shotSignature = 'paragraph:2';
elapsedMs = 1301;
const hardCut = collisionContext.solve(0, 1, 0, 0, 1.6, 3);
assert(hardCut.z > 2.95, 'a newly activated instant-cut orbit discards stale horizontal collision smoothing');
const probesBeforeOptOut = lateralCalls; // Confirms interior cinematic previews do not run width probes without their own opt-in.
horizontalRequested = false;
elapsedMs = 1400;
const unmarkedCutscene = collisionContext.solve(0, 1, 0, 0, 1.6, 3);
assert(unmarkedCutscene.z > 2.95, 'an unmarked cutscene in the inn preserves its authored horizontal framing');
assert.equal(collisionContext.horizontalDebug(), null, 'no horizontal debug data is recorded without an opt-in');
assert.equal(lateralCalls, probesBeforeOptOut, 'unmarked cinematics do not perform the extra lateral raycasts');
roomTiles[2][0].npcFurnitureCollider = true;
shotSignature = 'paragraph:unmarked-furniture'; // Another cut resets the direct boom smoothing before testing unmarked furniture.
const unmarkedFurniture = collisionContext.solve(0.5, 1, 0.5, 0.5, 1.6, 4.5);
assert(unmarkedFurniture.z > 4.4, 'an unmarked interior cinematic does not use the horizontal furniture grid');
roomTiles[2][0].npcFurnitureCollider = false;
horizontalRequested = true;
wallVisible = true;
shotSignature = 'paragraph:3';
elapsedMs = 1500;
assert(collisionContext.solve(0, 1, 0, 0, 1.6, 3).z < 1.1,
  'restoring an explicitly requested camera resets clearance and squeezes against the wall');
const emptyFloorDistance = collisionContext.tileDistance(0.5, 1, 0.5, 0.5, 1.6, 4.5);
assert.equal(emptyFloorDistance, null, 'unobstructed floor tiles do not constrain the camera');
roomTiles[2][0].type = 'rock'; // Authored map collider (including nonrendered wall tile).
const wallTileDistance = collisionContext.tileDistance(0.5, 1, 0.5, 0.5, 1.6, 4.5);
assert(wallTileDistance > 1.4 && wallTileDistance < 2.0, 'solid collision-grid tile intersects the camera even with zero mesh hits');
roomTiles[2][0].type = 'floor';
roomTiles[2][0].npcFurnitureCollider = true; // Nonrendered footprint such as a bed occupies the otherwise walkable floor.
const furnitureTileDistance = collisionContext.tileDistance(0.5, 1, 0.5, 0.5, 1.6, 4.5);
assert(furnitureTileDistance > 1.4 && furnitureTileDistance < 2.0, 'furniture collision tile also blocks the boom');
roomTiles[2][0].npcFurnitureCollider = false;
const sceneSource = game.slice(game.indexOf('const buildingFurniture ='), game.indexOf('const buildingFurniture =') + 11000);
assert(sceneSource.includes('buildingCameraFurniture.push(renderedFurniture)')
  && game.includes('occlusionMeshes.push(furniture)'), 'camera also raycasts real built furniture meshes where available');
console.log('Procedural dialogue orbit: paired directional resets, signed start offset, instant cuts and optional lerp, face-height arc and wall/furniture clearance passed.');
