'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'drunk-prone-composition-bridge.js');
const source = fs.readFileSync(modulePath, 'utf8');

class MockRotation {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new MockRotation(this.x, this.y, this.z); }
  copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; return this; }
}

class MockQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  clone() { return new MockQuaternion(this.x, this.y, this.z, this.w); }
  copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; this.w = other.w; return this; }
  identity() { this.x = this.y = this.z = 0; this.w = 1; return this; }
}

class MockGroup {
  constructor() {
    this.isObject3D = true;
    this.name = '';
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.rotation = new MockRotation();
    this.quaternion = new MockQuaternion();
  }
  add(child) {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child.parent === this) child.parent = null;
    return this;
  }
  traverse(fn) {
    fn(this);
    for (const child of this.children) child.traverse ? child.traverse(fn) : fn(child);
  }
  updateWorldMatrix() {}
}

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
let baseBanditAiCalls = 0;

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
      group: new MockGroup(),
      update(dt, speed, suppressed, seatedPose) {
        lastLegUpdate = { dt, speed, suppressed, seatedPose };
      },
      dispose() {},
    };
  },
};

const BanditCombat = {
  async makeEntity() {
    return pendingBanditEntity;
  },
  updateCombatAI() {
    baseBanditAiCalls++;
    return { aimAngle: 1, moving: true };
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

const THREE = {
  Group: MockGroup,
  Quaternion: MockQuaternion,
  WebGLRenderer,
};

const context = {
  console,
  window: {
    ResourceSystem,
    ProceduralLegAnimation,
    PlayerBodyTransformComposer,
    BanditCombat,
    THREE,
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
  assert.doesNotMatch(source, /THREE\.DoubleSide|preserveBanditFacingSide/, 'bandit sway never overrides portrait material culling');
  assert.ok(source.includes("portraitFaceCulling: 'material-frontside'"), 'bridge diagnostics expose normal FrontSide culling');
  assert.ok(source.includes('forcedPortraitDoubleSide: false'), 'bridge diagnostics expose that two-sided portrait forcing is disabled');

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
  const playerLegs = ProceduralLegAnimation.attach(THREE, new MockGroup(), { name: 'player' });
  player.prone = true;
  playerLegs.update(0.016, 2.5, false, undefined);
  assert.strictEqual(lastLegUpdate.suppressed, true);
  player.prone = false;
  playerLegs.update(0.016, 2.5, false, undefined);
  assert.strictEqual(lastLegUpdate.suppressed, false);
  playerLegs.update(0.016, 2.5, true, undefined);
  assert.strictEqual(lastLegUpdate.suppressed, true);

  // Bandit body tilt is isolated from the yaw-owning avatar root. The visible
  // front/back portrait pivots move under a child visual root, while the
  // drunken-locomotion decorator receives an off-scene driver root.
  const banditBodyRoot = new MockGroup();
  banditBodyRoot.name = 'bandit_avatar_group';
  const frontPlane = new MockGroup(); frontPlane.name = 'bandit_front_plane';
  const backPlane = new MockGroup(); backPlane.name = 'bandit_back_plane';
  const banditLegPivot = new MockGroup(); banditLegPivot.name = 'bandit_legs_pivot';
  banditBodyRoot.add(frontPlane);
  banditBodyRoot.add(backPlane);
  banditBodyRoot.add(banditLegPivot);

  const banditLegs = ProceduralLegAnimation.attach(THREE, banditLegPivot, { name: 'Nakku' });
  const banditLossProvider = lastAttachOptions.drunkLossProvider;
  assert.strictEqual(typeof banditLossProvider, 'function');
  assert.strictEqual(lastAttachOptions.drunkBodyRoot.name, 'bandit_sway_driver');
  assert.notStrictEqual(lastAttachOptions.drunkBodyRoot, banditBodyRoot);
  const visualRoot = banditBodyRoot.children.find(child => child.name === 'bandit_body_sway_visual');
  assert.ok(visualRoot, 'bandit gets an isolated visible sway pivot');
  assert.strictEqual(frontPlane.parent, visualRoot);
  assert.strictEqual(backPlane.parent, visualRoot);
  assert.strictEqual(banditLegPivot.parent, banditBodyRoot, 'legs/facing root remain outside body tilt pivot');
  assert.strictEqual(banditLossProvider(), 0);

  pendingBanditEntity = {
    prone: false,
    footing: 40,
    maxFooting: 100,
    facing: 0.4,
    vx: 9,
    vy: -7,
    knockbackT: 0.5,
    knockbackVX: 100,
    knockbackVY: -80,
    _banditLunging: true,
    _banditLungeT: 0.3,
    _banditLungeDistancePx: 55,
    _banditLungeHitTest: {},
    _banditComboIndex: 2,
    telegraphState: 'strike',
    avatarRef: { legs: banditLegs, frontPlane, backPlane },
  };
  const boundBandit = await BanditCombat.makeEntity();
  assert.strictEqual(boundBandit, pendingBanditEntity);
  assert.ok(Math.abs(banditLossProvider() - 0.6) < 1e-12);
  pendingBanditEntity.footing = 0;
  assert.strictEqual(banditLossProvider(), 1);
  pendingBanditEntity.footing = 100;
  assert.strictEqual(banditLossProvider(), 0);

  // Prone is a hard motion-ownership boundary. Both leg updates and a direct
  // AI call suppress motion and discard stale knockback/lunge/action state.
  pendingBanditEntity.footing = 25;
  pendingBanditEntity.prone = true;
  assert.strictEqual(banditLossProvider(), 0);
  banditLegs.update(0.016, 3, false, undefined);
  assert.strictEqual(lastLegUpdate.suppressed, true);
  assert.strictEqual(pendingBanditEntity.vx, 0);
  assert.strictEqual(pendingBanditEntity.vy, 0);
  assert.strictEqual(pendingBanditEntity.knockbackT, 0);
  assert.strictEqual(pendingBanditEntity.knockbackVX, 0);
  assert.strictEqual(pendingBanditEntity.knockbackVY, 0);
  assert.strictEqual(pendingBanditEntity._banditLunging, false);
  assert.strictEqual(pendingBanditEntity._banditLungeT, 0);
  assert.strictEqual(pendingBanditEntity._banditComboIndex, 0);
  assert.strictEqual(pendingBanditEntity.telegraphState, null);

  const proneAi = BanditCombat.updateCombatAI(pendingBanditEntity, {}, 0.016);
  assert.strictEqual(proneAi.aimAngle, 0.4);
  assert.strictEqual(proneAi.moving, false);
  assert.strictEqual(baseBanditAiCalls, 0, 'prone cannot enter the underlying combat AI');
  pendingBanditEntity.prone = false;
  const standingAi = BanditCombat.updateCombatAI(pendingBanditEntity, {}, 0.016);
  assert.strictEqual(standingAi.moving, true);
  assert.strictEqual(baseBanditAiCalls, 1);

  // The render-boundary wrapper republishes player pitch/roll as additive after
  // gameplay-facing writers have resolved their base yaw for the frame. It does
  // not ask the compositor to freeze or double-side a pre-transform portrait face.
  const renderer = new WebGLRenderer();
  composerSet = null;
  composerCleared = null;
  assert.strictEqual(renderer.render(), 'rendered');
  assert.strictEqual(baseRenderCount, 1);
  assert.strictEqual(composerSet?.name, 'drunk');
  assert.strictEqual(composerSet?.contribution?.mode, 'additive');
  assert.strictEqual(Object.hasOwn(composerSet?.contribution || {}, 'preserveFacingSide'), false);
  assert.ok(Math.abs(composerSet.contribution.rotation.pitch - 12 * Math.PI / 180) < 1e-12);
  assert.ok(Math.abs(composerSet.contribution.rotation.roll - (-18 * Math.PI / 180)) < 1e-12);

  // While prone, the player's low-Footing body channel is removed so physical
  // knockdown/recovery owns the pose exclusively.
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
