// Adapts game-owned body-bound attachments into PlayerBodyTransformComposer.
//
// The composer intentionally does not know about companions, tools, or any
// game-specific dependency bag. This thin adapter supplies those roots lazily,
// so ragdoll/drunk/future body channels all inherit to the same attachments
// without any one effect module owning the relationship.
(() => {
  'use strict';

  const composer = window.PlayerBodyTransformComposer;
  const THREE = window.THREE; // Used by the render-time shoulder-pet face-limit transform below.
  if (!composer || window.__playerBodyAttachmentBridgeInstalled) return;
  window.__playerBodyAttachmentBridgeInstalled = true;

  let gameDeps = null;

  function chainFutureSetter(name, beforeSet) {
    const desc = Object.getOwnPropertyDescriptor(window, name);
    const previousSet = desc?.set;
    if (typeof previousSet !== 'function') return false;
    Object.defineProperty(window, name, {
      configurable: true,
      get: desc.get,
      set(value) {
        beforeSet?.(value);
        previousSet.call(window, value);
      },
    });
    return true;
  }

  function patchDevSpawner(api) {
    if (!api?.init || api.__playerBodyAttachmentInitHooked) return;
    const originalInit = api.init.bind(api);
    api.init = function playerBodyAttachmentAwareInit(injectedDeps) {
      gameDeps = injectedDeps;
      window.ProceduralHandAttachments?.installGameRuntime?.(injectedDeps);
      return originalInit(injectedDeps);
    };
    api.__playerBodyAttachmentInitHooked = true;
  }

  function ensureShoulderPetIdleFrame(companion, combatDeps) {
    const frameUrl = companion?.def?.sprites?.idle; // Uses the creature's own authored idle pose while it is perched on the player.
    if (!frameUrl || typeof combatDeps?.setCreatureFrame !== 'function' || !companion.avatarRef) return false;
    companion.__hobunjiShoulderIdleFrame = frameUrl; // Mobile/debug-readable proof of the shouldered presentation frame.
    if (companion.currentFrameUrl === frameUrl) return true;
    const genotypeKind = combatDeps.genotypeKindFor?.(companion) || companion.creatureKey || companion.kind || null; // Preserves patterned/recolored livestock through the shared frame compositor.
    combatDeps.setCreatureFrame(companion.avatarRef, frameUrl, genotypeKind, 'idle', companion.genotype);
    companion.currentFrameUrl = frameUrl;
    return true;
  }

  function activeShoulderPets(combatDeps) {
    const player = combatDeps?.player; // Master comparison below keeps this helper scoped to the local player's shoulder pets.
    if (!player) return [];
    return Array.from(combatDeps.companionObjects || []).filter(companion =>
      companion?.health > 0
      && companion.stableRole === 'shoulderPet'
      && (companion.master || player) === player
      && companion.avatarRef?.group);
  }

  function quaternionDeltaDegrees(a, b) {
    const dot = Math.min(1, Math.abs(a.dot(b))); // Quaternion signs are equivalent, so compare the shortest physical rotation only.
    return THREE.MathUtils.radToDeg(2 * Math.acos(dot));
  }

  function setRootWorldTransform(root, worldPosition, worldQuaternion) {
    const parent = root?.parent;
    if (parent?.isObject3D) {
      parent.updateWorldMatrix?.(true, false);
      const parentWorldQuaternion = parent.getWorldQuaternion(new THREE.Quaternion()); // Shoulder-pet roots live under ordinary scene/area parents without mirrored avatar scale.
      root.position.copy(parent.worldToLocal(worldPosition.clone()));
      root.quaternion.copy(parentWorldQuaternion.invert().multiply(worldQuaternion));
    } else {
      root.position.copy(worldPosition);
      root.quaternion.copy(worldQuaternion);
    }
    root.updateMatrix?.();
    root.matrixWorldNeedsUpdate = true;
  }

  function recordShoulderPetFaceLimit(attachment, values) {
    attachment.renderFaceRotationLimit = {
      recentChange: 'Head/neck shoulder-pet rotation cannot outrun the visible face world rotation.',
      ...values,
    }; // Stored beside the existing attachment dump so mobile diagnostics can inspect the limiter without a console.
  }

  function applyShoulderPetFaceRotationLimit(companion, renderContext) {
    if (!THREE || !companion?.avatarRef?.group) return null;
    const root = companion.avatarRef.group; // The same authoritative pet root updateShoulderPetMeshPin writes each gameplay frame.
    const attachment = root.userData?.hobunjiShoulderPetAttachment;
    if (!attachment || attachment.requestedRotationSource !== 'head') return null;

    const sampledFrameValues = attachment.rotationFrameWorldQuaternion;
    const sampledFinalValues = attachment.finalWorldQuaternion;
    const perchValues = attachment.authoredPerchWorldPosition;
    const sampledRootValues = attachment.expectedWorldPosition;
    if (!Array.isArray(sampledFrameValues) || sampledFrameValues.length < 4
      || !Array.isArray(sampledFinalValues) || sampledFinalValues.length < 4
      || !Array.isArray(perchValues) || perchValues.length < 3
      || !Array.isArray(sampledRootValues) || sampledRootValues.length < 3) {
      recordShoulderPetFaceLimit(attachment, { applied: false, reason: 'missing-attachment-frame-data' });
      return null;
    }

    const visibleFaceWorldQuaternion = renderContext?.visibleFaceWorldQuaternion?.clone?.(); // Supplied after the player's physical neck clamp and before shared body deltas.
    if (!visibleFaceWorldQuaternion?.isQuaternion) {
      recordShoulderPetFaceLimit(attachment, { applied: false, reason: 'no-visible-face-world-frame' });
      return null;
    }
    visibleFaceWorldQuaternion.normalize();
    const limitedFrameWorldQuaternion = visibleFaceWorldQuaternion.clone(); // Replaces only the sampled follow frame; authored perch/grip correction remains separate below.
    if (attachment.rotationSourceInverted) limitedFrameWorldQuaternion.invert();

    const sampledFrameWorldQuaternion = new THREE.Quaternion().fromArray(sampledFrameValues).normalize(); // Original head/neck frame sampled by game.js before the render-time face clamp.
    const sampledFinalWorldQuaternion = new THREE.Quaternion().fromArray(sampledFinalValues).normalize(); // Original pet root rotation after authored perch/grip correction.
    const sourceFrameDeltaDeg = quaternionDeltaDegrees(sampledFrameWorldQuaternion, limitedFrameWorldQuaternion);
    if (sourceFrameDeltaDeg <= 0.0001) {
      recordShoulderPetFaceLimit(attachment, {
        applied: false,
        reason: 'sample-already-matches-visible-face',
        sourceFrameDeltaDeg,
        visibleFaceWorldQuaternion: visibleFaceWorldQuaternion.toArray(),
      });
      return null;
    }

    const authoredRotationOffset = sampledFrameWorldQuaternion.clone().invert().multiply(sampledFinalWorldQuaternion); // Preserves the exact perch/grip rotation already authored by game.js, including the cancel-offset setting.
    const limitedFinalWorldQuaternion = limitedFrameWorldQuaternion.clone().multiply(authoredRotationOffset).normalize();
    const authoredPerchWorldPosition = new THREE.Vector3().fromArray(perchValues); // Reuses the exact perch point game.js resolved from the live skinned portrait this frame.
    const sampledRootWorldPosition = new THREE.Vector3().fromArray(sampledRootValues); // Reuses game.js's authoritative pre-limit root position rather than re-querying anchor config from another subsystem.
    const sampledGripWorldOffset = authoredPerchWorldPosition.clone().sub(sampledRootWorldPosition); // Exact world-space grip vector that aligned the pet before the visible-face cap.
    const localGripOffset = sampledGripWorldOffset.clone().applyQuaternion(sampledFinalWorldQuaternion.clone().invert()); // Recovers the root-local grip vector, preserving any authored/scaled offset game.js already baked in.
    const limitedGripWorldOffset = localGripOffset.clone().applyQuaternion(limitedFinalWorldQuaternion);
    const limitedRootWorldPosition = authoredPerchWorldPosition.clone().sub(limitedGripWorldOffset); // Rotating around the recovered grip keeps the animal physically pinned to the shoulder instead of orbiting/detaching.

    const oldPosition = root.position.clone(); // Restored after this render so gameplay/update state remains authoritative between frames.
    const oldRotation = root.rotation.clone(); // Preserves the original Euler representation instead of restoring through quaternion decomposition.
    setRootWorldTransform(root, limitedRootWorldPosition, limitedFinalWorldQuaternion);

    const alignedGripWorldPosition = limitedRootWorldPosition.clone().add(limitedGripWorldOffset); // Used only for mobile verification of the attachment invariant.
    recordShoulderPetFaceLimit(attachment, {
      applied: true,
      reason: 'visible-face-world-limit',
      sourceFrameDeltaDeg,
      visibleFaceWorldQuaternion: visibleFaceWorldQuaternion.toArray(),
      limitedRotationFrameWorldQuaternion: limitedFrameWorldQuaternion.toArray(),
      limitedFinalWorldQuaternion: limitedFinalWorldQuaternion.toArray(),
      limitedRootWorldPosition: limitedRootWorldPosition.toArray(),
      gripPerchError: alignedGripWorldPosition.distanceTo(authoredPerchWorldPosition),
      renderSequence: renderContext?.renderDebug?.sequence ?? null,
    });

    return () => {
      root.position.copy(oldPosition);
      root.rotation.copy(oldRotation);
      root.updateMatrix?.();
      root.matrixWorldNeedsUpdate = true;
    };
  }

  if (window.DevSpawner) patchDevSpawner(window.DevSpawner);
  else chainFutureSetter('DevSpawner', patchDevSpawner);

  composer.registerExternalRootProvider('equippedTool', () => gameDeps?.toolHolder || null);

  composer.registerPreRenderHook?.('shoulderPetFaceLimit', renderContext => {
    const combatDeps = window.Combat?.deps;
    const restores = [];
    for (const companion of activeShoulderPets(combatDeps)) {
      ensureShoulderPetIdleFrame(companion, combatDeps); // Perched presentation no longer depends on some unrelated body channel being active.
      const restore = applyShoulderPetFaceRotationLimit(companion, renderContext);
      if (typeof restore === 'function') restores.push(restore);
    }
    if (!restores.length) return null;
    return () => {
      for (let i = restores.length - 1; i >= 0; i--) restores[i]();
    };
  });

  composer.registerExternalRootProvider('shoulderPets', () => {
    const combatDeps = window.Combat?.deps;
    const roots = [];
    for (const companion of activeShoulderPets(combatDeps)) {
      ensureShoulderPetIdleFrame(companion, combatDeps);
      roots.push(companion.avatarRef.group);
    }
    return roots;
  });

  window.PlayerBodyAttachmentBridge = {
    getDebug() {
      const handDebug = window.ProceduralHandAttachments?.getActiveDebug?.().find(entry => entry?.speciesId) || null;
      const combatDeps = window.Combat?.deps;
      const shoulderPets = activeShoulderPets(combatDeps); // Shared by the count, idle-frame, and face-limit diagnostics below.
      const shoulderPetFaceRotationLimit = shoulderPets
        .map(companion => companion.avatarRef?.group?.userData?.hobunjiShoulderPetAttachment?.renderFaceRotationLimit || null)
        .find(Boolean) || null; // Exposes the first active pet's latest limiter result in the existing mobile-readable attachment debug object.
      return {
        hasGameDeps: !!gameDeps,
        hasToolHolder: !!gameDeps?.toolHolder,
        proceduralHands: handDebug,
        activeShoulderPets: shoulderPets.length,
        shoulderPetsOnIdle: shoulderPets.filter(companion => !!companion.__hobunjiShoulderIdleFrame && companion.currentFrameUrl === companion.__hobunjiShoulderIdleFrame).length,
        shoulderPetFaceRotationLimit,
      };
    },
  };
})();
