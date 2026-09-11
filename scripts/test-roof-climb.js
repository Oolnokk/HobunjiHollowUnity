const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

(async () => {
  const code = fs.readFileSync(require('path').join(__dirname, '..', 'docs', 'js', 'roof-climb.js'), 'utf8');
  let group = null;
  const scene = { traverse(fn) { if (group) fn(group); } };
  // Shoulder camera is deliberately far behind the nearby player. Roof-climb
  // proximity must be measured from the player, not from this ray origin.
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

  const context = { console, queueMicrotask, window: {} };
  context.window.window = context.window;
  context.window.EntryTunnelWallUnmark = { preparePiece: p => ({ piece: p }) };
  context.window.BuildingDoor = {
    resolveDoorEntrance: () => ({ cells: [{x:0,y:0}], bboxW: 1, bboxD: 1, psCells: [] }),
    doorWorldFromBuilding: () => ({ col: 9, row: 9 }),
  };
  context.window.GridTileAccessors = { getActiveScene: () => scene };
  context.window.HousePieceGen = {
    buildGroupFromPiece() { return { userData: {}, children: [], traverse(fn) { fn(this); } }; },
  };
  vm.createContext(context);
  vm.runInContext(code, context);

  group = context.window.HousePieceGen.buildGroupFromPiece({}, piece, 0, 0, { elevationY: 0, rotationDeg: 0 });
  const meta = group.userData.hobunjiRoofClimbStructure;
  assert(meta, 'structure metadata attached');
  assert.strictEqual(meta.source, 'authored-structure-planes');
  assert.strictEqual(meta.walls.length, 1, 'only authored wall plane registered');
  assert.strictEqual(meta.roofs.length, 1, 'only authored roof plane registered');

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
  assert(target && target.type === 'roof', 'nearby player can climb even when shoulder camera ray starts far behind');
  assert.strictEqual(target.wallFaceId, 'wall-south');
  assert(Math.abs(target.endSurfaceY - 2) < 1e-6, 'landing uses authored roof plane height');
  let debug = context.window.HobunjiRoofClimb.getDebug();
  assert(debug.lastWallHit.cameraDistance > 2.2, 'test actually covers the old camera-distance failure');
  assert(debug.lastWallHit.playerDistance < 1.75, 'accepted wall is close to the player');

  // Inverse case: a camera ray can be close to the wall while the player is
  // too far away; that must not create a remote climb target.
  player.y = -240;
  ray = { origin: { x: 1, y: 1, z: -1 }, direction: { x: 0, y: 0, z: 1 } };
  assert.strictEqual(system.getClimbTarget(), null, 'camera proximity cannot climb a wall when the player is far away');
  player.y = -48;
  ray = { origin: { x: 1, y: 1, z: -5 }, direction: { x: 0, y: 0, z: 1 } };

  meta.entrance = { x: 1, z: 0.5 };
  assert.strictEqual(system.getClimbTarget(), null, 'entrance-adjacent wall is not climbable');
  meta.entrance = { x: 9.5, z: 9.5 };

  ray = { origin: { x: 1, y: 1, z: -5 }, direction: { x: 0.9, y: 0, z: 0.1 } };
  assert.strictEqual(system.getClimbTarget(), null, 'glancing look is rejected');
  ray = { origin: { x: 1, y: 1, z: -5 }, direction: { x: 0, y: 0, z: 1 } };
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

  debug = context.window.HobunjiRoofClimb.getDebug();
  assert.strictEqual(debug.structureWrapperInstalled, true);
  assert.strictEqual(debug.climbHooksInstalled, true);
  console.log('roof climb tests passed');
})();
