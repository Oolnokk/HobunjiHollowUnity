'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'footing-damage-recovery-bridge.js');
const source = fs.readFileSync(modulePath, 'utf8');

let now = 1000;
let lastTickOptions = null;
const events = [];

class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

const ResourceSystem = {
  spendFooting(entity, amount) {
    if (entity.prone || !(amount > 0)) return 0;
    const before = entity.footing;
    entity.footing = Math.max(0, before - amount);
    return before - entity.footing;
  },
  tick(entity, dt, options = {}) {
    lastTickOptions = options;
    const rate = options.footingRegenPerSec ?? 6;
    entity.footing = Math.min(entity.maxFooting, entity.footing + rate * dt);
    return { ok: true };
  },
};

const player = { footing: 100, maxFooting: 100, prone: false, health: 100, facing: 0 };
const context = {
  console,
  CustomEvent,
  queueMicrotask: fn => fn(),
  performance: { now: () => now },
  window: {
    ResourceSystem,
    Combat: { deps: { player } },
    dispatchEvent(event) { events.push(event); return true; },
  },
};
context.globalThis = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: modulePath });

// Standing hits still double Footing damage and start the recovery delay.
assert.strictEqual(ResourceSystem.spendFooting(player, 10, 'ordinary hit'), 20);
assert.strictEqual(player.footing, 80);
assert.strictEqual(player.lastFootingDamageAt, 1000);
assert.strictEqual(context.window.HobunjiFootingDamageRecovery.damageMultiplier, 2);

// No Footing regen occurs until 1.5 seconds have passed without another standing hit.
now = 2000;
ResourceSystem.tick(player, 1);
assert.strictEqual(player.footing, 80);
assert.strictEqual(lastTickOptions.footingRegenPerSec, 0);

// A second standing Footing hit restarts the same grace period.
assert.strictEqual(ResourceSystem.spendFooting(player, 5, 'follow-up hit'), 10);
assert.strictEqual(player.footing, 70);
assert.strictEqual(player.lastFootingDamageAt, 2000);

now = 3400;
ResourceSystem.tick(player, 1);
assert.strictEqual(player.footing, 70);
assert.strictEqual(lastTickOptions.footingRegenPerSec, 0);

// Once the delay expires, the baseline rate is maxFooting / 3 per second.
now = 3600;
ResourceSystem.tick(player, 1);
assert.strictEqual(player.footing, 100);
assert.strictEqual(lastTickOptions.footingRegenPerSec, 100 / 3);
assert.strictEqual(context.window.HobunjiFootingDamageRecovery.fullRecoverySeconds, 3);
assert.strictEqual(context.window.HobunjiFootingDamageRecovery.defaultFootingRegenPerSec(player), 100 / 3);

// Explicit encounter-specific rates still override the baseline rate.
player.footing = 70;
ResourceSystem.tick(player, 1, { footingRegenPerSec: 3, staminaRegenPerSec: 9 });
assert.strictEqual(player.footing, 73);
assert.strictEqual(lastTickOptions.footingRegenPerSec, 3);
assert.strictEqual(lastTickOptions.staminaRegenPerSec, 9);

// Strike-caused zero Footing uses the strike's already-assigned knockback vector.
player.prone = false;
player.footing = 10;
player.knockbackVX = 0;
player.knockbackVY = 500;
player.vx = -100;
player.vy = 0;
assert.strictEqual(ResourceSystem.spendFooting(player, 5, 'weapon hit'), 10);
const strikeBreak = events.at(-1);
assert.strictEqual(strikeBreak.type, 'hobunji-footing-break');
assert.strictEqual(strikeBreak.detail.cause, 'strike-knockback');
assert.strictEqual(strikeBreak.detail.fallX, 0);
assert.strictEqual(strikeBreak.detail.fallY, 1);
assert.strictEqual(player.prone, true);

// Non-strike zero Footing ignores stale knockback and follows current movement.
player.prone = false;
player.footing = 10;
player.vx = -3;
player.vy = 4;
player.knockbackVX = 800;
player.knockbackVY = 0;
assert.strictEqual(ResourceSystem.spendFooting(player, 5, { reason: 'terrain balance loss', strike: false }), 10);
const movementBreak = events.at(-1);
assert.strictEqual(movementBreak.detail.cause, 'movement');
assert.ok(Math.abs(movementBreak.detail.fallX + 0.6) < 1e-9);
assert.ok(Math.abs(movementBreak.detail.fallY - 0.8) < 1e-9);

// If a non-strike source breaks Footing while stationary, facing is the stable fallback.
player.prone = false;
player.footing = 10;
player.vx = 0;
player.vy = 0;
player.facing = Math.PI / 2;
assert.strictEqual(ResourceSystem.spendFooting(player, 5, { reason: 'balance effect', strike: false }), 10);
const facingBreak = events.at(-1);
assert.strictEqual(facingBreak.detail.cause, 'facing');
assert.ok(Math.abs(facingBreak.detail.fallX) < 1e-9);
assert.ok(Math.abs(facingBreak.detail.fallY - 1) < 1e-9);
assert.deepStrictEqual(
  Object.keys(player.lastFootingBreak).sort(),
  ['at', 'cause', 'fallX', 'fallY', 'reason'].sort(),
  'stored break diagnostics must stay serializable and must not retain the entity itself'
);

// A hit while prone cannot refresh an already-expired recovery timer.
player.prone = true;
now = 5000;
const previousDamageAt = player.lastFootingDamageAt;
assert.strictEqual(ResourceSystem.spendFooting(player, 12, 'prone hit'), 0);
assert.strictEqual(player.lastFootingDamageAt, previousDamageAt);
assert.strictEqual(context.window.HobunjiFootingDamageRecovery.recoveryDelayRemaining(player), 0);

// A prone hit cannot create a new recovery timer either.
delete player.lastFootingDamageAt;
now = 6000;
assert.strictEqual(ResourceSystem.spendFooting(player, 12, 'prone hit without timer'), 0);
assert.strictEqual(player.lastFootingDamageAt, undefined);
assert.strictEqual(context.window.HobunjiFootingDamageRecovery.recoveryDelayRemaining(player), 0);

const debug = context.window.HobunjiFootingDamageRecovery.getDebug(player);
assert.strictEqual(debug.damageMultiplier, 2);
assert.strictEqual(debug.recoveryDelaySeconds, 1.5);
assert.strictEqual(debug.fullRecoverySeconds, 3);
assert.strictEqual(debug.defaultFootingRegenPerSec, 100 / 3);
assert.strictEqual(debug.lastFootingDamageAt, null);
assert.strictEqual(debug.lastFootingBreak.cause, 'facing');

console.log('Footing timing and zero-break direction checks passed.');
