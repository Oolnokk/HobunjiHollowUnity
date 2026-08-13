'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'drunk-locomotion.js');
const source = fs.readFileSync(modulePath, 'utf8');

class Quaternion {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0; this.w = 1;
    this.isQuaternion = true;
  }
  identity() { this.x = this.y = this.z = 0; this.w = 1; return this; }
  clone() { const q = new Quaternion(); q.x = this.x; q.y = this.y; q.z = this.z; q.w = this.w; return q; }
  invert() { return this; }
  multiply() { return this; }
  setFromEuler() { return this; }
}

class Euler {
  constructor(x, y, z, order) {
    this.x = x; this.y = y; this.z = z; this.order = order;
  }
}

const player = {
  footing: 35,
  maxFooting: 100,
  afflictions: { drunkenFooting: 0 },
};

let npcProviderCalls = 0;
const ProceduralLegAnimation = {
  attach() {
    return {
      group: { getObjectByName() { return null; } },
      update() {},
      dispose() {},
    };
  },
};

const context = {
  console,
  window: {
    ProceduralLegAnimation,
    Combat: { deps: { player } },
    PlayerBodyTransformComposer: { setChannel() {}, clearChannel() {} },
    SCRATCHBONES_CONFIG: {},
  },
};
context.globalThis = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: modulePath });

// The player's unsteady gait follows CURRENT missing Footing, even when sober.
assert.ok(Math.abs(context.window.HobunjiDrunkWalk.getDebug().loss - 0.65) < 1e-12);
player.footing = 100;
player.afflictions.drunkenFooting = 90;
assert.strictEqual(context.window.HobunjiDrunkWalk.getDebug().loss, 0);
player.footing = 60;
assert.ok(Math.abs(context.window.HobunjiDrunkWalk.getDebug().loss - 0.4) < 1e-12);

// Non-combat NPCs retain their independent sobriety/alcohol provider. Their
// gait input is not derived from the player's or a combat Footing resource.
const THREE = { Quaternion, Euler };
const npcBodyRoot = { quaternion: new Quaternion() };
const npcLegs = ProceduralLegAnimation.attach(THREE, {}, {
  name: 'Furunji Funji',
  modelWidth: 0.9,
  modelHeight: 0.9,
  drunkBodyRoot: npcBodyRoot,
  drunkLossProvider() {
    npcProviderCalls++;
    return 0.7;
  },
});
npcLegs.update(0.016, 1.2, false, false);
assert.strictEqual(npcProviderCalls, 1);

console.log('drunk-locomotion footing sources: all checks passed');
