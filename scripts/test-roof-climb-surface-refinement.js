const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

(async () => {
  const baseCode = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'roof-climb.js'), 'utf8');
  const refineCode = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'roof-climb-surface-refinement.js'), 'utf8');

  let group = null;
  let input = { x: 0, y: 0 };
  const player = {
    x: 48,
    y: -0.25 * 48,
    angle: 0,
    climbing: false,
    dodging: false,
    prone: false,
    onBranch: null,
    vx: 0,
    vy: 0,
  };
  const scene = { traverse(fn) { if (group) fn(group); } };
  const slantedPiece = {
    gridSize: 2,
    footprint: { cells: [{ x: 1, y: 1 }] },
    base: { faces: [
      // Top edge leans 0.25 tile inward (+Z), making a visibly sloped wall plane.
      { id: 'wall-sloped', tag: 'wall', v: [[0,0,0],[0,2,0.25],[2,2,0.25],[2,0,0]] },
      { id: 'roof-main', tag: 'roof', v: [[0,2,0.25],[0,2,2],[2,2,2],[2,2,0.25]] },
    ] },
  };

  const context = {
    console,
    queueMicrotask,
    window: {},
  };
  context.window.window = context.window;
  context.window.EntryTunnelWallUnmark = { preparePiece: piece => ({ piece }) };
  context.window.BuildingDoor = { resolveDoorEntrance: () => null, doorWorldFromBuilding: () => null };
  context.window.GridTileAccessors = { getActiveScene: () => scene };
  context.window.HousePieceGen = {
    buildGroupFromPiece() { return { userData: {}, traverse(fn) { fn(this); } }; },
  };

  vm.createContext(context);
  vm.runInContext(baseCode, context);
  vm.runInContext(refineCode, context);
  group = context.window.HousePieceGen.buildGroupFromPiece({}, slantedPiece, 0, 0, { elevationY: 0, rotationDeg: 0 });

  const original = {
    init(deps) { this._deps = deps; },
    getClimbTarget() { return null; },
    startClimb() { return false; },
    updateClimb(dt) {
      const cycle = 0.32 + 0.26;
      const total = (player.climbHopCount || 1) * cycle;
      player.climbElapsed = Math.min((player.climbElapsed || 0) + dt, total);
      if (player.climbElapsed >= total) {
        player.x = player.climbEndX;
        player.y = player.climbEndY;
        player.climbSurfaceY = player.climbSurfaceEndY;
        player.climbing = false;
      }
    },
    updateBranchMovement() { throw new Error('base branch movement must not run while on a refined roof'); },
    resolveBranchKnockback() { return null; },
  };

  context.window.ClimbSystem = original;
  const deps = {
    player,
    TILE: 48,
    worldSurfaceY: () => 0,
    getPlayerInteractionRay: () => null,
    getPlayerAimRay: () => null,
    getMountRideState: () => 'none',
    getMovementInput: () => input,
    setFacingAngle() {},
    setTargetAimAngle() {},
    setLastMoveAngle() {},
  };
  context.window.ClimbSystem.init(deps);
  await Promise.resolve();
  await Promise.resolve();
  const system = context.window.ClimbSystem;

  const api = context.window.HobunjiRoofClimb;
  assert.strictEqual(api.maxWallDistanceTiles, 0.42, 'final roof policy requires near-contact wall distance');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.surfaceOffsets)),
    { wallTiles: 0.14, roofY: 0.08 },
    'wall and roof visual surface offsets are public/tunable',
  );

  let target = system.getClimbTarget();
  assert(target?.type === 'roof', 'player 0.25 tile from wall can climb');
  assert(target.__hobunjiSurfaceRefined, 'final target is surface-refined');
  assert(target.playerWallDistance <= 0.42, 'accepted target obeys contact threshold');
  assert(Math.abs(target.endSurfaceY - 2.08) < 1e-6, 'roof landing is raised above shingles');
  assert(target.wallGuide.top.z > target.wallGuide.bottom.z, 'guide preserves authored wall lean');
  assert(target.dir.y > 0.99, 'climb faces inward perpendicular to this wall');

  // Base roof-climb would still accept this distance (under its broad 1.75-tile
  // discovery radius); the final policy must reject it for both ordinary and
  // direct target paths.
  player.y = -0.60 * 48;
  assert.strictEqual(system.getClimbTarget(), null, '0.60 tile is too far from structural wall');
  assert.strictEqual(api.getRoofClimbTarget(), null, 'direct roof target obeys the same contact threshold');

  player.y = -0.25 * 48;
  target = system.getClimbTarget();
  assert(target?.type === 'roof');
  assert.strictEqual(system.startClimb(target), true, 'refined structure climb starts');
  assert.strictEqual(player.climbHopCount, 2, 'refinement preserves two-hop structure climb');
  assert(player._hobunjiRoofRefinedPath, 'wall-following path is installed at climb start');

  // One update puts the player into the wall-following portion. The wall itself
  // has leaned inward by ~0.13 tile here; the portrait should retain the 0.14
  // tile outward offset rather than linearly cutting through the bricks.
  system.updateClimb(0.20);
  const overall = 0.5; // Base roof wrapper doubles 0.20 -> 0.40; hop 0 has fully settled => 1 / 2 hops.
  const wallT = (overall - 0.12) / (0.84 - 0.12);
  const wallZ = target.wallGuide.bottom.z + (target.wallGuide.top.z - target.wallGuide.bottom.z) * wallT;
  const playerZ = player.y / 48;
  assert(Math.abs((wallZ - playerZ) - 0.14) < 0.025, 'climb path follows sloped wall with outward brick offset');
  assert(Math.abs(player.angle - Math.PI / 2) < 1e-6, 'portrait stays oriented into the wall while climbing');

  system.updateClimb(0.40);
  assert.strictEqual(player.climbing, false, 'structure climb finishes');
  assert(player.onBranch?.__hobunjiRoofSurface, 'finished climb enters roof state');
  assert(Math.abs(player.branchSurfaceY - 2.08) < 1e-6, 'standing roof height retains shingle offset');

  // This uses the captured live getter directly; player.inputX/Y begin at zero,
  // so movement cannot accidentally pass by relying on stale ordinary movement state.
  const x0 = player.x;
  input = { x: 1, y: 0 };
  system.updateBranchMovement(0.10);
  assert(player.x > x0, 'fresh rightward input moves freely across roof');
  assert(Math.abs(player.branchSurfaceY - 2.08) < 1e-6, 'roof offset is maintained while moving');

  const y0 = player.y;
  input = { x: 0, y: 1 };
  system.updateBranchMovement(0.10);
  assert(player.y > y0, 'fresh inward input also moves across roof instead of freezing at the eave');
  assert(context.window.HobunjiRoofClimb.getDebug().lastMovementMovedPx > 0, 'movement diagnostics record actual roof travel');

  console.log('roof climb surface refinement tests passed');
})();
