#!/usr/bin/env node
'use strict';

// Execute the actual free-jump runtime without WebGL. Covers launch, air
// motion, ledge/cover height rules, raised support, and the existing input hook.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
const source = read('docs/js/player-jump.js'); // Runtime under test.
const integration = read('docs/js/climb-system.js'); // Existing context input keeps its jump fallback.
const gameSource = read('docs/game.js'); // Canonical movement/render loop owns free-jump motion.
const ruinSource = read('docs/js/dev-random-ruin-interior-map.js'); // Multi-story ruin reconciliation must not snap airborne feet.
const index = read('docs/index.html'); // Confirms load order for the modular runtime.
const coverSource = read('docs/js/nearby-volume-collision.js'); // Shared furniture bounds source for jumps and projectiles.

for (const name of ['docs/js/player-jump.js', 'docs/js/climb-system.js', 'docs/js/nearby-volume-collision.js']) {
  new vm.Script(read(name), { filename: name });
}
assert(integration.includes('window.PlayerJump?.init?.(injectedDeps)'));
assert(gameSource.includes('if (window.PlayerJump?.tick?.(dt)) return;'), 'game loop must tick jump independently');
assert(gameSource.includes('player._freeJump ? player.physicalFeetY'), 'renderer uses physical jump height');
assert(gameSource.includes('getBaseMoveSpeedTiles: () => MOVE_SPEED / TILE'), 'ordinary player speed drives airborne travel');
assert(gameSource.includes('canPlayerOccupyAtHeight, // Jump uses native world collision'), 'jump uses the native height-aware collision authority');
assert(gameSource.includes('function furnitureBlocksMovementAt(area, x, z, worldY = null)'), 'furniture collision now understands optional height');
assert(gameSource.includes('furnitureBlocksMovementAt(currentArea, x, z, feetY + 0.05)'), 'non-cover furniture remains solid when jumping');

assert(gameSource.includes('return canOccupyAt(wx, wy, radius, footprintY + radius / TILE)'), 'tile cover tests physical feet instead of a radius below feet');

// Execute the real game-owned height probe in isolation, not a mock that
// accidentally skips the player's collision-radius conversion.
{
  const begin = gameSource.indexOf('      function canPlayerOccupyAtHeight(');
  const end = gameSource.indexOf('\n      function canPlayerOccupy(wx, wy)', begin);
  assert(begin >= 0 && end > begin, 'native physical-height probe is present');
  const func = gameSource.slice(begin, end); // Same source shipped in the main game loop.
  const world = {
    GridTileAccessors: { getActiveGrid: () => Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ type: 'floor' }))) },
    InteriorDoorTiles: { blocksBox: () => false },
    AreaFootprintBlockers: { blocksBox: () => false },
    FurnitureTableSystem: { blocksBox: () => false },
  };
  let tileFeetY = null; // Captures the native tile collision sample height after radius conversion.
  const radius = 16 * .72 / 64; // Expected footprint radius in tile units for this isolated probe.
  const probe = new Function('window', 'currentArea', 'TILE', 'PLAYER_RADIUS', 'furnitureBlocksMovementAt', 'canOccupyAt', 'canPlayerOccupy',
    func + '\nreturn canPlayerOccupyAtHeight;')(
      world, 'zone-test', 64, 16, () => false, (_x, _z, pxRadius, worldY) => {
        tileFeetY = worldY - pxRadius / 64;
        return tileFeetY > 1.11;
      }, () => false);
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), true, 'standing atop a rock is not blocked by a sample below its surface');
  assert(Math.abs(tileFeetY - 1.15) < .001, 'tile collision samples the intended physical feet');
  world.FurnitureTableSystem.blocksBox = () => true;
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), false, 'an independent full-footprint table still blocks');
  world.FurnitureTableSystem.blocksBox = () => false;
  world.AreaFootprintBlockers.blocksBox = () => true;
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), false, 'an independent full-footprint obstacle still blocks');
  world.AreaFootprintBlockers.blocksBox = () => false;
  const thinBarrier = (_area, _x, _z, half, worldY) => half >= radius - 1e-6 && worldY < 1.17;
  world.AreaFootprintBlockers.blocksBox = thinBarrier;
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), false, 'thin height-limited footprint blocks the body even between corner samples');
  world.AreaFootprintBlockers.blocksBox = () => false;
  world.FurnitureTableSystem.blocksBox = thinBarrier;
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), false, 'thin height-limited furniture blocks the full player footprint');
  world.FurnitureTableSystem.blocksBox = () => false;
}

assert(ruinSource.includes('const freeJump=deps.player?._freeJump;'), 'native ruin floor reconciliation must honor airborne jump state');
assert(integration.includes('return window.PlayerJump?.start?.() || false; // Empty ground'));
assert(index.indexOf('js/player-jump.js?') < index.indexOf('js/climb-system.js?'));
assert(coverSource.includes('function movementCoverNear('));
assert(coverSource.includes('movementCoverNear,'));

const TILE = 64; // Player positions use pixels, semantic colliders use world/tile units.
const groundTile = () => ({ type: 'floor', surfaceY: 0 });
function harness({ rock = null, furniture = null, wall = null, pit = null, start = { x: 2.5, z: 3.5 },
  heightBlocked = null, deepSupportY = null, geometry = null } = {}) {
  const grid = Array.from({ length: 9 }, () => Array.from({ length: 10 }, groundTile));
  if (rock) grid[rock.row][rock.col] = { type: 'rock', rockKind: 'undiggableBoulder', projectileCoverHeightTiles: rock.top, top: rock.top };
  if (wall) grid[wall.row][wall.col] = { type: 'wall' };
  if (pit) for (let col = pit.firstCol; col <= pit.lastCol; col++) grid[pit.row][col] = { type: 'void' }; // An empty floor must never become jump support.
  const player = { x: start.x * TILE, y: start.z * TILE, health: 100, climbing: false }; // ClimbSystem's player model.
  let activeArea = 'zone-test'; // Simulated scene transition for state cleanup tests.
  let canJump = true; // Simulates game activity ownership (dialogue/minigames) without a DOM.
  const input = { x: 0, y: 0 }; // Mutable analog movement vector sampled every air/ground step.
  const furnitureNode = furniture && {
    name: furniture.name || 'test_furniture',
    userData: { projectileCoverHeightTiles: furniture.top, projectileCoverRadiusTiles: furniture.radius },
    position: { x: furniture.x, y: 0, z: furniture.z },
    scale: { x: 1, y: 1, z: 1 }, visible: true, children: [],
  };
  const scene = { children: furnitureNode ? [furnitureNode] : [] }; // Minimal scene for the real semantic-cover spatial index.
  if (furnitureNode) furnitureNode.parent = scene;
  const window = {
    ZonePlateauMesa: { hasTerrain: () => !!geometry, surfaceYAt: (_area, x, z) => geometry?.(x, z) ?? null }, // Same interface as the generated triangle index.
    MapBoundaryGuard: { isBoundaryTile: () => false },
    GridTileAccessors: { isHouseFootprint: () => false, isFarmBuildingCollisionTile: () => false, isTownBuildingCollisionTile: () => false },
    InteriorDoorTiles: { blocksBox: () => false }, // Closed doors must never be treated as low cover.
    DevRandomRuin: { groundLandings: 0, acceptFreeJumpLanding(y) { this.groundLandings++; this.lastY = y; }, getPlayerGroundSupportY: () => null }, // Confirmed ground landings must be reported once.
    ProjectileTileCover: { coverTop(tile) { return tile?.type === 'rock' ? tile.top : null; } },
    AreaFootprintBlockers: { surfaceYAt: () => null, blocksBox: () => false },
    DynamicSurfaces: {
      sampleSupport: (x, z, opts = {}) => deepSupportY != null && x >= 3
        && deepSupportY >= (opts.minY ?? -Infinity) && deepSupportY <= (opts.maxY ?? Infinity)
        ? { y: deepSupportY, id: 'deep-floor' } : null,
      blockerAt: () => null,
    },
    FallSystem: { land: () => null },
  };
  const context = { window, console, performance: { now: () => 1000 } };
  vm.runInNewContext(coverSource, context, { filename: 'nearby-volume-collision.js' });
  window.NearbyVolumeCollision.init({
    getActiveScene: () => scene, isCombatActive: () => false, debugLog() {},
    player, worldSurfaceY: () => 0,
    options: { enabled: false, projectiles: false },
  }); // Even disabled projectile hit checks must not disable the shared cover-height geometry.
  vm.runInNewContext(source, context, { filename: 'player-jump.js' });
  window.PlayerJump.init({
    player, TILE,
    getCurrentArea: () => activeArea,
    getActiveGrid: () => grid,
    getMovementInput: () => input,
    isSolid: type => type === 'rock' || type === 'wall',
    _isZoneArea: () => true,
    tileSurfaceYInArea: tile => tile.surfaceY ?? 0,
    worldSurfaceY: () => 0,
    getMountRideState: () => 'none',
    canStartFreeJump: () => canJump,
    canPlayerOccupy: () => true,
    canPlayerOccupyAtHeight: (wx, wy, feetY) => !heightBlocked?.(wx / TILE, wy / TILE, feetY),
    furnitureBlocksMovementAt: () => false,
  });
  function advance(seconds) {
    const frames = Math.ceil(seconds * 60);
    for (let i = 0; i < frames; i++) window.PlayerJump.tick(1 / 60);
  }
  return { window, grid, player, input, advance, setArea: area => { activeArea = area; }, setCanJump: allowed => { canJump = !!allowed; } };
}

{
  const h = harness();
  assert.equal(h.window.PlayerJump.start(), true, 'empty ground must be jumpable');
  const { launchSpeed, gravity } = h.window.PlayerJump.config; // Validate the configured half-height apex independent of frame stepping.
  const priorApex = 6.25 ** 2 / (2 * 11.8); // Previously shipped base height, used only as a regression reference.
  assert(Math.abs(launchSpeed ** 2 / (2 * gravity) - priorApex / 2) < 0.001,
    'base jump must reach half of its former apex without changing gravity');
  assert.equal(gravity, 11.8, 'halving takeoff height must not alter gravity or falling behavior');
  assert.equal(!!h.player.climbing, false, 'free jump must not lock the wall-climb action state');
  let apex = 0;
  for (let i = 0; i < 85; i++) {
    h.advance(1 / 60);
    apex = Math.max(apex, h.player.heightAboveGround || 0);
  }
  assert(apex > 0.72 && apex < 0.86, 'base jump apex is now approximately 0.83 world units');
  assert.equal(h.player.climbing, false, 'land on flat terrain frees ordinary movement');
  assert.equal(h.player._freeJump, null, 'flat landing clears transient state');
  assert.equal(h.window.DevRandomRuin.groundLandings, 1, 'a confirmed ground landing is reported exactly once');
}

{
  const h = harness({ rock: { col: 4, row: 3, top: 0.6 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.4);
  assert(h.player.x / TILE > 4.5, 'an airborne player can jump over low finite-height rock cover');
  assert.equal(h.player.climbing, false, 'clearing the rock ends in an ordinary floor landing');
}

{
  const h = harness({ rock: { col: 4, row: 3, top: 0.65 }, start: { x: 3.45, z: 3.5 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 90; i++) {
    if (h.player.x / TILE > 4.25) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player._freeJump?.phase, 'supported', 'land on top of a rock instead of passing through it');
  assert(Math.abs(h.player.physicalFeetY - 0.65) < .01);
  assert(h.player.heightAboveGround > 0.6, 'height includes elevation gained from standing on cover');
  assert(h.window.PlayerJump.start(), 'a second press jumps again from the elevated support');
  h.advance(.15);
  assert(h.player.physicalFeetY > 0.65);
}

{
  const h = harness({ furniture: { x: 4.5, z: 3.5, top: 0.65, radius: .48 }, start: { x: 3.45, z: 3.5 } });
  assert.equal(h.window.NearbyVolumeCollision.movementCoverNear(4.5, 3.5, .2)[0].topY, 0.65,
    'jump uses combat cover geometry even with projectile cover switched off');
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 90; i++) {
    if (h.player.x / TILE > 4.35) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player._freeJump?.phase, 'supported', 'furniture is an elevated landing target');
  assert(Math.abs(h.player.physicalFeetY - 0.65) < .01);
}

{
  const h = harness({ rock: { col: 4, row: 3, top: 1.1 }, start: { x: 3.45, z: 3.5 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.2);
  assert(h.player.x / TILE < 3.84, 'previously reachable 1.1-unit cover is now too high for a base jump');
}

{
  const h = harness({ wall: { col: 4, row: 3 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.5);
  assert(h.player.x / TILE < 3.84, 'infinite/solid walls stay impassable at any jump height');
  assert.equal(h.player.climbing, false);
}

{
  const h = harness();
  assert(h.window.PlayerJump.start());
  const before = h.window.PlayerJump.debug.starts;
  assert(h.window.PlayerJump.start(), 'pressing Jump while airborne is handled');
  assert.equal(h.window.PlayerJump.debug.starts, before, 'no unintended double jumping');
}

{
  const h = harness();
  assert(h.window.PlayerJump.start());
  h.setArea('zone-different'); // A scene transition invalidates the previous transient jump.
  const prior = h.window.PlayerJump.debug.starts;
  assert(h.window.PlayerJump.start(), 'the next press must recover from stale airborne state');
  assert.equal(h.window.PlayerJump.debug.starts, prior + 1, 'the second press must launch a new physical jump');
}

{
  const h = harness({ pit: { row: 3, firstCol: 3, lastCol: 7 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 200; i++) {
    if (h.player.x / TILE > 4.5) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player.climbing, false, 'falling into an unsupported pit must hand control back to world physics');
  assert.equal(h.window.PlayerJump.debug.lastEvent, 'unsupported fall returned to safe ground');
  assert.equal(h.window.PlayerJump.debug.active, false, 'fall must relinquish movement control');
  assert(h.player.x / TILE < 3.01, 'an unsupported ordinary-map fall restores walkable ground rather than abandoning the player over void');
}

{
  const h = harness();
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1 / 60);
  assert.equal(h.player.inputX, 1, 'airborne movement intent stays visible to targeting systems');
  assert.equal(h.player.inputStrength, 1, 'airborne input strength remains accurate');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 } });
  h.grid[3][4] = { type: 'floor', incline: true };
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.4);
  assert(h.player.x / TILE < 3.85, 'jump must not pass through a cliff incline ring');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 } });
  h.window.InteriorDoorTiles.blocksBox = (_area, x) => x >= 3.85;
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.4);
  assert(h.player.x / TILE < 3.85, 'jump must not pass through closed doors');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 } });
  h.window.GridTileAccessors.isTownBuildingCollisionTile = col => col === 4;
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.4);
  assert(h.player.x / TILE < 3.85, 'zone buildings retain collision during jump');
}

{
  const h = harness();
  h.setCanJump(false);
  assert.equal(h.window.PlayerJump.start(), false, 'owned cutscenes/dialogue block ordinary free jumps');
  h.setCanJump(true);
  assert(h.window.PlayerJump.start(), 'the same input works again once the movement lock ends');
}

{
  const h = harness({ furniture: { x: 4.5, z: 3.5, top: 1.1, radius: .48 },
    start: { x: 3.45, z: 3.5 } });
  h.window.AreaFootprintBlockers.blocksBox = (_area, x) => x >= 3.85;
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.5);
  assert(h.player.x / TILE < 3.85, 'overlapping independent footprint remains solid above low cover');
}
{
  const h = harness({ furniture: { x: 4.5, z: 3.5, top: 1.1, radius: .48 },
    start: { x: 3.45, z: 3.5 }, heightBlocked: x => x >= 3.85 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.5);
  assert(h.player.x / TILE < 3.85, 'an unrelated world blocker cannot be bypassed by a low table');
}
{
  const h = harness({ rock: { col: 4, row: 3, top: 1.1 },
    start: { x: 3.45, z: 3.5 }, heightBlocked: x => x >= 3.85 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.5);
  assert(h.player.x / TILE < 3.85, 'low rock cannot bypass a separate world collider');
}
{
  const h = harness({ pit: { row: 3, firstCol: 3, lastCol: 7 }, deepSupportY: -10 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 260; i++) {
    if (h.player.x / TILE > 4.5) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player._freeJump?.phase, 'supported', 'fall continues past seven units to a ten-unit-deep floor');
  assert(Math.abs(h.player.physicalFeetY + 10) < .01, 'deep landing uses physical lower elevation');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, geometry: (x, z) => x >= 4 && x <= 5 && z >= 3 && z <= 4 ? 0.7 : null });
  h.grid[3][4] = { type: 'floor', incline: true }; // Reserved incline cells are finite rendered geometry, not infinite walls.
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.2);
  assert(h.player.x / TILE > 4.2, 'airborne feet can clear the actual cliff skin inside an incline tile');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, geometry: () => null });
  h.grid[3][4] = { type: 'floor', incline: true };
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(0.3);
  assert(h.player.x / TILE > 4, 'an empty part of an indexed incline has no invisible tile wall');
}
{
  const h = harness({ start: { x: 3.5, z: 3.5 }, wall: { col: 4, row: 3 } });
  h.input.x = 1; h.input.y = 0.4;
  assert(h.window.PlayerJump.start());
  h.advance(0.5);
  assert(h.player.y / TILE > 3.9, 'diagonal approach slides along an unclimbable wall');
  assert(h.window.PlayerJump.debug.slides > 0);
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 } });
  h.grid[3][4] = { type: 'floor', surfaceY: 0.65 }; // Plateau top in the adjacent tile.
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 85; i++) {
    if (h.player.x / TILE > 4.3) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert(h.player.x / TILE > 4, 'crossing the adjacent plateau height permits entry');
  assert.equal(h.player._freeJump, null, 'plateau landing returns to ordinary grounded movement');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, deepSupportY: 0.65 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 85; i++) {
    if (h.player.x / TILE > 4.3) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player._freeJump?.phase, 'supported', 'adjacent dynamic minicliff/platform is reachable when feet cross its elevation');
  assert(Math.abs(h.player.physicalFeetY - 0.65) < 0.01);
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, rock: { col: 4, row: 3, top: 0.65 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(0.5);
  assert(h.window.PlayerJump.debug.assists > 0, 'clearing a collider finds a forward landing within one tile');
  const before = h.player.x; // Releasing input cancels remaining assisted movement immediately.
  h.input.x = 0;
  h.advance(0.05);
  assert.equal(h.player.x, before);
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, rock: { col: 4, row: 3, top: 0.65 }, heightBlocked: x => x > 4.05 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(0.9);
  assert(h.player.x / TILE <= 4.05, 'landing assist cannot lerp through an independent collider');
}
{
  const h = harness();
  const ctx = { window: h.window, self: h.window, console }; // Execute the real authored wall-climb owner beside PlayerJump.
  vm.runInNewContext(read('docs/js/climb-surfaces.js'), ctx);
  h.window.ClimbSurfaces.init({ player: h.player, TILE, getFeetY: () => h.player._freeJump?.feetY ?? 0 });
  h.window.ClimbSurfaces.register({ id: 'air-wall', axis: 'z', plane: 3.1, u0: 3, u1: 4, y0: 0, y1: 6, normal: { x: -1, z: 0 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(0.3);
  assert(h.player.onClimbSurface, 'airborne contact automatically grabs a registered climbable wall');
  assert.equal(h.player._freeJump, null, 'a grab transfers ownership out of the free jump');
  assert(h.player.wallClimbY > 0, 'grab preserves airborne height instead of restarting from the floor');
}
{
  const h = harness({ geometry: x => x >= 4 && x <= 5 ? (x - 4) * 2 : null });
  h.grid[3][4] = { type: 'floor', incline: true };
  assert(h.window.PlayerJump.start());
  h.player.x = 4.45 * TILE;
  h.player._freeJump.feetY = 1.26;
  h.player._freeJump.vy = -1;
  h.advance(0.15);
  assert(h.player.x / TILE < 4.45, 'falling onto an unclimbable face slides downhill even without input');
  assert(h.player._freeJump.feetY > 0, 'slope contact never falls through the rock shell');
}
{
  const h = harness(); // Uses the real free-fall physics while replacing only the two grab callbacks.
  let regrabs = 0; // Counts wall/route auto-grab attempts that a deliberate release must suppress.
  h.window.ClimbSurfaces = { tryAirGrab() { regrabs++; return true; } };
  h.window.ClimbSystem = { tryAirGrab() { regrabs++; return true; } };
  const flight = h.window.PlayerJump.beginFlight({
    x: 2.5, y: 3, z: 3.5, vy: 0, noGrab: true,
  }, { source: 'wall climb release', deliberate: true });
  assert(flight, 'a released climb transfers to physical airborne movement');
  h.advance(0.1);
  assert.equal(regrabs, 0, 'the released grip cannot immediately reattach during falling');
  assert(h.player._freeJump?.feetY < 3, 'gravity lowers the player from the original wall height');
  h.advance(1);
  assert.equal(h.player._freeJump, null, 'the fall lands and restores ordinary movement');
}
console.log('player-jump ok');
