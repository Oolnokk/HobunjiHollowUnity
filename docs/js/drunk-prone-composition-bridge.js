// Prone/drunken-Footing and final body-composition compatibility bridge.
//
// Loaded after drunk-locomotion + alcohol-gameplay-bridge and before game.js.
// It deliberately owns only the seams between those already-decoupled systems:
//   1) prone temporarily ignores the Drunken Footing effective-max cap so
//      Footing can refill to the literal max required by get-up logic;
//   2) the player's procedural/drunken gait is suppressed while prone;
//   3) immediately before each render, the current drunken pitch/roll is
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

  // Force the player leg/gait update into its existing suppressed path while
  // prone. Because drunk-locomotion decorates this same update() call, that
  // also drives its raw drunken-loss contribution to zero without deleting or
  // modifying the stored Drunken Footing amount. This wrapper is installed
  // after drunk-locomotion, so it sits outside that decorator intentionally.
  if (!legApi.__proneSuppressesDrunkGaitInstalled) {
    const previousAttach = legApi.attach.bind(legApi);
    legApi.attach = function proneAwareLegAttach(THREEArg, parent, options = {}) {
      const handle = previousAttach(THREEArg, parent, options);
      if (!handle || String(options.name || '').toLowerCase() !== 'player' || typeof handle.update !== 'function') return handle;

      const previousUpdate = handle.update.bind(handle);
      handle.update = function proneAwarePlayerLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
        const player = window.Combat?.deps?.player;
        return previousUpdate(dt, speedWorldUnitsPerSecond, !!suppressed || !!player?.prone, seatedPose);
      };
      return handle;
    };
    legApi.__proneSuppressesDrunkGaitInstalled = true;
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
