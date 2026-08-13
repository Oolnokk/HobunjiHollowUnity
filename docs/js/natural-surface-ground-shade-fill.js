(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE || window.NaturalSurfaceGroundShadeFill?.installed) return;

  const naturalConfig = window.NaturalSurfaceMaterialConfig || {};
  const cache = new Map();
  const stats = {
    materialsQueued: 0,
    textureLoadsStarted: 0,
    textureLoadsCompleted: 0,
    textureLoadsFailed: 0,
    materialsUpgraded: 0,
  };

  function surfaceFor(mesh, mat) {
    return mat?.userData?.naturalSurface
      || mesh?.userData?.naturalSurface
      || null;
  }

  function configFor(surface) {
    return naturalConfig.surfaces?.[surface] || {};
  }

  function pathFor(surface) {
    const cfg = configFor(surface);
    return cfg.texture || naturalConfig.texture || 'assets/textures/carved_smooth.png';
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

  function applyFinal(entry, mat) {
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
    stats.materialsUpgraded++;
  }

  function queueMaterial(mesh, mat) {
    if (!mat?.isMeshBasicMaterial || !mat.map) return;
    const surface = surfaceFor(mesh, mat);
    if (surface !== 'trunks' && surface !== 'vines') return;
    const cfg = configFor(surface);
    if (cfg.enabled === false || cfg.tintTreatment !== 'ground-shade-fill') return;

    const tint = sourceTint(mat);
    if (!tint) return;
    const tintHex = tint.getHexString();
    if (mat.userData?.naturalSurfaceGroundShadeFillReady === tintHex
        && (mat.map?.image?.naturalWidth || mat.map?.image?.width || 0) > 1) {
      return;
    }

    const path = pathFor(surface);
    const key = `${path}|${tintHex}|${samplingKey(mat.map)}`;
    let entry = cache.get(key);
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
      cache.set(key, entry);
    }

    entry.waiting.add(mat);
    stats.materialsQueued++;
    if (entry.texture) {
      applyFinal(entry, mat);
      return;
    }
    if (entry.loading) return;

    entry.loading = true;
    stats.textureLoadsStarted++;
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
          stats.textureLoadsCompleted++;

          for (const waitingMat of entry.waiting) applyFinal(entry, waitingMat);
          entry.waiting.clear();
        } catch (error) {
          entry.loading = false;
          stats.textureLoadsFailed++;
          console.warn('[natural-surface] final shade-fill build failed', path, error);
        }
      },
      undefined,
      (error) => {
        entry.loading = false;
        stats.textureLoadsFailed++;
        console.warn('[natural-surface] final bark texture load failed', path, error);
      },
    );
  }

  function inspect(root) {
    root?.traverse?.((obj) => {
      if (!obj?.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) queueMaterial(obj, mat);
    });
  }

  const sceneProto = THREE.Scene?.prototype;
  const previousAdd = sceneProto?.add;
  if (!sceneProto || typeof previousAdd !== 'function') return;

  if (!previousAdd.__hobunjiGroundShadeFillWrapped) {
    function wrappedSceneAdd(...objects) {
      const result = previousAdd.apply(this, objects);
      for (const object of objects) inspect(object);
      const deferred = () => {
        for (const object of objects) inspect(object);
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(deferred);
      else Promise.resolve().then(deferred);
      return result;
    }
    wrappedSceneAdd.__hobunjiGroundShadeFillWrapped = true;
    wrappedSceneAdd.__hobunjiGroundShadeFillOriginal = previousAdd;
    sceneProto.add = wrappedSceneAdd;
  }

  window.NaturalSurfaceGroundShadeFill = {
    installed: true,
    inspect,
    snapshot() {
      return Object.assign({}, stats, {
        cachedTextures: cache.size,
        readyTextures: Array.from(cache.values()).filter(entry => !!entry.texture).length,
        pendingTextures: Array.from(cache.values()).filter(entry => entry.loading).length,
      });
    },
  };
})();
