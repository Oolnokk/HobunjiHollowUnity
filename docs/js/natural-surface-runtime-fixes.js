(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE || window.NaturalSurfaceRuntimeFixes?.installed) return;

  const ROCK_HEX = 0x79807c;
  const WEEDS_HEX = 0x247c3c;
  const BOX_TRIANGLES = 12;
  const naturalConfig = window.NaturalSurfaceMaterialConfig || {};
  const wildernessConfig = window.WildernessTerrainCleanupConfig || {};

  const stats = {
    sceneAddsInspected: 0,
    legacyRockMeshesNaturalized: 0,
    naturalMaterialsGrassTinted: 0,
    barkMaterialsHueNormalized: 0,
    weedPlaceholderMeshesHidden: 0,
  };

  function materialHex(mat) {
    return mat?.color?.isColor ? mat.color.getHex() : null;
  }

  function plainLambert(mesh, hex) {
    const mat = Array.isArray(mesh?.material) ? null : mesh?.material;
    return !!(
      mesh?.isMesh
      && mat?.isMeshLambertMaterial
      && !mat.map
      && materialHex(mat) === hex
    );
  }

  function triangleCount(geometry) {
    const count = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
    return Math.floor((Number(count) || 0) / 3);
  }

  function geometryExtents(mesh) {
    const geometry = mesh?.geometry;
    if (!geometry?.attributes?.position) return null;
    geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    if (!box) return null;
    return {
      x: box.max.x - box.min.x,
      y: box.max.y - box.min.y,
      z: box.max.z - box.min.z,
    };
  }

  function isVerticalLegacyWeedPlaceholder(mesh) {
    if (wildernessConfig.hideVerticalWeedPlaceholders === false) return false;
    if (!plainLambert(mesh, WEEDS_HEX)) return false;
    const ext = geometryExtents(mesh);
    if (!ext) return false;
    const maxHorizontal = Math.max(ext.x, ext.z);
    const boxLike = mesh.geometry?.type === 'BoxGeometry' || triangleCount(mesh.geometry) === BOX_TRIANGLES;
    const minSpan = Number(wildernessConfig.legacyWeedPlaceholderMinVerticalSpan ?? 0.12);
    const minRatio = Number(wildernessConfig.legacyWeedPlaceholderMinVerticalRatio ?? 0.12);
    // A real WEEDS floor bucket is essentially flat. The old mint placeholder
    // boxes have meaningful vertical extent; requiring box-like topology keeps
    // this from hiding the legitimate merged terrain material.
    return boxLike && ext.y > minSpan && ext.y >= maxHorizontal * minRatio;
  }

  function normalizeMaterialHueOnly(mat) {
    if (!mat?.color?.isColor || mat.userData?.naturalSurfaceHueOnlyTint) return false;
    const helper = window.SurfaceTint;
    if (helper?.normalizeHueOnly) mat.color.copy(helper.normalizeHueOnly(mat.color));
    else {
      const maxChannel = Math.max(mat.color.r, mat.color.g, mat.color.b);
      if (!(maxChannel > 1e-5)) return false;
      if (maxChannel < 0.999) mat.color.multiplyScalar(1 / maxChannel);
    }
    mat.userData = Object.assign({}, mat.userData, {
      naturalSurfaceHueOnlyTint: true,
    });
    stats.barkMaterialsHueNormalized++;
    return true;
  }

  function naturalSurfaceFor(mesh, mat) {
    return mat?.userData?.naturalSurface
      || mesh?.userData?.naturalSurface
      || null;
  }

  function applyNaturalSurfaceTint(mesh) {
    if (!mesh?.isMesh) return;
    const helper = window.SurfaceTint;
    if (!helper?.applyGrassLuminance) return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const surface = naturalSurfaceFor(mesh, mat);
      if (!surface) continue;
      const cfg = naturalConfig.surfaces?.[surface] || {};
      if (cfg.enabled === false) continue;
      if ((cfg.tintTreatment || 'grass-luminance') !== 'grass-luminance') continue;

      if ((surface === 'trunks' || surface === 'vines')
          && (cfg.sourceTintMode || 'hue-only') === 'hue-only'
          && (!cfg.tint || cfg.tint === 'source')) {
        normalizeMaterialHueOnly(mat);
      }

      const already = mat.userData?.surfaceTintTreatment === helper.treatment;
      if (helper.applyGrassLuminance(mat, mat.color) && !already) {
        stats.naturalMaterialsGrassTinted++;
      }
    }
  }

  function naturalizeLegacyRock(mesh) {
    if (wildernessConfig.naturalizeLegacyRockTiles === false) return false;
    if (!plainLambert(mesh, ROCK_HEX)) return false;
    const api = window.NaturalSurfaceMaterials;
    if (!api?.naturalizeMesh) return false;
    api.naturalizeMesh(mesh, 'rocks', 'planar-stretch');
    mesh.userData = Object.assign({}, mesh.userData, {
      wildernessLegacyRockSurface: true,
      naturalizedAtSceneAdd: true,
    });
    stats.legacyRockMeshesNaturalized++;
    return true;
  }

  function hideLegacyWeedPlaceholder(mesh) {
    if (!isVerticalLegacyWeedPlaceholder(mesh)) return false;
    mesh.visible = false;
    mesh.userData = Object.assign({}, mesh.userData, {
      wildernessOverlayPlaceholder: 'weeds-box',
      hiddenByNaturalSurfaceRuntimeFixes: true,
    });
    stats.weedPlaceholderMeshesHidden++;
    return true;
  }

  function inspectObject(root) {
    root?.traverse?.((obj) => {
      if (!obj?.isMesh) return;
      if (naturalizeLegacyRock(obj)) {
        applyNaturalSurfaceTint(obj);
        return;
      }
      applyNaturalSurfaceTint(obj);
      hideLegacyWeedPlaceholder(obj);
    });
  }

  const sceneProto = THREE.Scene?.prototype;
  const originalAdd = sceneProto?.add;
  if (!sceneProto || typeof originalAdd !== 'function') return;

  if (!originalAdd.__hobunjiNaturalSurfaceRuntimeFixWrapped) {
    function wrappedSceneAdd(...objects) {
      const result = originalAdd.apply(this, objects);
      stats.sceneAddsInspected += objects.length;
      for (const object of objects) inspectObject(object);
      return result;
    }
    wrappedSceneAdd.__hobunjiNaturalSurfaceRuntimeFixWrapped = true;
    wrappedSceneAdd.__hobunjiNaturalSurfaceRuntimeFixOriginal = originalAdd;
    sceneProto.add = wrappedSceneAdd;
  }

  window.NaturalSurfaceRuntimeFixes = {
    installed: true,
    inspectObject,
    snapshot() {
      return Object.assign({}, stats, {
        surfaceTint: window.SurfaceTint?.snapshot?.() || null,
      });
    },
  };
})();
