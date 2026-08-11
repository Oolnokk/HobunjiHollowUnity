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
  let playerMesh = null;
  let playerLegRoot = null;
  let playerPosteriorY = 0;

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
    let preserveFacingSide = false; // Used by render() to keep additive tilt from swapping portrait sides.

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
      if (channel.preserveFacingSide === true) preserveFacingSide = true;
      applied.push(name);
    }
    return { rotation, translation, applied, preserveFacingSide };
  }

  // The neck-rigged player portrait stores its front and mirrored rear artwork
  // as two material groups on one SkinnedMesh. Ordinarily GPU face culling picks
  // the correct group from the game's resolved yaw. An additive pitch/roll can
  // move a nearly edge-on portrait across that culling boundary after facing has
  // already resolved, making the X-flipped rear portrait flash as a false 180°
  // turn. Capture the pre-delta side, render only it as double-sided during the
  // temporary body tilt, then restore both materials immediately after render.
  function preserveSkinnedPortraitFacingSide(root, camera, undo) {
    if (!root?.isObject3D || !camera?.isObject3D) return;
    root.updateWorldMatrix?.(true, true);
    camera.updateWorldMatrix?.(true, false);
    const cameraWorldPosition = camera.getWorldPosition(new THREE.Vector3()); // Used for the pre-delta view vector.

    root.traverse?.(object => {
      const materials = Array.isArray(object?.material) ? object.material : null; // Material groups inspected for a front/rear pair.
      if (!object?.isSkinnedMesh || !materials?.length) return;
      const frontMaterial = materials.find(material => /front_material$/i.test(String(material?.name || ''))); // Pre-tilt front portrait material.
      const backMaterial = materials.find(material => /back_material$/i.test(String(material?.name || ''))); // Pre-tilt mirrored rear portrait material.
      if (!frontMaterial || !backMaterial) return;

      const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld); // Converts the plane's local front normal into base world space.
      const frontNormal = new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize(); // Compared with the camera before composer tilt.
      const objectWorldPosition = object.getWorldPosition(new THREE.Vector3()); // Origin for the camera-facing direction below.
      const viewDirection = cameraWorldPosition.clone().sub(objectWorldPosition).normalize(); // Selects the portrait side chosen by ordinary yaw.
      const showFront = frontNormal.dot(viewDirection) >= 0;
      const oldFrontVisible = frontMaterial.visible;
      const oldBackVisible = backMaterial.visible;
      const selectedMaterial = showFront ? frontMaterial : backMaterial; // Kept renderable even if additive tilt crosses the culling plane.
      const oldSelectedSide = selectedMaterial.side;

      frontMaterial.visible = showFront;
      backMaterial.visible = !showFront;
      selectedMaterial.side = THREE.DoubleSide;
      undo.push(() => {
        frontMaterial.visible = oldFrontVisible;
        backMaterial.visible = oldBackVisible;
        selectedMaterial.side = oldSelectedSide;
      });
    });
  }

  function applyWorldDelta(root, pivotWorld, worldRotation, worldTranslation, undo) {
    if (!root?.isObject3D || root.visible === false) return;
    root.updateWorldMatrix?.(true, false);

    const oldPosition = root.position.clone();
    const oldQuaternion = root.quaternion.clone();
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
      root.quaternion.copy(oldQuaternion);
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
      preserveFacingSide: contribution.preserveFacingSide === true,
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
  }

  function unregisterPlayerRig(parent, handle) {
    if (playerMesh !== parent) return;
    if (handle?.group && playerLegRoot !== handle.group) return;
    playerMesh = null;
    playerLegRoot = null;
    playerPosteriorY = 0;
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
      if (playerMesh) {
        const delta = resolveDelta();
        const rotationMagnitude = Math.abs(delta.rotation.x) + Math.abs(delta.rotation.y) + Math.abs(delta.rotation.z);
        const translationMagnitude = delta.translation.lengthSq();
        if (rotationMagnitude > 1e-8 || translationMagnitude > 1e-12) {
          // game.js has already resolved facing, attack/tool poses, and its
          // ordinary movement bob by this point. Convert the local composer
          // delta into world space from that FINAL base transform, pivot around
          // the standing posterior/hip point, render, then restore immediately.
          playerMesh.updateWorldMatrix?.(true, false);
          const baseWorldQuaternion = hierarchyWorldQuaternion(playerMesh);
          const worldRotation = baseWorldQuaternion.clone()
            .multiply(delta.rotation)
            .multiply(baseWorldQuaternion.clone().invert());
          const worldTranslation = delta.translation.clone().applyQuaternion(baseWorldQuaternion);
          const pivotWorld = playerMesh.localToWorld(new THREE.Vector3(0, playerPosteriorY, 0));
          if (delta.preserveFacingSide) preserveSkinnedPortraitFacingSide(playerMesh, camera, undo);
          for (const root of currentOwnedRoots()) {
            applyWorldDelta(root, pivotWorld, worldRotation, worldTranslation, undo);
          }
        }
      }

      try { return originalRender.call(this, scene, camera); }
      finally {
        for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      }
    };
    proto.__playerBodyTransformComposerRenderHook = true;
  }

  window.PlayerBodyTransformComposer = {
    setChannel,
    clearChannel,
    clearAllChannels,
    registerExternalRootProvider,
    getPlayerMesh: () => playerMesh,
    getVisualRoots: () => currentOwnedRoots().slice(),
    hasVisibleHeldItem: () => !!playerMesh && Array.from(playerMesh.children || []).some(isHeldVisualRoot),
    getDebug() {
      const delta = resolveDelta();
      return {
        playerAttached: !!playerMesh,
        posteriorY: playerPosteriorY,
        renderRoot: playerMesh?.name || playerMesh?.type || null,
        avatarBodyRoots: discoverAvatarBodyRoots().map(root => root.name || root.type),
        visualRoots: currentOwnedRoots().map(root => root.name || root.type),
        externalProviders: Array.from(externalRootProviders.keys()),
        channels: Array.from(channels.entries()).map(([name, channel]) => ({
          name,
          priority: channel.priority,
          mode: channel.mode,
          enabled: channel.enabled !== false,
          rotation: channel.rotation || null,
          translation: channel.translation || null,
          preserveFacingSide: channel.preserveFacingSide === true,
        })),
        appliedOrder: delta.applied,
      };
    },
  };
})();
