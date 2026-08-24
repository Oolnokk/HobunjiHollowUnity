// Central composition point for the local player's rendered body transform.
//
// Gameplay-facing state (player.angle, aim cones, movement direction, mount
// steering, etc.) deliberately stays outside this module. game.js can continue
// resolving its existing base playerMesh transform (dead-zone facing, authored
// attack/tool body yaw, movement bob, and other legacy base-pose writers); this
// composer owns only the FINAL visual-layer delta applied after those systems
// have finished.
//
// New systems should contribute named channels instead of writing shared body
// rotations directly. Channels are ordered by priority and can be additive or
// overriding. External body-bound visuals (tool holder, shoulder pets, future
// attachments) register providers rather than reaching into this renderer.
(() => {
  'use strict';

  const THREE = window.THREE;
  const legApi = window.ProceduralLegAnimation;
  if (!THREE || !legApi?.attach || window.PlayerBodyTransformComposer) return;

  const channels = new Map();
  const externalRootProviders = new Map();
  const PLAYER_HEAD_MAX_YAW_DEG = 65; // Shared body-relative neck limit used by ordinary aim, animation-composed body yaw, and seated camera look.
  const PLAYER_HEAD_MAX_YAW_RAD = THREE.MathUtils.degToRad(PLAYER_HEAD_MAX_YAW_DEG); // Used by applyPlayerNeckYawLimit for range checks and the final hard clamp.
  let playerMesh = null;
  let playerLegRoot = null;
  let playerPosteriorY = 0;
  let playerNeckJointCache = null; // Cached current player neck bone; invalidated when the rig/avatar is replaced so rebuilds retarget automatically.
  let renderSequence = 0; // Incremented for Pixel Probe correlation across real render calls.
  let lastRenderDebug = null; // Read by getDebug() so mobile reports can inspect temporary render state after restoration.
  let pendingCapture = null; // One-shot callback fired mid-render, after the temporary delta lands but before it's undone — see captureNextRenderTransforms().

  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  // Compose orientation strictly from the quaternion hierarchy. Three.js's
  // getWorldQuaternion() decomposes matrixWorld; when any ancestor has a
  // negative scale (the PNG-facing mirror), that reflection can be folded into
  // the returned quaternion as a spurious 180-degree turn. Position conversion
  // should still use matrixWorld so mirrored offsets remain correct, but facing
  // and body-channel rotation must never derive from scale.
  function hierarchyWorldQuaternion(node, target = new THREE.Quaternion()) {
    const chain = []; // Used below to apply local quaternions parent-first.
    let cursor = node; // Walks from the requested node to the scene root.
    while (cursor?.isObject3D) {
      chain.push(cursor);
      cursor = cursor.parent;
    }
    target.identity();
    for (let i = chain.length - 1; i >= 0; i--) target.multiply(chain[i].quaternion);
    return target.normalize();
  }

  function quaternionEulerDegrees(quaternion) {
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ'); // Converted below for compact probe output.
    const degrees = 180 / Math.PI; // Used for all three reported composer axes.
    return { pitch: euler.x * degrees, yaw: euler.y * degrees, roll: euler.z * degrees };
  }

  function hasRenderableDescendant(root) {
    if (!root?.isObject3D) return false;
    if (root.isMesh || root.isSprite || root.isLine || root.isPoints) return true;
    let found = false;
    root.traverse?.(obj => {
      if (!found && obj !== root && (obj.isMesh || obj.isSprite || obj.isLine || obj.isPoints)) found = true;
    });
    return found;
  }

  function isAvatarBodyRoot(child) {
    if (!child?.isObject3D) return false;
    const name = String(child.name || '').toLowerCase();
    const role = String(child.userData?.modelRole || '').toLowerCase();
    const pipeline = String(child.userData?.pngPipelineMode || '').toLowerCase();
    return role === 'temporary-npc-demo-model'
      || role === 'player'
      || role === 'player-avatar'
      || (pipeline === 'single' && role.includes('demo-model'))
      || name.includes('player_avatar')
      || name.includes('player_portrait')
      || name.includes('temporary_npc_portrait_model')
      || name.includes('hat_xray')
      || name.includes('occlusion_ghost');
  }

  function isDescendantOf(node, ancestor) {
    if (!node?.isObject3D || !ancestor?.isObject3D) return false;
    let cursor = node.parent;
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  function wrapSignedAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function currentPlayerNeckJoint() {
    if (playerNeckJointCache?.isBone && isDescendantOf(playerNeckJointCache, playerMesh)) return playerNeckJointCache;
    playerNeckJointCache = null;
    playerMesh?.traverse?.(object => {
      if (playerNeckJointCache) return;
      const rig = object?.userData?.neckRig; // Used here to find the current rebuilt player portrait without depending on generated bone names.
      if (rig?.available && rig.neckJoint?.isBone) playerNeckJointCache = rig.neckJoint;
    });
    return playerNeckJointCache;
  }

  // game.js authors the player's local neck yaw before render, already
  // subtracting PlayerBodyTransformComposer's pending body-yaw channels. That
  // makes this renderer boundary the one place where the REAL body-relative
  // result can be physically limited after ordinary aiming, combat/idle body
  // animation, and seated free-look have all contributed.
  //
  // Seated free-look is special: game.js's raw yaw points the head TOWARD the
  // camera because the camera sits at activeCameraAzimuthRad(). Once that
  // direction is outside the neck range, adding PI reverses it to the
  // direction the camera itself is FACING. The same ±65° hard limit is then
  // applied to that fallback as well, so neither branch can overtwist.
  function applyPlayerNeckYawLimit(renderDebug) {
    const neckJoint = currentPlayerNeckJoint();
    if (!neckJoint) return;
    const rawYaw = finite(neckJoint.rotation.y); // Game-authored local neck yaw inspected below before the visual physical limit is applied.
    const sitState = window.__hobunjiFurnitureDebug?.sitInteraction; // Used only to distinguish the seated camera-look fallback from normal aim clamping.
    const seated = sitState?.phase === 'active';
    const outsideLookRange = seated && Math.abs(rawYaw) > PLAYER_HEAD_MAX_YAW_RAD; // Used below to switch from looking at the camera to following its facing direction.
    const requestedYaw = outsideLookRange ? wrapSignedAngle(rawYaw + Math.PI) : rawYaw; // Seated out-of-range target is the camera-facing direction, not the camera position.
    const renderedYaw = THREE.MathUtils.clamp(requestedYaw, -PLAYER_HEAD_MAX_YAW_RAD, PLAYER_HEAD_MAX_YAW_RAD); // Final physical limit shared by every head-turn source.
    neckJoint.rotation.y = renderedYaw;
    renderDebug.neckYaw = {
      rawDeg: THREE.MathUtils.radToDeg(rawYaw),
      requestedDeg: THREE.MathUtils.radToDeg(requestedYaw),
      renderedDeg: THREE.MathUtils.radToDeg(renderedYaw),
      maxDeg: PLAYER_HEAD_MAX_YAW_DEG,
      seated,
      usedCameraFacingFallback: outsideLookRange,
    };
  }

  // Diagnostics only. Runtime composition deliberately does not depend on
  // successfully identifying the current PNG child anymore: the player rig
  // root is the same transform that already carries the game's ordinary walk
  // bob/facing, so a render-only delta on that root necessarily reaches the
  // current body PNG, procedural legs, and any in-rig held visuals together.
  function discoverAvatarBodyRoots() {
    if (!playerMesh?.isObject3D) return [];
    const candidates = [];
    playerMesh.traverse?.(obj => {
      if (!obj?.isObject3D || obj === playerMesh || obj === playerLegRoot) return;
      if (playerLegRoot && isDescendantOf(obj, playerLegRoot)) return;
      if (isAvatarBodyRoot(obj) && hasRenderableDescendant(obj)) candidates.push(obj);
    });

    return candidates.filter(candidate => !candidates.some(other =>
      other !== candidate && isDescendantOf(candidate, other)));
  }

  function isHeldVisualRoot(child) {
    if (!child?.isObject3D || child === playerLegRoot || isAvatarBodyRoot(child)) return false;
    return child.type === 'Group'
      && child.visible !== false
      && !String(child.name || '').trim()
      && hasRenderableDescendant(child);
  }

  // The whole player rig is now the primary owned root. Previously the composer
  // tried to rediscover and rotate individual PNG/leg children. That made the
  // procedural feet visibly react while a rebuilt or differently-named body PNG
  // could remain rigid. Applying the channel to playerMesh itself at the final
  // renderer boundary removes that fragile child-identification dependency.
  //
  // Providers are still needed for visuals that intentionally live OUTSIDE the
  // player rig (for example a shoulder-pet root parented directly to the scene).
  // Descendants of playerMesh are skipped because they already inherit its delta.
  function currentOwnedRoots() {
    const roots = [];
    const add = root => {
      if (!root?.isObject3D || root.visible === false || roots.includes(root)) return;
      if (root !== playerMesh && isDescendantOf(root, playerMesh)) return;
      if (roots.some(existing => isDescendantOf(root, existing))) return;
      for (let i = roots.length - 1; i >= 0; i--) {
        if (isDescendantOf(roots[i], root)) roots.splice(i, 1);
      }
      roots.push(root);
    };

    add(playerMesh);
    for (const provider of externalRootProviders.values()) {
      let supplied = null;
      try { supplied = provider?.(); } catch (_) { supplied = null; }
      const list = Array.isArray(supplied) || supplied instanceof Set ? Array.from(supplied) : [supplied];
      for (const root of list) add(root);
    }
    return roots;
  }

  function channelQuaternion(channel) {
    if (channel?.quaternion?.isQuaternion) return channel.quaternion.clone();
    const rotation = channel?.rotation || {};
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      finite(rotation.pitch ?? rotation.x),
      finite(rotation.yaw ?? rotation.y),
      finite(rotation.roll ?? rotation.z),
      channel?.order || 'YXZ'
    ));
  }

  function resolveDelta() {
    const ordered = Array.from(channels.entries())
      .filter(([, channel]) => channel && channel.enabled !== false)
      .sort((a, b) => finite(a[1].priority) - finite(b[1].priority) || a[0].localeCompare(b[0]));

    const rotation = new THREE.Quaternion();
    const translation = new THREE.Vector3();
    const applied = [];

    for (const [name, channel] of ordered) {
      const q = channelQuaternion(channel);
      const t = channel.translation || channel.position || null;
      if (channel.mode === 'override') rotation.copy(q);
      else rotation.multiply(q);

      if (t) {
        const next = new THREE.Vector3(finite(t.x), finite(t.y), finite(t.z));
        if (channel.translationMode === 'override') translation.copy(next);
        else translation.add(next);
      }
      applied.push(name);
    }
    return { rotation, translation, applied };
  }

  function applyWorldDelta(root, pivotWorld, worldRotation, worldTranslation, undo) {
    if (!root?.isObject3D || root.visible === false) return;
    root.updateWorldMatrix?.(true, false);

    const oldPosition = root.position.clone();
    const oldRotation = root.rotation.clone(); // Restored after render so Three cannot rewrite a >90° yaw into equivalent 180-degree X/Z Euler angles.
    const worldPosition = root.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = hierarchyWorldQuaternion(root);

    const nextWorldPosition = pivotWorld.clone()
      .add(worldPosition.sub(pivotWorld).applyQuaternion(worldRotation))
      .add(worldTranslation);
    const nextWorldQuaternion = worldRotation.clone().multiply(worldQuaternion);

    if (root.parent?.isObject3D) {
      root.parent.updateWorldMatrix?.(true, false);
      const parentWorldQuaternion = hierarchyWorldQuaternion(root.parent);
      root.position.copy(root.parent.worldToLocal(nextWorldPosition.clone()));
      root.quaternion.copy(parentWorldQuaternion.invert().multiply(nextWorldQuaternion));
    } else {
      root.position.copy(nextWorldPosition);
      root.quaternion.copy(nextWorldQuaternion);
    }

    undo.push(() => {
      root.position.copy(oldPosition);
      root.rotation.copy(oldRotation);
    });
  }

  function setChannel(name, contribution = {}) {
    if (!name) return false;
    const stored = {
      priority: finite(contribution.priority),
      mode: contribution.mode === 'override' ? 'override' : 'additive',
      translationMode: contribution.translationMode === 'override' ? 'override' : 'additive',
      enabled: contribution.enabled !== false,
      order: contribution.order || 'YXZ',
      rotation: contribution.rotation ? { ...contribution.rotation } : undefined,
      quaternion: contribution.quaternion?.isQuaternion ? contribution.quaternion.clone() : undefined,
      translation: contribution.translation ? { ...contribution.translation } : contribution.position ? { ...contribution.position } : undefined,
    };
    channels.set(String(name), stored);
    return true;
  }

  function clearChannel(name) {
    return channels.delete(String(name));
  }

  function clearAllChannels() {
    channels.clear();
  }

  function registerExternalRootProvider(name, provider) {
    if (!name || typeof provider !== 'function') return () => {};
    externalRootProviders.set(String(name), provider);
    return () => externalRootProviders.delete(String(name));
  }

  function registerPlayerRig(parent, handle) {
    playerMesh = parent?.isObject3D ? parent : null;
    playerLegRoot = handle?.group?.isObject3D ? handle.group : null;
    playerPosteriorY = finite(handle?.standingPosteriorY);
    playerNeckJointCache = null;
  }

  function unregisterPlayerRig(parent, handle) {
    if (playerMesh !== parent) return;
    if (handle?.group && playerLegRoot !== handle.group) return;
    playerMesh = null;
    playerLegRoot = null;
    playerPosteriorY = 0;
    playerNeckJointCache = null;
    clearAllChannels();
  }

  // Observe the existing rig constructor rather than requiring game.js to know
  // about the composer. The render-time transform targets the already-resolved
  // rig root, so appearance/equipment rebuilds do not require retargeting.
  const previousAttach = legApi.attach.bind(legApi);
  legApi.attach = function composerAwareLegAttach(THREEArg, parent, options = {}) {
    const handle = previousAttach(THREEArg, parent, options);
    if (String(options.name || '').toLowerCase() !== 'player' || !handle) return handle;
    registerPlayerRig(parent, handle);
    const originalDispose = typeof handle.dispose === 'function' ? handle.dispose.bind(handle) : null;
    handle.dispose = function composerAwareLegDispose() {
      unregisterPlayerRig(parent, handle);
      return originalDispose?.();
    };
    return handle;
  };
  legApi.__playerBodyTransformComposerWrapped = true;

  if (THREE.WebGLRenderer && !THREE.WebGLRenderer.prototype.__playerBodyTransformComposerRenderHook) {
    const proto = THREE.WebGLRenderer.prototype;
    const originalRender = proto.render;
    proto.render = function composedPlayerBodyRender(scene, camera) {
      const undo = [];
      const renderDebug = {
        sequence: ++renderSequence,
        timestampMs: performance.now(),
        appliedOrder: [],
        portraitFaceCulling: 'material-frontside',
        forcedPortraitDoubleSide: false,
        baseWorldEulerDeg: null,
        composedWorldEulerDeg: null,
        neckYaw: null,
      }; // Persisted below before temporary transforms are restored.
      if (playerMesh) {
        applyPlayerNeckYawLimit(renderDebug);
        const delta = resolveDelta();
        renderDebug.appliedOrder = delta.applied.slice();
        const rotationMagnitude = Math.abs(delta.rotation.x) + Math.abs(delta.rotation.y) + Math.abs(delta.rotation.z);
        const translationMagnitude = delta.translation.lengthSq();
        if (rotationMagnitude > 1e-8 || translationMagnitude > 1e-12) {
          // game.js has already resolved facing, attack/tool poses, and its
          // ordinary movement bob by this point. Convert the local composer
          // delta into world space from that FINAL base transform, pivot around
          // the standing posterior/hip point, render, then restore immediately.
          // Portrait material sides are deliberately untouched here: the
          // transformed geometry and its existing THREE.FrontSide materials
          // remain the authority on whether front or rear artwork is visible.
          playerMesh.updateWorldMatrix?.(true, false);
          const baseWorldQuaternion = hierarchyWorldQuaternion(playerMesh);
          renderDebug.baseWorldEulerDeg = quaternionEulerDegrees(baseWorldQuaternion);
          const worldRotation = baseWorldQuaternion.clone()
            .multiply(delta.rotation)
            .multiply(baseWorldQuaternion.clone().invert());
          const worldTranslation = delta.translation.clone().applyQuaternion(baseWorldQuaternion);
          const pivotWorld = playerMesh.localToWorld(new THREE.Vector3(0, playerPosteriorY, 0));
          for (const root of currentOwnedRoots()) {
            applyWorldDelta(root, pivotWorld, worldRotation, worldTranslation, undo);
          }
          renderDebug.composedWorldEulerDeg = quaternionEulerDegrees(hierarchyWorldQuaternion(playerMesh));
        }
      }

      lastRenderDebug = renderDebug;

      try {
        const result = originalRender.call(this, scene, camera);
        // Fires after the real render (so anything that re-syncs itself off
        // playerMesh/toolHolder inside that render, e.g. the procedural hand
        // sockets' onBeforeRender sentinel, has already used THIS frame's
        // composed transform) but before the delta below is undone — the one
        // point where playerMesh, toolHolder, and the hand sockets are all
        // simultaneously in the exact state actually shown on screen.
        if (pendingCapture) {
          const callback = pendingCapture;
          pendingCapture = null;
          try { callback(); } catch (_) { /* diagnostic-only; must never break rendering */ }
        }
        return result;
      }
      finally {
        for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      }
    };
    // held-object-render-order.js's internal depth-replay passes need the
    // TRUE, undecorated render() — no visual-delta wrapper applied — and
    // find it by walking a chain of __hobunji*Original markers left by each
    // wrapper (see its unwrapRendererRender). Without this marker on this
    // wrap specifically, that unwrap stopped one link too early and those
    // replay passes still ran this wrap's full apply-delta/render/undo cycle
    // (with scene.autoUpdate forced false around them, so the freshly-applied
    // delta never propagated into matrixWorld for that one call) instead of
    // the plain pass-through the depth-replay design intends.
    proto.render.__hobunjiPlayerBodyComposerOriginal = originalRender;
    proto.__playerBodyTransformComposerRenderHook = true;
  }

  // One-shot: fires `callback` synchronously mid-render on the next real
  // frame, at the single point where every composer-owned root (playerMesh,
  // toolHolder, shoulder-pet roots, ...) reflects its true as-rendered
  // transform rather than the resting state a caller would see between
  // frames. Intended for diagnostics (e.g. a transform dump) that need a
  // self-consistent snapshot instead of comparing some objects mid-tilt
  // against others already restored. Returns false if a capture is already
  // pending (last-writer-wins would silently drop the earlier caller).
  function captureNextRenderTransforms(callback) {
    if (typeof callback !== 'function' || pendingCapture) return false;
    pendingCapture = callback;
    return true;
  }

  // The extra yaw (radians) the active channels will add to playerMesh at the
  // next render, without waiting for one. Channels like weapon-idle-stance-
  // body-yaw only ever reach playerMesh through this composer's render-time
  // world delta (see the module comment above) — anything that needs to
  // reason about the body's yaw ahead of render (e.g. game.js's
  // updatePlayerHeadAim, which counter-rotates the neck so the head keeps
  // its own world yaw locked to the aim direction) must add this in, or it
  // ends up countering only playerMesh.rotation.y's pre-delta resting yaw
  // and the head renders off-target by whatever yaw a channel contributes.
  function resolvedYawDeltaRad() {
    return new THREE.Euler().setFromQuaternion(resolveDelta().rotation, 'YXZ').y;
  }

  window.PlayerBodyTransformComposer = {
    setChannel,
    clearChannel,
    clearAllChannels,
    registerExternalRootProvider,
    captureNextRenderTransforms,
    resolvedYawDeltaRad,
    getPlayerMesh: () => playerMesh,
    getVisualRoots: () => currentOwnedRoots().slice(),
    hasVisibleHeldItem: () => !!playerMesh && Array.from(playerMesh.children || []).some(isHeldVisualRoot),
    getDebug() {
      const delta = resolveDelta();
      const neckJoint = currentPlayerNeckJoint(); // Used below so the mobile/debug report can show the currently clamped local neck yaw without console access.
      return {
        playerAttached: !!playerMesh,
        posteriorY: playerPosteriorY,
        headMaxYawDeg: PLAYER_HEAD_MAX_YAW_DEG,
        currentNeckYawDeg: neckJoint ? THREE.MathUtils.radToDeg(neckJoint.rotation.y) : null,
        renderRoot: playerMesh?.name || playerMesh?.type || null,
        avatarBodyRoots: discoverAvatarBodyRoots().map(root => root.name || root.type),
        visualRoots: currentOwnedRoots().map(root => root.name || root.type),
        externalProviders: Array.from(externalRootProviders.keys()),
        portraitFaceCulling: 'material-frontside',
        forcedPortraitDoubleSide: false,
        channels: Array.from(channels.entries()).map(([name, channel]) => ({
          name,
          priority: channel.priority,
          mode: channel.mode,
          enabled: channel.enabled !== false,
          rotation: channel.rotation || null,
          translation: channel.translation || null,
        })),
        appliedOrder: delta.applied,
        lastRender: lastRenderDebug ? {
          ...lastRenderDebug,
          appliedOrder: lastRenderDebug.appliedOrder.slice(),
          baseWorldEulerDeg: lastRenderDebug.baseWorldEulerDeg ? { ...lastRenderDebug.baseWorldEulerDeg } : null,
          composedWorldEulerDeg: lastRenderDebug.composedWorldEulerDeg ? { ...lastRenderDebug.composedWorldEulerDeg } : null,
          neckYaw: lastRenderDebug.neckYaw ? { ...lastRenderDebug.neckYaw } : null,
        } : null,
      };
    },
  };
})();
