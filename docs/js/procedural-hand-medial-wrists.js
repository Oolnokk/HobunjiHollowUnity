// Gives procedural hands a medial neutral wrist basis.
//
// The authored source GLBs are front/back-facing hands. Mirroring creates the
// left/right pair, but handedness alone does not rotate either palm toward the
// character centerline. Add a shared +90deg body-local yaw to tool-following
// hand transforms, and keep the non-tool/idle hand on that same medial basis.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralArmAnimation;
  if (!profiles || !hands?.attach) return;
  if (hands.attach.__hobunjiMedialWristsWrapped) return;

  const MEDIAL_YAW_DEG = 90;

  // Grip modes already wrap handTransformForSpecies. Layer the wrist basis on
  // top so model fine-alignment and palm-parallel/perpendicular remain additive.
  const originalHandTransformForSpecies = profiles.handTransformForSpecies?.bind(profiles);
  if (originalHandTransformForSpecies && !profiles.__hobunjiMedialWristTransformWrapped) {
    profiles.handTransformForSpecies = function medialHandTransformForSpecies(speciesId) {
      const transform = originalHandTransformForSpecies(speciesId) || {};
      const position = transform.position || {};
      const rotation = transform.rotationDeg || {};
      return {
        position: {
          x: Number(position.x) || 0,
          y: Number(position.y) || 0,
          z: Number(position.z) || 0,
        },
        rotationDeg: {
          pitch: Number(rotation.pitch) || 0,
          yaw: (Number(rotation.yaw) || 0) + MEDIAL_YAW_DEG,
          roll: Number(rotation.roll) || 0,
        },
      };
    };
    Object.defineProperty(profiles, '__hobunjiMedialWristTransformWrapped', { value: true, configurable: true });
  }

  function applyMedialWorldBasis(THREE, rig, sides) {
    if (!THREE || !rig?.group?.getObjectByName) return;
    rig.group.updateWorldMatrix?.(true, true);

    const rootWorld = new THREE.Quaternion();
    rig.group.getWorldQuaternion(rootWorld);
    const medialLocal = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      0,
      THREE.MathUtils.degToRad(MEDIAL_YAW_DEG),
      0,
      'YXZ',
    ));
    const desiredWorld = rootWorld.clone().multiply(medialLocal);

    for (const side of sides) {
      const hand = rig.group.getObjectByName(`${side}_hand_socket`);
      if (!hand?.parent) continue;
      hand.parent.updateWorldMatrix?.(true, false);
      const parentWorld = new THREE.Quaternion();
      hand.parent.getWorldQuaternion(parentWorld);
      hand.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
      hand.updateMatrix?.();
      hand.updateMatrixWorld?.(true);
    }
  }

  const originalAttach = hands.attach.bind(hands);
  const wrappedAttach = function medialWristAwareAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    if (!rig) return rig;

    const applyLeft = () => applyMedialWorldBasis(THREE, rig, ['left']);
    const applyBoth = () => applyMedialWorldBasis(THREE, rig, ['left', 'right']);

    // Left is normally not driven by the held tool, so keep it medial while the
    // right hand follows grip modes through the frame driver.
    const originalFollowWorldTarget = rig.followWorldTarget?.bind(rig);
    if (originalFollowWorldTarget) {
      rig.followWorldTarget = function medialWristWorldTarget(...args) {
        const result = originalFollowWorldTarget(...args);
        applyLeft();
        return result;
      };
    }

    const originalFollowLocalTarget = rig.followLocalTarget?.bind(rig);
    if (originalFollowLocalTarget) {
      rig.followLocalTarget = function medialWristLocalTarget(...args) {
        const result = originalFollowLocalTarget(...args);
        applyLeft();
        return result;
      };
    }

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function medialWristIdlePose(...args) {
        const result = originalUseIdlePose(...args);
        applyBoth();
        return result;
      };
    }

    const originalRefresh = rig.refreshModelProfile?.bind(rig);
    if (originalRefresh) {
      rig.refreshModelProfile = async function medialWristRefresh(...args) {
        const result = await originalRefresh(...args);
        applyLeft();
        return result;
      };
    }

    // The first GLB refresh starts during attach(), before wrappers above exist.
    // Reapply on the next frame so the initial non-tool hand also starts medial.
    global.requestAnimationFrame?.(applyLeft);
    return rig;
  };

  wrappedAttach.__hobunjiMedialWristsWrapped = true;
  hands.attach = wrappedAttach;

  global.HobunjiHandMedialWristBasis = Object.freeze({ yawDeg: MEDIAL_YAW_DEG });
})(window);
