// NPC portrait JSON/random profile adapter for temporary PNG-plane avatar previews.
(function () {
  'use strict';

  let cosmeticsPromise = null;
  let cosmeticsCache = null;
  let accountShimInstalled = false;
  let activeNpcForShim = null;
  let portraitAssetBase = '../../assets/';
  const fineHoodTrimMaskImageCache = new Map();

  function setAssetBase(assetBase) {
    if (assetBase) portraitAssetBase = String(assetBase);
    if (window.setPortraitAssetBase && assetBase) window.setPortraitAssetBase(assetBase);
  }

  function normalizedAssetBase(base) {
    return String(base || '../../assets/').replace(/\/?$/, '/');
  }

  function fineHoodTrimLayers(profile) {
    const hood = profile?.hood;
    if (!hood) return [];
    const fighter = (typeof window.resolvePortraitFighter === 'function')
      ? (window.resolvePortraitFighter(profile.fighter) || profile.fighter)
      : profile.fighter;
    let layers = [];
    try {
      layers = (typeof window.resolveOptionLayers === 'function')
        ? window.resolveOptionLayers(hood, fighter)
        : (Array.isArray(hood.layers) ? hood.layers : []);
    } catch (_) {
      layers = Array.isArray(hood.layers) ? hood.layers : [];
    }
    return layers.filter(layer => {
      const url = String(layer?.url || '').toLowerCase().replace(/_/g, '-');
      return url.includes('finehood') && url.includes('trim') && url.endsWith('.png');
    });
  }

  function loadFineHoodTrimMaskImage(relPath) {
    if (!relPath) return Promise.resolve(null);
    if (fineHoodTrimMaskImageCache.has(relPath)) return fineHoodTrimMaskImageCache.get(relPath);
    const promise = (async () => {
      if (typeof window.loadImg === 'function') {
        try { return await window.loadImg(relPath); } catch (_) { /* fall through */ }
      }
      const cleanPath = String(relPath).replace(/^\.\/assets\//, '').replace(/^assets\//, '');
      const candidates = [
        normalizedAssetBase(portraitAssetBase) + cleanPath,
        './assets/' + cleanPath,
        '../../assets/' + cleanPath,
      ];
      const seen = new Set();
      for (const src of candidates) {
        if (!src || seen.has(src)) continue;
        seen.add(src);
        try {
          const img = await new Promise((resolve, reject) => {
            const next = new Image();
            next.crossOrigin = 'anonymous';
            next.onload = () => resolve(next);
            next.onerror = reject;
            next.src = src;
          });
          return img;
        } catch (_) { /* try next candidate */ }
      }
      return null;
    })();
    fineHoodTrimMaskImageCache.set(relPath, promise);
    return promise;
  }

  function portraitCanvasMetrics() {
    const configured = window.PORTRAIT_CONFIG?.canvas || {};
    return {
      width: Number(configured.width) || 200,
      height: Number(configured.height) || 200,
      layerSize: Number(configured.layerSize) || 80,
    };
  }

  function portraitLayerXform(layer) {
    if (layer?.xformPreset && typeof window.getPortraitXformPreset === 'function') {
      return window.getPortraitXformPreset(layer.xformPreset);
    }
    return {
      ax: Number(layer?.ax) || 0,
      ay: Number(layer?.ay) || 0,
      sx: Number.isFinite(Number(layer?.sx)) ? Number(layer.sx) : 1,
      sy: Number.isFinite(Number(layer?.sy)) ? Number(layer.sy) : 1,
    };
  }

  function fineHoodTrimHeadOnThresholds() {
    const configured = window.SCRATCHBONES_CONFIG?.game?.portrait?.cosmetics?.fineHoodTrimHeadOn || {};
    const hiddenDot = Number(configured.hiddenDot);
    const fullDot = Number(configured.fullDot);
    const hidden = Number.isFinite(hiddenDot) ? hiddenDot : 0.82;
    const full = Number.isFinite(fullDot) ? fullDot : 0.94;
    return {
      hiddenDot: Math.max(-1, Math.min(1, Math.min(hidden, full - 0.001))),
      fullDot: Math.max(-0.999, Math.min(1, Math.max(full, hidden + 0.001))),
    };
  }

  async function prepareFineHoodTrimHeadOnMask(canvas, profile, renderOptions = {}) {
    if (!canvas) return false;
    const isFrontComposite = renderOptions?.portraitView !== 'behind'
      && renderOptions?.view !== 'behind'
      && renderOptions?.onlyHeadSprite !== true
      && renderOptions?.omitHeadSpriteAndCosmetics !== true;
    if (!isFrontComposite) {
      canvas.__hobunjiFineHoodTrimHeadOnMask = null;
      canvas.__hobunjiFineHoodTrimHeadOnMaskDebug = null;
      return false;
    }

    const trimLayers = fineHoodTrimLayers(profile);
    if (!trimLayers.length) {
      canvas.__hobunjiFineHoodTrimHeadOnMask = null;
      canvas.__hobunjiFineHoodTrimHeadOnMaskDebug = null;
      return false;
    }

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return false;

    const metrics = portraitCanvasMetrics();
    ctx.save();
    ctx.scale(maskCanvas.width / metrics.width, maskCanvas.height / metrics.height);
    let drawnLayers = 0;
    for (const layer of trimLayers) {
      const img = await loadFineHoodTrimMaskImage(layer.url);
      if (!img) continue;
      const { ax, ay, sx, sy } = portraitLayerXform(layer);
      const height = metrics.layerSize * sy;
      const width = ((img.naturalWidth || img.width || 1) / Math.max(1, img.naturalHeight || img.height || 1))
        * metrics.layerSize * sx;
      const centerX = metrics.width / 2 + ay * metrics.layerSize;
      const centerY = metrics.height / 2 - ax * metrics.layerSize;
      ctx.drawImage(img, centerX - width / 2, centerY - height / 2, width, height);
      drawnLayers += 1;
    }
    ctx.restore();

    if (!drawnLayers) {
      canvas.__hobunjiFineHoodTrimHeadOnMask = null;
      canvas.__hobunjiFineHoodTrimHeadOnMaskDebug = {
        enabled: false,
        reason: 'trim-image-load-failed',
        requestedLayers: trimLayers.map(layer => layer.url),
      };
      return false;
    }

    const thresholds = fineHoodTrimHeadOnThresholds();
    canvas.__hobunjiFineHoodTrimHeadOnMask = maskCanvas;
    canvas.__hobunjiFineHoodTrimHeadOnMaskDebug = {
      enabled: true,
      kind: 'finehood-trim-head-on',
      drawnLayers,
      urls: trimLayers.map(layer => layer.url),
      canvasSize: `${maskCanvas.width}x${maskCanvas.height}`,
      hiddenDot: thresholds.hiddenDot,
      fullDot: thresholds.fullDot,
    };
    return true;
  }

  function installFineHoodTrimHeadOnHook() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildSinglePlaneAvatarModel || api.__fineHoodTrimHeadOnInstalled) return false;

    const originalBuild = api.buildSinglePlaneAvatarModel.bind(api);
    const originalDispose = typeof api.disposeAvatarModel === 'function'
      ? api.disposeAvatarModel.bind(api)
      : null;

    const attachHeadOnShader = (THREE, object, material, maskCanvas, thresholds) => {
      if (!object || !material || !maskCanvas || material.userData?.hobunjiFineHoodTrimHeadOnTexture) return;
      const maskTexture = new THREE.CanvasTexture(maskCanvas);
      maskTexture.needsUpdate = true;
      const facingUniform = { value: 1 };
      const previousOnBeforeCompile = material.onBeforeCompile;
      const previousProgramKey = typeof material.customProgramCacheKey === 'function'
        ? material.customProgramCacheKey.bind(material)
        : null;

      material.userData = material.userData || {};
      material.userData.hobunjiFineHoodTrimHeadOnTexture = maskTexture;
      material.userData.hobunjiFineHoodTrimHeadOnFacingUniform = facingUniform;
      material.userData.hobunjiFineHoodTrimHeadOn = {
        enabled: true,
        rule: 'fine hood trim fades out as the portrait leaves the head-on viewing cone',
        hiddenDot: thresholds.hiddenDot,
        fullDot: thresholds.fullDot,
      };
      material.onBeforeCompile = function onBeforeCompileFineHoodTrimHeadOn(shader, renderer) {
        if (typeof previousOnBeforeCompile === 'function') previousOnBeforeCompile.call(this, shader, renderer);
        shader.uniforms.hobunjiFineHoodTrimHeadOnMask = { value: maskTexture };
        shader.uniforms.hobunjiFineHoodTrimHeadOnFacing = facingUniform;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform sampler2D hobunjiFineHoodTrimHeadOnMask;\nuniform float hobunjiFineHoodTrimHeadOnFacing;'
          )
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>\nfloat hobunjiFineHoodTrimMaskAlpha = texture2D(hobunjiFineHoodTrimHeadOnMask, vUv).a;\nfloat hobunjiFineHoodTrimVisibility = smoothstep(${thresholds.hiddenDot.toFixed(6)}, ${thresholds.fullDot.toFixed(6)}, hobunjiFineHoodTrimHeadOnFacing);\ndiffuseColor.a *= mix(1.0, hobunjiFineHoodTrimVisibility, hobunjiFineHoodTrimMaskAlpha);`
          );
      };
      material.customProgramCacheKey = () =>
        `${previousProgramKey ? previousProgramKey() : ''}|hobunji-finehood-trim-head-on-v2-${thresholds.hiddenDot.toFixed(3)}-${thresholds.fullDot.toFixed(3)}`;
      material.needsUpdate = true;

      if (!object.userData?.hobunjiFineHoodTrimHeadOnRenderHook) {
        object.userData = object.userData || {};
        const previousOnBeforeRender = object.onBeforeRender;
        const localFront = new THREE.Vector3(0, 0, 1);
        const worldFront = new THREE.Vector3();
        const objectWorld = new THREE.Vector3();
        const cameraWorld = new THREE.Vector3();
        const toCamera = new THREE.Vector3();
        object.onBeforeRender = function onBeforeRenderFineHoodTrimHeadOn(renderer, scene, camera, geometry, currentMaterial, group) {
          if (typeof previousOnBeforeRender === 'function') {
            previousOnBeforeRender.call(this, renderer, scene, camera, geometry, currentMaterial, group);
          }
          const uniform = currentMaterial?.userData?.hobunjiFineHoodTrimHeadOnFacingUniform;
          if (!uniform || !camera) return;
          this.updateWorldMatrix?.(true, false);
          worldFront.copy(localFront).transformDirection(this.matrixWorld).normalize();
          this.getWorldPosition(objectWorld);
          camera.getWorldPosition(cameraWorld);
          toCamera.copy(cameraWorld).sub(objectWorld).normalize();
          uniform.value = Math.max(-1, Math.min(1, worldFront.dot(toCamera)));
          currentMaterial.userData.hobunjiFineHoodTrimLastFacingDot = uniform.value;
        };
        object.userData.hobunjiFineHoodTrimHeadOnRenderHook = true;
      }
    };

    api.buildSinglePlaneAvatarModel = function buildSinglePlaneAvatarModelWithFineHoodTrimHeadOn(THREE, sourceCanvas, options = {}) {
      const root = originalBuild(THREE, sourceCanvas, options);
      const maskCanvas = sourceCanvas?.__hobunjiFineHoodTrimHeadOnMask;
      if (!root || !maskCanvas || !THREE?.CanvasTexture) return root;

      const thresholds = fineHoodTrimHeadOnThresholds();
      let attached = 0;
      root.traverse?.(object => {
        const materials = object?.material
          ? (Array.isArray(object.material) ? object.material : [object.material])
          : [];
        for (const material of materials) {
          if (!/front_material$/i.test(String(material?.name || ''))) continue;
          attachHeadOnShader(THREE, object, material, maskCanvas, thresholds);
          attached += 1;
        }
      });
      root.userData = root.userData || {};
      root.userData.fineHoodTrimHeadOn = {
        enabled: attached > 0,
        attachedMaterials: attached,
        mask: sourceCanvas.__hobunjiFineHoodTrimHeadOnMaskDebug || null,
      };
      return root;
    };

    if (originalDispose) {
      api.disposeAvatarModel = function disposeAvatarModelWithFineHoodTrimHeadOn(root) {
        root?.traverse?.(object => {
          const materials = object?.material
            ? (Array.isArray(object.material) ? object.material : [object.material])
            : [];
          for (const material of materials) {
            const texture = material?.userData?.hobunjiFineHoodTrimHeadOnTexture;
            texture?.dispose?.();
            if (material?.userData) {
              delete material.userData.hobunjiFineHoodTrimHeadOnTexture;
              delete material.userData.hobunjiFineHoodTrimHeadOnFacingUniform;
            }
          }
        });
        return originalDispose(root);
      };
    }

    api.__fineHoodTrimHeadOnInstalled = true;
    return true;
  }

  async function ensurePortraitCosmetics(paths = {}) {
    if (cosmeticsCache) return cosmeticsCache;
    if (cosmeticsPromise) return cosmeticsPromise;
    setAssetBase(paths.assetBase || '../../assets/');
    cosmeticsPromise = window.loadPortraitCosmetics(paths.configBase || '../../config/')
      .then(cosmetics => {
        cosmeticsCache = cosmetics;
        return cosmeticsCache;
      })
      .finally(() => { cosmeticsPromise = null; });
    return cosmeticsPromise;
  }

  function installAccountShim() {
    if (accountShimInstalled) return;
    window.ScratchbonesAccount = {
      getShopCatalog: () => window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [],
      getDyeCatalog: () => window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [],
      getDyeCategories: () => window.SCRATCHBONES_CONFIG?.game?.dyes?.categories || [],
      getAppliedDyes: () => activeNpcForShim?.appliedDyes || {},
      getAppearance: () => activeNpcForShim?.appearance || { speciesId: 'mao-ao', gender: 'male', cosmetics: {} },
      isUnlocked: () => true,
      isDyeOwned: () => true,
      getEquippedForCategory: cat => {
        const catalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
        const ids = activeNpcForShim?.equippedCosmetics || [];
        return catalog.find(item => item.category === cat && ids.includes(item.id))?.id ?? null;
      },
    };
    accountShimInstalled = true;
  }

  function seededRng(seedText) {
    let s = 2166136261;
    const str = String(seedText || Date.now());
    for (let i = 0; i < str.length; i += 1) {
      s ^= str.charCodeAt(i);
      s = Math.imul(s, 16777619) >>> 0;
    }
    return function rng() {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalizeSpeciesId(speciesId) {
    return String(speciesId || '').replace(/_/g, '-');
  }

  function selectFighter(speciesId, gender) {
    const fighters = window.getPortraitFighters?.() || [];
    const normalized = normalizeSpeciesId(speciesId || 'mao-ao');
    const underscored = normalized.replace(/-/g, '_');
    const desiredGender = String(gender || 'male').toLowerCase();
    const fighterGender = f => f.gender ?? (f.id === 'M' ? 'male' : f.id === 'F' ? 'female' : null);
    return fighters.find(f =>
      (f.speciesId === normalized || f.speciesId === underscored) && fighterGender(f) === desiredGender
    ) || fighters[0] || null;
  }

  function randomProfile(seedText, options = {}) {
    const cosmetics = cosmeticsCache;
    if (!cosmetics || !window.randomPortraitProfileSeeded) return null;
    const fighter = selectFighter(options.speciesId, options.gender);
    if (!fighter) return null;
    const {
      hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions, eyesOptions,
      upperFaceOptions, facialHairOptions, hatOptions, hoodOptions, torsoPortraitOptions, armPortraitOptions,
      bodyColorRangesByGender, allowedCosmeticsByFighter, cosmeticWeightsByFighter,
      forcedCosmeticsByFighter, conditionalCosmeticsByFighter,
      mandatoryCosmeticSlotsByFighter, exclusiveCosmeticsByFighter,
    } = cosmetics;
    return window.randomPortraitProfileSeeded(seededRng(seedText), [fighter], hairFrontOptions, hairBackOptions,
      hairSideOptions, hairSideLOptions, eyesOptions, upperFaceOptions, facialHairOptions,
      bodyColorRangesByGender, allowedCosmeticsByFighter, hatOptions, hoodOptions,
      cosmeticWeightsByFighter, torsoPortraitOptions, armPortraitOptions,
      forcedCosmeticsByFighter, conditionalCosmeticsByFighter, undefined,
      mandatoryCosmeticSlotsByFighter, exclusiveCosmeticsByFighter);
  }

  function buildProfileFromNpcExport(npc) {
    const cosmetics = cosmeticsCache;
    if (!cosmetics || !npc?.appearance) return null;
    installAccountShim();
    activeNpcForShim = npc;
    const appearance = npc.appearance || {};
    const profile = randomProfile(`npc-json:${npc.name || ''}:${JSON.stringify(appearance.cosmetics || {})}`, {
      speciesId: appearance.speciesId,
      gender: appearance.gender,
    });
    if (!profile) return null;

    const { optionCache, hatOptions, hoodOptions, torsoPortraitOptions, armPortraitOptions } = cosmetics;
    const savedCosmetics = appearance.cosmetics || {};
    const forced = cosmetics.forcedCosmeticsByFighter?.[profile.fighter?.id] ?? {};
    const forcedSlots = new Set(Object.keys(forced));
    const mandatorySlots = new Set(cosmetics.mandatoryCosmeticSlotsByFighter?.[profile.fighter?.id] || []);
    const exclusiveBySlot = cosmetics.exclusiveCosmeticsByFighter?.[profile.fighter?.id] || {};
    const isAllowedSavedCosmetic = (slot, id) => {
      const exclusive = exclusiveBySlot?.[slot];
      return !Array.isArray(exclusive) || !exclusive.length || exclusive.includes(id);
    };
    const lookup = id => id ? (optionCache?.get(id) ?? null) : null;
    for (const [slot, profileKey] of Object.entries({
      hairFront: 'hairFront', hairBack: 'hairBack', hairSide: 'hairSide', hairSideL: 'hairSideL',
      eyes: 'eyes', upperFace: 'upperFace', facialHair: 'facialHair',
    })) {
      if (savedCosmetics[slot] === undefined || forcedSlots.has(slot) || !isAllowedSavedCosmetic(slot, savedCosmetics[slot])) continue;
      if (slot === 'upperFace' && mandatorySlots.has(slot) && (!savedCosmetics[slot] || savedCosmetics[slot] === 'none')) continue;
      profile[profileKey] = lookup(savedCosmetics[slot]);
    }
    if (appearance.bodyColors) profile.bodyColors = { ...(profile.bodyColors || {}), ...appearance.bodyColors };
    if (Array.isArray(appearance.bodyDeform)) profile.bodyDeform = appearance.bodyDeform;

    const catalog = window.ScratchbonesAccount.getShopCatalog();
    const equippedIds = Array.isArray(npc.equippedCosmetics) ? npc.equippedCosmetics : [];
    const resolveVariantId = (category, equippedId) => {
      if (!equippedId) return null;
      const base = catalog.find(i => i.id === equippedId);
      if (!base) return equippedId;
      const speciesId = appearance.speciesId;
      const gender = appearance.gender;
      const candidates = catalog.filter(i =>
        i.category === category && i.label === base.label &&
        (i.material || null) === (base.material || null) &&
        i.species === speciesId && (!i.gender || i.gender === gender)
      );
      return [equippedId, ...candidates.map(i => i.id)].find(id => optionCache?.has(id)) ?? equippedId;
    };
    const applyEquip = (category, key, noneOpt) => {
      // Most equipped ids are shop-catalog items, whose category the catalog
      // itself carries. Bandit-exclusive/loot-only cosmetics (e.g. facewrap)
      // are deliberately never listed in the shop catalog -- so it never
      // shows up as a free pick in character creation's Collections tab --
      // which means their category has to come from the cosmetic JSON's own
      // `slot` (already recorded on the optionCache entry) instead.
      const equippedId = catalog.find(i => i.category === category && equippedIds.includes(i.id))?.id
        ?? equippedIds.find(id => optionCache?.get(id)?.slot === category)
        ?? null;
      const resolvedId = resolveVariantId(category, equippedId);
      profile[key] = (resolvedId && optionCache?.has(resolvedId)) ? optionCache.get(resolvedId) : (noneOpt || { id: 'none', tintSlot: null, layers: [] });
    };
    applyEquip('hat', 'hat', hatOptions?.[0]);
    applyEquip('hood', 'hood', hoodOptions?.[0]);
    applyEquip('torso', 'torsoCosmetic', torsoPortraitOptions?.[0]);
    applyEquip('overwear', 'armCosmetic', armPortraitOptions?.[0]);

    const portraitCosmeticConfig = window.SCRATCHBONES_CONFIG?.game?.portrait?.cosmetics || {};
    const collaredTag = portraitCosmeticConfig.collaredTag;
    const collarLockedFacialHairIds = portraitCosmeticConfig.collarLockedFacialHairIds || portraitCosmeticConfig.shirtbeardIds || [];
    const hasCollaredClothing = collaredTag
      ? [profile.torsoCosmetic, profile.armCosmetic].some(c => c?.tags?.includes(collaredTag))
      : false;
    if (!hasCollaredClothing && collarLockedFacialHairIds.includes(profile.facialHair?.id)) {
      profile.facialHair = optionCache?.get('none') || { id: 'none', label: 'No Facial Hair', tintSlot: null, layers: [] };
    }

    const defaultTintColors = portraitCosmeticConfig.defaultTintColors || {};
    const defaults = profile.upperFace?.id ? defaultTintColors[profile.upperFace.id] : null;
    if (defaults) {
      for (const [tintKey, color] of Object.entries(defaults)) {
        profile.bodyColors = { ...(profile.bodyColors || {}), [tintKey]: { ...color } };
      }
    }
    const dyes = npc.appliedDyes || {};
    const dyeCatalog = window.ScratchbonesAccount.getDyeCatalog();
    for (const [tintKey, dyeId] of Object.entries(dyes)) {
      const dye = dyeCatalog.find(d => d.id === dyeId);
      if (dye) {
        const nextBodyColors = Object.assign({}, profile.bodyColors || {});
        const nextTint = Object.assign({}, dye.color || {});
        if (dye.hex) { nextTint.hex = dye.hex; nextTint.tintMode = 'hexShadeFill'; }
        nextBodyColors[tintKey] = nextTint;
        profile.bodyColors = nextBodyColors;
      }
    }
    return profile;
  }

  async function renderProfileToCanvas(canvas, profile, renderOptions = {}) {
    if (!canvas || !profile || !window.renderPortraitProfile) return false;
    await window.renderPortraitProfile(canvas, profile, renderOptions);
    // Fine Hood trim is composited into the same front portrait texture as the
    // face and hood base. Recover a trim-only mask so the world mesh can give
    // that one layer stricter view-angle semantics without changing the rest
    // of the portrait or disabling normal THREE.FrontSide culling.
    await prepareFineHoodTrimHeadOnMask(canvas, profile, renderOptions);
    installFineHoodTrimHeadOnHook();
    return true;
  }

  function normalizeNpcImport(data) {
    return Array.isArray(data) ? data.filter(Boolean) : (data ? [data] : []);
  }

  window.NpcAvatarPreview = {
    ensurePortraitCosmetics,
    buildProfileFromNpcExport,
    randomProfile,
    renderProfileToCanvas,
    normalizeNpcImport,
    seededRng,
    getFineHoodTrimHeadOnMaskDebug: canvas => canvas?.__hobunjiFineHoodTrimHeadOnMaskDebug || null,
  };

})();
