// Central composition point for the local player's rendered body transform.
//
// Gameplay-facing state (player.angle, aim cones, movement direction, mount
// steering, etc.) deliberately stays outside this module. game.js can continue
// resolving its existing base playerMesh transform (dead-zone facing, authored
// attack/tool body yaw, and other legacy base-pose writers); this composer owns
// only the FINAL visual-layer delta applied after those systems have finished.
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
    return role === 'temporary-npc-demo-model'
      || role === 'player'
      || role === 'player-avatar'
      || name.includes('player_avatar')
      || name.includes('player_portrait')
      || name.includes('temporary_npc_portrait_model')
      || name.includes('hat_xray')
      || name.includes('occlusion_ghost');
  }

  function isHeldVisualRoot(child) {
    if (!child?.isObject3D || child === playerLegRoot || isAvatarBodyRoot(child)) return false;
    // The held-item assembly is the unnamed visible Group directly under the
    // player root. Named helpers/colliders/HUD roots are intentionally not
    // swept into body composition merely because they share a parent.
    return child.type === 'Group'
      && child.visible !== false
      && !String(child.name || '').trim()
      && hasRenderableDescendant(child);
  }

  function currentOwnedRoots() {
    const roots = [];
    const add = root => {
      if (!root?.isObject3D || root.visible === false || roots.includes(root) || !hasRenderableDescendant(root)) return;
      roots.push(root);
    };

    for (const child of playerMesh?.children || []) {
      if (isAvatarBodyRoot(child) || isHeldVisualRoot(child)) add(child);
    }
    add(playerLegRoot);

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
    const oldQuaternion = root.quaternion.clone();
    const worldPosition = root.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = root.getWorldQuaternion(new THREE.Quaternion());

    const nextWorldPosition = pivotWorld.clone()
      .add(worldPosition.sub(pivotWorld).applyQuaternion(worldRotation))
      .add(worldTranslation);
    const nextWorldQuaternion = worldRotation.clone().multiply(worldQuaternion);

    if (root.parent?.isObject3D) {
      root.parent.updateWorldMatrix?.(true, false);
      const parentWorldQuaternion = root.parent.getWorldQuaternion(new THREE.Quaternion());
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
  // about the composer. The root set itself is rediscovered every render, so an
  // appearance/equipment rebuild cannot leave composition targeting stale PNG
  // objects.
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
          playerMesh.updateWorldMatrix?.(true, false);
          const baseWorldQuaternion = playerMesh.getWorldQuaternion(new THREE.Quaternion());
          const worldRotation = baseWorldQuaternion.clone()
            .multiply(delta.rotation)
            .multiply(baseWorldQuaternion.clone().invert());
          const worldTranslation = delta.translation.clone().applyQuaternion(baseWorldQuaternion);
          const pivotWorld = playerMesh.localToWorld(new THREE.Vector3(0, playerPosteriorY, 0));
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
        visualRoots: currentOwnedRoots().map(root => root.name || root.type),
        externalProviders: Array.from(externalRootProviders.keys()),
        channels: Array.from(channels.entries()).map(([name, channel]) => ({
          name,
          priority: channel.priority,
          mode: channel.mode,
          enabled: channel.enabled !== false,
          rotation: channel.rotation || null,
          translation: channel.translation || null,
        })),
        appliedOrder: delta.applied,
      };
    },
  };
})();
