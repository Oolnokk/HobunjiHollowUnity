(() => {
  'use strict';

  // Seasonal vegetation bridge. Loaded before game.js so materials/textures can
  // be classified once at construction time without later scene traversal.
  if (typeof window === 'undefined' || typeof THREE === 'undefined') return;
  if (window.SeasonalVegetationTint?.__sourceTaggedV6) return;

  const trackedMaterials = new Set();
  const grassSurfaceMaterials = new Set();
  const plainGrassFloorMaterials = new Set();
  const grassBillboardMaterials = new Set();
  const weedFloorMaterials = new Set();
  const proceduralWeedMaterials = new Set();
  const seasonalLeafCardMaterials = new Set();
  const proceduralShrubLeafMaterials = new Set();
  const leafBaseColors = new WeakMap();
  const grassTextureNames = new Set(['wavy_surface.png']);

  // Leaf textures already contain authored green pixels, so a modest material
  // tint still reads evergreen after texture multiplication. Keep only a tiny
  // authored contribution and let the current season dominate the final card.
  const LEAF_SEASON_BLEND = 0.96;
  const LAMBERT_EMISSIVE_FLOOR = 0.3;
  const LEGACY_WEED_FLOOR_HEX = 0x247c3c;
  const DEFAULT_GRASS_GREEN_HEX = new THREE.Color().setHSL(108 / 360, 0.58, 0.28).getHex();
  const GENERIC_SHRUB_LEAF_HEX = new THREE.Color().setHSL(125 / 360, 0.55, 0.26).getHex();

  let activeTextureUrl = '';
  let lastAppliedTintHex = null;
  let lastAppliedDensity = null;
  let lastLoggedSignature = '';
  let syncQueued = false;

  function normalizeUrl(value) {
    return String(value || '').replace(/\\/g, '/').toLowerCase();
  }

  function fileNameFromUrl(value) {
    const src = normalizeUrl(value).split(/[?#]/, 1)[0];
    const slash = src.lastIndexOf('/');
    return slash >= 0 ? src.slice(slash + 1) : src;
  }

  function stampSource(target, url) {
    if (!target || !url) return target;
    try {
      target.userData = target.userData || {};
      target.userData.hobunjiSourceUrl = String(url);
    } catch (_) {}
    try {
      const image = target.image || target.source?.data;
      if (image && typeof image === 'object') image.__hobunjiSourceUrl = String(url);
    } catch (_) {}
    return target;
  }

  function textureSourceUrl(texture) {
    if (!texture) return '';
    const image = texture.image || texture.source?.data;
    return String(
      texture.userData?.hobunjiSourceUrl ||
      image?.__hobunjiSourceUrl ||
      image?.currentSrc ||
      image?.src ||
      ''
    );
  }

  function currentSeason() {
    try {
      return window.CalendarSystem?.currentSeason?.() || null;
    } catch (_) {
      return null;
    }
  }

  function currentSeasonTint() {
    const color = currentSeason()?.grassColor;
    return color?.isColor ? color : null;
  }

  function currentSeasonDensity() {
    const density = Number(currentSeason()?.grassDensity);
    return Number.isFinite(density) ? density : 1;
  }

  function looksLikeGrassSurfaceMaterial(material) {
    if (!(material?.isMeshBasicMaterial || material?.isMeshLambertMaterial) || !material.map) return false;
    const src = normalizeUrl(textureSourceUrl(material.map));
    return !!src && /(^|\/)assets\/textures\//.test(src) && grassTextureNames.has(fileNameFromUrl(src));
  }

  function looksLikePlainGrassFloorMaterial(material) {
    // game.js creates tileMats.grass and vegFloorMat as untextured unlit
    // MeshBasicMaterials using this exact authored green. Capture them before
    // seasonal recoloring changes the signature.
    return !!(
      material?.isMeshBasicMaterial
      && !material.map
      && material.color?.isColor
      && material.color.getHex() === DEFAULT_GRASS_GREEN_HEX
    );
  }

  function looksLikeGrassBillboardMaterial(material) {
    if (!material?.isShaderMaterial) return false;
    const uniforms = material.uniforms;
    const tex = uniforms?.uGrassTex?.value;
    if (!tex || !uniforms?.uTint?.value?.isColor || !uniforms?.uDensity) return false;
    const src = normalizeUrl(textureSourceUrl(tex));
    return /(^|\/)assets\/leaves\/grass_1\.png(?:[?#].*)?$/.test(src);
  }

  function looksLikeWeedFloorMaterial(material) {
    return !!(
      material?.isMeshLambertMaterial
      && !material.map
      && material.color?.isColor
      && material.color.getHex() === LEGACY_WEED_FLOOR_HEX
    );
  }

  function looksLikeProceduralWeedMaterial(material) {
    return !!(
      material?.isMeshLambertMaterial
      && !material.map
      && material.color?.isColor
      && material.color.getHex() === DEFAULT_GRASS_GREEN_HEX
    );
  }

  function looksLikeSeasonalLeafCardMaterial(material) {
    if (!material?.isMeshBasicMaterial || !material.map) return false;
    const src = normalizeUrl(textureSourceUrl(material.map));
    if (!/(^|\/)assets\/leaves\//.test(src)) return false;
    const filename = fileNameFromUrl(src);
    // grass_1.png owns a separate shader path. All foliage-generator leaf
    // cards are seasonal: leaf_1.png is the wilderness bush, while leaves_*
    // are authored tree cards such as crowned pine and shadewood.
    return filename !== 'grass_1.png';
  }

  function looksLikeProceduralShrubLeafMaterial(material) {
    // buildShrubGroup() uses solid procedural leaf geometry rather than PNG
    // cards. Its foliage has one exact authored HSL, distinct from its bark.
    return !!(
      material?.isMeshLambertMaterial
      && !material.map
      && material.color?.isColor
      && material.color.getHex() === GENERIC_SHRUB_LEAF_HEX
    );
  }

  function registerTargets(material) {
    if (!material) return;
    if (looksLikeGrassSurfaceMaterial(material)) grassSurfaceMaterials.add(material);
    if (looksLikePlainGrassFloorMaterial(material)) plainGrassFloorMaterials.add(material);
    if (looksLikeGrassBillboardMaterial(material)) grassBillboardMaterials.add(material);
    if (looksLikeWeedFloorMaterial(material)) weedFloorMaterials.add(material);
    if (looksLikeProceduralWeedMaterial(material)) proceduralWeedMaterials.add(material);
    if (looksLikeSeasonalLeafCardMaterial(material)) seasonalLeafCardMaterials.add(material);
    if (looksLikeProceduralShrubLeafMaterial(material)) proceduralShrubLeafMaterials.add(material);
  }

  function applyBasicSeasonTint(material, tint) {
    if (!material?.color?.isColor || !tint?.isColor) return;
    material.color.copy(tint);
    material.needsUpdate = true;
  }

  function applyLambertSeasonTint(material, tint) {
    if (!material?.color?.isColor || !tint?.isColor) return;
    material.color.copy(tint);
    if (material.emissive?.isColor) material.emissive.copy(tint).multiplyScalar(LAMBERT_EMISSIVE_FLOOR);
    material.needsUpdate = true;
  }

  function seasonalLeafColor(material, tint) {
    let base = leafBaseColors.get(material);
    if (!base) {
      base = material.color.clone();
      leafBaseColors.set(material, base);
    }
    return base.clone().lerp(tint, LEAF_SEASON_BLEND);
  }

  function applySeasonalLeafTint(material, tint) {
    if (!material?.color?.isColor || !tint?.isColor) return;
    const finalColor = seasonalLeafColor(material, tint);
    material.color.copy(finalColor);
    if (material.emissive?.isColor) material.emissive.copy(finalColor).multiplyScalar(LAMBERT_EMISSIVE_FLOOR);
    material.needsUpdate = true;
  }

  function applyTintToMaterial(material, tint, density) {
    if (!material || !tint?.isColor) return null;
    registerTargets(material);

    if (grassSurfaceMaterials.has(material)) {
      applyBasicSeasonTint(material, tint);
      return 'grassSurface';
    }
    if (plainGrassFloorMaterials.has(material)) {
      applyBasicSeasonTint(material, tint);
      return 'plainGrassFloor';
    }
    if (grassBillboardMaterials.has(material)) {
      const uniforms = material.uniforms;
      if (uniforms?.uTint?.value?.isColor) uniforms.uTint.value.copy(tint);
      if (uniforms?.uDensity) uniforms.uDensity.value = density;
      return 'grassBillboard';
    }
    if (weedFloorMaterials.has(material)) {
      applyLambertSeasonTint(material, tint);
      return 'weedFloor';
    }
    if (proceduralWeedMaterials.has(material)) {
      applyLambertSeasonTint(material, tint);
      return 'weedFoliage';
    }
    if (seasonalLeafCardMaterials.has(material)) {
      applySeasonalLeafTint(material, tint);
      return 'leafCard';
    }
    if (proceduralShrubLeafMaterials.has(material)) {
      applySeasonalLeafTint(material, tint);
      return 'shrubLeaf';
    }
    return null;
  }

  function syncAll(force = false, reason = 'season') {
    const tint = currentSeasonTint();
    if (!tint) return { tint: null };
    const density = currentSeasonDensity();
    const tintHex = tint.getHex();

    if (!force && tintHex === lastAppliedTintHex && density === lastAppliedDensity) {
      return { tint: `#${tint.getHexString()}` };
    }
    lastAppliedTintHex = tintHex;
    lastAppliedDensity = density;

    const counts = {
      grassSurface: 0,
      plainGrassFloor: 0,
      grassBillboard: 0,
      weedFloor: 0,
      weedFoliage: 0,
      leafCard: 0,
      shrubLeaf: 0,
    };

    for (const material of trackedMaterials) {
      const kind = applyTintToMaterial(material, tint, density);
      if (kind && Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind]++;
    }

    const signature = [
      tintHex, density,
      counts.grassSurface, counts.plainGrassFloor, counts.grassBillboard,
      counts.weedFloor, counts.weedFoliage, counts.leafCard, counts.shrubLeaf,
    ].join(':');

    if (signature !== lastLoggedSignature) {
      lastLoggedSignature = signature;
      window.__farmLog?.(
        `[seasonal vegetation] ${reason}: #${tint.getHexString()} density=${density.toFixed(2)} -> `
          + `${counts.grassSurface} grass surface, ${counts.plainGrassFloor} plain grass/vegetation floor, `
          + `${counts.grassBillboard} grass billboard, ${counts.weedFloor} weed floor, `
          + `${counts.weedFoliage} weed foliage, ${counts.leafCard} leaf card, `
          + `${counts.shrubLeaf} procedural shrub leaf material(s)`,
        'info',
        'foliage'
      );
    }

    return { ...counts, tint: `#${tint.getHexString()}`, density };
  }

  function queueSync(reason) {
    if (syncQueued) return;
    syncQueued = true;
    const schedule = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (fn => setTimeout(fn, 0));
    schedule(() => {
      syncQueued = false;
      syncAll(true, reason);
    });
  }

  // Preserve TextureLoader source identity through derived CanvasTextures.
  const textureLoaderProto = THREE.TextureLoader?.prototype;
  if (textureLoaderProto && !textureLoaderProto.__hobunjiSeasonalSourceTagV6) {
    const originalLoad = textureLoaderProto.load;
    textureLoaderProto.load = function (url, onLoad, onProgress, onError) {
      const sourceUrl = String(url || '');
      const wrappedOnLoad = texture => {
        stampSource(texture, sourceUrl);
        const previous = activeTextureUrl;
        activeTextureUrl = sourceUrl;
        try {
          if (typeof onLoad === 'function') onLoad(texture);
        } finally {
          activeTextureUrl = previous;
        }
        const normalized = normalizeUrl(sourceUrl);
        if (/(^|\/)assets\/(textures|leaves)\//.test(normalized)) queueSync('target texture loaded');
      };
      const texture = originalLoad.call(this, url, wrappedOnLoad, onProgress, onError);
      return stampSource(texture, sourceUrl);
    };
    textureLoaderProto.__hobunjiSeasonalSourceTagV6 = true;
  }

  const BaseCanvasTexture = THREE.CanvasTexture;
  if (BaseCanvasTexture && !BaseCanvasTexture.__hobunjiSeasonalSourceTagV6) {
    function SourceTaggedCanvasTexture(...args) {
      const texture = new BaseCanvasTexture(...args);
      if (activeTextureUrl) {
        stampSource(texture, activeTextureUrl);
        const canvas = args[0];
        if (canvas && typeof canvas === 'object') {
          try { canvas.__hobunjiSourceUrl = activeTextureUrl; } catch (_) {}
        }
      }
      return texture;
    }
    SourceTaggedCanvasTexture.prototype = BaseCanvasTexture.prototype;
    Object.setPrototypeOf(SourceTaggedCanvasTexture, BaseCanvasTexture);
    SourceTaggedCanvasTexture.__hobunjiSeasonalSourceTagV6 = true;
    THREE.CanvasTexture = SourceTaggedCanvasTexture;
  }

  // Register each material once at construction and remove it on dispose.
  const materialProto = THREE.Material?.prototype;
  if (materialProto && !materialProto.__hobunjiSeasonalSourceTagV6) {
    const originalSetValues = materialProto.setValues;
    const originalDispose = materialProto.dispose;

    materialProto.setValues = function (values) {
      const result = originalSetValues.call(this, values);
      trackedMaterials.add(this);
      registerTargets(this);
      const tint = currentSeasonTint();
      if (tint) applyTintToMaterial(this, tint, currentSeasonDensity());
      return result;
    };

    materialProto.dispose = function (...args) {
      trackedMaterials.delete(this);
      grassSurfaceMaterials.delete(this);
      plainGrassFloorMaterials.delete(this);
      grassBillboardMaterials.delete(this);
      weedFloorMaterials.delete(this);
      proceduralWeedMaterials.delete(this);
      seasonalLeafCardMaterials.delete(this);
      proceduralShrubLeafMaterials.delete(this);
      leafBaseColors.delete(this);
      return originalDispose.apply(this, args);
    };

    materialProto.__hobunjiSeasonalSourceTagV6 = true;
  }

  // Follow future authored grass texture replacements in terrain config.
  if (typeof window.fetch === 'function') {
    window.fetch('config/maps/terrain-materials.json')
      .then(response => response.ok ? response.json() : null)
      .then(config => {
        for (const mapConfig of Object.values(config?.byMap || {})) {
          const texture = mapConfig?.grass?.texture;
          if (typeof texture === 'string' && texture.trim()) grassTextureNames.add(fileNameFromUrl(texture.trim()));
        }
        queueSync('terrain material config loaded');
      })
      .catch(() => {});
  }

  function leafMaterialDrifted(material, tint) {
    if (!material?.color?.isColor) return false;
    return material.color.getHex() !== seasonalLeafColor(material, tint).getHex();
  }

  // Per-frame work touches only the tiny registered target sets. There is no
  // scene traversal and no scan of the full tracked-material registry.
  function registeredTargetDrifted(tint, density) {
    const tintHex = tint.getHex();
    for (const material of grassSurfaceMaterials) {
      if (material?.color?.isColor && material.color.getHex() !== tintHex) return true;
    }
    for (const material of plainGrassFloorMaterials) {
      if (material?.color?.isColor && material.color.getHex() !== tintHex) return true;
    }
    for (const material of weedFloorMaterials) {
      if (material?.color?.isColor && material.color.getHex() !== tintHex) return true;
    }
    for (const material of proceduralWeedMaterials) {
      if (material?.color?.isColor && material.color.getHex() !== tintHex) return true;
    }
    for (const material of seasonalLeafCardMaterials) {
      if (leafMaterialDrifted(material, tint)) return true;
    }
    for (const material of proceduralShrubLeafMaterials) {
      if (leafMaterialDrifted(material, tint)) return true;
    }
    for (const material of grassBillboardMaterials) {
      const uniforms = material?.uniforms;
      const liveTint = uniforms?.uTint?.value;
      if (!liveTint?.isColor || liveTint.getHex() !== tintHex) return true;
      if (uniforms?.uDensity && Number(uniforms.uDensity.value) !== density) return true;
    }
    return false;
  }

  function watchSeasonTint() {
    const tint = currentSeasonTint();
    if (tint) {
      const density = currentSeasonDensity();
      if (tint.getHex() !== lastAppliedTintHex || density !== lastAppliedDensity) {
        syncAll(true, 'season changed');
      } else if (registeredTargetDrifted(tint, density)) {
        syncAll(true, 'registered target drift corrected');
      }
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(watchSeasonTint);
  }
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(watchSeasonTint);

  window.SeasonalVegetationTint = {
    __sourceTaggedV6: true,
    reapply: () => syncAll(true, 'manual reapply'),
    status: () => ({
      source: currentSeasonTint() ? 'CalendarSystem.currentSeason().grassColor' : null,
      tint: currentSeasonTint()?.getHexString?.() ? `#${currentSeasonTint().getHexString()}` : null,
      density: currentSeasonDensity(),
      trackedMaterials: trackedMaterials.size,
      targets: {
        grassSurface: grassSurfaceMaterials.size,
        plainGrassFloor: plainGrassFloorMaterials.size,
        grassBillboard: grassBillboardMaterials.size,
        weedFloor: weedFloorMaterials.size,
        weedFoliage: proceduralWeedMaterials.size,
        leafCards: seasonalLeafCardMaterials.size,
        shrubLeaves: proceduralShrubLeafMaterials.size,
      },
      grassTextures: [...grassTextureNames],
      lastAppliedTint: lastAppliedTintHex == null ? null : `#${lastAppliedTintHex.toString(16).padStart(6, '0')}`,
      lastAppliedDensity,
    }),
  };
})();
