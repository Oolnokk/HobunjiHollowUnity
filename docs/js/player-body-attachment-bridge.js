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
  let cachedPlayerMesh = null; // Tracks which player rig owns cachedPlayerNeckJoint below.
  let cachedPlayerNeckJoint = null; // Reused by the per-render shoulder-pet limiter so it never traverses the player rig every frame.

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

  function isDescendantOf(node, ancestor) {
    let cursor = node;
    while (cursor?.isObject3D) {
      if (cursor === ancestor) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  function currentPlayerNeckJoint() {
    const playerMesh = composer.getPlayerMesh?.(); // Supplies the live player rig that owns the visible face bone.
    if (!playerMesh?.isObject3D) {
      cachedPlayerMesh = null;
      cachedPlayerNeckJoint = null;
      return null;
    }
    if (cachedPlayerMesh !== playerMesh) {
      cachedPlayerMesh = playerMesh;
      cachedPlayerNeckJoint = null;
    }
    if (cachedPlayerNeckJoint?.isBone && isDescendantOf(cachedPlayerNeckJoint, playerMesh)) return cachedPlayerNeckJoint;
    cachedPlayerNeckJoint = null;
    playerMesh.traverse?.(object => {
      if (cachedPlayerNeckJoint) return;
      const rig = object?.userData?.neckRig; // Matches the neck-rig discovery contract used by PlayerBodyTransformComposer itself.
      if (rig?.available && rig.neckJoint?.isBone) cachedPlayerNeckJoint = rig.neckJoint;
    });
    return cachedPlayerNeckJoint;
  }

  function quaternionDeltaDegrees(a, b) {
    const dot = Math.min(1, Math.abs(a.dot(b))); // Quaternion signs are equivalent, so compare the shortest physical rotation only.
    return THREE.MathUtils.radToDeg(2 * Math.acos(dot));
  }

  function setRootWorldTransform(root, worldPosition, worldQuaternion) {
    const parent = root?.parent;
    if (parent?.isObject3D) {
      parent.updateWorldMatrix?.(true, false);
      const parentWorldQuaternion = parent.getWorldQuaternion(new THREE.Quaternion()); // Mirrors game.js's authoritative shoulder-pet root conversion.
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

  function applyShoulderPetFaceRotationLimit(companion, combatDeps) {
    if (!THREE || !companion?.avatarRef?.group) return false;
    const root = companion.avatarRef.group; // The same authoritative pet root updateShoulderPetMeshPin writes each gameplay frame.
    const attachment = root.userData?.hobunjiShoulderPetAttachment;
    if (!attachment || attachment.requestedRotationSource !== 'head') return false;

    const sampledFrameValues = attachment.rotationFrameWorldQuaternion;
    const sampledFinalValues = attachment.finalWorldQuaternion;
    const perchValues = attachment.authoredPerchWorldPosition;
    if (!Array.isArray(sampledFrameValues) || sampledFrameValues.length < 4
      || !Array.isArray(sampledFinalValues) || sampledFinalValues.length < 4
      || !Array.isArray(perchValues) || perchValues.length < 3) {
      recordShoulderPetFaceLimit(attachment, { applied: false, reason: 'missing-attachment-frame-data' });
      return false;
    }

    const neckJoint = currentPlayerNeckJoint();
    if (!neckJoint?.getWorldQuaternion) {
      recordShoulderPetFaceLimit(attachment, { applied: false, reason: 'no-player-neck-joint' });
      return false;
    }
    neckJoint.updateWorldMatrix?.(true, false);
    const visibleFaceWorldQuaternion = neckJoint.getWorldQuaternion(new THREE.Quaternion()).normalize(); // Composer has already applied its physical neck limit before asking providers for roots during render.
    const limitedFrameWorldQuaternion = visibleFaceWorldQuaternion.clone(); // Replaces only the sampled follow frame; authored perch/grip correction remains separate below.
    if (attachment.rotationSourceInverted) limitedFrameWorldQuaternion.invert();

    const sampledFrameWorldQuaternion = new THREE.Quaternion().fromArray(sampledFrameValues).normalize(); // Original head/neck frame sampled by game.js before the render-time face clamp.
    const sampledFinalWorldQuaternion = new THREE.Quaternion().fromArray(sampledFinalValues).normalize(); // Original pet root rotation after authored perch/grip correction.
    const sourceFrameDeltaDeg = quaternionDeltaDegrees(sampledFrameWorldQuaternion, limitedFrameWorldQuaternion);
    if (sourceFrameDeltaDeg <= 0.0001) {
      recordShoulderPetFaceLimit(attachment, {
        applied: false,
        reason: 'sample-already-within-visible-face',
        sourceFrameDeltaDeg,
        visibleFaceWorldQuaternion: visibleFaceWorldQuaternion.toArray(),
      });
      return false;
    }

    const grip = combatDeps?.creatureAttachmentAnchor?.(companion.creatureKey, 'shoulderGrip', companion.genotype);
    if (!grip) {
      recordShoulderPetFaceLimit(attachment, { applied: false, reason: 'missing-shoulder-grip', sourceFrameDeltaDeg });
      return false;
    }

    const authoredRotationOffset = sampledFrameWorldQuaternion.clone().invert().multiply(sampledFinalWorldQuaternion); // Preserves the exact perch/grip rotation already authored by game.js, including the cancel-offset setting.
    const limitedFinalWorldQuaternion = limitedFrameWorldQuaternion.clone().multiply(authoredRotationOffset).normalize();
    const authoredPerchWorldPosition = new THREE.Vector3().fromArray(perchValues); // Reuses the exact perch point game.js resolved from the live skinned portrait this frame.
    const limitedGripWorldOffset = new THREE.Vector3(Number(grip.x) || 0, Number(grip.y) || 0, Number(grip.z) || 0).applyQuaternion(limitedFinalWorldQuaternion);
    const limitedRootWorldPosition = authoredPerchWorldPosition.clone().sub(limitedGripWorldOffset); // Rotating around the grip keeps the animal physically pinned to the shoulder instead of orbiting/detaching.
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
    });
    return true;
  }

  if (window.DevSpawner) patchDevSpawner(window.DevSpawner);
  else chainFutureSetter('DevSpawner', patchDevSpawner);

  composer.registerExternalRootProvider('equippedTool', () => gameDeps?.toolHolder || null);

  composer.registerExternalRootProvider('shoulderPets', () => {
    const combatDeps = window.Combat?.deps;
    const player = combatDeps?.player;
    if (!player) return [];
    const roots = [];
    for (const companion of combatDeps.companionObjects || []) {
      if (!companion || companion.health <= 0 || companion.stableRole !== 'shoulderPet') continue;
      if ((companion.master || player) !== player) continue;
      if (companion.avatarRef?.group) {
        ensureShoulderPetIdleFrame(companion, combatDeps);
        applyShoulderPetFaceRotationLimit(companion, combatDeps); // Runs after the composer's visible-face neck clamp and before its shared body delta reaches this external root.
        roots.push(companion.avatarRef.group);
      }
    }
    return roots;
  });

  window.PlayerBodyAttachmentBridge = {
    getDebug() {
      const handDebug = window.ProceduralHandAttachments?.getActiveDebug?.().find(entry => entry?.speciesId) || null;
      const activeShoulderPets = window.Combat?.deps?.companionObjects
        ? Array.from(window.Combat.deps.companionObjects).filter(companion =>
            companion?.health > 0
            && companion.stableRole === 'shoulderPet'
            && (companion.master || window.Combat.deps.player) === window.Combat.deps.player)
        : []; // Shared by the count, idle-frame, and face-limit diagnostics below.
      const shoulderPetFaceRotationLimit = activeShoulderPets
        .map(companion => companion.avatarRef?.group?.userData?.hobunjiShoulderPetAttachment?.renderFaceRotationLimit || null)
        .find(Boolean) || null; // Exposes the first active pet's latest limiter result in the existing mobile-readable attachment debug object.
      return {
        hasGameDeps: !!gameDeps,
        hasToolHolder: !!gameDeps?.toolHolder,
        proceduralHands: handDebug,
        activeShoulderPets: activeShoulderPets.length,
        shoulderPetsOnIdle: activeShoulderPets.filter(companion => !!companion.__hobunjiShoulderIdleFrame && companion.currentFrameUrl === companion.__hobunjiShoulderIdleFrame).length,
        shoulderPetFaceRotationLimit,
      };
    },
  };
})();
