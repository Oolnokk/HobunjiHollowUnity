// Prone/drunken-Footing and final body-composition compatibility bridge.
//
// Loaded after drunk-locomotion + alcohol-gameplay-bridge and before game.js.
// It deliberately owns only the seams between those already-decoupled systems:
//   1) prone temporarily ignores the Drunken Footing effective-max cap so
//      Footing can refill to the literal max required by get-up logic;
//   2) the player's procedural/drunken gait is suppressed while prone;
//   3) bandits feed ordinary Footing loss into the existing drunken locomotion
//      layer, so low Footing produces the same unsteady legs/body sway;
//   4) immediately before each render, the current player drunken pitch/roll is
//      re-published as an additive composer channel after gameplay has resolved
//      facing/auto-target yaw for the frame.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  const legApi = window.ProceduralLegAnimation;
  const composer = window.PlayerBodyTransformComposer;
  const THREE = window.THREE;
  if (!RS || !legApi || !composer || !THREE || window.__hobunjiDrunkProneCompositionBridgeInstalled) return;
  window.__hobunjiDrunkProneCompositionBridgeInstalled = true;

  const DRUNK_CHANNEL = 'drunk';
  const DRUNK_PRIORITY = 200;
  const DEG = Math.PI / 180;
  const banditStateByLegHandle = new WeakMap(); // Binds a pre-entity bandit leg attachment to its entity once makeEntity finishes.

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function banditFootingLoss(entity) {
    const maxFooting = Number(entity?.maxFooting) || 0;
    if (!entity || entity.prone || !(maxFooting > 0)) return 0;
    const footing = Math.max(0, Number(entity.footing) || 0);
    return clamp01(1 - footing / maxFooting);
  }

  // Drunken Footing normally lowers the effective Footing ceiling. Prone
  // recovery is the exception: player and hostile get-up logic both wait for
  // entity.footing >= entity.maxFooting, so a reduced effective maximum makes
  // a drunken prone entity permanently ineligible to stand. Preserve the
  // stored drunken affliction, but ignore its cap while prone. The moment
  // prone clears, the existing drunken cap automatically applies again.
  if (!RS.__proneIgnoresDrunkenFootingCapInstalled) {
    const previousGetEffectiveMax = RS.getEffectiveMax.bind(RS);
    RS.getEffectiveMax = function proneAwareEffectiveMax(entity, key) {
      if (key === 'footing' && entity?.prone) {
        return Math.max(0, Number(entity.maxFooting) || 0);
      }
      return previousGetEffectiveMax(entity, key);
    };
    RS.__proneIgnoresDrunkenFootingCapInstalled = true;
  }

  // Wrap the common procedural-leg attach seam after drunk-locomotion has
  // already decorated it. Player attachments keep the prone suppression from
  // this bridge. Bandit legs are identifiable by their dedicated floor pivot;
  // inject a Footing-loss provider BEFORE calling the drunk-locomotion wrapper
  // so that existing layer performs the gait/body sway instead of duplicating
  // any animation math here. Bandit portraits are built before their combatant
  // entity exists, hence the tiny mutable state object bound after makeEntity.
  if (!legApi.__proneSuppressesDrunkGaitInstalled) {
    const previousAttach = legApi.attach.bind(legApi);
    legApi.attach = function proneAwareLegAttach(THREEArg, parent, options = {}) {
      const isBanditLegs = parent?.name === 'bandit_legs_pivot';
      const banditState = isBanditLegs ? { entity: null } : null;
      const attachOptions = isBanditLegs
        ? {
            ...options,
            drunkLossProvider: () => banditFootingLoss(banditState.entity),
            drunkBodyRoot: options.drunkBodyRoot || parent?.parent || null,
          }
        : options;
      const handle = previousAttach(THREEArg, parent, attachOptions);
      if (!handle) return handle;
      if (banditState) banditStateByLegHandle.set(handle, banditState);

      if (String(options.name || '').toLowerCase() !== 'player' || typeof handle.update !== 'function') return handle;
      const previousUpdate = handle.update.bind(handle);
      handle.update = function proneAwarePlayerLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
        const player = window.Combat?.deps?.player;
        return previousUpdate(dt, speedWorldUnitsPerSecond, !!suppressed || !!player?.prone, seatedPose);
      };
      return handle;
    };
    legApi.__proneSuppressesDrunkGaitInstalled = true;
  }

  // combat-bandit.js loads before this bridge, and a bandit's portrait/legs are
  // constructed before ResourceSystem.initEntity creates its Footing fields.
  // Bind the finished entity back to the provider captured above. No bandit AI,
  // facing, attack, or resource code is replaced; this only supplies the data
  // source the existing drunken locomotion decorator was missing.
  const banditApi = window.BanditCombat;
  if (banditApi?.makeEntity && !banditApi.__lowFootingSwayInstalled) {
    const previousMakeBanditEntity = banditApi.makeEntity.bind(banditApi);
    banditApi.makeEntity = async function lowFootingSwayBanditEntity(...args) {
      const entity = await previousMakeBanditEntity(...args);
      const state = banditStateByLegHandle.get(entity?.avatarRef?.legs);
      if (state) state.entity = entity;
      return entity;
    };
    banditApi.__lowFootingSwayInstalled = true;
  }

  function syncDrunkComposerChannel() {
    const player = window.Combat?.deps?.player;
    if (!player) return;

    // Prone/knockdown playback owns the pose completely. Removing only the
    // drunk channel leaves the ragdoll/recovery channel and every other body
    // contribution untouched. Stored drunkenness remains on the entity.
    if (player.prone) {
      composer.clearChannel(DRUNK_CHANNEL);
      return;
    }

    const debug = window.HobunjiDrunkWalk?.getDebug?.();
    if (!debug) return;
    const pitch = Number(debug.pitchDeg) * DEG;
    const roll = Number(debug.rollDeg) * DEG;
    if (!Number.isFinite(pitch) || !Number.isFinite(roll)) return;

    // Reassert at the render boundary, after game.js has resolved this frame's
    // normal facing/auto-target yaw. The composer then post-composes this local
    // pitch/roll onto that base orientation, so target tracking cannot replace
    // the drunken lean; it can only rotate the already-leaning body to face the
    // target. Attack/ragdoll channels continue to compose by their priorities.
    composer.setChannel(DRUNK_CHANNEL, {
      priority: DRUNK_PRIORITY,
      mode: 'additive',
      preserveFacingSide: true,
      rotation: { pitch, roll },
    });
  }

  // combat-config-loader makes r128 renderer instances delegate render() to
  // the prototype specifically so runtime composition modules can safely wrap
  // this seam. PlayerBodyTransformComposer is already installed when this file
  // loads; wrapping it here means syncDrunkComposerChannel() runs immediately
  // before the composer's own final-delta resolution on every render pass.
  const rendererProto = THREE.WebGLRenderer?.prototype;
  if (rendererProto?.render && !rendererProto.__drunkProneCompositionRenderHook) {
    const previousRender = rendererProto.render;
    rendererProto.render = function drunkProneCompositionRender(...args) {
      syncDrunkComposerChannel();
      return previousRender.apply(this, args);
    };
    rendererProto.__drunkProneCompositionRenderHook = true;
  }

  window.HobunjiDrunkProneCompositionBridge = Object.freeze({
    banditFootingLoss,
    getDebug() {
      const player = window.Combat?.deps?.player;
      return {
        playerProne: !!player?.prone,
        footing: Number(player?.footing) || 0,
        maxFooting: Number(player?.maxFooting) || 0,
        effectiveFootingMax: player ? Number(RS.getEffectiveMax(player, 'footing')) || 0 : 0,
        drunkenFooting: Number(player?.afflictions?.drunkenFooting) || 0,
        drunkWalk: window.HobunjiDrunkWalk?.getDebug?.() || null,
        composer: composer.getDebug?.() || null,
      };
    },
  });
})();
