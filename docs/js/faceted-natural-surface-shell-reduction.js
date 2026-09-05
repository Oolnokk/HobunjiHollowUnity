(() => {
  'use strict';

  const SHELL_LAYER = 1; // Existing inverted-shell render layer removed from faceted natural surfaces after their authored PNG edge treatment is applied.
  const FACETED_SURFACES = new Set(['rocks', 'cliffs']); // Natural surfaces whose irregular flat-face PNG mapping replaces a generated shell silhouette.
  const countedMeshes = new WeakSet(); // Prevents repeated remap/naturalize passes from inflating the mobile diagnostics.
  const stats = {
    naturalizeWrapInstalled: false,
    mapperWrapInstalled: false,
    rocksSuppressed: 0,
    cliffsSuppressed: 0,
    shellLayerMembershipsRemoved: 0,
  }; // Exposed through snapshot() for mobile-friendly verification.

  function materialSurface(mesh) {
    const direct = mesh?.userData?.naturalSurface;
    if (FACETED_SURFACES.has(direct)) return direct;
    if (mesh?.userData?.naturalSurfaceCliffSlot != null) return 'cliffs';
    const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
    for (const material of materials) {
      const surface = material?.userData?.naturalSurface;
      if (FACETED_SURFACES.has(surface)) return surface;
    }
    return null;
  }

  function suppressMesh(mesh, requestedSurface = null) {
    if (!mesh?.isMesh) return false;
    const surface = FACETED_SURFACES.has(requestedSurface) ? requestedSurface : materialSurface(mesh);
    if (!FACETED_SURFACES.has(surface)) return false;

    const hadShellLayer = !!(mesh.layers && (mesh.layers.mask & (1 << SHELL_LAYER)) !== 0);
    mesh.layers?.disable(SHELL_LAYER);
    mesh.userData = Object.assign({}, mesh.userData, {
      noOutline: true,
      facetedSurfaceTextureOutline: true,
      shellOutlineDisabledReason: 'faceted-surface-texture-outline',
    });

    if (!countedMeshes.has(mesh)) {
      countedMeshes.add(mesh);
      stats[surface === 'rocks' ? 'rocksSuppressed' : 'cliffsSuppressed']++;
    }
    if (hadShellLayer) stats.shellLayerMembershipsRemoved++;
    return true;
  }

  function apply(root, requestedSurface = null) {
    if (!root) return 0;
    let changed = 0;
    const visit = object => { if (suppressMesh(object, requestedSurface)) changed++; };
    if (root.isMesh) visit(root);
    root.traverse?.(object => { if (object !== root) visit(object); });
    return changed;
  }

  function wrapNaturalize() {
    const api = window.NaturalSurfaceMaterials;
    const original = api?.naturalizeMesh;
    if (!api || typeof original !== 'function' || original.__hobunjiFacetedSurfaceShellWrapped) return;
    function wrappedNaturalizeMesh(mesh, surface, ...args) {
      const result = original.call(this, mesh, surface, ...args);
      suppressMesh(result || mesh, surface);
      return result;
    }
    wrappedNaturalizeMesh.__hobunjiFacetedSurfaceShellWrapped = true;
    wrappedNaturalizeMesh.__hobunjiFacetedSurfaceShellOriginal = original;
    api.naturalizeMesh = wrappedNaturalizeMesh;
    stats.naturalizeWrapInstalled = true;
  }

  function wrapSurfaceMapper() {
    const mapper = window.HobunjiSurfaceStretchUV;
    const original = mapper?.remapNaturalTerrainMesh;
    if (!mapper || typeof original !== 'function' || original.__hobunjiFacetedSurfaceShellWrapped) return;
    function wrappedRemapNaturalTerrainMesh(mesh, ...args) {
      const report = original.call(this, mesh, ...args);
      suppressMesh(mesh);
      return report;
    }
    wrappedRemapNaturalTerrainMesh.__hobunjiFacetedSurfaceShellWrapped = true;
    wrappedRemapNaturalTerrainMesh.__hobunjiFacetedSurfaceShellOriginal = original;
    mapper.remapNaturalTerrainMesh = wrappedRemapNaturalTerrainMesh;
    stats.mapperWrapInstalled = true;
  }

  wrapNaturalize();
  wrapSurfaceMapper();

  window.FacetedNaturalSurfaceShellReduction = {
    installed: true,
    apply,
    suppressMesh,
    snapshot() {
      return Object.assign({}, stats, {
        policy: 'rocks/cliffs use authored irregular-surface PNG outlines; rounded natural meshes may retain shell outlines',
      });
    },
  };
})();
