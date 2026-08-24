(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE) return;
  if (window.NaturalSurfaceMaterials?.installed) return;

  const DEFAULTS = {
    texture: 'assets/textures/carved_smooth.png',
    surfaces: {
      trunks: { enabled: true, tint: 'source', mapping: 'cylindrical-stretch' },
      vines:  { enabled: true, tint: 'source', mapping: 'cylindrical-stretch' },
      rocks:  { enabled: true, tint: '#808080', tintTreatment: 'body-sprite-tint', mapping: 'planar-stretch' },
      cliffs: { enabled: true, tint: '#808080', tintTreatment: 'body-sprite-tint', mapping: 'world-stretch' },
    },
  };

  const config = window.NaturalSurfaceMaterialConfig || DEFAULTS;
  const materialCache = new Map();
  const textureCache = new Map();
  const appliedCounts = { trunks: 0, vines: 0, rocks: 0, cliffs: 0 };
  const loggedSurfaces = new Set();
  let borderDeps = null;
  let terrainDeps = null;

  function cfgFor(surface) {
    const base = DEFAULTS.surfaces[surface] || {};
    return Object.assign({}, base, config.surfaces?.[surface] || {});
  }

  function texturePath(surfaceCfg) {
    return surfaceCfg.texture || config.texture || DEFAULTS.texture;
  }

  function markTextureSrgb(tex) {
    // Three r128 predates Texture.colorSpace/SRGBColorSpace. Use the old
    // encoding API there, while remaining compatible if this code is ever run
    // against a newer Three build.
    if (!tex) return tex;
    if ('colorSpace' in tex && THREE.SRGBColorSpace != null) tex.colorSpace = THREE.SRGBColorSpace;
    else if ('encoding' in tex && THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function loadBaseTexture(path, wrapMode = 'clamp') {
    const cacheKey = `${path}|${wrapMode}`;
    let tex = textureCache.get(cacheKey);
    if (tex) return tex;
    tex = markTextureSrgb(new THREE.TextureLoader().load(path));
    const wrapping = wrapMode === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrapping;
    tex.wrapT = wrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    textureCache.set(cacheKey, tex);
    return tex;
  }

  function isHexTint(hex) {
    return /^#?[0-9a-f]{6}$/i.test(String(hex || '').trim());
  }

  function flatTintCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = isHexTint(hex) ? hex : '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function shouldUseBodySpriteTint(surfaceCfg, tint) {
    return surfaceCfg?.tintTreatment === 'body-sprite-tint' && isHexTint(tint);
  }

  function loadBodySpriteTintTexture(path, tint, wrapMode = 'clamp') {
    const cacheKey = `${path}|${wrapMode}|body-sprite-tint|${String(tint).toLowerCase()}`;
    let tex = textureCache.get(cacheKey);
    if (tex) return tex;

    // Start at the requested medium gray instead of white while carved_smooth
    // loads. The decoded PNG later replaces this with the exact portrait body
    // recolor canvas, using {hex:tint} as the body-color descriptor.
    const textureName = `natural_${String(tint).toLowerCase()}_${wrapMode}`;
    tex = (window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.configureTexture
      ? window.HobunjiPngPlaneUnlit.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(tint)), textureName)
      : new THREE.CanvasTexture(flatTintCanvas(tint));
    if (!(window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.configureTexture) {
      tex.name = textureName;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
    const wrapping = wrapMode === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrapping;
    tex.wrapT = wrapping;
    tex.userData = Object.assign({}, tex.userData, {
      naturalSurfaceBodySpriteTint: true,
      naturalSurfaceBodySpriteTintTarget: String(tint).toLowerCase(),
    });
    textureCache.set(cacheKey, tex);

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const tintBodyCanvas = window.HobunjiSpritePngSurface?.tintBodyCanvas || window.getBodyTintedCanvas;
      if (typeof tintBodyCanvas !== 'function') {
        console.warn('[natural-surface] portrait body PNG tint helper unavailable; keeping flat tint', path, tint);
        return;
      }
      // Empty species id intentionally follows bodyTintModeForSpecies(''), whose
      // default is the same shadeFill mode used by ordinary body sprites. A hex
      // descriptor is already absolute, so no species swatch conversion occurs.
      const canvas = tintBodyCanvas(image, cacheKey, { hex: tint }, '', 'A');
      if (!canvas) return;
      tex.image = canvas;
      tex.needsUpdate = true;
    };
    image.onerror = () => console.warn('[natural-surface] failed to load body-tinted surface texture', path);
    image.src = path;
    return tex;
  }

  function sourceTint(material) {
    if (material?.color?.isColor) return `#${material.color.getHexString()}`;
    return '#ffffff';
  }

  function resolveTint(surfaceCfg, sourceMaterial) {
    const tint = surfaceCfg.tint;
    if (!tint || tint === 'source') return sourceTint(sourceMaterial);
    return tint;
  }

  function basicMaterial(surface, sourceMaterial, texture, tint) {
    const key = [
      surface,
      texture?.uuid || 'no-texture',
      tint,
      sourceMaterial?.side ?? THREE.FrontSide,
      sourceMaterial?.transparent ? 1 : 0,
      sourceMaterial?.alphaTest || 0,
      sourceMaterial?.depthTest !== false ? 1 : 0,
      sourceMaterial?.depthWrite !== false ? 1 : 0,
      sourceMaterial?.polygonOffset ? 1 : 0,
      sourceMaterial?.polygonOffsetFactor || 0,
      sourceMaterial?.polygonOffsetUnits || 0,
    ].join('|');
    let mat = materialCache.get(key);
    if (mat) return mat;

    const overrides = {
      color: new THREE.Color(tint),
      // Geometry-specific state stays inherited so cliffs/rocks do not move
      // into the transparent render queue or cull faces differently just to
      // imitate a 2D sprite. Everything that controls the unlit appearance is
      // provided by the PNG-plane builder.
      side: sourceMaterial?.side ?? THREE.FrontSide,
      transparent: !!sourceMaterial?.transparent,
      opacity: sourceMaterial?.opacity ?? 1,
      alphaTest: sourceMaterial?.alphaTest || 0,
      depthTest: sourceMaterial?.depthTest !== false,
      depthWrite: sourceMaterial?.depthWrite !== false,
      polygonOffset: !!sourceMaterial?.polygonOffset,
      polygonOffsetFactor: sourceMaterial?.polygonOffsetFactor || 0,
      polygonOffsetUnits: sourceMaterial?.polygonOffsetUnits || 0,
    };
    mat = (window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.makeMaterial
      ? window.HobunjiPngPlaneUnlit.makeMaterial(THREE, texture || null, `natural_${surface}_${tint}`, overrides)
      : new THREE.MeshBasicMaterial({ map: texture || null, ...overrides });
    mat.name = `natural_${surface}_${tint}`;
    mat.userData = Object.assign({}, sourceMaterial?.userData, {
      naturalSurface: surface,
      naturalSurfaceUnlit: true,
    });
    materialCache.set(key, mat);
    return mat;
  }

  function geometryHasUvMapping(geometry, mapping) {
    return !!(
      geometry?.userData?.naturalSurfaceUvMapping === mapping
      && geometry.getAttribute?.('uv')
    );
  }

  function markUvMapping(geometry, mapping) {
    geometry.userData = Object.assign({}, geometry.userData, {
      naturalSurfaceUvMapping: mapping,
    });
  }

  function assignCylindricalStretchUv(geometry) {
    const mapping = 'cylindrical-stretch';
    if (geometryHasUvMapping(geometry, mapping)) return true;
    const pos = geometry?.getAttribute?.('position');
    if (!pos) return false;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const cx = (box.min.x + box.max.x) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const dy = Math.max(1e-5, box.max.y - box.min.y);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      let u = Math.atan2(pos.getZ(i) - cz, pos.getX(i) - cx) / (Math.PI * 2) + 0.5;
      if (u < 0) u += 1;
      if (u > 1) u -= 1;
      uv[i * 2] = u;
      uv[i * 2 + 1] = (pos.getY(i) - box.min.y) / dy;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.attributes.uv.needsUpdate = true;
    markUvMapping(geometry, mapping);
    return true;
  }

  function assignPlanarStretchUv(geometry) {
    const mapping = 'planar-stretch';
    if (geometryHasUvMapping(geometry, mapping)) return true;
    const pos = geometry?.getAttribute?.('position');
    if (!pos) return false;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const dx = box.max.x - box.min.x;
    const dz = box.max.z - box.min.z;
    const dy = Math.max(1e-5, box.max.y - box.min.y);
    const useX = dx >= dz;
    const du = Math.max(1e-5, useX ? dx : dz);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const h = useX ? pos.getX(i) - box.min.x : pos.getZ(i) - box.min.z;
      uv[i * 2] = h / du;
      uv[i * 2 + 1] = (pos.getY(i) - box.min.y) / dy;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.attributes.uv.needsUpdate = true;
    markUvMapping(geometry, mapping);
    return true;
  }

  function assignWorldStretchUv(geometry) {
    const mapping = 'world-stretch';
    if (geometryHasUvMapping(geometry, mapping)) return true;
    const pos = geometry?.getAttribute?.('position');
    if (!pos) return false;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const dx = Math.max(1e-5, box.max.x - box.min.x);
    const dz = Math.max(1e-5, box.max.z - box.min.z);
    const existing = geometry.getAttribute?.('uv');
    const uv = existing?.count === pos.count
      ? existing
      : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);

    // Normalize each unique cliff/mesa geometry into 0..1 UVs instead of
    // cloning a Texture and Material for every mesh. This preserves the
    // requested "stretch the PNG once across the whole surface" look while
    // keeping one shared texture/material per tint.
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(
        i,
        (pos.getX(i) - box.min.x) / dx,
        (pos.getZ(i) - box.min.z) / dz,
      );
    }
    if (uv !== existing) geometry.setAttribute('uv', uv);
    uv.needsUpdate = true;
    markUvMapping(geometry, mapping);
    return true;
  }

  function prepareUv(geometry, mapping) {
    if (mapping === 'cylindrical-stretch') return assignCylindricalStretchUv(geometry);
    if (mapping === 'planar-stretch') return assignPlanarStretchUv(geometry);
    if (mapping === 'world-stretch') return assignWorldStretchUv(geometry);
    return true;
  }

  function textureForSurface(surface, wrapMode = 'clamp', resolvedTint = null) {
    const surfaceCfg = cfgFor(surface);
    const tint = resolvedTint || surfaceCfg.tint;
    return shouldUseBodySpriteTint(surfaceCfg, tint)
      ? loadBodySpriteTintTexture(texturePath(surfaceCfg), tint, wrapMode)
      : loadBaseTexture(texturePath(surfaceCfg), wrapMode);
  }

  function noteApplied(surface) {
    appliedCounts[surface] = (appliedCounts[surface] || 0) + 1;
    if (loggedSurfaces.has(surface)) return;
    loggedSurfaces.add(surface);
    const surfaceCfg = cfgFor(surface);
    const message = `[natural-surface] ${surface}: unlit ${texturePath(surfaceCfg)} (${surfaceCfg.mapping || 'stretch'}, tint=${surfaceCfg.tint || 'source'})`;
    if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
    else console.debug(message);
  }

  function naturalizeMesh(mesh, surface, mappingOverride = null) {
    if (!mesh?.isMesh || !mesh.geometry || mesh.userData?.naturalSurface === surface) return mesh;
    const surfaceCfg = cfgFor(surface);
    if (surfaceCfg.enabled === false) return mesh;
    const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const mapping = mappingOverride || surfaceCfg.mapping;

    prepareUv(mesh.geometry, mapping);
    const tint = resolveTint(surfaceCfg, sourceMaterial);
    const bakeTint = shouldUseBodySpriteTint(surfaceCfg, tint); // The PNG is recolored by the exact body-sprite canvas path, so the Three material stays white.
    const tex = textureForSurface(surface, 'clamp', tint);
    mesh.material = basicMaterial(surface, sourceMaterial, tex, bakeTint ? '#ffffff' : tint);
    mesh.userData = Object.assign({}, mesh.userData, { naturalSurface: surface });
    noteApplied(surface);
    return mesh;
  }

  function naturalizeMaterialSlot(mesh, slot, surface) {
    if (!mesh?.isMesh || !Array.isArray(mesh.material) || !mesh.material[slot]) return;
    const surfaceCfg = cfgFor(surface);
    if (surfaceCfg.enabled === false) return;
    const sourceMaterial = mesh.material[slot];
    const mapping = surfaceCfg.mapping;

    // A multi-material plateau shares ONE uv attribute between its grass top
    // and stone cliff group. Normalizing that geometry for the cliff slot
    // would also remap the grass material, so preserve the authored world UVs.
    // The MATERIAL map is still forced to this surface's configured texture;
    // otherwise an old source map can silently bypass carved_smooth.png.
    const tint = resolveTint(surfaceCfg, sourceMaterial);
    const bakeTint = shouldUseBodySpriteTint(surfaceCfg, tint); // Same body-sprite tint canvas as character art; material white avoids a second multiplier.
    let tex;
    if (mapping === 'world-stretch') {
      tex = textureForSurface(surface, 'repeat', tint);
    } else {
      prepareUv(mesh.geometry, mapping);
      tex = textureForSurface(surface, 'clamp', tint);
    }

    const materials = mesh.material.slice();
    materials[slot] = basicMaterial(surface, sourceMaterial, tex, bakeTint ? '#ffffff' : tint);
    mesh.material = materials;
    mesh.userData = Object.assign({}, mesh.userData, { naturalSurfaceCliffSlot: slot });
    noteApplied(surface);
  }

  function naturalizeFoliageGroup(group, jungle = false) {
    if (!group?.children?.length) return group;
    const meshes = group.children.filter(child => child?.isMesh);
    if (!meshes.length) return group;
    naturalizeMesh(meshes[0], 'trunks');
    if (!jungle) {
      for (let i = 1; i < meshes.length; i++) {
        const mat = meshes[i].material;
        if (mat?.isMeshBasicMaterial && mat.map) continue;
        if (mat?.isMeshLambertMaterial) naturalizeMesh(meshes[i], 'vines');
      }
    }
    return group;
  }

  function wrapFoliage(api) {
    if (!api || api.__naturalSurfaceWrapped) return api;
    const specs = {
      buildJungleTreeMesh: true,
      buildCrownedPineMesh: false,
      buildShadewoodMesh: false,
      buildWildernessBushMesh: false,
      buildStumpMesh: false,
    };
    for (const [name, jungle] of Object.entries(specs)) {
      const original = api[name];
      if (typeof original !== 'function') continue;
      api[name] = function (...args) {
        return naturalizeFoliageGroup(original.apply(this, args), jungle);
      };
    }
    api.__naturalSurfaceWrapped = true;
    return api;
  }

  function newlyAddedMeshes(scene, beforeCount) {
    return scene?.children?.slice(beforeCount).filter(child => child?.isMesh) || [];
  }

  function wrapTerrainFeatures(api) {
    if (!api || api.__naturalSurfaceWrapped) return api;
    const originalInit = api.init;
    if (typeof originalInit === 'function') {
      api.init = function (deps) {
        terrainDeps = deps;
        return originalInit.call(this, deps);
      };
    }
    const originalRock = api.buildRockFormationMeshes;
    if (typeof originalRock === 'function') {
      api.buildRockFormationMeshes = function (scene, ...args) {
        const before = scene?.children?.length || 0;
        const result = originalRock.call(this, scene, ...args);
        for (const mesh of newlyAddedMeshes(scene, before)) naturalizeMesh(mesh, 'rocks');
        return result;
      };
    }
    api.__naturalSurfaceWrapped = true;
    return api;
  }

  function wrapPlateauMesa(api) {
    if (!api || api.__naturalSurfaceWrapped) return api;
    const original = api.buildPlateauMesa;
    if (typeof original === 'function') {
      api.buildPlateauMesa = function (...args) {
        const mesh = original.apply(this, args);
        if (mesh?.isMesh) {
          if (Array.isArray(mesh.material) && mesh.material.length > 1) {
            naturalizeMaterialSlot(mesh, 1, 'cliffs');
          } else if (mesh.material?.isMeshLambertMaterial) {
            naturalizeMesh(mesh, 'cliffs', 'world-stretch');
          }
        }
        return mesh;
      };
    }
    api.__naturalSurfaceWrapped = true;
    return api;
  }

  function naturalizeCliffCandidates(scene, beforeCount) {
    const cliffCfg = cfgFor('cliffs');
    const basename = texturePath(cliffCfg).split('/').pop();
    const tintHex = String(cliffCfg.tint || '').replace('#', '').toLowerCase();
    const knownCliffTints = new Set([tintHex, '5f5a56', '6a6460', '808080']); // Lets legacy border-cliff materials be upgraded even when they do not already carry carved_smooth.png.
    for (const mesh of newlyAddedMeshes(scene, beforeCount)) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (let i = 0; i < mats.length; i++) {
        const mat = mats[i];
        const src = mat?.map?.image?.currentSrc
          || mat?.map?.image?.src
          || mat?.map?.source?.data?.src
          || '';
        const colorHex = mat?.color?.isColor ? mat.color.getHexString().toLowerCase() : '';
        if (!String(src).includes(basename) && !knownCliffTints.has(colorHex)) continue;
        if (Array.isArray(mesh.material)) naturalizeMaterialSlot(mesh, i, 'cliffs');
        else naturalizeMesh(mesh, 'cliffs', 'world-stretch');
      }
    }
  }

  function wrapBorderTerrain(api) {
    if (!api || api.__naturalSurfaceWrapped) return api;
    const originalInit = api.init;
    if (typeof originalInit === 'function') {
      api.init = function (deps) {
        borderDeps = deps;
        return originalInit.call(this, deps);
      };
    }

    const zone = api.buildZoneBorderTerrain;
    if (typeof zone === 'function') {
      api.buildZoneBorderTerrain = function (scene, ...args) {
        const before = scene?.children?.length || 0;
        const result = zone.call(this, scene, ...args);
        naturalizeCliffCandidates(scene, before);
        return result;
      };
    }

    const farm = api.buildBorderTerrain;
    if (typeof farm === 'function') {
      api.buildBorderTerrain = function (...args) {
        const scene = borderDeps?.scene;
        const before = scene?.children?.length || 0;
        const result = farm.apply(this, args);
        naturalizeCliffCandidates(scene, before);
        return result;
      };
    }

    const town = api.buildTownBorderTerrain;
    if (typeof town === 'function') {
      api.buildTownBorderTerrain = function (...args) {
        const scene = borderDeps?.townScene || borderDeps?.getTownScene?.();
        const before = scene?.children?.length || 0;
        const result = town.apply(this, args);
        naturalizeCliffCandidates(scene, before);
        return result;
      };
    }

    api.__naturalSurfaceWrapped = true;
    return api;
  }

  function installGlobal(name, wrapper) {
    let current = window[name];
    if (current) {
      window[name] = wrapper(current);
      return;
    }
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrapper(value); },
      });
    } catch (_) {}
  }

  installGlobal('FoliageGenerator', wrapFoliage);
  installGlobal('ZoneTerrainFeatures', wrapTerrainFeatures);
  installGlobal('ZonePlateauMesa', wrapPlateauMesa);
  installGlobal('BorderTerrain', wrapBorderTerrain);

  window.NaturalSurfaceMaterials = {
    installed: true,
    config,
    naturalizeMesh,
    snapshot() {
      return {
        texture: config.texture || DEFAULTS.texture,
        surfaces: JSON.parse(JSON.stringify(config.surfaces || DEFAULTS.surfaces)),
        cachedMaterials: materialCache.size,
        cachedTextures: textureCache.size,
        appliedCounts: Object.assign({}, appliedCounts),
        borderDepsCaptured: !!borderDeps,
        terrainDepsCaptured: !!terrainDeps,
      };
    },
  };
})();