// Prone/Footing and final body-composition compatibility bridge.
//
// Loaded after drunk-locomotion + alcohol-gameplay-bridge and before game.js.
// It deliberately owns only seams between those already-decoupled systems:
//   1) prone temporarily ignores the Drunken Footing effective-max cap so
//      Footing can refill to the literal max required by get-up logic;
//   2) the player's procedural/unsteady gait is suppressed while prone;
//   3) bandits feed ordinary Footing loss into the existing locomotion layer;
//   4) bandit low-Footing pitch/roll is rendered through an isolated child
//      pivot instead of mutating the same avatar root that owns facing/yaw;
//   5) prone is a hard bandit motion-ownership boundary: attack/lunge and
//      stale knockback state are cancelled while the entity is down;
//   6) immediately before each render, the current player low-Footing pitch/
//      roll is re-published as an additive composer channel after gameplay has
//      resolved facing/auto-target yaw for the frame;
//   7) movement context passes through to the canonical leg solver, which
//      owns running, grounded lunge footwork, and airborne poses;
//   8) the Debug tab exposes a Leg Bone Debug checkbox wired to the same
//      shared bone-guide toggle as the existing keyboard shortcut.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  const legApi = window.ProceduralLegAnimation;
  const composer = window.PlayerBodyTransformComposer;
  const THREE = window.THREE;
  if (!RS || !legApi || !composer || !THREE || window.__hobunjiDrunkProneCompositionBridgeInstalled) return;
  window.__hobunjiDrunkProneCompositionBridgeInstalled = true;

  const RUN_CHANNEL = 'run-lean'; // Separate additive player channel keeps running compatible with Footing sway.
  const DRUNK_CHANNEL = 'drunk';
  const DRUNK_PRIORITY = 200;
  const DRUNK_SAMPLE_MAX_AGE_MS = 500; // Match the composer's channel lease: only live gait frames can renew render-time sway.
  let lastDrunkPoseSyncReason = 'waiting'; // Existing mobile debug report explains why a render reused or rejected sway.
  let lastDrunkPoseSampleAgeMs = null; // Latest age measured at the renderer boundary, not a guessed animation progress value.
  const DEG = Math.PI / 180;
  const banditStateByLegHandle = new WeakMap(); // Binds a pre-entity bandit leg attachment to its entity once makeEntity finishes.
  const banditStates = new Set(); // Iterated only at render time to compose visible sway without touching persistent facing state.

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function installLegBoneDebugCheckbox() {
    if (document.getElementById('debugLegBonesCheckbox')) return true;
    const filterTabs = document.getElementById('debugFilterTabs');
    if (!filterTabs?.parentNode) return false;
    const row = document.createElement('label'); // Used as the mobile/desktop Debug-tab control for the shared procedural leg-bone guides.
    row.id = 'debugLegBonesRow';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:0 12px 7px;flex-shrink:0;font-size:11px;color:#d1d5db;cursor:pointer;user-select:none';
    row.innerHTML = '<input id="debugLegBonesCheckbox" type="checkbox" style="width:auto;margin:0"><span><b>Leg Bone Debug</b> — show hip, thigh, knee, and calf guides</span>';
    filterTabs.parentNode.insertBefore(row, filterTabs);
    const checkbox = row.querySelector('#debugLegBonesCheckbox');
    if (checkbox) {
      checkbox.checked = !!legApi.showBones;
      checkbox.addEventListener('change', () => legApi.setShowBones?.(checkbox.checked));
    }
    return true;
  }

  // Keep the new checkbox synchronized with the existing B-key shortcut and
  // any author/debug tool that calls the shared setShowBones API directly.
  if (typeof legApi.setShowBones === 'function' && !legApi.__debugCheckboxSyncInstalled) {
    const previousSetShowBones = legApi.setShowBones.bind(legApi);
    legApi.setShowBones = function setShowBonesWithDebugCheckbox(visible) {
      previousSetShowBones(visible);
      const checkbox = document.getElementById('debugLegBonesCheckbox');
      if (checkbox) checkbox.checked = !!legApi.showBones;
    };
    legApi.__debugCheckboxSyncInstalled = true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installLegBoneDebugCheckbox, { once: true });
  } else {
    installLegBoneDebugCheckbox();
  }

  function banditFootingLoss(entity) {
    const maxFooting = Number(entity?.maxFooting) || 0;
    if (!entity || entity.prone || !(maxFooting > 0)) return 0;
    const footing = Math.max(0, Number(entity.footing) || 0);
    return clamp01(1 - footing / maxFooting);
  }

  function clearBanditTransientMotion(entity) {
    if (!entity?.prone) return;
    entity.vx = 0;
    entity.vy = 0;
    entity.knockbackT = 0;
    entity.knockbackVX = 0;
    entity.knockbackVY = 0;
    entity._banditLunging = false;
    entity._banditLungeT = 0;
    entity._banditLungeDistancePx = 0;
    entity._banditLungeHitTest = null;
    if (entity._banditAction) entity._banditAction.cancel?.();
    entity._banditAction = null;
    entity._banditComboIndex = 0;
    entity.telegraphState = null;
  }

  function setForwardLeanQuaternion(target, pitch, yaw) {
    const halfSin = Math.sin(pitch * 0.5); // Rotates local up toward the actor's logical forward, independent of billboard yaw.
    return target.set(Math.cos(yaw) * halfSin, 0, -Math.sin(yaw) * halfSin, Math.cos(pitch * 0.5));
  }

  const playerRunTravel = { x: NaN, y: NaN, headingRad: null, source: 'uninitialized' }; // Remembers the preceding committed player position so raised ruin floors need not supply velocity.
  function resolvePlayerRunHeading(player, dt, gaitSpeed) {
    const x = Number(player?.x), y = Number(player?.y); // World X/Z are stored as player.x/y in gameplay pixel coordinates.
    const hasPosition = player && Number.isFinite(x) && Number.isFinite(y);
    const hasPrevious = Number.isFinite(playerRunTravel.x) && Number.isFinite(playerRunTravel.y);
    const dx = hasPosition && hasPrevious ? x - playerRunTravel.x : 0; // Used below to resolve the true travel bearing independent of physics velocity.
    const dy = hasPosition && hasPrevious ? y - playerRunTravel.y : 0; // Matches the gait sampler's committed player.y -> world Z convention.
    playerRunTravel.x = hasPosition ? x : NaN;
    playerRunTravel.y = hasPosition ? y : NaN;
    const moving = Number.isFinite(gaitSpeed) && gaitSpeed > 0.02; // The canonical leg solver already rejects blocked movement and teleport distances.
    if (moving && Number.isFinite(dt) && dt > 0 && Math.hypot(dx, dy) > 1e-4) {
      playerRunTravel.headingRad = Math.atan2(dx, dy);
      playerRunTravel.source = 'committed-travel';
      return playerRunTravel.headingRad;
    }
    const vx = Number(player?.vx) || 0, vy = Number(player?.vy) || 0; // Fallback for non-positional motion providers and the first gait frame.
    if (moving && Math.hypot(vx, vy) > 1e-4) {
      playerRunTravel.headingRad = Math.atan2(vx, vy);
      playerRunTravel.source = 'velocity-fallback';
      return playerRunTravel.headingRad;
    }
    playerRunTravel.headingRad = null; // An unknown heading must never silently become a fixed +Z world tilt.
    playerRunTravel.source = moving ? 'heading-unavailable' : 'idle-or-suppressed';
    return null;
  }

  function makeBanditSwayState(THREEArg, legsPivot) {
    const avatarRoot = legsPivot?.parent;
    if (!avatarRoot?.isObject3D || typeof THREEArg?.Group !== 'function') return null;

    let visualRoot = avatarRoot.children?.find?.(child => child?.name === 'bandit_body_sway_visual') || null;
    if (!visualRoot) {
      visualRoot = new THREEArg.Group();
      visualRoot.name = 'bandit_body_sway_visual';
      avatarRoot.add(visualRoot);
      const portraitPlanes = Array.from(avatarRoot.children || [])
        .filter(child => child?.name === 'bandit_front_plane' || child?.name === 'bandit_back_plane');
      for (const plane of portraitPlanes) visualRoot.add(plane);
    }

    // drunk-locomotion owns its own tracked body delta. Give it an off-scene
    // driver instead of the visible/facing root; the render hook copies that
    // delta onto visualRoot only for the actual draw, then restores identity.
    // This is the bandit equivalent of PlayerBodyTransformComposer's final-
    // render composition and prevents pitch/roll from feeding back into yaw.
    const driverRoot = new THREEArg.Group();
    driverRoot.name = 'bandit_sway_driver';
    return { entity: null, avatarRoot, visualRoot, driverRoot, handle: null,
      runLeanQuaternion: new THREEArg.Quaternion(), // Reused for heading-correct enemy lean during rendering.
    };
  }

  // Temporary Drunken Footing must not make a prone actor permanently unable
  // to refill enough Footing to stand. Permanent Shambling Footing is different:
  // its unshambled remainder IS the recovery target, so a 70%-Shambling Minion
  // only needs to refill the remaining 30%. Once prone clears, ordinary
  // Drunken + Shambling standing caps compose again.
  if (!RS.__proneIgnoresDrunkenFootingCapInstalled) {
    const previousGetEffectiveMax = RS.getEffectiveMax.bind(RS);
    RS.getEffectiveMax = function proneAwareEffectiveMax(entity, key) {
      if (key === 'footing' && entity?.prone) {
        const target = RS.getProneRecoveryFootingTarget?.(entity); // Central target preserves Shambling while intentionally ignoring transient Drunken Footing.
        if (Number.isFinite(Number(target))) return Math.max(0, Number(target));
        return Math.max(0, Number(entity.maxFooting) || 0); // Compatibility fallback for old resource registries.
      }
      return previousGetEffectiveMax(entity, key);
    };
    RS.__proneIgnoresDrunkenFootingCapInstalled = true;
  }

  // Wrap the common procedural-leg attach seam after drunk-locomotion has
  // already decorated it. Player attachments keep the prone suppression from
  // this bridge. Bandit legs are identifiable by their dedicated floor pivot;
  // their low-Footing provider drives the existing gait math, but body tilt is
  // sent to an off-scene driver and copied onto an isolated portrait child only
  // during render. The persistent bandit_avatar_group remains yaw-only.
  if (!legApi.__proneSuppressesDrunkGaitInstalled) {
    const previousAttach = legApi.attach.bind(legApi);
    legApi.attach = function proneAwareLegAttach(THREEArg, parent, options = {}) {
      const isBanditLegs = parent?.name === 'bandit_legs_pivot';
      const banditState = isBanditLegs ? makeBanditSwayState(THREEArg, parent) : null;
      const attachOptions = banditState
        ? {
            ...options,
            drunkLossProvider: () => banditFootingLoss(banditState.entity),
            drunkBodyRoot: banditState.driverRoot,
          }
        : options;
      const handle = previousAttach(THREEArg, parent, attachOptions);
      if (!handle) return handle;

      if (banditState) {
        banditState.handle = handle;
        banditStateByLegHandle.set(handle, banditState);
        banditStates.add(banditState);

        if (typeof handle.update === 'function') {
          const previousBanditUpdate = handle.update.bind(handle);
          handle.update = function proneExclusiveBanditLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose, motion) {
            const prone = !!banditState.entity?.prone;
            if (prone) clearBanditTransientMotion(banditState.entity);
            const effectiveSuppressed = !!suppressed || prone;
            const result = previousBanditUpdate(dt, speedWorldUnitsPerSecond, effectiveSuppressed, seatedPose, motion);
            return result;
          };
        }

        if (typeof handle.dispose === 'function') {
          const previousBanditDispose = handle.dispose.bind(handle);
          handle.dispose = function banditSwayAwareDispose() {
            banditStates.delete(banditState);
            banditState.visualRoot?.quaternion?.identity?.();
            return previousBanditDispose();
          };
        }
      }

      if (String(options.name || '').toLowerCase() !== 'player' || typeof handle.update !== 'function') return handle;
      const previousUpdate = handle.update.bind(handle);
      const runLeanQuaternion = new THREEArg.Quaternion(); // Reused to lean along actual world movement independently of portrait and weapon yaw.
      handle.update = function proneAwarePlayerLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose, motion) {
        const player = window.Combat?.deps?.player;
        const effectiveSuppressed = !!suppressed || !!player?.prone;
        const result = previousUpdate(dt, speedWorldUnitsPerSecond, effectiveSuppressed, seatedPose, motion);
        const pitch = Number(handle.getRunLean?.()) || 0; // Reads the gait's own blend without recomputing movement state.
        const heading = resolvePlayerRunHeading(player, dt, speedWorldUnitsPerSecond); // Raised ruin supports can move the player while native vx/vy stay at zero.
        if (pitch && Number.isFinite(heading) && !effectiveSuppressed && !seatedPose) composer.setChannel(RUN_CHANNEL, {
          priority: 100, mode: 'additive', space: 'world', leaseMs: 500, // Remove abandoned movement lean after interrupted gait updates.
          excludeExternalProviders: ['equippedTool', 'heldItem'], // Scene-level weapons/tools and player-nested bag items (including Kurraya) ignore movement lean.
          quaternion: setForwardLeanQuaternion(runLeanQuaternion, pitch, heading),
        });
        else composer.clearChannel(RUN_CHANNEL);
        return result;
      };
      const previousDispose = handle.dispose.bind(handle); // Clears the previous avatar's lean when equipment/species changes rebuild the rig.
      handle.dispose = function runLeanAwareDispose() {
        composer.clearChannel(RUN_CHANNEL);
        return previousDispose();
      };
      return handle;
    };
    legApi.__proneSuppressesDrunkGaitInstalled = true;
  }

  // combat-bandit.js loads before this bridge, and a bandit's portrait/legs are
  // constructed before ResourceSystem.initEntity creates its Footing fields.
  // Bind the finished entity back to the provider captured above.
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

  // updateHostiles already puts its prone branch ahead of knockback and the
  // bandit AI dispatch. Keep the bandit module safe on its own as well: if a
  // future caller invokes updateCombatAI directly while prone, it must not
  // restart a lunge/attack or consume old knockback alongside the knockdown.
  if (banditApi?.updateCombatAI && !banditApi.__proneMotionExclusiveInstalled) {
    const previousBanditCombatAI = banditApi.updateCombatAI.bind(banditApi);
    banditApi.updateCombatAI = function proneExclusiveBanditCombatAI(entity, ...args) {
      if (entity?.prone) {
        clearBanditTransientMotion(entity);
        return { aimAngle: Number(entity.facing) || 0, moving: false };
      }
      return previousBanditCombatAI(entity, ...args);
    };
    banditApi.__proneMotionExclusiveInstalled = true;
  }

  function prepareBanditSwayForRender(undo) {
    for (const state of Array.from(banditStates)) {
      const entity = state.entity;
      const visualRoot = state.visualRoot;
      if (!entity || !visualRoot?.quaternion) continue;

      visualRoot.quaternion.identity();
      if (entity.prone) {
        clearBanditTransientMotion(entity);
        continue;
      }

      const loss = banditFootingLoss(entity);
      const runLean = Number(state.handle?.getRunLean?.()) || 0; // Same run pitch used by the player, applied only to the enemy visual pivot.
      if (!(loss > 0) && !runLean) continue;

      // The sway transform moves the portrait geometry only. Do not lock a
      // pre-sway front/back choice or mutate material.side: the portrait's
      // existing THREE.FrontSide materials must keep ordinary backface culling
      // authoritative after the final transformed orientation is known.
      const previousRotation = visualRoot.rotation?.clone?.() || null;
      if (loss > 0) visualRoot.quaternion.copy(state.driverRoot.quaternion);
      if (runLean) {
        const headingYaw = Math.PI / 2 - (Number(entity.facing) || 0) - (Number(entity.def?.aimAngleOffset) || 0); // Same world heading convention as game.js's creature facing resolver.
        const localHeading = headingYaw - (Number(state.avatarRoot.rotation.y) || 0); // Facing-relative forward axis shared by torso lean and head counter-rotation.
        setForwardLeanQuaternion(state.runLeanQuaternion, runLean, localHeading);
        visualRoot.quaternion.multiply(state.runLeanQuaternion);
        window.NpcMovementHeadTarget?.applyHostileRunPitch?.(entity.avatarRef, runLean, localHeading, undo); // Counter-pitch only the head skins for this draw; existing combat head yaw remains untouched.
      }
      undo.push(() => {
        if (previousRotation && visualRoot.rotation?.copy) visualRoot.rotation.copy(previousRotation);
        else visualRoot.quaternion.identity();
      });
    }
  }

  function syncDrunkComposerChannel() {
    const player = window.Combat?.deps?.player;
    if (!player) {
      composer.clearChannel(DRUNK_CHANNEL);
      lastDrunkPoseSyncReason = 'no-player';
      lastDrunkPoseSampleAgeMs = null;
      return;
    }

    // Explicit pose owners always beat unsteady locomotion, including the
    // standing recovery arc where player.prone may already be false.
    if (player.prone || window.ImpactRagdollPlayback?.isActive?.()
        || window.CharacterActionLocks?.isLocked?.('player', 'pose')) {
      composer.clearChannel(RUN_CHANNEL);
      composer.clearChannel(DRUNK_CHANNEL);
      lastDrunkPoseSyncReason = 'body-pose-owned';
      lastDrunkPoseSampleAgeMs = null;
      return;
    }

    const sample = window.HobunjiDrunkWalk?.currentPlayerPoseSample?.(); // Direct live solver state; a full mobile diagnostics snapshot is too expensive to build per draw.
    const stamp = sample?.lastUpdatedAtMs;
    const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() : Date.now(); // Must use the same time origin as the gait writer and composer.
    const sampleAgeMs = typeof stamp === 'number' && Number.isFinite(stamp) ? nowMs - stamp : NaN;
    lastDrunkPoseSampleAgeMs = Number.isFinite(sampleAgeMs) ? sampleAgeMs : null;
    if (!Number.isFinite(sampleAgeMs) || sampleAgeMs < 0 || sampleAgeMs >= DRUNK_SAMPLE_MAX_AGE_MS) {
      composer.clearChannel(DRUNK_CHANNEL);
      lastDrunkPoseSyncReason = 'stale-gait-sample'; // Rendering without simulation must never keep renewing a stale pitch/roll.
      return;
    }

    const pitch = Number(sample.pitch); // Sampled gait pitch is already in radians, unlike the debug-only pitchDeg value.
    const roll = Number(sample.roll); // Sampled gait roll shares the composer's local rotation convention.
    if (!Number.isFinite(pitch) || !Number.isFinite(roll)) {
      composer.clearChannel(DRUNK_CHANNEL);
      lastDrunkPoseSyncReason = 'invalid-gait-sample';
      return;
    }

    // Gameplay has resolved this frame's base facing. Only the fresh gait's
    // pitch/roll may be republished at this boundary, never a cached debug pose.
    composer.setChannel(DRUNK_CHANNEL, {
      priority: DRUNK_PRIORITY,
      leaseMs: DRUNK_SAMPLE_MAX_AGE_MS,
      mode: 'additive',
      rotation: { pitch, roll },
    });
    lastDrunkPoseSyncReason = 'fresh-gait-sample';
  }

  // combat-config-loader makes r128 renderer instances delegate render() to
  // the prototype specifically so runtime composition modules can safely wrap
  // this seam. PlayerBodyTransformComposer is already installed when this file
  // loads. Bandit sway is also composed only for the real render call, then its
  // portrait child is restored so no tilt can contaminate next frame's yaw.
  const rendererProto = THREE.WebGLRenderer?.prototype;
  if (window.RenderHooks?.register) {
    // Registered ahead of the player-body composer (js/render-hooks.js ORDER) so
    // the drunk channel is published before the composer resolves this frame.
    window.RenderHooks.register({
      id: 'drunk-prone-composition',
      owner: 'drunk-prone-composition-bridge.js',
      order: window.RenderHooks.ORDER.DRUNK_PRONE,
      scope: 'frame',
      before: () => {
        syncDrunkComposerChannel();
        const undo = [];
        try {
          prepareBanditSwayForRender(undo);
        } catch (error) {
          for (let i = undo.length - 1; i >= 0; i--) undo[i](); // Never leave a partial sway behind.
          throw error;
        }
        return undo;
      },
      after: (_ctx, undo) => { for (let i = (undo?.length || 0) - 1; i >= 0; i--) undo[i](); },
    });
  } else if (rendererProto?.render && !rendererProto.__drunkProneCompositionRenderHook) {
    const previousRender = rendererProto.render;
    rendererProto.render = function drunkProneCompositionRender(scene, camera, ...rest) {
      syncDrunkComposerChannel();
      const undo = [];
      prepareBanditSwayForRender(undo);
      try {
        return previousRender.call(this, scene, camera, ...rest);
      } finally {
        for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      }
    };
    // held-object-render-order.js's internal depth-replay passes look for the
    // TRUE, undecorated render() by walking a chain of __hobunji*Original
    // markers (see its unwrapRendererRender) — without this marker those
    // replay passes still ran through this wrap (and, chained beneath it,
    // PlayerBodyTransformComposer's own wrap) with scene.autoUpdate forced
    // false around them, so a freshly-applied composed delta never
    // propagated into descendants' matrixWorld for those passes.
    rendererProto.render.__hobunjiDrunkProneCompositionOriginal = previousRender;
    rendererProto.__drunkProneCompositionRenderHook = true;
  }

  window.HobunjiDrunkProneCompositionBridge = Object.freeze({
    banditFootingLoss,
    prepareBanditSwayForRender, // Isolated authoring renderers use the same low-Footing/run/head composition seam.
    installLegBoneDebugCheckbox,
    getDebug() {
      const player = window.Combat?.deps?.player;
      return {
        lastChange: 'Movement-only NPC forward gaze and render-time enemy neck counter-pitch preserve level sightlines',
        runLeanSpace: 'world-movement',
        playerRunHeadingSource: playerRunTravel.source, // Also exposed by the existing mobile Dev Companion provider.
        playerRunHeadingDeg: Number.isFinite(playerRunTravel.headingRad) ? playerRunTravel.headingRad / DEG : null,
        playerProne: !!player?.prone,
        footing: Number(player?.footing) || 0,
        maxFooting: Number(player?.maxFooting) || 0,
        effectiveFootingMax: player ? Number(RS.getEffectiveMax(player, 'footing')) || 0 : 0,
        drunkenFooting: Number(player?.afflictions?.drunkenFooting) || 0,
        activeBanditSwayStates: banditStates.size,
        legBoneDebugVisible: !!legApi.showBones,
        portraitFaceCulling: 'material-frontside',
        forcedPortraitDoubleSide: false,
        drunkWalk: window.HobunjiDrunkWalk?.getDebug?.() || null,
        drunkPoseSyncReason: lastDrunkPoseSyncReason, // Visible on mobile when animation updates freeze but drawing continues.
        drunkPoseSampleAgeMs: lastDrunkPoseSampleAgeMs,
        composer: composer.getDebug?.() || null,
      };
    },
  });

  window.DevCompanion?.registerStateProvider?.('playerRunLean', () => {
    const player = window.Combat?.deps?.player; // Read on request so mobile diagnostics show the current traversal frame, not a startup snapshot.
    return {
      headingSource: playerRunTravel.source,
      headingDegrees: Number.isFinite(playerRunTravel.headingRad) ? playerRunTravel.headingRad / DEG : null,
      leanDegrees: (Number(composer.getPlayerLegHandle?.()?.getRunLean?.()) || 0) / DEG,
      nativeVX: Number(player?.vx) || 0,
      nativeVY: Number(player?.vy) || 0,
      inProne: !!player?.prone,
    };
  }); // Existing Dev Companion state report works on mobile without browser devtools.
})();
