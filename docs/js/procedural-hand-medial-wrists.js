// Gives non-tool/idle procedural hands a medial neutral wrist basis.
//
// Handedness/mirroring creates a left/right pair, but does not by itself turn
// idle palms toward the character centerline. Keep that anatomical default on
// idle/non-tool hands only. Tool-following hands must remain entirely governed
// by gripMode + the explicitly authored handFromTool transform, with no hidden
// +90deg rotation underneath the editor sliders.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  if (!hands?.attach || hands.attach.__hobunjiMedialWristsWrapped) return;

  const MEDIAL_YAW_DEG = 90;

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

    // During tool use, right-hand orientation is authored explicitly. Left is
    // still an idle/free hand, so keep only that side medial.
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

    global.requestAnimationFrame?.(applyLeft);
    return rig;
  };

  wrappedAttach.__hobunjiMedialWristsWrapped = true;
  hands.attach = wrappedAttach;

  global.HobunjiHandMedialWristBasis = Object.freeze({
    yawDeg: MEDIAL_YAW_DEG,
    appliesToToolDrivenRightHand: false,
  });
})(window);
