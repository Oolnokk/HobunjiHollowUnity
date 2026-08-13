(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE || window.NaturalSurfaceTextureReady?.installed) return;

  const configuredPath = window.NaturalSurfaceMaterialConfig?.texture
    || 'assets/textures/carved_smooth.png';
  const targetSuffix = String(configuredPath).split('?')[0].replace(/\\/g, '/');
  const originalLoad = THREE.TextureLoader?.prototype?.load;
  if (typeof originalLoad !== 'function') return;

  const stats = {
    interceptedLoads: 0,
    placeholderTextures: 0,
    eagerRequests: 0,
    eagerLoaded: false,
    eagerErrored: false,
    barkMaterialsQueued: 0,
    barkFinalLoadsStarted: 0,
    barkFinalLoadsCompleted: 0,
    barkFinalLoadsFailed: 0,
    barkMaterialsUpgraded: 0,
  };

  const finalBarkCache = new Map();

  // Match the average brown-gray of carved_smooth.png closely enough that
  // natural surfaces are visibly colored from their first frame. The real
  // image replaces this 1x1 canvas automatically when TextureLoader finishes.
  const placeholder = document.createElement('canvas');
  placeholder.width = 1;
  placeholder.height = 1;
  const ctx = placeholder.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#635544';
    ctx.fillRect(0, 0, 1, 1);
  }

  function isTarget(url) {
    if (!url) return false;
    const clean = String(url).split('?')[0].replace(/\\/g, '/');
    return clean.endsWith(targetSuffix) || clean.endsWith('/' + targetSuffix);
  }

  if (!originalLoad.__hobunjiNaturalSurfaceReadyWrapped) {
    function wrappedTextureLoad(url, onLoad, onProgress, onError) {
      const texture = originalLoad.call(this, url, onLoad, onProgress, onError);
      if (!isTarget(url)) return texture;

      stats.interceptedLoads++;
      if (!texture.image) {
        texture.image = placeholder;
        texture.needsUpdate = true;
        stats.placeholderTextures++;
      }
      return texture;
    }
    wrappedTextureLoad.__hobunjiNaturalSurfaceReadyWrapped = true;
    wrappedTextureLoad.__hobunjiNaturalSurfaceReadyOriginal = originalLoad;
    THREE.TextureLoader.prototype.load = wrappedTextureLoad;
  }

  // Start network fetch/decode at parser time, before game.js begins building
  // farm/wilderness trees.
  const eagerImage = new Image();
  eagerImage.decoding = 'async';
  eagerImage.onload = () => { stats.eagerLoaded = true; };
  eagerImage.onerror = () => { stats.eagerErrored = true; };
  stats.eagerRequests++;
  eagerImage.src = configuredPath;

  function surfaceFor(mesh, mat) {
    return mat?.userData?.naturalSurface
      || mesh?.userData?.naturalSurface
      || null;
  }

  function sourceTint(mat) {
    const stored = mat?.userData?.naturalSurfaceSourceTint;
    if (stored?.isColor) return stored;
    const hex = mat?.userData?.naturalSurfaceGroundShadeFill;
    if (typeof hex === 'string' && /^[0-9a-f]{6}$/i.test(hex)) {
      return new THREE.Color(`#${hex}`);
    }
    return null;
  }

  function tintRgb255(color) {
    const hex = color.getHex();
    return [
      (hex >> 16) & 255,
      (hex >> 8) & 255,
      hex & 255,
    ];
  }

  function samplingKey(map) {
    const repeat = map?.repeat;
    const offset = map?.offset;
    const center = map?.center;
    return [
      map?.wrapS ?? 'ws',
      map?.wrapT ?? 'wt',
      map?.minFilter ?? 'min',
      map?.magFilter ?? 'mag',
      map?.generateMipmaps === false ? 0 : 1,
      map?.flipY === false ? 0 : 1,
      repeat ? `${repeat.x},${repeat.y}` : 'rep',
      offset ? `${offset.x},${offset.y}` : 'off',
      center ? `${center.x},${center.y}` : 'ctr',
      Number(map?.rotation || 0),
    ].join('|');
  }

  function copySampling(target, source) {
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

  function applyFinalBark(entry, mat) {
    if (!entry?.texture || !mat) return;
    const tintHex = entry.tintHex;
    if (mat.userData?.naturalSurfaceGroundShadeFill !== tintHex) return;
    if (mat.map === entry.texture
        && mat.userData?.naturalSurfaceGroundShadeFillReady === tintHex) return;

    mat.map = entry.texture;
    mat.color?.set?.(0xffffff);
    mat.userData = Object.assign({}, mat.userData, {
      naturalSurfaceGroundShadeFillReady: tintHex,
      naturalSurfaceTintTreatment: 'ground-shade-fill',
    });
    mat.needsUpdate = true;
    stats.barkMaterialsUpgraded++;
  }

  function queueFinalBark(mesh, mat) {
    if (!mat?.isMeshBasicMaterial || !mat.map) return;
    const surface = surfaceFor(mesh, mat);
    if (surface !== 'trunks' && surface !== 'vines') return;
    const cfg = window.NaturalSurfaceMaterialConfig?.surfaces?.[surface] || {};
    if (cfg.enabled === false || cfg.tintTreatment !== 'ground-shade-fill') return;

    const tint = sourceTint(mat);
    if (!tint) return;
    const tintHex = tint.getHexString();
    if (mat.userData?.naturalSurfaceGroundShadeFillReady === tintHex
        && (mat.map?.image?.naturalWidth || mat.map?.image?.width || 0) > 1) {
      return;
    }

    const path = cfg.texture || window.NaturalSurfaceMaterialConfig?.texture || configuredPath;
    const key = `${path}|${tintHex}|${samplingKey(mat.map)}`;
    let entry = finalBarkCache.get(key);
    if (!entry) {
      entry = {
        path,
        tint: tint.clone(),
        tintHex,
        samplingSource: mat.map,
        texture: null,
        waiting: new Set(),
        loading: false,
      };
      finalBarkCache.set(key, entry);
    }

    entry.waiting.add(mat);
    stats.barkMaterialsQueued++;
    if (entry.texture) {
      applyFinalBark(entry, mat);
      return;
    }
    if (entry.loading) return;

    entry.loading = true;
    stats.barkFinalLoadsStarted++;
    new THREE.TextureLoader().load(
      path,
      (loadedTexture) => {
        try {
          const img = loadedTexture?.image;
          if (!img) throw new Error(`TextureLoader completed without an image for ${path}`);

          let finalImage = img;
          const shadeFill = window.getShadeFillCanvas;
          if (typeof shadeFill === 'function') {
            finalImage = shadeFill(img, `${path}|#${tintHex}`, {
              mode: 'shadeFill',
              rgb: tintRgb255(entry.tint),
              options: typeof window.getPortraitTintingConfig === 'function'
                ? window.getPortraitTintingConfig()
                : undefined,
            });
          }

          const finalTexture = finalImage === img
            ? loadedTexture
            : new THREE.CanvasTexture(finalImage);
          copySampling(finalTexture, entry.samplingSource);
          finalTexture.userData = Object.assign({}, finalTexture.userData, {
            naturalSurfaceGroundShadeFill: true,
            naturalSurfaceGroundShadeFillReady: true,
            naturalSurface: surface,
            naturalSurfaceTintHex: tintHex,
            naturalSurfaceSourcePath: path,
          });
          finalTexture.needsUpdate = true;
          entry.texture = finalTexture;
          entry.loading = false;
          stats.barkFinalLoadsCompleted++;

          for (const waitingMat of entry.waiting) applyFinalBark(entry, waitingMat);
          entry.waiting.clear();
        } catch (error) {
          entry.loading = false;
          stats.barkFinalLoadsFailed++;
          console.warn('[natural-surface] final shade-fill build failed', path, error);
        }
      },
      undefined,
      (error) => {
        entry.loading = false;
        stats.barkFinalLoadsFailed++;
        console.warn('[natural-surface] final bark texture load failed', path, error);
      },
    );
  }

  function inspectFinalBark(root) {
    root?.traverse?.((obj) => {
      if (!obj?.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) queueFinalBark(obj, mat);
    });
  }

  const sceneProto = THREE.Scene?.prototype;
  const previousAdd = sceneProto?.add;
  if (sceneProto && typeof previousAdd === 'function'
      && !previousAdd.__hobunjiNaturalSurfaceFinalBarkWrapped) {
    function wrappedSceneAdd(...objects) {
      const result = previousAdd.apply(this, objects);
      for (const object of objects) inspectFinalBark(object);
      // NaturalSurfaceRuntimeFixes is loaded after this module and applies the
      // ground-shade-fill placeholder in its outer Scene.add wrapper. One
      // microtask runs after that outer wrapper finishes, so this pass sees the
      // final material and upgrades it using TextureLoader's decoded image.
      const deferred = () => {
        for (const object of objects) inspectFinalBark(object);
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(deferred);
      else Promise.resolve().then(deferred);
      return result;
    }
    wrappedSceneAdd.__hobunjiNaturalSurfaceFinalBarkWrapped = true;
    wrappedSceneAdd.__hobunjiNaturalSurfaceFinalBarkOriginal = previousAdd;
    sceneProto.add = wrappedSceneAdd;
  }

  window.NaturalSurfaceTextureReady = {
    installed: true,
    configuredPath,
    placeholder,
    eagerImage,
    inspectFinalBark,
    snapshot() {
      return Object.assign({}, stats, {
        eagerComplete: !!eagerImage.complete,
        eagerNaturalWidth: Number(eagerImage.naturalWidth || 0),
        cachedFinalBarkTextures: finalBarkCache.size,
        readyFinalBarkTextures: Array.from(finalBarkCache.values()).filter(entry => !!entry.texture).length,
        pendingFinalBarkTextures: Array.from(finalBarkCache.values()).filter(entry => entry.loading).length,
      });
    },
  };
})();
