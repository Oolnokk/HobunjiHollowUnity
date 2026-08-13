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
    naturalGroundShadeFillMaterials: 0,
    naturalGroundShadeFillTextures: 0,
    naturalSourceTintsCaptured: 0,
    cliffUvsReprojected: 0,
    weedPlaceholderMeshesHidden: 0,
  };

  const deferredRoots = new Set();
  const shadeFillTextureCache = new Map();
  const imagePromiseCache = new Map();
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
    return boxLike && ext.y > minSpan && ext.y >= maxHorizontal * minRatio;
  }

  function naturalSurfaceFor(mesh, mat) {
    return mat?.userData?.naturalSurface
      || mesh?.userData?.naturalSurface
      || null;
  }

  function surfaceConfig(surface) {
    return naturalConfig.surfaces?.[surface] || {};
  }

  function surfaceTexturePath(surface) {
    const cfg = surfaceConfig(surface);
    return cfg.texture || naturalConfig.texture || 'assets/textures/carved_smooth.png';
  }

  function sourceTintFor(mat) {
    if (!mat?.color?.isColor) return null;
    mat.userData = Object.assign({}, mat.userData);
    const stored = mat.userData.naturalSurfaceSourceTint;
    if (stored?.isColor) return stored;

    const tint = mat.color.clone();
    mat.userData.naturalSurfaceSourceTint = tint;
    stats.naturalSourceTintsCaptured++;
    return tint;
  }

  function tintRgb255(color) {
    const hex = color.getHex();
    return [
      (hex >> 16) & 255,
      (hex >> 8) & 255,
      hex & 255,
    ];
  }

  function solidTintCanvas(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = `#${color.getHexString()}`;
      ctx.fillRect(0, 0, 1, 1);
    }
    return canvas;
  }

  function imagePromiseFor(path) {
    let promise = imagePromiseCache.get(path);
    if (promise) return promise;

    const eager = window.NaturalSurfaceTextureReady;
    const eagerImage = eager?.configuredPath === path ? eager.eagerImage : null;
    if (eagerImage && eagerImage.complete && eagerImage.naturalWidth > 0) {
      promise = Promise.resolve(eagerImage);
    } else if (eagerImage && !eagerImage.complete) {
      promise = new Promise((resolve, reject) => {
        eagerImage.addEventListener('load', () => resolve(eagerImage), { once: true });
        eagerImage.addEventListener('error', reject, { once: true });
      });
    } else {
      promise = new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = path;
      });
    }

    imagePromiseCache.set(path, promise);
    return promise;
  }

  function copyTextureSampling(target, source) {
    if (!target || !source) return;
    target.wrapS = source.wrapS;
    target.wrapT = source.wrapT;
    target.minFilter = source.minFilter;
    target.magFilter = source.magFilter;
    target.generateMipmaps = source.generateMipmaps;
    target.flipY = source.flipY;
    if (source.repeat && target.repeat) target.repeat.copy(source.repeat);
    if (source.offset && target.offset) target.offset.copy(source.offset);
    if (source.center && target.center) target.center.copy(source.center);
    target.rotation = source.rotation || 0;
  }

  function groundShadeFillTexture(surface, mat, tint) {
    const path = surfaceTexturePath(surface);
    const sourceMap = mat?.map || null;
    const tintHex = tint.getHexString();
    const key = [
      path,
      tintHex,
      sourceMap?.wrapS ?? 'ws',
      sourceMap?.wrapT ?? 'wt',
      sourceMap?.minFilter ?? 'min',
      sourceMap?.magFilter ?? 'mag',
      sourceMap?.generateMipmaps === false ? 0 : 1,
    ].join('|');

    let texture = shadeFillTextureCache.get(key);
    if (texture) return texture;

    texture = new THREE.CanvasTexture(solidTintCanvas(tint));
    copyTextureSampling(texture, sourceMap);
    texture.userData = Object.assign({}, texture.userData, {
      naturalSurfaceGroundShadeFill: true,
      naturalSurface: surface,
      naturalSurfaceTintHex: tintHex,
      naturalSurfaceSourcePath: path,
    });
    shadeFillTextureCache.set(key, texture);
    stats.naturalGroundShadeFillTextures++;

    imagePromiseFor(path).then((img) => {
      let finalImage = img;
      const shadeFill = window.getShadeFillCanvas;
      if (typeof shadeFill === 'function') {
        finalImage = shadeFill(img, `${path}|#${tintHex}`, {
          mode: 'shadeFill',
          rgb: tintRgb255(tint),
          options: typeof window.getPortraitTintingConfig === 'function'
            ? window.getPortraitTintingConfig()
            : undefined,
        });
      }
      texture.image = finalImage;
      texture.needsUpdate = true;
    }).catch((error) => {
      console.warn('[natural-surface] shade-fill texture failed', path, error);
    });

    return texture;
  }

  function applyGroundShadeFill(mat, surface) {
    if (!mat?.map || !mat?.color?.isColor) return false;
    const cfg = surfaceConfig(surface);
    if ((cfg.tintTreatment || '') !== 'ground-shade-fill') return false;

    const tint = sourceTintFor(mat);
    if (!tint) return false;
    const tintHex = tint.getHexString();

    if (mat.userData?.naturalSurfaceGroundShadeFill === tintHex) return true;

    mat.map = groundShadeFillTexture(surface, mat, tint);
    mat.color.set(0xffffff);
    mat.userData = Object.assign({}, mat.userData, {
      naturalSurfaceGroundShadeFill: tintHex,
      naturalSurfaceTintTreatment: 'ground-shade-fill',
    });
    mat.needsUpdate = true;
    stats.naturalGroundShadeFillMaterials++;
    return true;
  }

  // Single-material cliffs own their UV channel, so project the horizontal
  // span along U and actual height along V. Multi-material plateaus share UVs
  // with their grass tops, so they are deliberately left alone here.
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

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const surface = naturalSurfaceFor(mesh, mat);
      if (!surface) continue;
      const cfg = surfaceConfig(surface);
      if (cfg.enabled === false) continue;

      if (applyGroundShadeFill(mat, surface)) continue;
      if ((cfg.tintTreatment || 'grass-luminance') !== 'grass-luminance') continue;
      if (!helper?.applyGrassLuminance) continue;

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
        cachedGroundShadeFillTextures: shadeFillTextureCache.size,
        surfaceTint: window.SurfaceTint?.snapshot?.() || null,
        textureReady: window.NaturalSurfaceTextureReady?.snapshot?.() || null,
      });
    },
  };
})();
