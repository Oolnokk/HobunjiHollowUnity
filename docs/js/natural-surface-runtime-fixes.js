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
    deferredInspectionBatches: 0,
    deferredRootsInspected: 0,
    legacyRockMeshesNaturalized: 0,
    naturalMaterialsGrassTinted: 0,
    naturalSourceTintsCaptured: 0,
    cliffUvsReprojected: 0,
    weedPlaceholderMeshesHidden: 0,
  };

  const deferredRoots = new Set();
  let deferredInspectionQueued = false;

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

  function naturalSurfaceFor(mesh, mat) {
    return mat?.userData?.naturalSurface
      || mesh?.userData?.naturalSurface
      || null;
  }

  function sourceTintFor(mat) {
    if (!mat?.color?.isColor) return null;
    mat.userData = Object.assign({}, mat.userData);
    const stored = mat.userData.naturalSurfaceSourceTint;
    if (stored?.isColor) return stored;

    // Keep the generator/authored tint as immutable shader input. Do not
    // normalize or otherwise mutate material.color: tree visibility/fade code
    // is allowed to preserve/restore material state, and mutating the shared
    // material made first-render bark peach until a cull cycle restored it.
    const tint = mat.color.clone();
    mat.userData.naturalSurfaceSourceTint = tint;
    stats.naturalSourceTintsCaptured++;
    return tint;
  }

  // Single-material cliffs own their UV channel, so project the horizontal
  // span along U and actual height along V. The old world X/Z projection
  // effectively collapsed vertical cliff faces into stripes/smears. Do not
  // touch multi-material plateau geometry: its grass top shares the same UV
  // attribute and would be corrupted by a cliff-only remap.
  function fixSingleMaterialCliffUv(mesh) {
    if (!mesh?.isMesh || Array.isArray(mesh.material)) return false;
    const surface = naturalSurfaceFor(mesh, mesh.material);
    if (surface !== 'cliffs') return false;
    const geometry = mesh.geometry;
    const pos = geometry?.getAttribute?.('position');
    if (!pos) return false;
    if (geometry.userData?.naturalSurfaceUvMapping === 'cliff-face-stretch') return false;

    geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    if (!box) return false;
    const dx = box.max.x - box.min.x;
    const dz = box.max.z - box.min.z;
    const dy = box.max.y - box.min.y;
    if (!(dy > 1e-5)) return false;

    const useX = dx >= dz;
    const du = Math.max(1e-5, useX ? dx : dz);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const horizontal = useX ? pos.getX(i) - box.min.x : pos.getZ(i) - box.min.z;
      uv[i * 2] = horizontal / du;
      uv[i * 2 + 1] = (pos.getY(i) - box.min.y) / dy;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.attributes.uv.needsUpdate = true;
    geometry.userData = Object.assign({}, geometry.userData, {
      naturalSurfaceUvMapping: 'cliff-face-stretch',
    });
    stats.cliffUvsReprojected++;
    return true;
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

      const sourceTint = sourceTintFor(mat);
      if (!sourceTint) continue;
      const already = mat.userData?.surfaceTintTreatment === helper.treatment;
      if (helper.applyGrassLuminance(mat, sourceTint) && !already) {
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
      naturalizeLegacyRock(obj);
      fixSingleMaterialCliffUv(obj);
      applyNaturalSurfaceTint(obj);
      hideLegacyWeedPlaceholder(obj);
    });
  }

  function queueDeferredInspection(objects) {
    for (const object of objects) if (object) deferredRoots.add(object);
    if (deferredInspectionQueued) return;
    deferredInspectionQueued = true;
    const run = () => {
      deferredInspectionQueued = false;
      if (!deferredRoots.size) return;
      const roots = Array.from(deferredRoots);
      deferredRoots.clear();
      stats.deferredInspectionBatches++;
      stats.deferredRootsInspected += roots.length;
      for (const root of roots) inspectObject(root);
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  const sceneProto = THREE.Scene?.prototype;
  const originalAdd = sceneProto?.add;
  if (!sceneProto || typeof originalAdd !== 'function') return;

  if (!originalAdd.__hobunjiNaturalSurfaceRuntimeFixWrapped) {
    function wrappedSceneAdd(...objects) {
      const result = originalAdd.apply(this, objects);
      stats.sceneAddsInspected += objects.length;
      for (const object of objects) inspectObject(object);
      // Several legacy generators add their mesh first and replace its
      // material immediately after returning from scene.add(). One batched
      // microtask catches those synchronous post-add replacements after the
      // generator finishes, without any recurring per-frame scene scan.
      queueDeferredInspection(objects);
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
        textureReady: window.NaturalSurfaceTextureReady?.snapshot?.() || null,
      });
    },
  };
})();
