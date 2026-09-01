(() => {
  'use strict';

  // Seasonal vegetation bridge. Load this before game.js so every terrain/leaf
  // texture created later keeps its source identity through derived CanvasTextures.
  if (typeof window === 'undefined' || typeof THREE === 'undefined') return;
  if (window.SeasonalVegetationTint?.__sourceTaggedV4) return;

  const trackedMaterials = new Set();
  const grassSurfaceMaterials = new Set();
  const grassBillboardMaterials = new Set();
  const weedFloorMaterials = new Set();
  const proceduralWeedMaterials = new Set();
  const treeLeafMaterials = new Set();
  const leafBaseColors = new WeakMap();
  const grassTextureNames = new Set(['wavy_surface.png']);

  const LEAF_SEASON_BLEND = 0.72;
  const LAMBERT_EMISSIVE_FLOOR = 0.3;
  const LEGACY_WEED_FLOOR_HEX = 0x247c3c;
  const DEFAULT_GRASS_GREEN_HEX = new THREE.Color().setHSL(108 / 360, 0.58, 0.28).getHex();

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
    if (!src || !/(^|\/)assets\/textures\//.test(src)) return false;
    return grassTextureNames.has(fileNameFromUrl(src));
  }

  function looksLikeTreeLeafMaterial(material) {
    if (!material?.isMeshBasicMaterial || !material.map) return false;
    const src = normalizeUrl(textureSourceUrl(material.map));
    if (!/(^|\/)assets\/leaves\//.test(src)) return false;
    // Tree cards use leaves_crowned_pine.png / leaves_shadewood.png.
    // Generic leaf_1.png bushes and grass_1.png remain separate systems.
    return fileNameFromUrl(src).startsWith('leaves_');
  }

  function looksLikeGrassBillboardMaterial(material) {
    if (!material?.isShaderMaterial) return false;
    const uniforms = material.uniforms;
    const tex = uniforms?.uGrassTex?.value;
    const tint = uniforms?.uTint?.value;
    if (!tex || !tint?.isColor || !uniforms?.uDensity) return false;
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
    // FoliageGenerator.buildWeedsGroup() is the only authored Lambert material
    // using the exact default grass HSL. Capture it while still at its authored
    // green; after registration its color follows the season and no longer
    // matches this signature.
    return !!(
      material?.isMeshLambertMaterial
      && !material.map
      && material.color?.isColor
      && material.color.getHex() === DEFAULT_GRASS_GREEN_HEX
    );
  }

  function registerTargets(material) {
    if (!material) return;
    if (looksLikeGrassSurfaceMaterial(material)) grassSurfaceMaterials.add(material);
    if (looksLikeGrassBillboardMaterial(material)) grassBillboardMaterials.add(material);
    if (looksLikeWeedFloorMaterial(material)) weedFloorMaterials.add(material);
    if (looksLikeProceduralWeedMaterial(material)) proceduralWeedMaterials.add(material);
    if (looksLikeTreeLeafMaterial(material)) treeLeafMaterials.add(material);
  }

  function applyLambertSeasonTint(material, tint) {
    if (!material?.color?.isColor || !tint?.isColor) return;
    material.color.copy(tint);
    if (material.emissive?.isColor) material.emissive.copy(tint).multiplyScalar(LAMBERT_EMISSIVE_FLOOR);
    material.needsUpdate = true;
  }

  function applyTintToMaterial(material, tint, density) {
    if (!material || !tint?.isColor) return null;
    registerTargets(material);

    if (grassSurfaceMaterials.has(material)) {
      // The map config provides a neutral luminance-preserving texture. The
      // material color is therefore the actual seasonal hue.
      if (material.color?.isColor) {
        material.color.copy(tint);
        material.needsUpdate = true;
      }
      return 'grassSurface';
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

    if (treeLeafMaterials.has(material)) {
      let base = leafBaseColors.get(material);
      if (!base) {
        base = material.color.clone();
        leafBaseColors.set(material, base);
      }
      material.color.copy(base).lerp(tint, LEAF_SEASON_BLEND);
      material.needsUpdate = true;
      return 'treeLeaf';
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
      grassBillboard: 0,
      weedFloor: 0,
      weedFoliage: 0,
      treeLeaf: 0,
    };

    for (const material of trackedMaterials) {
      const kind = applyTintToMaterial(material, tint, density);
      if (kind && Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind]++;
    }

    const signature = [
      tintHex,
      density,
      counts.grassSurface,
      counts.grassBillboard,
      counts.weedFloor,
      counts.weedFoliage,
      counts.treeLeaf,
    ].join(':');

    if (signature !== lastLoggedSignature) {
      lastLoggedSignature = signature;
      window.__farmLog?.(
        `[seasonal vegetation] ${reason}: #${tint.getHexString()} density=${density.toFixed(2)} -> `
          + `${counts.grassSurface} grass surface, ${counts.grassBillboard} grass billboard, `
          + `${counts.weedFloor} weed floor, ${counts.weedFoliage} weed foliage, ${counts.treeLeaf} tree leaf material(s)`,
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

  // Carry TextureLoader source identity through any CanvasTexture produced
  // synchronously inside that texture's onLoad callback. This is the path used
  // by terrain adaptive shade-fill.
  const textureLoaderProto = THREE.TextureLoader?.prototype;
  if (textureLoaderProto && !textureLoaderProto.__hobunjiSeasonalSourceTagV4) {
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
    textureLoaderProto.__hobunjiSeasonalSourceTagV4 = true;
  }

  const BaseCanvasTexture = THREE.CanvasTexture;
  if (BaseCanvasTexture && !BaseCanvasTexture.__hobunjiSeasonalSourceTagV4) {
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
    SourceTaggedCanvasTexture.__hobunjiSeasonalSourceTagV4 = true;
    THREE.CanvasTexture = SourceTaggedCanvasTexture;
  }

  // Every material constructor eventually calls Material.setValues. Track
  // creation/disposal once; no scene traversal is required for season changes.
  const materialProto = THREE.Material?.prototype;
  if (materialProto && !materialProto.__hobunjiSeasonalSourceTagV4) {
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
      grassBillboardMaterials.delete(this);
      weedFloorMaterials.delete(this);
      proceduralWeedMaterials.delete(this);
      treeLeafMaterials.delete(this);
      leafBaseColors.delete(this);
      return originalDispose.apply(this, args);
    };

    materialProto.__hobunjiSeasonalSourceTagV4 = true;
  }

  // Use the same grass texture names as map material config so authored
  // replacements remain seasonal automatically.
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

  // The game's grass billboard shader shares one uTint Color, but older boot /
  // calendar paths can still write its authored default green after the saved
  // calendar has already resolved. Check only the registered billboard shader
  // material(s) each frame (normally one shared material), not every material
  // or scene object. Any drift is corrected immediately.
  function billboardDrifted(tint, density) {
    const tintHex = tint.getHex();
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
      } else if (billboardDrifted(tint, density)) {
        for (const material of grassBillboardMaterials) applyTintToMaterial(material, tint, density);
        window.__farmLog?.('[seasonal vegetation] corrected grass billboard tint drift', 'info', 'foliage');
      }
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(watchSeasonTint);
  }
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(watchSeasonTint);

  window.SeasonalVegetationTint = {
    __sourceTaggedV4: true,
    reapply: () => syncAll(true, 'manual reapply'),
    status: () => ({
      source: currentSeasonTint() ? 'CalendarSystem.currentSeason().grassColor' : null,
      tint: currentSeasonTint()?.getHexString?.() ? `#${currentSeasonTint().getHexString()}` : null,
      density: currentSeasonDensity(),
      trackedMaterials: trackedMaterials.size,
      targets: {
        grassSurface: grassSurfaceMaterials.size,
        grassBillboard: grassBillboardMaterials.size,
        weedFloor: weedFloorMaterials.size,
        weedFoliage: proceduralWeedMaterials.size,
        treeLeaf: treeLeafMaterials.size,
      },
      grassTextures: [...grassTextureNames],
      lastAppliedTint: lastAppliedTintHex == null ? null : `#${lastAppliedTintHex.toString(16).padStart(6, '0')}`,
      lastAppliedDensity,
    }),
  };
})();
