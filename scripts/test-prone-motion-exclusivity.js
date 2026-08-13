'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'prone-motion-exclusivity.js');
const source = fs.readFileSync(modulePath, 'utf8');

let baseTicks = 0;
const ResourceSystem = {
  tick(entity) {
    baseTicks++;
    if (entity.regenFooting) entity.footing = Math.min(entity.maxFooting, entity.footing + 5);
    return 'ticked';
  },
};

const context = { window: { ResourceSystem } };
context.globalThis = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: modulePath });

const prone = {
  prone: true,
  footing: 20,
  maxFooting: 100,
  regenFooting: true,
  vx: 13,
  vy: -8,
  knockbackT: 0.6,
  knockbackVX: 120,
  knockbackVY: -90,
};
assert.strictEqual(ResourceSystem.tick(prone, 0.016), 'ticked');
assert.strictEqual(baseTicks, 1);
assert.strictEqual(prone.footing, 25, 'resource tick still runs while prone');
assert.strictEqual(prone.vx, 0);
assert.strictEqual(prone.vy, 0);
assert.strictEqual(prone.knockbackT, 0);
assert.strictEqual(prone.knockbackVX, 0);
assert.strictEqual(prone.knockbackVY, 0);

const standing = {
  prone: false,
  vx: 4,
  vy: 5,
  knockbackT: 0.25,
  knockbackVX: 30,
  knockbackVY: 40,
};
ResourceSystem.tick(standing, 0.016);
assert.strictEqual(baseTicks, 2);
assert.strictEqual(standing.vx, 4);
assert.strictEqual(standing.vy, 5);
assert.strictEqual(standing.knockbackT, 0.25);
assert.strictEqual(standing.knockbackVX, 30);
assert.strictEqual(standing.knockbackVY, 40);

assert.ok(context.window.HobunjiProneMotionExclusivity.getDebug().clearCount >= 2);
console.log('prone-motion-exclusivity: all checks passed');