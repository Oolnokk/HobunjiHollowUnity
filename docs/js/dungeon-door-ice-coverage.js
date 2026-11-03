// Generic door-surface ice: generated from the real door leaf's size, never a
// translucent rectangular sheet. Dungeon Fire owns collision and melt timing.
(function () {
  'use strict';

  const THREE = window.THREE; // Uses the same Three.js runtime as furniture and dungeon mechanisms.
  const REFERENCE_HEIGHT = 3.1; // The authored ruinGreatDoor's 3.1-unit leaf is the size reference, not a required door ID.
  const REFERENCE = Object.freeze({ // Values sampled from the uploaded boss-door ice recipe; scale with each target's height.
    count: 26, density: .9, radius: .5, iceHeightMin: 2, iceHeightMax: 3,
    iceCluster: 4, iceEngulf: .75, iceFootprintPadding: .3, iceFacets: 5,
    iceTipSharpness: .8, iceLean: .15, iceRoughness: .22,
    iceOpacity: .93, color: '#bcecff'
  });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value)); // Bounds atypical furniture and malformed imported door dimensions.

  function physicalLeaf(root) {
    if (!root?.traverse) return root;
    let preferred = null; // Choose the actual moving leaf over an outer arch/ornament whenever an author supplies one.
    root.traverse(child => {
      if (preferred || !child.isMesh || !child.geometry || child.userData?.surfaceFoliage) return;
      const id = String(child.userData?.authoredPartId || child.userData?.id || child.name || '').toLowerCase();
      if (/(?:^|[_\s-])leaf(?:$|[_\s-])|door[\s_-]*(?:leaf|panel|slab)/.test(id)) preferred = child;
    });
    if (preferred) return preferred;
    const livePanel = root.userData?.__devRuinTransitDoorState?.panel; // Runtime owns the authoritative retracting panel for hallway transit doors.
    if (livePanel?.isMesh && livePanel.geometry) return livePanel; // Avoid frosting a stationary decorative frame when panel order differs.
    if (root.userData?.transitDoor || root.userData?.previewMotion?.type === 'stoneDoor') {
      // Match the actual interior runtime's first-render-mesh panel selection; a stone arch is not the movable door leaf.
      return (root.children || []).find(child => child.isMesh && child.geometry && !child.userData?.surfaceFoliage) || root;
    }
    return root;
  }

  function doorBounds(door) {
    if (!THREE || !door?.isObject3D) return null;
    const source = physicalLeaf(door); // Source choice is independent of the door's animation or mechanism class.
    source.updateWorldMatrix?.(true, true);
    const box = new THREE.Box3().setFromObject(source); // Real world-space leaf geometry, not a guessed doorway tile.
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3()); // World-space scaling supports authored, generated and modular doors.
    const center = box.getCenter(new THREE.Vector3()); // Ice is placed at this physical door, even if it is offset from the doorway center.
    if (![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite) || size.y < .3) return null;
    return { source, size, center, box };
  }

  function authoredIceLayer(door) {
    let layer = null; // Reuse an existing authored ice layer instead of rendering a second coat on top of it.
    door?.traverse?.(child => {
      if (!layer && child.userData?.iceStalagmites && child.children.some(mesh => mesh.userData?.iceCoverage)) layer = child;
    });
    return layer;
  }

  function scaledRecipe(height, seed, overrides = {}) {
    const sizeRatio = clamp(height / REFERENCE_HEIGHT, .45, 1.35); // Smaller doors receive proportionately shorter, thinner ice; boss doors keep the uploaded dimensions.
    const preset = { ...REFERENCE,
      radius: REFERENCE.radius * sizeRatio, iceHeightMin: REFERENCE.iceHeightMin * sizeRatio,
      iceHeightMax: REFERENCE.iceHeightMax * sizeRatio,
      iceFootprintPadding: REFERENCE.iceFootprintPadding * sizeRatio,
      seed: String(seed || 'dungeon-door-ice').slice(0, 128),
      kind: 'iceStalagmites', target: 'all', targetIds: [], texture: ''
    }; // All door kinds share one author-derived ice recipe, never a special boss-door visual asset.
    return window.FoliageGenerator?.normalizeSurfaceGrowth?.({ ...preset, ...overrides, kind: 'iceStalagmites' }) || null;
  }

  function create({ door, parent, groundY, seed, recipe: overrides = {} } = {}) {
    const geometry = doorBounds(door); // Door type affects only which object is passed; one geometry pipeline handles them all.
    if (!geometry || !parent?.isObject3D) return null;
    if (!window.IceStalagmiteCoverage?.build || !window.IceStalagmiteCoverage?.setGrowth || !window.FoliageGenerator?.normalizeSurfaceGrowth) return null;
    const existing = authoredIceLayer(door); // Original furniture coverage is itself a valid shrinkable Dungeon Fire target.
    const height = clamp(geometry.size.y, 1.25, 5); // Floor-grown spikes stay visually proportionate on tiny and boss-sized doors.
    const baseline = Number.isFinite(groundY) ? groundY : geometry.box.min.y; // Prefer the actual walkable floor over the moving door panel.
    const recipe = scaledRecipe(height, seed, overrides); // Defaults reproduce the submitted 2–3-unit high, .5-radius boss-door example.
    if (existing) {
      window.IceStalagmiteCoverage.setGrowth(existing, 1); // Preserve author-specified ice geometry without duplicating its material or recipes.
      return { iceLayer: existing, ownsLayer: false, recipe, geometry, groundY: baseline };
    }
    const source = new THREE.Group(); // Temporary geometry source is never inserted into the scene or collision system.
    const width = Math.max(.18, Math.min(6, geometry.size.x)); // Actual horizontal face breadth becomes the cluster footprint.
    const depth = Math.max(.18, Math.min(6, geometry.size.z)); // A thin door leaf still receives ice on its front and back.
    const proxyGeometry = new THREE.BoxGeometry(width, height, depth); // Invisible temporary stand-in retains the real door leaf's physical dimensions.
    const proxyMaterial = new THREE.MeshBasicMaterial(); // Never rendered; disposed immediately after copying its bounds.
    const proxy = new THREE.Mesh(proxyGeometry, proxyMaterial); // Shared furniture generator recognizes this single authored part.
    proxy.userData.authoredPartId = 'dungeon_door_ice_surface'; // Prevents the generator treating arbitrary scene meshes as source geometry.
    proxy.position.y = height * .5; // Every crystal grows upward from the door's actual ground baseline.
    source.add(proxy);
    let layer; // One merged geometry is created by the existing furniture-ice builder.
    try { layer = window.IceStalagmiteCoverage.build(THREE, source, recipe); }
    finally { proxyGeometry.dispose(); proxyMaterial.dispose(); }
    if (!layer?.userData?.surfaceGrowthStats?.spikes) return null; // No empty ice blockers if geometry could not be generated.
    layer.name = 'dungeon_door_ice_coverage';
    layer.position.set(geometry.center.x, baseline, geometry.center.z); // Keep ice in world space when the underlying door animates.
    layer.userData.dungeonDoorIce = true; // Debug tools can distinguish dungeon fire ice from ordinary furniture coverage.
    parent.add(layer);
    return { iceLayer: layer, ownsLayer: true, recipe, geometry, groundY: baseline };
  }

  function setGrowth(record, value) {
    const layer = record?.iceLayer || record; // Accept a placement record or an authored/furniture ice group directly.
    return window.IceStalagmiteCoverage?.setGrowth?.(layer, value) === true;
  }

  function clear(record) {
    if (!record?.iceLayer) return;
    if (!record.ownsLayer) setGrowth(record, 1); // A borrowed authored layer must remain intact after a dungeon reroll.
    // Owned geometry is disposed by the existing composer-group teardown; do not double-dispose it here.
  }

  window.DungeonDoorIceCoverage = Object.freeze({ REFERENCE, doorBounds, scaledRecipe, create, setGrowth, clear });
})();
