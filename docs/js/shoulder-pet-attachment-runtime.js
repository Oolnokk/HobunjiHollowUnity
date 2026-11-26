// Canonical shoulder-pet grip/perch world transform and rendered-root pin.
// Gameplay owns its update cadence and passes live dependencies through getters.
// This module never animates sprites or writes game state outside the pet root.
//
// Owner-generic: create() one instance per owner character with
// getOwnerMesh/getOwnerNeckJoint (the player today; any NPC or enemy that
// carries a pet can get its own instance). The older getPlayerMesh/
// getPlayerNeckJoint names are accepted as aliases, and "player" in the
// internal names and diagnostic labels below means "the owner".
// See js/character-visuals.js (shoulder-pet-perch).
(() => {
  'use strict';

  function create({ THREE, getOwnerMesh, getOwnerNeckJoint, getPlayerMesh = getOwnerMesh, getPlayerNeckJoint = getOwnerNeckJoint,
    getRotationSource, getInvertRotationSource, getCancelRotationalOffset, getOwnerPortraitMeshes } = {}) {
    if (!THREE?.Quaternion || !THREE?.Vector3 || typeof getPlayerMesh !== 'function'
      || typeof getPlayerNeckJoint !== 'function' || typeof getRotationSource !== 'function'
      || typeof getInvertRotationSource !== 'function' || typeof getCancelRotationalOffset !== 'function') {
      throw new TypeError('ShoulderPetAttachmentRuntime requires THREE and live owner (getOwnerMesh/getOwnerNeckJoint) and configuration getters.');
    }

    const rotationLimits = window.ShoulderPetRotationLimits?.create?.(THREE); // One cached geometric solver per owner.
    const SHOULDER_PET_BODY_NECK_BLEND = 0.5; // Equal quaternion midpoint between the player body and neck follow frames.
    const worldUp = new THREE.Vector3(0, 1, 0); // Axis for the upright pet's heading and observation turn.
    function worldQuaternionWithoutReflection(node) {
      const out = new THREE.Quaternion(); // Shared caller scratch result; the source's actual local quaternions, not decomposed signed scales, determine orientation.
      if (node?.isObject3D && node.quaternion) {
        const rigResolver = window.ProceduralLegAnimation?.worldQuaternionWithoutScale; // Reuse the leg solver's canonical scale-free world orientation when present.
        if (typeof rigResolver === 'function') return rigResolver(node, out);
        out.identity();
        const chain = []; // Editor/standalone fallback when the procedural-leg module is not loaded.
        for (let parent = node; parent?.isObject3D; parent = parent.parent) chain.push(parent);
        for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
        return out.normalize();
      }
      return node?.getWorldQuaternion?.(out) || out; // Test doubles and older preview rigs have no local quaternion hierarchy.
    }
    const SHOULDER_PET_HALF_TURN_QUATERNION = new THREE.Quaternion().setFromAxisAngle(worldUp, Math.PI); // Swaps the two facing poses without mirroring the sprite.
    const neutralGripYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(61)); // Stock shoulder yaw gives neutral grip rigs a readable side silhouette.
    const petHeading = new THREE.Vector3(); // The animal's nose points along local +Z; the two cards face along ±X.
    const ownerLateral = new THREE.Vector3(); // World-space lateral ray including the owner's actual reflection.
    const perchInOwnerSpace = new THREE.Vector3(); // Reads the live perch side after the source pixel follows the portrait flip.
    const ownerOrigin = new THREE.Vector3(); // Subtracted from the lateral point to obtain a direction.
    function keepHeadingUpright(rotation) {
      petHeading.set(0, 0, 1).applyQuaternion(rotation);
      if (Math.hypot(petHeading.x, petHeading.z) > 1e-6) {
        return rotation.setFromAxisAngle(worldUp, Math.atan2(petHeading.x, petHeading.z));
      }
      // When forward points straight up or down, use the horizontal right axis.
      petHeading.set(1, 0, 0).applyQuaternion(rotation);
      return rotation.setFromAxisAngle(worldUp, Math.atan2(-petHeading.z, petHeading.x));
    }

    function shoulderLateralHeading(owner, rotation) {
      owner.localToWorld(ownerLateral.set(1, 0, 0));
      owner.localToWorld(ownerOrigin.set(0, 0, 0));
      ownerLateral.sub(ownerOrigin);
      petHeading.set(0, 0, 1).applyQuaternion(rotation);
      return (petHeading.x * ownerLateral.x + petHeading.z * ownerLateral.z)
        / (Math.hypot(ownerLateral.x, ownerLateral.z) || 1);
    }

    function _shoulderPetSurfaceTransform(perch, grip, pet) {
      const playerMesh = getPlayerMesh(); // Live owner mesh, never a stale captured avatar.
      const playerNeckJoint = getPlayerNeckJoint(); // Live skinned neck after portrait rebuilds.
      const s_shoulderPetRotationSource = getRotationSource(); // Current configured owner rotation frame.
      const s_invertShoulderPetRotationSource = getInvertRotationSource(); // Runtime-only legacy compatibility switch.
      const s_cancelShoulderPetRotationalOffset = getCancelRotationalOffset(); // Runtime-only authored-offset override.
      if (!playerMesh) throw new Error('Shoulder pet cannot resolve a missing player mesh.');
      const rotationQuaternion = rotationDeg => { // Converts authored YXZ pitch/yaw/roll for the perch and grip composition below.
        const degrees = rotationDeg || {};
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(Number(degrees.x) || 0),
          THREE.MathUtils.degToRad(Number(degrees.y) || 0),
          THREE.MathUtils.degToRad(Number(degrees.z) || 0),
          'YXZ',
        ));
      };
      playerMesh.updateWorldMatrix?.(true, false);
      const perchFrame = window.PNGPlaneAvatar?.resolveSkinnedPixelWorldFrame?.(playerMesh, perch.sourcePixel);
      const perchWorldPosition = perchFrame?.position
        || playerMesh.localToWorld(new THREE.Vector3(perch.x || 0, perch.y || 0, perch.z || 0)); // Position always prefers the authored live-skinned pixel, independent of the rotation dropdown.
      const renderedPerchX = perchFrame ? playerMesh.worldToLocal(perchInOwnerSpace.copy(perchWorldPosition)).x : perch.x; // Use the side the pet is actually perched on after portrait UV mirroring.
      const facingTowardPlayerCenter = pet?.__hobunjiShoulderFacingInward === true; // Desired heading for this held observation pose.
      let selectedRotationQuaternion = null; // Receives the world-space frame chosen by the Settings dropdown below.
      let resolvedRotationSource = s_shoulderPetRotationSource;
      switch (s_shoulderPetRotationSource) {
        case 'body':
          selectedRotationQuaternion = worldQuaternionWithoutReflection(playerMesh);
          resolvedRotationSource = 'player-body';
          break;
        case 'bodyNeckMidpoint': {
          const bodyRotationQuaternion = worldQuaternionWithoutReflection(playerMesh).normalize(); // Body endpoint ignores mirrored model scale.
          const neckRotationSource = playerNeckJoint?.isObject3D ? playerNeckJoint : null; // Neck endpoint; rigid avatars safely fall back to the body frame.
          if (!neckRotationSource) {
            selectedRotationQuaternion = bodyRotationQuaternion;
            resolvedRotationSource = 'player-body-fallback-no-neck';
            break;
          }
          neckRotationSource.updateWorldMatrix?.(true, false);
          const neckRotationQuaternion = worldQuaternionWithoutReflection(neckRotationSource).normalize(); // Physical neck orientation is not a matrix reflection.
          selectedRotationQuaternion = bodyRotationQuaternion.clone().slerp(neckRotationQuaternion, SHOULDER_PET_BODY_NECK_BLEND).normalize();
          resolvedRotationSource = 'player-body-neck-midpoint';
          break;
        }
        case 'head': {
          const headRotationSource = playerNeckJoint?.isObject3D ? playerNeckJoint : playerMesh; // Head/neck selection falls back safely for rigid avatars.
          headRotationSource.updateWorldMatrix?.(true, false);
          selectedRotationQuaternion = worldQuaternionWithoutReflection(headRotationSource);
          resolvedRotationSource = headRotationSource === playerNeckJoint ? 'player-head-neck' : 'player-body-fallback-no-neck';
          break;
        }
        case 'world':
          selectedRotationQuaternion = new THREE.Quaternion();
          resolvedRotationSource = 'world-aligned';
          break;
        case 'pixel':
        default:
          selectedRotationQuaternion = perchFrame?.quaternion?.clone()
            || worldQuaternionWithoutReflection(playerMesh);
          resolvedRotationSource = perchFrame ? 'player-authored-skinned-surface' : 'player-body-fallback-no-skinned-frame';
          break;
      }
      if (s_invertShoulderPetRotationSource) selectedRotationQuaternion.invert();
      const perchQuaternion = rotationQuaternion(perch.rotationDeg); // Authored shoulderPerch rotational correction.
      const inverseGripQuaternion = rotationQuaternion(grip.rotationDeg).invert(); // Authored inverse shoulderGrip rotational correction.
      const authoredRotationOffset = keepHeadingUpright(perchQuaternion.multiply(inverseGripQuaternion)); // Keep the authored facing correction on the horizontal plane.
      const worldQuaternion = keepHeadingUpright(selectedRotationQuaternion.clone()); // Carrier pitch and roll still move the perch, but never tilt the pet's body.
      let authoredFacesInward = false; // Identifies which of the two authored half-turns points toward the carrier's midline.
      if (!s_cancelShoulderPetRotationalOffset) {
        worldQuaternion.multiply(authoredRotationOffset);
        if (renderedPerchX) {
          const authoredLateralHeading = petHeading.set(0, 0, 1).applyQuaternion(authoredRotationOffset).x; // Only neutral rigs need an added yaw; head animation alone cannot enable it.
          if (Math.abs(authoredLateralHeading) < 0.05) worldQuaternion.multiply(neutralGripYaw);
          authoredFacesInward = shoulderLateralHeading(playerMesh, worldQuaternion) * renderedPerchX < 0;
        }
      }
      const shoulderFacingTurnDeg = facingTowardPlayerCenter !== authoredFacesInward ? 180 : 0;
      if (shoulderFacingTurnDeg) worldQuaternion.multiply(SHOULDER_PET_HALF_TURN_QUATERNION);
      // Curiosity pitch/yaw is animated by the animal's head bones, not this shared root.
      // Keep the entire body and its off-center grip still between the two authored 180° observation poses.
      const shoulderLeanDeg = 0; // Retained in attachment diagnostics to report the actually applied (neutral) body lean.
      const perchScaleX = Number(perch.scale?.x) > 0 ? Number(perch.scale.x) : 1; // Explicit authored grip multiplier; the runtime never recalculates it from body dimensions.
      const perchScaleY = Number(perch.scale?.y) > 0 ? Number(perch.scale.y) : 1; // Matches the pet's rendered Y scale when solving its foot grip.
      const perchScaleZ = Number(perch.scale?.z) > 0 ? Number(perch.scale.z) : 1; // Matches the pet's rendered depth scale.
      const rawGrip = grip.localPosition; // Native unscaled socket coordinates; the grip resolver retains them alongside its legacy scaled fields.
      const renderedScale = pet?.avatarRef?.group?.scale; // Actual THREE root scale, including the swapped width/depth axes and the current breath/squash multiplier.
      const useRenderedGrip = !!(rawGrip && renderedScale
        && Number.isFinite(renderedScale.x) && Number.isFinite(renderedScale.y) && Number.isFinite(renderedScale.z)); // Only fall back for old callers without a real avatar root.
      let geometryConstraint = null; // The live collision solve runs before the grip offset is composed.
      if (rotationLimits && useRenderedGrip && typeof getOwnerPortraitMeshes === 'function') {
        const front = pet.avatarRef.frontPlane; // Use the exact canonical rendered face, not the pre-pin billboard rotation.
        if (front) {
          front.matrixAutoUpdate = true;
          front.rotation.set(0, Math.PI / 2, 0);
          front.updateMatrix();
        }
        geometryConstraint = rotationLimits?.constrain({
          ownerMeshes: getOwnerPortraitMeshes(), pet, perch: perchWorldPosition, grip: rawGrip,
          scale: renderedScale, quaternion: worldQuaternion,
        });
      }
      const gripWorldOffset = new THREE.Vector3(
        useRenderedGrip ? rawGrip.x * renderedScale.x : (grip.x || 0) * perchScaleX,
        useRenderedGrip ? rawGrip.y * renderedScale.y : (grip.y || 0) * perchScaleY,
        useRenderedGrip ? rawGrip.z * renderedScale.z : (grip.z || 0) * perchScaleZ,
      ).applyQuaternion(worldQuaternion); // Rotate the real scaled grip, not an approximate socket with axis-swapped or stale breathing scale.
      return {
        worldPosition: perchWorldPosition.clone().sub(gripWorldOffset),
        worldQuaternion,
        perchWorldPosition: perchWorldPosition.clone(),
        gripWorldOffset: gripWorldOffset.clone(),
        gripLocalPosition: useRenderedGrip ? rawGrip : null, // Final transform uses this to measure the real world grip from the pet's updated THREE matrix.
        gripSource: grip.source || 'authored-shoulder-grip', // Reports whether the foot socket is authored or derived from a flying sprite.
        rotationFrameWorldQuaternion: selectedRotationQuaternion,
        perchPositionSource: perchFrame ? 'player-authored-skinned-pixel' : 'player-body-local-fallback',
        rotationSource: resolvedRotationSource,
        requestedRotationSource: s_shoulderPetRotationSource,
        rotationSourceInverted: s_invertShoulderPetRotationSource,
        rotationalOffsetCancelled: s_cancelShoulderPetRotationalOffset,
        facingTowardPlayerCenter,
        shoulderFacingTurnDeg,
        shoulderLeanDeg, // Always zero: head movement cannot drift the body or the shoulder grip.
        geometryConstraint, // Requested/applied angles and bounded candidate checks for Pixel Probe.
      };
    }

    function _applyShoulderPetFinalTransform(c, finalTransform) {
      const group = c.avatarRef?.group;
      if (!group || !finalTransform?.worldPosition || !finalTransform?.worldQuaternion) return;
      const fallbackPlayerMesh = finalTransform.faceRotationSource === 'player-body-fallback-no-authored-anchors'
        ? getPlayerMesh() : null; // The legacy no-perch/no-grip path still arrives with a possibly reflected getWorldQuaternion from game.js.
      const worldQuaternion = fallbackPlayerMesh
        ? keepHeadingUpright(fallbackPlayerMesh.isObject3D
          ? worldQuaternionWithoutReflection(fallbackPlayerMesh) : finalTransform.worldQuaternion.clone())
        : finalTransform.worldQuaternion; // The legacy path also follows the owner's horizontal heading.
      const parent = group.parent; // Used to convert the resolved world attachment transform back into the pet root's actual local space.
      parent?.updateWorldMatrix?.(true, false);
      const parentWorldQuaternion = parent ? worldQuaternionWithoutReflection(parent)
        : new THREE.Quaternion(); // Parent rotations ignore mirrored matrix decomposition when solving the pet's local attachment.
      const localQuaternion = parentWorldQuaternion.invert().multiply(worldQuaternion.clone()); // Local root rotation that renders as the selected world-space attachment frame.
      const localPosition = parent?.worldToLocal
        ? parent.worldToLocal(finalTransform.worldPosition.clone())
        : finalTransform.worldPosition.clone(); // Local root position whose conceptual shoulderGrip coincides with shoulderPerch.
      group.position.copy(localPosition);
      group.quaternion.copy(localQuaternion);
      // The selected root transform is now authoritative for both placement
      // and rendering. Restore normal matrix inheritance and only retain the
      // canonical mirrored face rotations; png-plane-avatar's render hook
      // recognizes the marker below and no longer replaces this orientation.
      const setCanonicalPlaneRotation = (plane, y) => {
        if (!plane) return;
        plane.matrixAutoUpdate = true;
        plane.rotation.set(0, y, 0);
        plane.updateMatrix();
        plane.matrixWorldNeedsUpdate = true;
      };
      setCanonicalPlaneRotation(c.avatarRef.frontPlane, Math.PI / 2);
      setCanonicalPlaneRotation(c.avatarRef.backPlane, -Math.PI / 2);
      group.updateWorldMatrix?.(false, false); // The grip readback needs this pose even before the first render updates matrices.
      const alignedGripWorldPosition = finalTransform.gripLocalPosition
        ? group.localToWorld(new THREE.Vector3( // Read the actual rendered root matrix, not merely undoing the same offset calculation.
            finalTransform.gripLocalPosition.x, finalTransform.gripLocalPosition.y, finalTransform.gripLocalPosition.z))
        : finalTransform.worldPosition.clone().add(finalTransform.gripWorldOffset || new THREE.Vector3()); // Legacy no-anchor or mock callers have only the expected offset.
      const gripPerchError = finalTransform.perchWorldPosition
        ? alignedGripWorldPosition.distanceTo(finalTransform.perchWorldPosition)
        : null; // Pixel Probe now measures real world transform drift, including genotype scaling and breathing.
      group.userData.hobunjiShoulderPetAttachment = { // Mobile-visible Pixel Probe diagnostics for this final authoritative pin.
        recentChange: fallbackPlayerMesh ? 'Legacy shoulder pet uses the upright owner heading.' : 'Body stays fixed between the two observation poses; curiosity yaw/pitch moves the head only.',
        rotationSource: finalTransform.rotationSource || finalTransform.faceRotationSource,
        positionSource: finalTransform.perchPositionSource,
        expectedWorldPosition: finalTransform.worldPosition.toArray(),
        authoredPerchWorldPosition: finalTransform.perchWorldPosition?.toArray?.() || null,
        alignedGripWorldPosition: alignedGripWorldPosition.toArray(),
        gripPerchError,
        gripPositionSource: finalTransform.gripLocalPosition ? 'rendered-group-matrix' : 'estimated-offset-fallback', // Mobile debug distinguishes measured vs algebraic grip placement.
        gripSource: finalTransform.gripSource || 'unavailable', // Mobile Pixel Probe shows which grip solved the final world attachment.
        authoritativeRootTransform: true,
        requestedRotationSource: finalTransform.requestedRotationSource,
        rotationSourceInverted: finalTransform.rotationSourceInverted,
        rotationalOffsetCancelled: finalTransform.rotationalOffsetCancelled,
        rotationFrameWorldQuaternion: finalTransform.rotationFrameWorldQuaternion?.toArray?.() || null,
        finalWorldQuaternion: worldQuaternion.toArray(), // Report the *actual applied* world orientation, including the legacy fallback repair.
        facingTowardPlayerCenter: finalTransform.facingTowardPlayerCenter === true,
        shoulderFacingTurnDeg: Number(finalTransform.shoulderFacingTurnDeg) || 0,
        shoulderLeanDeg: Number(finalTransform.shoulderLeanDeg) || 0, // Reports the local X lean solved around the grip instead of either sprite center.
        spriteMirrored: false,
        geometryConstraint: finalTransform.geometryConstraint || null, // Reports unavailable/no-safe-pose explicitly.
      };
      let canonicalPlaneRestored = group.userData.hobunjiShoulderSpriteCanonicalized === true;
      if (!canonicalPlaneRestored && finalTransform.perchWorldPosition) {
        canonicalPlaneRestored = window.ShoulderPetObservationFlip?.applyAtPinnedPerch?.(c, finalTransform.perchWorldPosition) === true;
        if (canonicalPlaneRestored) group.userData.hobunjiShoulderSpriteCanonicalized = true; // One-time hot-reload cleanup; no per-frame avatar traversal now that shoulder sprites never mirror.
      }
      group.userData.hobunjiShoulderPetAttachment.canonicalPlaneRestored = canonicalPlaneRestored;
    }

    return Object.freeze({
      solveSurfaceTransform: _shoulderPetSurfaceTransform,
      applyFinalTransform: _applyShoulderPetFinalTransform,
    }); // game.js calls these once per final shoulder-pet pin, not from a second render loop.
  }

  window.ShoulderPetAttachmentRuntime = Object.freeze({ create }); // Existing classic-script loader registers this before game.js.
})();
