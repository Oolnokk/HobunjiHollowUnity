const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('docs/js/footing-damage-recovery-bridge.js', 'utf8');
let now = 1000;
let originalClimbTicks = 0;

const player = {
  x: 1.82 * 64,
  y: 1.5 * 64,
  angle: 0,
  inputX: 1,
  inputY: 0,
  vx: 120,
  vy: 0,
  footing: 100,
  maxFooting: 100,
  prone: false,
  climbing: false,
  onBranch: null,
  dodging: false,
  lunging: false,
};

const grid = Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => ({ type: 'grass', elevTier: 0, incline: false })));
grid[1][1] = { type: 'grass', elevTier: 2, incline: false };
grid[1][2] = { type: 'grass', elevTier: 2, incline: true };
grid[1][3] = { type: 'grass', elevTier: 1, incline: false };

const ResourceSystem = {
  spendFooting(entity, amount) {
    if (entity.prone || !(amount > 0)) return 0;
    const before = entity.footing;
    entity.footing = Math.max(0, before - amount);
    return before - entity.footing;
  },
  tick() {},
};

const deps = {
  player,
  TILE: 64,
  getActiveGrid: () => grid,
  canPlayerOccupy: () => true,
  isSolid: type => type === 'wall',
};

const window = {
  ResourceSystem,
  Combat: { deps },
  ClimbSystem: {
    groundYAt(x) {
      return x < 3 * 64 ? 2 : 1;
    },
    updateClimb() { originalClimbTicks++; },
  },
  Mounts: { rideState: 'none' },
  PlayerChat: { isOpen: false },
  __farmLog() {},
};

const context = vm.createContext({
  window,
  performance: { now: () => now },
  Date,
  console,
  document: { getElementById: () => null },
});
vm.runInContext(source, context, { filename: 'footing-damage-recovery-bridge.js' });

const Falls = window.HobunjiPlateauFalls;
assert.ok(Falls, 'fall API is exported');
assert.equal(Falls.footingCostForDrop(1, false), 35, 'one-tier hard landing requests 35 before the global x2 Footing multiplier');
assert.equal(Falls.footingCostForDrop(1, true), 12.5, 'one-tier rolling landing requests 12.5 before the global x2 Footing multiplier');
assert.equal(Falls.footingCostForDrop(3, false), 47.5, 'hard landing Footing cost scales and caps');
assert.equal(Falls.footingCostForDrop(3, true), 20, 'rolling landing remains substantially cheaper across taller drops');

assert.equal(Falls.probe(), true, 'moving toward a downhill plateau lip begins an accidental fall');
assert.equal(player.climbing, true, 'fall reuses the existing scripted vertical movement lane');
assert.ok(player._hobunjiFallState, 'fall state is stored on the player while airborne');
assert.equal(player._hobunjiFallState.rolling, true, 'an accidental moving walk-off is a rolling landing');

for (let i = 0; i < 20 && player.climbing; i++) window.ClimbSystem.updateClimb(0.1);
assert.equal(player.climbing, false, 'fall eventually reaches the lower surface');
assert.equal(player.x, 3.5 * 64, 'player lands in the center of the lower walkable tile');
assert.equal(player.y, 1.5 * 64, 'landing preserves the correct row');
assert.equal(player.footing, 75, 'rolling one-tier impact loses 25 Footing after the bridge multiplier');
assert.equal(player.dodging, true, 'moving landing enters the existing tumble/roll animation state');
assert.equal(player.dodgeT, 0.32, 'landing roll uses the established short tumble duration');

player.dodging = false;
window.ClimbSystem.updateClimb(0.1);
assert.equal(originalClimbTicks, 1, 'ordinary climbs remain owned by the original ClimbSystem update');

player.x = 64;
player.y = 64;
player.footing = 100;
player.climbing = false;
assert.equal(Falls.beginFall({
  entity: player,
  deps,
  endX: 64,
  endY: 128,
  startSurfaceY: 2,
  endSurfaceY: 1,
  tierDrop: 1,
  rolling: false,
  dir: { x: 0, y: 1 },
  source: 'test platform',
}), true, 'generic fall API accepts a non-plateau tall platform drop');
for (let i = 0; i < 20 && player.climbing; i++) window.ClimbSystem.updateClimb(0.1);
assert.equal(player.footing, 30, 'hard one-tier impact loses 70 Footing after the bridge multiplier');
assert.equal(player.dodging, false, 'stationary hard landing does not synthesize a roll');

player.x = 1.82 * 64;
player.y = 2.5 * 64;
player.inputX = 1;
player.inputY = 0;
player.vx = 120;
player.vy = 0;
player.footing = 100;
grid[2][1] = { type: 'grass', elevTier: 1, incline: false };
grid[2][2] = { type: 'grass', elevTier: 1, incline: true };
grid[2][3] = { type: 'grass', elevTier: 2, incline: false };
assert.equal(Falls.probe(), false, 'uphill cliff remains impassable ordinary movement');
assert.equal(player.climbing, false, 'uphill probe does not start a scripted transition');

player.y = 3.5 * 64;
grid[3][1] = { type: 'grass', elevTier: 2, incline: false };
grid[3][2] = { type: 'grass', elevTier: 2, incline: true };
grid[3][3] = { type: 'grass', elevTier: 1, incline: false };
deps.canPlayerOccupy = () => false;
assert.equal(Falls.probe(), false, 'lower tile collision rejects an otherwise valid fall');

console.log('plateau fall landing tests passed');
