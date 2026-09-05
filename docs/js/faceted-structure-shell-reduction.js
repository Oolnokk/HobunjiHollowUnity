(() => {
  'use strict';

  const HousePieceGen = window.HousePieceGen;
  if (!HousePieceGen) return;

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

  function wrapBuildMethod(name) {
    const original = HousePieceGen[name];
    if (typeof original !== 'function' || original.__hobunjiFacetedShellReductionWrapped) return false;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      return result && typeof result.then === 'function'
        ? result.then(disableShellOnWallBricks)
        : disableShellOnWallBricks(result);
    };
    wrapped.__hobunjiFacetedShellReductionWrapped = true;
    wrapped.__hobunjiFacetedShellReductionOriginal = original;
    HousePieceGen[name] = wrapped;
    return true;
  }

  const wrappedBuildGroup = wrapBuildMethod('buildGroup'); // Covers generated Highland-base houses that use the convenience entrypoint.
  const wrappedBuildGroupFromPiece = wrapBuildMethod('buildGroupFromPiece'); // Covers town houses, barns, incubator additions, and authored modular pieces.
  if (!wrappedBuildGroup && !wrappedBuildGroupFromPiece) return;

  window.FacetedStructureShellReduction = {
    installed: true,
    brickShellOutlinesDisabled: true,
    snapshot() {
      return {
        installed: true,
        brickShellOutlinesDisabled: true,
        wrappedBuildGroup,
        wrappedBuildGroupFromPiece,
        processedWallGroups,
        processedWallMeshes,
        policy: 'faceted structures use authored texture outlines; rounded meshes may keep shell outlines',
      };
    },
  };
})();
