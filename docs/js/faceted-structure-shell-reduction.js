(() => {
  'use strict';

  const HousePieceGen = window.HousePieceGen;
  if (!HousePieceGen || typeof HousePieceGen.buildGroup !== 'function') return;

  const originalBuildGroup = HousePieceGen.buildGroup;
  if (originalBuildGroup.__hobunjiFacetedShellReductionWrapped) return;

  let processedWallGroups = 0; // Debug counter: WallBuilder groups whose descendants were removed from shell layer 1.
  let processedWallMeshes = 0; // Debug counter: individual brick meshes/instanced meshes removed from shell layer 1.

  function disableShellOnWallBricks(root) {
    if (!root?.traverse) return root;
    root.traverse((object) => {
      if (!object?.userData?.isWallBricks) return;
      processedWallGroups++;
      object.traverse?.((child) => {
        if (!child?.isMesh || !child.layers) return;
        if ((child.layers.mask & (1 << 1)) !== 0) processedWallMeshes++;
        child.layers.disable(1);
        child.userData = child.userData || {};
        child.userData.shellOutlineDisabledReason = 'faceted-texture-outline';
      });
    });
    return root;
  }

  function buildGroupWithoutBrickShells(...args) {
    const result = originalBuildGroup.apply(this, args);
    return result && typeof result.then === 'function'
      ? result.then(disableShellOnWallBricks)
      : disableShellOnWallBricks(result);
  }

  buildGroupWithoutBrickShells.__hobunjiFacetedShellReductionWrapped = true;
  buildGroupWithoutBrickShells.__hobunjiFacetedShellReductionOriginal = originalBuildGroup;
  HousePieceGen.buildGroup = buildGroupWithoutBrickShells;

  window.FacetedStructureShellReduction = {
    installed: true,
    brickShellOutlinesDisabled: true,
    snapshot() {
      return {
        installed: true,
        brickShellOutlinesDisabled: true,
        processedWallGroups,
        processedWallMeshes,
        policy: 'faceted structures use authored texture outlines; rounded meshes may keep shell outlines',
      };
    },
  };
})();
