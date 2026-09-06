'use strict';

const assert = require('node:assert'); // Strict checks for fixed-rate target rotation and ranged bypass behavior.
const fs = require('node:fs'); // Reads the committed runtime adapter and loader directly from the checkout.
const path = require('node:path'); // Resolves repository-relative source files.
const vm = require('node:vm'); // Executes the browser IIFE against a deterministic BanditCombat mock.

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'combat', 'enemy-target-facing.js'), 'utf8'); // Runtime facing adapter under test.
const loader = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'combat', 'combat-config-loader.js'), 'utf8'); // Bootstrap source used to pin runtime integration.

const hostileObjects = []; // Live-array stand-in used by the adapter's mobile/headless debug snapshot.
const BanditCombat = {
  updateCombatAI(entity, dt, targetPlayer) {
    const desired = Math.atan2(targetPlayer.y - entity.y, targetPlayer.x - entity.x);
    // Model the current problematic behavior: the underlying AI snaps facing
    // and lunge direction straight at its target before returning aimAngle.
    entity.facing = desired;
    entity._banditLungeDirX = Math.cos(desired);
    entity._banditLungeDirY = Math.sin(desired);
    return { aimAngle: desired, moving: true };
  },
};

const context = vm.createContext({
  console,
  Math,
  window: {
    BanditCombat,
    Combat: { deps: { hostileObjects } },
    __attackValuesConfig: { bandit: { targetTurnRateRadS: 6 } },
    addEventListener() {},
  },
});
vm.runInContext(source, context, { filename: 'enemy-target-facing.js' });

assert(context.window.EnemyTargetFacing, 'facing adapter should install');
assert(loader.includes("js/combat/enemy-target-facing.js?v=20260906a"), 'combat bootstrap should load the facing adapter before game.js');
assert.strictEqual(context.window.EnemyTargetFacing.turnRateRadS, 6);

const halfTurn = {
  id: 'half-turn', name: 'Half Turn', isBandit: true,
  x: 0, y: 0, facing: 0,
};
hostileObjects.push(halfTurn);
const halfTurnResult = BanditCombat.updateCombatAI(halfTurn, 0.1, { x: -10, y: 0 }, 10);
assert(Math.abs(halfTurn.facing - 0.6) < 1e-9, '180-degree target correction should advance only 0.6 rad in 0.1s at 6 rad/s');
assert(Math.abs(halfTurnResult.aimAngle - halfTurn.facing) < 1e-9, 'returned aim angle must match capped entity facing');
assert(Math.abs(halfTurn._banditLungeDirX - Math.cos(0.6)) < 1e-9, 'lunge X direction must use capped facing');
assert(Math.abs(halfTurn._banditLungeDirY - Math.sin(0.6)) < 1e-9, 'lunge Y direction must use capped facing');
assert(Math.abs(halfTurn._targetFacingDebug.requestedTurnRad - Math.PI) < 1e-9);
assert(Math.abs(halfTurn._targetFacingDebug.appliedTurnRad - 0.6) < 1e-9);

const quarterTurn = {
  id: 'quarter-turn', name: 'Quarter Turn', isBandit: true,
  x: 0, y: 0, facing: 0,
};
BanditCombat.updateCombatAI(quarterTurn, 0.1, { x: 0, y: 10 }, 10);
assert(Math.abs(quarterTurn.facing - 0.6) < 1e-9, '90-degree turn uses the same fixed angular speed, so it completes in half the time of 180 degrees');

const smallTurn = {
  id: 'small-turn', name: 'Small Turn', isBandit: true,
  x: 0, y: 0, facing: 0,
};
const smallAngle = 0.3;
BanditCombat.updateCombatAI(smallTurn, 0.1, { x: Math.cos(smallAngle) * 10, y: Math.sin(smallAngle) * 10 }, 10);
assert(Math.abs(smallTurn.facing - smallAngle) < 1e-9, 'turns smaller than the frame cap should finish exactly without overshoot');

const ranged = {
  id: 'ranged', name: 'Ranged', isBandit: true,
  x: 0, y: 0, facing: 0, _rangedMode: true,
};
const rangedResult = BanditCombat.updateCombatAI(ranged, 0.1, { x: -10, y: 0 }, 10);
assert(Math.abs(Math.abs(ranged.facing) - Math.PI) < 1e-9, 'ranged projectile aim should bypass melee turn drag');
assert(Math.abs(Math.abs(rangedResult.aimAngle) - Math.PI) < 1e-9);

context.window.EnemyTargetFacing.applyConfig({ bandit: { targetTurnRateRadS: 3 } });
assert.strictEqual(context.window.EnemyTargetFacing.turnRateRadS, 3, 'authored attack-values turn rate should remain live-configurable');
const configured = { id: 'configured', name: 'Configured', isBandit: true, x: 0, y: 0, facing: 0 };
BanditCombat.updateCombatAI(configured, 0.1, { x: -10, y: 0 }, 10);
assert(Math.abs(configured.facing - 0.3) < 1e-9, 'updated 3 rad/s config should cap a 0.1s frame at 0.3 rad');

const snapshot = context.window.EnemyTargetFacing.debugSnapshot();
assert.strictEqual(snapshot.length, 1);
assert.strictEqual(snapshot[0].id, 'half-turn');
assert.strictEqual(snapshot[0].turnRateRadS, 6, 'entity debug cache should retain the rate that was active when it was last updated');

console.log('enemy target facing regression tests passed');
