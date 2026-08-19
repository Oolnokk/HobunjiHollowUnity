// Applies approved/authored semantic hand axes to the reusable hand visual groups.
//
// Grip sockets and handFromTool offsets remain untouched. This layer only rotates
// each loaded GLB from its raw local Fingers/Thumb/Palm convention into the shared
// semantic hand frame, so editor close-up and gameplay see the same model orientation.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralHandAttachments;
  const basisApi = global.HobunjiHandToolSemanticBasis;
  if (!profiles || !hands?.attach || !basisApi) return;
  if (hands.attach.__hobunjiSemanticHandBasisWrapped) return;

  const activeRigs = new Set(); // Live editor/game hand pairs that need semantic refresh after model/profile changes.

  function correctionForRig(rig) {
    return basisApi.handRawToCanonicalQuaternionForSpecies?.(rig?.speciesId) || null;
  }

  function applyVisual(rig, side) {
    const visual = rig?.group?.getObjectByName?.(`${side}_hand_visual`);
    if (!visual?.quaternion) return false;

    visual.userData = visual.userData || {};
    if (!visual.userData.hobunjiSemanticHandBaseQuaternion) {
      visual.userData.hobunjiSemanticHandBaseQuaternion = {
        x: Number(visual.quaternion.x) || 0,
        y: Number(visual.quaternion.y) || 0,
        z: Number(visual.quaternion.z) || 0,
        w: Number.isFinite(Number(visual.quaternion.w)) ? Number(visual.quaternion.w) : 1,
      };
    }

    const base = visual.userData.hobunjiSemanticHandBaseQuaternion;
    const correction = correctionForRig(rig);
    visual.quaternion.set(base.x, base.y, base.z, base.w);
    if (correction) visual.quaternion.multiply(correction).normalize();
    visual.userData.hobunjiSemanticHandBasisApplied = !!correction;
    visual.userData.hobunjiSemanticHandModelKey = profiles.modelKeyForSpecies?.(rig?.speciesId) || null;
    visual.updateMatrix?.();
    visual.updateMatrixWorld?.(true);
    return true;
  }

  function applyRig(rig) {
    if (!rig) return false;
    const left = applyVisual(rig, 'left');
    const right = applyVisual(rig, 'right');
    return left || right;
  }

  function refreshAll() {
    let refreshed = 0;
    for (const rig of [...activeRigs]) {
      if (!rig?.group?.parent) {
        activeRigs.delete(rig);
        continue;
      }
      if (applyRig(rig)) refreshed += 1;
    }
    return refreshed;
  }

  function settle(result, callback) {
    Promise.resolve(result).then(callback, callback);
  }

  const originalAttach = hands.attach;
  const wrappedAttach = function semanticHandBasisAttach(...args) {
    const rig = originalAttach.apply(this, args);
    if (!rig) return rig;

    activeRigs.add(rig);
    applyRig(rig);

    const originalRefresh = typeof rig.refreshModelProfile === 'function'
      ? rig.refreshModelProfile.bind(rig)
      : null;
    if (originalRefresh) {
      rig.refreshModelProfile = function semanticHandBasisRefresh(...refreshArgs) {
        const result = originalRefresh(...refreshArgs);
        settle(result, () => {
          applyRig(rig);
          global.requestAnimationFrame?.(() => applyRig(rig));
        });
        return result;
      };
    }

    const originalDebug = typeof rig.getDebug === 'function' ? rig.getDebug.bind(rig) : null;
    if (originalDebug) {
      rig.getDebug = function semanticHandBasisDebug() {
        const basis = basisApi.handBasisForSpecies?.(rig.speciesId) || null;
        const left = rig.group?.getObjectByName?.('left_hand_visual');
        const right = rig.group?.getObjectByName?.('right_hand_visual');
        return {
          ...originalDebug(),
          semanticHandBasis: basis ? {
            source: basis.source,
            complete: basis.complete,
            valid: basis.valid,
            axes: basis.axes || null,
            handedness: basis.handedness || null,
          } : null,
          semanticHandBasisApplied: {
            left: left?.userData?.hobunjiSemanticHandBasisApplied === true,
            right: right?.userData?.hobunjiSemanticHandBasisApplied === true,
          },
        };
      };
    }

    const originalDispose = typeof rig.dispose === 'function' ? rig.dispose.bind(rig) : null;
    if (originalDispose) {
      rig.dispose = function semanticHandBasisDispose(...disposeArgs) {
        activeRigs.delete(rig);
        return originalDispose(...disposeArgs);
      };
    }

    return rig;
  };

  wrappedAttach.__hobunjiSemanticHandBasisWrapped = true;
  wrappedAttach.__hobunjiSemanticHandBasisOriginal = originalAttach;
  hands.attach = wrappedAttach;

  // Profile edits may alter the hand semantic axes without rebuilding the whole
  // close-up. Reapply on the next frame while preserving the authored grip frame.
  profiles.subscribe?.(() => global.requestAnimationFrame?.(refreshAll));

  global.ProceduralHandSemanticBasisRuntime = Object.freeze({
    refreshAll,
    getDebug() {
      return {
        activeRigs: activeRigs.size,
        rigs: [...activeRigs].map(rig => ({
          speciesId: rig?.speciesId || null,
          modelKey: profiles.modelKeyForSpecies?.(rig?.speciesId) || null,
          basis: basisApi.handBasisForSpecies?.(rig?.speciesId) || null,
          correction: correctionForRig(rig),
        })),
      };
    },
  });
})(window);
