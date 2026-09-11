const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

(async () => {
  const path = require('path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'roof-climb.js'), 'utf8');
  const probeCode = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'roof-climb-pixel-probe.js'), 'utf8');
  const actualHousePiece = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'config', 'pieces', 'hobunjihouse1.json'), 'utf8'));
  let group = null;
  const scene = { traverse(fn) { if (group) fn(group); } };
  // Camera direction deliberately varies below. Building climbing should now be
  // driven by the player's distance to authored structural walls, not by a
  // precise camera-ray triangle hit.
  let ray = { origin: { x: 1, y: 1, z: -5 }, direction: { x: 0, y: 0, z: 1 } };
  let input = { x: 0, y: 0 };
  let mountState = 'none';
  let toast = null;
  const player = {
    x: 48, y: -48, angle: Math.PI / 2,
    climbing: false, dodging: false, prone: false, onBranch: null,
    vx: 0, vy: 0,
  };

  const piece = {
    gridSize: 2,
    footprint: { cells: [{ x: 1, y: 1 }] },
    base: { faces: [
      { id: 'wall-south', tag: 'wall', v: [[0,0,0],[0,2,0],[2,2,0],[2,0,0]] },
      { id: 'roof-main', tag: 'roof', v: [[0,2,0],[0,2,2],[2,2,2],[2,2,0]] },
    ] },
  };

  const context = {
    console,
    queueMicrotask,
    window: {},
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
    MutationObserver: class { observe() {} },
    THREE: { Raycaster: class {} },
  };
  context.window.window = context.window;
  context.window.EntryTunnelWallUnmark = { preparePiece: p => ({ piece: p }) };
  context.window.BuildingDoor = {
    resolveDoorEntrance: () => ({ cells: [{x:0,y:0}], bboxW: 1, bboxD: 1, psCells: [] }),
    doorWorldFromBuilding: () => ({ col: 1, row: 0 }),
  };
  context.window.GridTileAccessors = { getActiveScene: () => scene };
  context.window.HousePieceGen = {
    buildGroupFromPiece() { return { userData: {}, children: [], traverse(fn) { fn(this); } }; },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  vm.runInContext(probeCode, context);

  group = context.window.HousePieceGen.buildGroupFromPiece({}, piece, 0, 0, { elevationY: 0, rotationDeg: 0 });
  const meta = group.userData.hobunjiRoofClimbStructure;
  assert(meta, 'structure metadata attached');
  assert.strictEqual(meta.source, 'authored-structure-planes');
  assert.strictEqual(meta.walls.length, 1, 'only authored wall plane registered');
  assert.strictEqual(meta.roofs.length, 1, 'only authored roof plane registered');
  assert.strictEqual(meta.entrance, null, 'entrance adjacency exclusion is disabled at building creation');
  assert.strictEqual(meta.entranceClimbExclusionDisabled, true);

  const original = {
    init(deps) { this._deps = deps; },
    getClimbTarget() { return null; },
    startClimb() { return false; },
    updateClimb() {
      player.x = player.climbEndX;
      player.y = player.climbEndY;
      player.climbSurfaceY = player.climbSurfaceEndY;
      player.climbing = false;
    },
    updateBranchMovement() { throw new Error('real branch movement should not run for roof state'); },
    resolveBranchKnockback() { throw new Error('real branch knockback should not run for roof state'); },
  };
  context.window.ClimbSystem = original;
  await Promise.resolve();
  const system = context.window.ClimbSystem;
  const deps = {
    player,
    TILE: 48,
    getPlayerInteractionRay: () => ray,
    getPlayerAimRay: () => ray,
    worldSurfaceY: () => 0,
    getMountRideState: () => mountState,
    showToast: msg => { toast = msg; },
    setFacingAngle() {}, setTargetAimAngle() {}, setLastMoveAngle() {},
    getMovementInput: () => input,
  };
  system.init(deps);

  let target = system.getClimbTarget();
  assert(target && target.type === 'roof', 'nearby player gets a building climb target');
  assert.strictEqual(target.wallFaceId, 'wall-south');
  assert(Math.abs(target.endSurfaceY - 2) < 1e-6, 'landing uses authored roof plane height');
  let debug = context.window.HobunjiRoofClimb.getDebug();
  assert(debug.lastWallHit.playerDistance < 1.75, 'accepted wall is close to the player');
  assert.strictEqual(debug.lastWallHit.selectionModel, 'nearest-player-wall');
  assert.strictEqual(debug.runtimeDepsSource, 'ClimbSystem.init');

  // Camera aim no longer gates building climbing. A wildly glancing ray or no
  // ray at all still works while the player is physically beside the wall.
  ray = { origin: { x: 1, y: 1, z: -5 }, direction: { x: 0.9, y: 0, z: 0.1 } };
  assert(system.getClimbTarget()?.type === 'roof', 'glancing camera aim does not cancel a nearby building climb');
  ray = null;
  assert(system.getClimbTarget()?.type === 'roof', 'building climbing does not require an interaction ray');

  // Inverse case: camera location/aim cannot create a remote climb target when
  // the player is physically too far from the structure.
  player.y = -240;
  ray = { origin: { x: 1, y: 1, z: -1 }, direction: { x: 0, y: 0, z: 1 } };
  assert.strictEqual(system.getClimbTarget(), null, 'camera proximity cannot climb a wall when the player is far away');
  player.y = -48;
  target = system.getClimbTarget();

  mountState = 'mounted';
  assert.strictEqual(system.startClimb(target), false, 'mounted roof climb is blocked');
  assert.strictEqual(toast, 'Dismount before climbing.');
  mountState = 'none';
  assert.strictEqual(system.startClimb(target), true, 'roof climb starts');
  assert.strictEqual(player.climbing, true);
  assert.strictEqual(player.climbHopCount, 4, 'roof climb uses existing multi-hop climb animator state');
  assert.strictEqual(player._climbLastHopIndex, -1);

  system.updateClimb(1);
  assert.strictEqual(player.climbing, false);
  assert(player.onBranch && player.onBranch.__hobunjiRoofSurface, 'finished climb enters elevated roof surface mode');
  assert(Math.abs(player.branchSurfaceY - 2) < 1e-6);

  const beforeX = player.x;
  input = { x: 1, y: 0 };
  system.updateBranchMovement(0.1);
  assert(player.x > beforeX, 'roof movement is 2D movement on authored roof surface');
  assert(Math.abs(player.branchSurfaceY - 2) < 1e-6);

  player.x = 48; player.y = 48;
  let kb = system.resolveBranchKnockback(player, 0, 48, 20);
  assert.strictEqual(kb.fell, false);
  assert(player.onBranch?.__hobunjiRoofSurface);

  kb = system.resolveBranchKnockback(player, 0, player.y, 1000);
  assert.strictEqual(kb.fell, true);
  assert.strictEqual(player.onBranch, null);

  // Regression against the actual town-house export. Its frustum walls and
  // sloped/cross-gable roof are materially different from the simple square
  // fixture above, so this catches transform/landing mistakes the old test did not.
  group = context.window.HousePieceGen.buildGroupFromPiece({}, actualHousePiece, 10, 10, { elevationY: 0, rotationDeg: 0 });
  assert(group.userData.hobunjiRoofClimbStructure?.walls?.length > 0, 'real Hobunji house receives structural wall metadata');
  assert(group.userData.hobunjiRoofClimbStructure?.roofs?.length > 0, 'real Hobunji house receives authored roof metadata');
  player.onBranch = null;
  player.climbing = false;
  player.prone = false;
  player.x = 13 * 48;
  player.y = 9.3 * 48; // 0.7 tile north of the real house's north structural wall.
  ray = null;
  target = system.getClimbTarget();
  assert(target && target.type === 'roof', 'actual Hobunji house is climbable from beside its structural wall');
  assert(target.playerWallDistance <= 1.75, 'real-house target obeys the same player proximity limit');
  assert(target.endSurfaceY > 0, 'real-house target resolves a positive authored roof landing height');

  debug = context.window.HobunjiRoofClimb.getDebug();
  assert.strictEqual(debug.structureWrapperInstalled, true);
  assert.strictEqual(debug.climbHooksInstalled, true);

  // Reproduce the live failure from Pixel Probe: the roof wrapper misses the
  // ClimbSystem.init handoff, but Combat.deps already has the live player/TILE.
  // Roof targeting must remain functional instead of returning a generic null.
  let fallbackGroup = null;
  const fallbackPlayer = {
    x: 48, y: -48, angle: Math.PI / 2,
    climbing: false, dodging: false, prone: false, onBranch: null,
    vx: 0, vy: 0,
  };
  const fallbackDeps = {
    player: fallbackPlayer,
    TILE: 48,
    worldSurfaceY: () => 0,
    getPlayerInteractionRay: () => null,
    getPlayerAimRay: () => null,
    getMovementInput: () => ({ x: 0, y: 0 }),
  };
  const fallbackContext = {
    console,
    queueMicrotask,
    window: {},
  };
  fallbackContext.window.window = fallbackContext.window;
  fallbackContext.window.Combat = { deps: fallbackDeps };
  fallbackContext.window.EntryTunnelWallUnmark = { preparePiece: p => ({ piece: p }) };
  fallbackContext.window.BuildingDoor = { resolveDoorEntrance: () => null, doorWorldFromBuilding: () => null };
  fallbackContext.window.GridTileAccessors = { getActiveScene: () => ({ traverse(fn) { if (fallbackGroup) fn(fallbackGroup); } }) };
  fallbackContext.window.HousePieceGen = {
    buildGroupFromPiece() { return { userData: {}, children: [], traverse(fn) { fn(this); } }; },
  };
  vm.createContext(fallbackContext);
  vm.runInContext(code, fallbackContext);
  fallbackGroup = fallbackContext.window.HousePieceGen.buildGroupFromPiece({}, piece, 0, 0, { elevationY: 0, rotationDeg: 0 });
  let fallbackTarget = fallbackContext.window.HobunjiRoofClimb.getRoofClimbTarget();
  assert(fallbackTarget?.type === 'roof', 'Combat.deps fallback resolves a roof target even when ClimbSystem.init was never captured');
  let fallbackDebug = fallbackContext.window.HobunjiRoofClimb.getDebug();
  assert.strictEqual(fallbackDebug.climbDepsCaptured, false, 'test really omits the roof ClimbSystem.init capture');
  assert.strictEqual(fallbackDebug.runtimeDepsSource, 'Combat.deps fallback');
  assert.strictEqual(fallbackDebug.runtimePlayerReady, true);

  // Reproduce an entry-tunnel-carved wall fragment like the user's live
  // `222__tunnel_0_0_after`. A straight inward line can pass through the
  // tunnel gap, so fall back to the nearest safe interior point on an authored
  // roof triangle rather than declaring the whole building unclimbable.
  fallbackPlayer.x = 0.1 * 48;
  fallbackPlayer.y = -0.2 * 48;
  fallbackGroup = {
    userData: {
      hobunjiRoofClimbStructure: {
        entrance: null,
        walls: [{
          id: '222__tunnel_0_0_after',
          vertices: [
            { x: 0, y: 0, z: 0 }, { x: 0, y: 1.4, z: 0 },
            { x: 0.2, y: 1.4, z: 0 }, { x: 0.2, y: 0, z: 0 },
          ],
        }],
        roofs: [{
          id: '227',
          vertices: [
            { x: 0.8, y: 1.4, z: 0.3 },
            { x: 2.0, y: 2.4, z: 1.1 },
            { x: 0.8, y: 1.4, z: 1.6 },
          ],
        }],
      },
    },
  };
  fallbackTarget = fallbackContext.window.HobunjiRoofClimb.getRoofClimbTarget();
  assert(fallbackTarget?.type === 'roof', 'carved entry-tunnel wall fragment still resolves a nearby authored roof landing');
  assert.strictEqual(fallbackTarget.wallFaceId, '222__tunnel_0_0_after');
  assert.strictEqual(fallbackTarget.landingSource, 'roof-interior-fallback', 'tunnel-gap case uses the safe roof-interior fallback');

  console.log('roof climb tests passed');
})();
