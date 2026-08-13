(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE || window.WildernessTerrainCleanup?.installed) return;

  const DEFAULTS = {
    hideLegacyWeedSlabs: true,
    naturalizeLegacyRockTiles: true,
    naturalizeDenMounds: true,
    frustumRockFormation: {
      enabled: true,
      slopeWidthTiles: 0.82,
      middleFraction: 0.50,
    },
  };
  const config = Object.assign({}, DEFAULTS, window.WildernessTerrainCleanupConfig || {});
  config.frustumRockFormation = Object.assign(
    {},
    DEFAULTS.frustumRockFormation,
    window.WildernessTerrainCleanupConfig?.frustumRockFormation || {}
  );

  const stats = {
    installs: 0,
    weedMeshesHidden: 0,
    legacyRockMeshesNaturalized: 0,
    rockFormationMeshesSloped: 0,
    rockFormationSpansSloped: 0,
    denMeshesNaturalized: 0,
  };

  const colorHex = (mat) => mat?.color?.isColor ? mat.color.getHex() : null;
  const plainLambert = (mesh, hex) => {
    const mat = Array.isArray(mesh?.material) ? null : mesh?.material;
    return !!(mesh?.isMesh && mat?.isMeshLambertMaterial && !mat.map && colorHex(mat) === hex);
  };

  function surfaceY(tile) {
    if (!tile) return null;
    if (tile.type === 'ramp') return Number(tile.rampElevation || 0);
    return Number(tile.elevTier || 0);
  }

  function lowerSideForSpan(axis, edgeCoord, alongCoord, zGrid) {
    if (axis === 'x') {
      const edge = Math.round(edgeCoord);
      const row = Math.max(0, Math.floor(alongCoord));
      const left = surfaceY(zGrid?.[row]?.[edge - 1]);
      const right = surfaceY(zGrid?.[row]?.[edge]);
      if (left != null && right != null && Math.abs(left - right) > 1e-5) return left < right ? -1 : 1;
      if (left != null && right == null) return -1;
      if (right != null && left == null) return 1;
      return 0;
    }
    const edge = Math.round(edgeCoord);
    const col = Math.max(0, Math.floor(alongCoord));
    const north = surfaceY(zGrid?.[edge - 1]?.[col]);
    const south = surfaceY(zGrid?.[edge]?.[col]);
    if (north != null && south != null && Math.abs(north - south) > 1e-5) return north < south ? -1 : 1;
    if (north != null && south == null) return -1;
    if (south != null && north == null) return 1;
    return 0;
  }

  // buildRockFormationMeshes emits one 3x3 vertex patch per solved edge span:
  // row 0 is the top edge, row 2 the bottom. Pull the lower rows outward
  // toward the lower-elevation side so the old vertical sheet becomes the
  // same broad one-tile frustum/slope language used by plateau cliffs.
  function slopeRockFormation(mesh, zGrid) {
    const cfg = config.frustumRockFormation;
    if (!cfg.enabled || !mesh?.geometry || mesh.userData?.frustumRockFormation) return 0;
    const pos = mesh.geometry.getAttribute?.('position');
    if (!pos || pos.count < 9 || pos.count % 9 !== 0) return 0;

    const width = Math.max(0, Math.min(1.5, Number(cfg.slopeWidthTiles) || 0));
    const middle = Math.max(0, Math.min(1, Number(cfg.middleFraction) || 0.5));
    let changed = 0;

    for (let base = 0; base < pos.count; base += 9) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      let avgX = 0, avgZ = 0;
      for (let i = 0; i < 9; i++) {
        const x = pos.getX(base + i), z = pos.getZ(base + i);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        avgX += x; avgZ += z;
      }
      avgX /= 9; avgZ /= 9;
      const axis = (maxX - minX) < (maxZ - minZ) ? 'x' : 'z';
      const dir = axis === 'x'
        ? lowerSideForSpan('x', avgX, avgZ, zGrid)
        : lowerSideForSpan('z', avgZ, avgX, zGrid);
      if (!dir) continue;

      // Vertex order is j-major: 0..2 top, 3..5 middle, 6..8 bottom.
      for (let j = 1; j <= 2; j++) {
        const fraction = j === 1 ? middle : 1;
        const offset = dir * width * fraction;
        for (let i = 0; i < 3; i++) {
          const vi = base + j * 3 + i;
          if (axis === 'x') pos.setX(vi, pos.getX(vi) + offset);
          else pos.setZ(vi, pos.getZ(vi) + offset);
        }
      }
      changed++;
    }

    if (!changed) return 0;
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals?.();
    mesh.geometry.computeBoundingBox?.();
    mesh.geometry.computeBoundingSphere?.();
    mesh.userData = Object.assign({}, mesh.userData, {
      frustumRockFormation: true,
      cliffShape: 'frustum',
      frustumSlopeWidthTiles: width,
    });
    stats.rockFormationMeshesSloped++;
    stats.rockFormationSpansSloped += changed;
    return changed;
  }

  function naturalizeLegacyFloorOverlays(scene) {
    if (!scene?.children) return;
    for (const mesh of scene.children) {
      if (!mesh?.isMesh) continue;
      if (config.hideLegacyWeedSlabs && plainLambert(mesh, 0x247c3c)) {
        mesh.visible = false;
        mesh.userData = Object.assign({}, mesh.userData, {
          wildernessOverlayPlaceholder: 'weeds',
          hiddenByWildernessTerrainCleanup: true,
        });
        stats.weedMeshesHidden++;
        continue;
      }
      if (config.naturalizeLegacyRockTiles && plainLambert(mesh, 0x79807c)) {
        window.NaturalSurfaceMaterials?.naturalizeMesh?.(mesh, 'rocks', 'planar-stretch');
        mesh.userData = Object.assign({}, mesh.userData, {
          wildernessLegacyRockSurface: true,
        });
        stats.legacyRockMeshesNaturalized++;
      }
    }
  }

  function wrapTerrainFeatures(api) {
    if (!api || api.__wildernessTerrainCleanupWrapped) return api;
    const original = api.buildRockFormationMeshes;
    if (typeof original === 'function') {
      api.buildRockFormationMeshes = function (scene, zGrid, ...rest) {
        const before = scene?.children?.length || 0;
        const result = original.call(this, scene, zGrid, ...rest);
        const added = scene?.children?.slice(before) || [];
        for (const mesh of added) if (mesh?.isMesh) slopeRockFormation(mesh, zGrid);
        naturalizeLegacyFloorOverlays(scene);
        return result;
      };
    }
    api.__wildernessTerrainCleanupWrapped = true;
    return api;
  }

  function wrapDenTotemFeatures(api) {
    if (!api || api.__wildernessTerrainCleanupWrapped) return api;
    const original = api.buildAnimalDenMeshes;
    if (typeof original === 'function') {
      api.buildAnimalDenMeshes = function (scene, ...args) {
        const before = scene?.children?.length || 0;
        const result = original.call(this, scene, ...args);
        if (config.naturalizeDenMounds) {
          for (const mesh of scene?.children?.slice(before) || []) {
            if (!mesh?.isMesh) continue;
            window.NaturalSurfaceMaterials?.naturalizeMesh?.(mesh, 'rocks', 'planar-stretch');
            mesh.userData = Object.assign({}, mesh.userData, {
              generatedFeature: 'animalDenMound',
            });
            stats.denMeshesNaturalized++;
          }
        }
        return result;
      };
    }
    api.__wildernessTerrainCleanupWrapped = true;
    return api;
  }

  function install() {
    if (window.WildernessTerrainCleanup?.runtimeInstalled) return true;
    const terrain = window.ZoneTerrainFeatures;
    const den = window.ZoneDenTotemFeatures;
    if (!terrain || !den) return false;
    wrapTerrainFeatures(terrain);
    wrapDenTotemFeatures(den);
    stats.installs++;
    window.WildernessTerrainCleanup.runtimeInstalled = true;
    console.log('[wilderness-terrain] legacy overlays cleaned; sheer rock formations now use frustum slopes');
    return true;
  }

  function installWhenReady() {
    if (install()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (install() || attempts >= 100) clearInterval(timer);
    }, 0);
  }

  window.WildernessTerrainCleanup = {
    installed: true,
    runtimeInstalled: false,
    config,
    install,
    snapshot() {
      return {
        runtimeInstalled: this.runtimeInstalled,
        config: JSON.parse(JSON.stringify(config)),
        stats: Object.assign({}, stats),
      };
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  } else {
    installWhenReady();
  }
})();
