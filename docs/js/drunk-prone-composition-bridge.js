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
//      resolved facing/auto-target yaw for the frame.
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
  const banditStates = new Set(); // Iterated only at render time to compose visible sway without touching persistent facing state.

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
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

        if (typeof handle.update === 'function') {
          const previousBanditUpdate = handle.update.bind(handle);
          handle.update = function proneExclusiveBanditLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
            const prone = !!banditState.entity?.prone;
            if (prone) clearBanditTransientMotion(banditState.entity);
            return previousBanditUpdate(dt, speedWorldUnitsPerSecond, !!suppressed || prone, seatedPose);
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

  function firstRenderableMesh(root) {
    if (!root?.isObject3D) return null;
    let found = null;
    root.traverse?.(object => {
      if (!found && object?.isMesh) found = object;
    });
    return found;
  }

  function preserveBanditFacingSide(state, camera, undo) {
    const entity = state.entity;
    const visualRoot = state.visualRoot;
    const avatarRoot = state.avatarRoot;
    if (!entity || !visualRoot?.quaternion || !avatarRoot?.isObject3D || !camera?.isObject3D) return;

    // The visible sway root is normally identity outside the render call. Base
    // front/back choice is therefore measured from the already-resolved hostile
    // yaw/dead-zone state, before low-Footing pitch/roll can cross a culling
    // boundary. This mirrors the player's preserveFacingSide render behavior.
    visualRoot.quaternion.identity();
    avatarRoot.updateWorldMatrix?.(true, true);
    camera.updateWorldMatrix?.(true, false);

    const frontPlane = entity.avatarRef?.frontPlane;
    const backPlane = entity.avatarRef?.backPlane;
    const frontMesh = firstRenderableMesh(frontPlane);
    if (!frontPlane || !backPlane || !frontMesh) return;

    const cameraWorldPosition = camera.getWorldPosition(new THREE.Vector3());
    const objectWorldPosition = frontMesh.getWorldPosition(new THREE.Vector3());
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(frontMesh.matrixWorld);
    const frontNormal = new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize();
    const viewDirection = cameraWorldPosition.clone().sub(objectWorldPosition).normalize();
    const showFront = frontNormal.dot(viewDirection) >= 0;
    const oldFrontVisible = frontPlane.visible;
    const oldBackVisible = backPlane.visible;
    const selectedPlane = showFront ? frontPlane : backPlane;
    const selectedMesh = firstRenderableMesh(selectedPlane);
    const selectedMaterials = Array.isArray(selectedMesh?.material)
      ? selectedMesh.material
      : (selectedMesh?.material ? [selectedMesh.material] : []);
    const oldSides = selectedMaterials.map(material => material.side);

    frontPlane.visible = showFront;
    backPlane.visible = !showFront;
    for (const material of selectedMaterials) material.side = THREE.DoubleSide;

    undo.push(() => {
      frontPlane.visible = oldFrontVisible;
      backPlane.visible = oldBackVisible;
      selectedMaterials.forEach((material, index) => { material.side = oldSides[index]; });
    });
  }

  function prepareBanditSwayForRender(camera, undo) {
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

      preserveBanditFacingSide(state, camera, undo);
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
      preserveFacingSide: true,
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
      prepareBanditSwayForRender(camera, undo);
      try {
        return previousRender.call(this, scene, camera, ...rest);
      } finally {
        for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      }
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
        activeBanditSwayStates: banditStates.size,
        drunkWalk: window.HobunjiDrunkWalk?.getDebug?.() || null,
        composer: composer.getDebug?.() || null,
      };
    },
  });
})();