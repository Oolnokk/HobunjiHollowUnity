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
//   7) the player blends from the ordinary procedural walk into a distinct
//      running gait at high movement speed, while non-animal combatants use
//      that run gait only during their active chase/combat state;
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

  const DRUNK_CHANNEL = 'drunk';
  const DRUNK_PRIORITY = 200;
  const DEG = Math.PI / 180;
  const RUN_STANCE_FRACTION = 0.44; // Below 0.5 creates a brief two-feet-off-ground overlap that visually distinguishes running from walking.
  const RUN_PLAYER_BLEND_START = 0.42; // Used to keep low analog-stick movement on the ordinary walk gait.
  const RUN_PLAYER_BLEND_FULL = 0.70; // Used to make normal full-speed player movement fully commit to the run gait.
  const RUN_MIN_CADENCE_HZ = 1.25; // Used to keep long-legged runners from turning a large stride into a slow-motion gait.
  const RUN_MAX_CADENCE_HZ = 3.4; // Used to keep short-legged runners from becoming a foot-blur at ordinary movement speeds.
  const banditStateByLegHandle = new WeakMap(); // Binds a pre-entity bandit leg attachment to its entity once makeEntity finishes.
  const banditStates = new Set(); // Iterated only at render time to compose visible sway without touching persistent facing state.

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function smoothstep01(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
  }

  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
  }

  function legPart(root, name) {
    return root?.getObjectByName?.(name) || null;
  }

  function runPoseAtPhase(phase, strideLength, liftHeight) {
    const cycle = ((phase % 1) + 1) % 1;
    if (cycle < RUN_STANCE_FRACTION) {
      const stanceT = cycle / RUN_STANCE_FRACTION;
      return { travel: strideLength * (0.5 - stanceT), lift: 0, swingWave: 0 };
    }
    const swingT = (cycle - RUN_STANCE_FRACTION) / Math.max(0.0001, 1 - RUN_STANCE_FRACTION);
    const eased = smoothstep01(swingT);
    const swingWave = Math.max(0, Math.sin(Math.PI * swingT));
    return {
      travel: -strideLength / 2 + strideLength * eased,
      lift: Math.pow(swingWave, 1.15) * liftHeight,
      swingWave,
    };
  }

  function syncBoneGuideLength(parent, length) {
    for (const child of Array.from(parent?.children || [])) {
      if (!child?.isMesh || child.geometry?.type !== 'CylinderGeometry') continue;
      child.scale.y = length;
      child.position.y = -length * 0.5;
    }
  }

  function makeRunGaitController(THREEArg, handle, mode) {
    if (!handle?.group || !window.LegBones?.solveTwoBoneLeg) return null;
    const readStandingDebug = typeof handle.getStandingPoseDebug === 'function'
      ? handle.getStandingPoseDebug.bind(handle)
      : null;
    const root = handle.group;
    const state = {
      mode, // Used by the mobile-readable standing-pose diagnostic to distinguish player-speed and hostile-combat running.
      phase: 0,
      blend: 0,
      stride: 0,
      cadenceHz: 0,
      speed: 0,
      active: false,
      currentFoot: new THREEArg.Vector3(),
      effectiveHip: new THREEArg.Vector3(),
      runTarget: new THREEArg.Vector3(),
      blendedTarget: new THREEArg.Vector3(),
    };
    const referenceSpeed = Math.max(0.1,
      Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.referenceSpeedWorldUnitsPerSecond) || 4.3);

    function applySide(side, pose, legLength, contactY) {
      const hip = legPart(root, `${side}_hip`);
      const thigh = legPart(root, `${side}_thigh`);
      const calf = legPart(root, `${side}_calf`);
      const foot = legPart(root, `${side}_foot`);
      if (!hip || !thigh || !calf || !foot) return;

      // Read the just-resolved ordinary gait target after the core + drunken
      // layer have both run, then blend toward the separate run target. This
      // gives walk<->run transitions instead of snapping between two solvers.
      root.updateMatrixWorld?.(true);
      foot.getWorldPosition(state.currentFoot);
      root.worldToLocal(state.currentFoot);
      state.effectiveHip.copy(hip.position).add(thigh.position); // Preserves low-Footing/drunk thigh offsets already composed by drunk-locomotion.js.
      state.runTarget.set(
        state.effectiveHip.x,
        contactY + pose.lift,
        state.effectiveHip.z + pose.travel,
      );
      state.blendedTarget.copy(state.currentFoot).lerp(state.runTarget, state.blend);

      // A run needs visibly flexed knees instead of merely stretching the
      // existing straight-leg walk farther. Flex peaks through the swing and
      // eases almost straight during the planted phase.
      const bendDegX = -(5 + 23 * pose.swingWave) * state.blend;
      const solved = window.LegBones.solveTwoBoneLeg(THREEArg, {
        hip: state.effectiveHip,
        foot: state.blendedTarget,
        bendDegX,
        bendDegZ: 0,
      });
      thigh.quaternion.copy(solved.thighQuaternion);
      calf.position.set(0, -solved.thighLength, 0);
      calf.quaternion.copy(solved.calfLocalQuaternion);
      foot.position.set(0, -solved.calfLength, 0);
      // Do NOT touch foot.quaternion here. drunk-locomotion.js has already
      // composed its tracked foot twist onto it this frame; preserving that
      // keeps running compatible with low-Footing/drunken gait effects.
      syncBoneGuideLength(thigh, solved.thighLength);
      syncBoneGuideLength(calf, solved.calfLength);
    }

    function update(dt, speedWorldUnitsPerSecond, requestedRun, suppressed, seatedPose) {
      const speed = Math.max(0, Number(speedWorldUnitsPerSecond) || 0);
      const shouldRun = !suppressed && !seatedPose && speed > 0.02 ? clamp01(requestedRun) : 0;
      state.blend = damp(state.blend, shouldRun, shouldRun > state.blend ? 10 : 14, dt);
      state.speed = speed;
      state.active = state.blend > 0.01;
      if (!state.active) {
        state.stride = 0;
        state.cadenceHz = 0;
        return;
      }

      const debug = readStandingDebug?.();
      const leftContactY = Number(debug?.left?.contactY);
      const rightContactY = Number(debug?.right?.contactY);
      const debugLegLength = Number(debug?.gait?.legLength);
      const fallbackLegLength = Number.isFinite(Number(debug?.posteriorY))
        ? Math.max(0.001, Number(debug.posteriorY) - (Number.isFinite(leftContactY) ? leftContactY : 0))
        : 0.30;
      const legLength = Math.max(0.001, Number.isFinite(debugLegLength) ? debugLegLength : fallbackLegLength);
      const speedRatio = clamp01(speed / referenceSpeed);
      const strideLength = legLength * (1.30 + 0.60 * Math.sqrt(speedRatio)); // Long legs gain proportionally more ground per running step.
      const liftHeight = legLength * (0.14 + 0.11 * speedRatio); // Run-specific knee/foot clearance, deliberately larger than the walk lift.
      const cadenceHz = Math.max(RUN_MIN_CADENCE_HZ, Math.min(RUN_MAX_CADENCE_HZ,
        (speed * 0.52) / Math.max(0.001, strideLength)));
      state.stride = strideLength;
      state.cadenceHz = cadenceHz;
      if (dt > 0) state.phase = (state.phase + dt * cadenceHz) % 1;

      const leftPose = runPoseAtPhase(state.phase, strideLength, liftHeight);
      const rightPose = runPoseAtPhase(state.phase + 0.5, strideLength, liftHeight);
      applySide('left', leftPose, legLength, Number.isFinite(leftContactY) ? leftContactY : 0);
      applySide('right', rightPose, legLength, Number.isFinite(rightContactY) ? rightContactY : 0);
    }

    if (readStandingDebug) {
      handle.getStandingPoseDebug = function standingPoseWithRunDebug() {
        const debug = readStandingDebug() || {};
        return {
          ...debug,
          run: {
            mode: state.mode,
            active: state.active,
            blend: state.blend,
            stride: state.stride,
            cadenceHz: state.cadenceHz,
            speed: state.speed,
            stanceFraction: RUN_STANCE_FRACTION,
          },
        };
      };
    }
    return { update, state };
  }

  function playerRunBlend(speedWorldUnitsPerSecond) {
    const referenceSpeed = Math.max(0.1,
      Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.referenceSpeedWorldUnitsPerSecond) || 4.3);
    const ratio = Math.max(0, Number(speedWorldUnitsPerSecond) || 0) / referenceSpeed;
    return smoothstep01((ratio - RUN_PLAYER_BLEND_START) / Math.max(0.001, RUN_PLAYER_BLEND_FULL - RUN_PLAYER_BLEND_START));
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
    return { entity: null, avatarRoot, visualRoot, driverRoot, handle: null };
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
        const runGait = makeRunGaitController(THREEArg, handle, 'combat-chase'); // Used only while this humanoid hostile is actively chasing/fighting.

        if (typeof handle.update === 'function') {
          const previousBanditUpdate = handle.update.bind(handle);
          handle.update = function proneExclusiveBanditLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
            const prone = !!banditState.entity?.prone;
            if (prone) clearBanditTransientMotion(banditState.entity);
            const effectiveSuppressed = !!suppressed || prone;
            const result = previousBanditUpdate(dt, speedWorldUnitsPerSecond, effectiveSuppressed, seatedPose);
            const activelyInCombat = banditState.entity?.state === 'chase'; // BanditCombat uses chase as the exact actively-engaged state; idle/return/patrol remain ordinary walks.
            runGait?.update(dt, speedWorldUnitsPerSecond, activelyInCombat ? 1 : 0, effectiveSuppressed, seatedPose);
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
      const runGait = makeRunGaitController(THREEArg, handle, 'player-speed'); // Used to blend analog walking into the player's normal full-speed running gait.
      handle.update = function proneAwarePlayerLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
        const player = window.Combat?.deps?.player;
        const effectiveSuppressed = !!suppressed || !!player?.prone;
        const result = previousUpdate(dt, speedWorldUnitsPerSecond, effectiveSuppressed, seatedPose);
        runGait?.update(dt, speedWorldUnitsPerSecond, playerRunBlend(speedWorldUnitsPerSecond), effectiveSuppressed, seatedPose);
        return result;
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
      if (!(loss > 0)) continue;

      // The sway transform moves the portrait geometry only. Do not lock a
      // pre-sway front/back choice or mutate material.side: the portrait's
      // existing THREE.FrontSide materials must keep ordinary backface culling
      // authoritative after the final transformed orientation is known.
      const previousRotation = visualRoot.rotation?.clone?.() || null;
      visualRoot.quaternion.copy(state.driverRoot.quaternion);
      undo.push(() => {
        if (previousRotation && visualRoot.rotation?.copy) visualRoot.rotation.copy(previousRotation);
        else visualRoot.quaternion.identity();
      });
    }
  }

  function syncDrunkComposerChannel() {
    const player = window.Combat?.deps?.player;
    if (!player) return;

    // Prone/knockdown playback owns the pose completely. Removing only the
    // unsteady-walk channel leaves the ragdoll/recovery channel and every other
    // body contribution untouched. Stored drunkenness remains on the entity.
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
    // the low-Footing lean; it can only rotate the already-leaning body to face
    // the target. Attack/ragdoll channels continue to compose by priority.
    composer.setChannel(DRUNK_CHANNEL, {
      priority: DRUNK_PRIORITY,
      mode: 'additive',
      rotation: { pitch, roll },
    });
  }

  // combat-config-loader makes r128 renderer instances delegate render() to
  // the prototype specifically so runtime composition modules can safely wrap
  // this seam. PlayerBodyTransformComposer is already installed when this file
  // loads. Bandit sway is also composed only for the real render call, then its
  // portrait child is restored so no tilt can contaminate next frame's yaw.
  const rendererProto = THREE.WebGLRenderer?.prototype;
  if (rendererProto?.render && !rendererProto.__drunkProneCompositionRenderHook) {
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
    installLegBoneDebugCheckbox,
    getDebug() {
      const player = window.Combat?.deps?.player;
      return {
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
        composer: composer.getDebug?.() || null,
      };
    },
  });
})();
