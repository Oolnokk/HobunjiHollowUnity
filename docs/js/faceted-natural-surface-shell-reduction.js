(() => {
  'use strict';

  const SHELL_LAYER = 1; // Existing inverted-shell render layer removed from faceted natural surfaces after their authored PNG edge treatment is applied.
  const FACETED_SURFACES = new Set(['rocks', 'cliffs']); // Natural surfaces whose irregular flat-face PNG mapping replaces a generated shell silhouette.
  const countedMeshes = new WeakSet(); // Prevents repeated remap/naturalize passes from inflating the mobile diagnostics.
  const stats = {
    naturalizeWrapInstalled: false,
    mapperWrapInstalled: false,
    foliageBoulderWrapInstalled: false,
    farmRockWrapInstalled: false,
    rocksSuppressed: 0,
    cliffsSuppressed: 0,
    shellLayerMembershipsRemoved: 0,
    proceduralBoulderMeshesStyled: 0,
    farmRockMeshesStyled: 0,
    farmRockPostPasses: 0,
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

  function naturalizeRockRoot(root) {
    const naturalSurfaces = window.NaturalSurfaceMaterials; // Canonical authored-PNG material/tint path used by farm cliffs and all other natural rock surfaces.
    if (!root || !naturalSurfaces?.naturalizeMesh) return 0;
    let changed = 0;
    const visit = object => {
      if (!object?.isMesh) return;
      naturalSurfaces.naturalizeMesh(object, 'rocks');
      suppressMesh(object, 'rocks');
      changed++;
    };
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

  function wrapProceduralBoulders() {
    const foliage = window.FoliageGenerator;
    const original = foliage?.buildBoulderMesh;
    if (!foliage || typeof original !== 'function' || original.__hobunjiFacetedSurfaceShellWrapped) return;
    function wrappedBuildBoulderMesh(...args) {
      const root = original.apply(this, args);
      stats.proceduralBoulderMeshesStyled += naturalizeRockRoot(root);
      return root;
    }
    wrappedBuildBoulderMesh.__hobunjiFacetedSurfaceShellWrapped = true;
    wrappedBuildBoulderMesh.__hobunjiFacetedSurfaceShellOriginal = original;
    foliage.buildBoulderMesh = wrappedBuildBoulderMesh;
    stats.foliageBoulderWrapInstalled = true;
  }

  function wrapFarmRockTiles() {
    const rendering = window.VegetationCropRendering;
    if (!rendering || rendering.__hobunjiFacetedSurfaceShellWrapped) return;
    let farmDeps = null; // Captured from VegetationCropRendering.init so post-build scans can identify the shared farm ROCK material without hardcoding colors.

    const originalInit = rendering.init;
    if (typeof originalInit === 'function') {
      rendering.init = function (injectedDeps, ...args) {
        farmDeps = injectedDeps;
        return originalInit.call(this, injectedDeps, ...args);
      };
    }

    function styleCurrentFarmRockMeshes() {
      const scene = farmDeps?.scene; // Farm scene whose tile renderer may directly enable shell layer 1 after constructing ROCK mound meshes.
      const rockType = farmDeps?.TileType?.ROCK;
      const rockMaterial = rockType != null ? farmDeps?.resolveTileMat?.('farm', rockType) : null; // Shared pre-naturalization material used to distinguish stone mound geometry from its grass floor/top pieces.
      if (!scene?.traverse || !rockMaterial) return 0;
      let changed = 0;
      scene.traverse(object => {
        if (!object?.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const alreadyNaturalRock = object.userData?.naturalSurface === 'rocks'
          || materials.some(material => material?.userData?.naturalSurface === 'rocks');
        if (!alreadyNaturalRock && !materials.includes(rockMaterial)) return;
        const wasNaturalRock = alreadyNaturalRock;
        naturalizeRockRoot(object);
        if (!wasNaturalRock) stats.farmRockMeshesStyled++;
        changed++;
      });
      stats.farmRockPostPasses++;
      return changed;
    }

    for (const name of ['buildTileMeshes', 'refreshTileMesh']) {
      const original = rendering[name];
      if (typeof original !== 'function') continue;
      rendering[name] = function (...args) {
        const result = original.apply(this, args);
        styleCurrentFarmRockMeshes(); // Runs after the legacy tile renderer's deps.markOutline/layer-enable calls, making the authored PNG treatment authoritative.
        return result;
      };
    }

    rendering.__hobunjiFacetedSurfaceShellWrapped = true;
    stats.farmRockWrapInstalled = true;
  }

  wrapNaturalize();
  wrapSurfaceMapper();
  wrapProceduralBoulders();
  wrapFarmRockTiles();

  window.FacetedNaturalSurfaceShellReduction = {
    installed: true,
    apply,
    suppressMesh,
    naturalizeRockRoot,
    snapshot() {
      return Object.assign({}, stats, {
        policy: 'rocks/cliffs use authored irregular-surface PNG outlines; rounded natural meshes may retain shell outlines',
      });
    },
  };
})();
