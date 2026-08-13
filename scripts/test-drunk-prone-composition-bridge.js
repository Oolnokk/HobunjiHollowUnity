'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'drunk-prone-composition-bridge.js');
const source = fs.readFileSync(modulePath, 'utf8');

const player = {
  prone: false,
  footing: 70,
  maxFooting: 100,
  afflictions: { drunkenFooting: 30 },
};

let lastLegUpdate = null;
let lastAttachOptions = null;
let composerSet = null;
let composerCleared = null;
let baseRenderCount = 0;
let pendingBanditEntity = null;

const ResourceSystem = {
  getEffectiveMax(entity, key) {
    if (key === 'footing') return (entity.maxFooting || 0) - (entity.afflictions?.drunkenFooting || 0);
    return 0;
  },
};

const ProceduralLegAnimation = {
  attach(_THREE, _parent, options) {
    lastAttachOptions = options;
    return {
      update(dt, speed, suppressed, seatedPose) {
        lastLegUpdate = { dt, speed, suppressed, seatedPose };
      },
    };
  },
};

const BanditCombat = {
  async makeEntity() {
    return pendingBanditEntity;
  },
};

function WebGLRenderer() {}
WebGLRenderer.prototype.render = function baseRender() {
  baseRenderCount++;
  return 'rendered';
};

const PlayerBodyTransformComposer = {
  setChannel(name, contribution) {
    composerSet = { name, contribution };
  },
  clearChannel(name) {
    composerCleared = name;
  },
  getDebug() { return { ok: true }; },
};

const context = {
  console,
  window: {
    ResourceSystem,
    ProceduralLegAnimation,
    PlayerBodyTransformComposer,
    BanditCombat,
    THREE: { WebGLRenderer },
    Combat: { deps: { player } },
    HobunjiDrunkWalk: {
      getDebug() {
        return { pitchDeg: 12, rollDeg: -18 };
      },
    },
  },
};
context.globalThis = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: modulePath });

(async () => {
  // Drunken Footing still caps standing entities.
  assert.strictEqual(ResourceSystem.getEffectiveMax(player, 'footing'), 70);

  // Prone temporarily exposes the literal maximum so recovery can reach the
  // threshold shared by player and hostile get-up logic.
  player.prone = true;
  assert.strictEqual(ResourceSystem.getEffectiveMax(player, 'footing'), 100);
  player.prone = false;
  assert.strictEqual(ResourceSystem.getEffectiveMax(player, 'footing'), 70);

  // Player leg updates inherit the prone state as suppression without changing
  // callers that already suppress for mounts/harvests.
  const playerLegs = ProceduralLegAnimation.attach({}, {}, { name: 'player' });
  player.prone = true;
  playerLegs.update(0.016, 2.5, false, undefined);
  assert.strictEqual(lastLegUpdate.suppressed, true);
  player.prone = false;
  playerLegs.update(0.016, 2.5, false, undefined);
  assert.strictEqual(lastLegUpdate.suppressed, false);
  playerLegs.update(0.016, 2.5, true, undefined);
  assert.strictEqual(lastLegUpdate.suppressed, true);

  // Bandit feet use their dedicated floor pivot, so the bridge injects the
  // existing locomotion provider/body root before the wrapped attach.
  const banditBodyRoot = { name: 'bandit_avatar_group' };
  const banditLegPivot = { name: 'bandit_legs_pivot', parent: banditBodyRoot };
  const banditLegs = ProceduralLegAnimation.attach({}, banditLegPivot, { name: 'Nakku' });
  const banditLossProvider = lastAttachOptions.drunkLossProvider;
  assert.strictEqual(typeof banditLossProvider, 'function');
  assert.strictEqual(lastAttachOptions.drunkBodyRoot, banditBodyRoot);
  assert.strictEqual(banditLossProvider(), 0);

  pendingBanditEntity = {
    prone: false,
    footing: 40,
    maxFooting: 100,
    avatarRef: { legs: banditLegs },
  };
  const boundBandit = await BanditCombat.makeEntity();
  assert.strictEqual(boundBandit, pendingBanditEntity);
  assert.ok(Math.abs(banditLossProvider() - 0.6) < 1e-12);
  pendingBanditEntity.footing = 0;
  assert.strictEqual(banditLossProvider(), 1);
  pendingBanditEntity.footing = 100;
  assert.strictEqual(banditLossProvider(), 0);
  pendingBanditEntity.footing = 25;
  pendingBanditEntity.prone = true;
  assert.strictEqual(banditLossProvider(), 0);
  pendingBanditEntity.prone = false;
  assert.ok(Math.abs(banditLossProvider() - 0.75) < 1e-12);

  // The render-boundary wrapper republishes player low-Footing pitch/roll as
  // additive after gameplay-facing writers resolve their base yaw for the frame.
  const renderer = new WebGLRenderer();
  composerSet = null;
  composerCleared = null;
  assert.strictEqual(renderer.render(), 'rendered');
  assert.strictEqual(baseRenderCount, 1);
  assert.strictEqual(composerSet?.name, 'drunk');
  assert.strictEqual(composerSet?.contribution?.mode, 'additive');
  assert.strictEqual(composerSet?.contribution?.preserveFacingSide, true);
  assert.ok(Math.abs(composerSet.contribution.rotation.pitch - 12 * Math.PI / 180) < 1e-12);
  assert.ok(Math.abs(composerSet.contribution.rotation.roll - (-18 * Math.PI / 180)) < 1e-12);

  // While prone, the stored drunkenness remains but the unsteady body channel
  // is removed so ragdoll/recovery owns the pose exclusively.
  player.prone = true;
  composerSet = null;
  composerCleared = null;
  renderer.render();
  assert.strictEqual(composerCleared, 'drunk');
  assert.strictEqual(composerSet, null);

  console.log('drunk-prone-composition bridge: all checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});