// Applies the per-model source-X mirror convention to procedural hand GLBs.
// Authored assets are treated as LEFT-hand sources by default: left uses the
// source transform and right is mirrored across local X. Setting mirrorX=false
// opts a particular model back into the opposite/source-right convention.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  const profiles = global.HobunjiHandModelProfiles;
  if (!hands?.attach || !profiles || hands.attach.__hobunjiModelMirrorWrapped) return;

  function wantsMirror(rig) {
    const model = profiles.modelForSpecies?.(rig?.speciesId);
    return model?.mirrorX === true;
  }

  function applyMirror(rig) {
    if (!rig?.group?.getObjectByName) return;
    const mirrored = wantsMirror(rig);
    const right = rig.group.getObjectByName('right_hand_socket');
    const left = rig.group.getObjectByName('left_hand_socket');

    // Normalize from magnitude so repeated profile refreshes/toggle changes never
    // accumulate sign flips. mirrorX=true means source-left: left stays source,
    // right gets the X reflection. false reverses that convention for one GLB.
    if (right?.scale) right.scale.x = Math.abs(right.scale.x || 1) * (mirrored ? -1 : 1);
    if (left?.scale) left.scale.x = Math.abs(left.scale.x || 1) * (mirrored ? 1 : -1);

    if (right?.userData) right.userData.sourceMirrorX = mirrored;
    if (left?.userData) left.userData.sourceMirrorX = mirrored;
  }

  const originalAttach = hands.attach.bind(hands);
  const wrappedAttach = function modelMirrorAwareAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    if (!rig) return rig;

    applyMirror(rig);

    const originalRefresh = rig.refreshModelProfile?.bind(rig);
    if (originalRefresh) {
      rig.refreshModelProfile = async function modelMirrorAwareRefresh(...args) {
        const result = await originalRefresh(...args);
        applyMirror(rig);
        return result;
      };
      // attach() begins one async load before wrappers can observe it. Start one
      // managed refresh so the winning generation is guaranteed to receive the
      // requested mirror state after its GLB is installed.
      Promise.resolve(rig.refreshModelProfile()).catch(error => {
        console.warn('[procedural-hands] mirrored hand refresh failed:', error);
      });
    }
    return rig;
  };

  wrappedAttach.__hobunjiModelMirrorWrapped = true;
  hands.attach = wrappedAttach;
})(window);
