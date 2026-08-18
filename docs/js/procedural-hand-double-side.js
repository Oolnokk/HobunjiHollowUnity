// Hand GLBs are intentionally authored as thin/open character appendage meshes.
// Render both sides so the palm/fingers do not disappear when attacks turn the hand
// past the camera. This is scoped only to procedural hand rigs; it does not change
// culling for tools, portraits, or other scene meshes.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  if (!hands?.attach || hands.attach.__hobunjiDoubleSidedHandsWrapped) return;

  function makeDoubleSided(THREE, rig) {
    if (!THREE?.DoubleSide || !rig?.group?.traverse) return;
    rig.group.traverse(node => {
      if (!node?.isMesh || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material || material.side === THREE.DoubleSide) continue;
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      }
    });
  }

  const originalAttach = hands.attach.bind(hands);
  const wrappedAttach = function doubleSidedHandAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    if (!rig) return rig;

    makeDoubleSided(THREE, rig); // Covers the immediate fallback hand.

    const originalRefresh = rig.refreshModelProfile?.bind(rig);
    if (originalRefresh) {
      rig.refreshModelProfile = async function doubleSidedHandRefresh(...args) {
        const result = await originalRefresh(...args);
        makeDoubleSided(THREE, rig); // Covers the asynchronously installed GLB.
        return result;
      };
      // attach() starts its first GLB refresh before returning. Start one managed
      // refresh through this wrapper so the winning generation is guaranteed to
      // receive DoubleSide after installation; the shared GLB decode is cached.
      Promise.resolve(rig.refreshModelProfile()).catch(error => {
        console.warn('[procedural-hands] double-sided refresh failed:', error);
      });
    }
    return rig;
  };

  wrappedAttach.__hobunjiDoubleSidedHandsWrapped = true;
  hands.attach = wrappedAttach;
})(window);
