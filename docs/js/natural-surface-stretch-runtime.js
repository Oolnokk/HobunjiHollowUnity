(() => {
  'use strict';

  const THREE = window.THREE; // Used to wrap Scene.add and identify runtime terrain meshes.
  if (!THREE || window.NaturalSurfaceStretchRuntime?.installed) return;

  const currentScript = document.currentScript; // Used to resolve authored texture paths relative to docs/js/.
  const jsBase = currentScript?.src ? new URL('.', currentScript.src) : new URL('js/', document.baseURI); // Used as the module-relative URL base.
  const docsBase = new URL('../', jsBase); // Used to turn assets/... paths into stable absolute URLs on GitHack and normal hosting.
  const imagePromises = new Map(); // Used to share one source-image request between every rock/cliff using the same PNG.
  const textureRepairs = new WeakMap(); // Used to prevent duplicate asynchronous repairs of one shared texture object.
  const stats = {
    inspectedMeshes: 0,
    placeholderTexturesFound: 0,
    textureRepairsStarted: 0,
    textureRepairsCompleted: 0,
    textureRepairsFailed: 0,
    legacyCliffUvOverridesFound: 0,
    islandUvReassertions: 0,
  }; // Used by snapshot() and the mobile-visible render debug log.

  function debugLog(message, level = 'info') {
    const text = `[surface-stretch-runtime] ${message}`; // Used as the common diagnostic prefix in the in-game Debug panel.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function resolveAssetPath(path) {
    const raw = String(path || '').trim(); // Used to normalize config/userData paths before loading.
    if (!raw) return '';
    if (/^(?:https?:|data:|blob:|file:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    if (raw.startsWith('assets/')) return new URL(raw, docsBase).href;
    return new URL(raw.replace(/^\.\//, ''), docsBase).href;
  }

  function configuredSurface(surface) {
    const config = window.NaturalSurfaceMaterialConfig || {}; // Used to reconstruct metadata when a texture clone lost its userData.
    const surfaceCfg = config.surfaces?.[surface] || {}; // Used to recover the intended tint, texture path, and tint treatment.
    return {
      path: surfaceCfg.texture || config.texture || 'assets/textures/carved_smooth.png',
      tint: surfaceCfg.tint || null,
      tintTreatment: surfaceCfg.tintTreatment || null,
    };
  }

  function naturalSurfaceFor(mesh, material) {
    return material?.userData?.naturalSurface
      || mesh?.userData?.naturalSurface
      || (mesh?.userData?.naturalSurfaceCliffSlot != null ? 'cliffs' : null);
  }

  function textureDimensions(texture) {
    const image = texture?.image; // Used to detect the 4x4 flat fallback seen by Pixel Probe.
    return {
      width: Number(image?.naturalWidth || image?.width || 0),
      height: Number(image?.naturalHeight || image?.height || 0),
    };
  }

  function isBodySpriteTerrainTexture(texture, surface) {
    if (!texture || (surface !== 'rocks' && surface !== 'cliffs')) return false;
    const userData = texture.userData || {}; // Used to recognize both intact and metadata-stripped natural-surface textures.
    if (userData.naturalSurfaceBodySpriteTint) return true;
    if (/^natural_#?[0-9a-f]{6}_(?:clamp|repeat)$/i.test(String(texture.name || ''))) return true;
    return configuredSurface(surface).tintTreatment === 'body-sprite-tint';
  }

  function textureNeedsRepair(texture, surface) {
    if (!isBodySpriteTerrainTexture(texture, surface)) return false;
    const dimensions = textureDimensions(texture); // Used to distinguish the authored PNG/canvas from the tiny flat placeholder.
    const state = String(texture.userData?.hobunjiAuthoredSurfaceState || ''); // Used to retry explicit loading/failure states even if dimensions are unusual.
    return dimensions.width <= 4
      || dimensions.height <= 4
      || !state
      || state === 'flat-loading'
      || state === 'flat-load-failure'
      || state === 'repair-loading'
      || state === 'repair-failed';
  }

  function eagerImageFor(path) {
    const ready = window.NaturalSurfaceTextureReady; // Used to reuse the parser-time eager image instead of issuing a second request.
    const eager = ready?.eagerImage; // Used when the requested source is the globally configured natural-surface PNG.
    if (!eager) return null;
    const eagerPath = resolveAssetPath(ready.configuredPath || ''); // Used to compare relative and absolute forms of the same PNG path.
    return eagerPath === resolveAssetPath(path) ? eager : null;
  }

  function imagePromiseFor(path) {
    const resolvedPath = resolveAssetPath(path); // Used as the shared cache key and the actual image URL.
    if (!resolvedPath) return Promise.reject(new Error('Natural surface texture path is empty'));
    if (imagePromises.has(resolvedPath)) return imagePromises.get(resolvedPath);

    const eager = eagerImageFor(path); // Used to adopt NaturalSurfaceTextureReady's already-started request where possible.
    let promise; // Used to store either the eager-image wait or a fresh resolved-path request.
    if (eager?.complete && Number(eager.naturalWidth || eager.width || 0) > 4) {
      promise = Promise.resolve(eager);
    } else if (eager && !eager.complete) {
      promise = new Promise((resolve, reject) => {
        const onLoad = () => resolve(eager); // Used to resolve the shared source promise when the parser-time request finishes.
        const onError = () => reject(new Error(`Failed to load natural surface texture ${resolvedPath}`)); // Used to expose the failed source path in mobile diagnostics.
        eager.addEventListener('load', onLoad, { once: true });
        eager.addEventListener('error', onError, { once: true });
      });
    } else {
      promise = new Promise((resolve, reject) => {
        const image = new Image(); // Used as the stable absolute-path fallback when the eager request is absent, failed, or metadata was lost.
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load natural surface texture ${resolvedPath}`));
        image.src = resolvedPath;
      });
    }

    const guarded = promise.catch(error => {
      imagePromises.delete(resolvedPath); // Used to allow a later scene rebuild/re-entry to retry a transient failure.
      throw error;
    });
    imagePromises.set(resolvedPath, guarded);
    return guarded;
  }

  function buildTintedSurface(image, tint, cacheKey) {
    const spritePng = window.HobunjiSpritePngSurface; // Used to keep repaired terrain on the same tint algorithm as character PNGs.
    const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || window.getBodyTintedCanvas; // Used as the canonical body-style recolor path.
    if (typeof tintSurfaceCanvas !== 'function' || !/^#?[0-9a-f]{6}$/i.test(String(tint || ''))) return image;
    try {
      return tintSurfaceCanvas(image, cacheKey, { hex: tint }, '', 'A') || image;
    } catch (error) {
      debugLog(`body-style tint failed for ${cacheKey}; using the authored PNG unchanged (${error?.message || error}).`, 'warn');
      return image;
    }
  }

  function repairTexture(texture, surface) {
    if (!textureNeedsRepair(texture, surface)) return Promise.resolve(false);
    if (textureRepairs.has(texture)) return textureRepairs.get(texture);

    stats.placeholderTexturesFound++;
    const surfaceCfg = configuredSurface(surface); // Used to reconstruct the source path/tint even when Pixel Probe reported state/source as '-'.
    const userData = texture.userData || {}; // Used to preserve any surviving texture metadata while filling the missing fields.
    const path = userData.hobunjiAuthoredSurfacePath || surfaceCfg.path; // Used as the source PNG path for the repair request.
    const tint = userData.naturalSurfaceBodySpriteTintTarget || surfaceCfg.tint || '#808080'; // Used to restore the same body-style tint the material expected.
    texture.userData = Object.assign({}, userData, {
      naturalSurfaceBodySpriteTint: true,
      naturalSurfaceBodySpriteTintTarget: String(tint).toLowerCase(),
      hobunjiAuthoredSurfacePath: path,
      hobunjiAuthoredSurfaceState: 'repair-loading',
      hobunjiAuthoredSurfaceError: null,
    });
    stats.textureRepairsStarted++;

    const repair = imagePromiseFor(path).then(image => {
      const sourceWidth = Number(image.naturalWidth || image.width || 0); // Used to reject another tiny placeholder before it can replace the current map.
      const sourceHeight = Number(image.naturalHeight || image.height || 0); // Used alongside sourceWidth for the same decoded-image sanity check.
      if (sourceWidth <= 4 || sourceHeight <= 4) throw new Error(`Decoded natural surface source is still only ${sourceWidth}x${sourceHeight}`);
      const finalImage = buildTintedSurface(image, tint, `${path}|${String(tint).toLowerCase()}`); // Used as the actual GPU texture image after successful repair.
      texture.image = finalImage;
      texture.userData = Object.assign({}, texture.userData, {
        hobunjiAuthoredSurfaceState: finalImage === image ? 'authored-png-raw-repair' : 'authored-png-tinted-repair',
        hobunjiAuthoredSurfaceImageSize: `${sourceWidth}x${sourceHeight}`,
        hobunjiAuthoredSurfaceError: null,
      });
      texture.needsUpdate = true;
      stats.textureRepairsCompleted++;
      debugLog(`${surface} texture repaired from flat ${sourceWidth}x${sourceHeight} source ${path}.`);
      return true;
    }).catch(error => {
      texture.userData = Object.assign({}, texture.userData, {
        hobunjiAuthoredSurfaceState: 'repair-failed',
        hobunjiAuthoredSurfaceError: String(error?.message || error),
      });
      stats.textureRepairsFailed++;
      debugLog(`${surface} texture repair failed for ${path}: ${error?.message || error}`, 'warn');
      return false;
    }).finally(() => {
      textureRepairs.delete(texture); // Used so a future explicit failure can retry instead of remaining permanently wedged.
    });

    textureRepairs.set(texture, repair);
    return repair;
  }

  function reassertIslandUvs(mesh) {
    const mapper = window.HobunjiSurfaceStretchUV; // Used to make the new surface-island unwrap authoritative after legacy runtime UV repair code runs.
    if (!mapper?.remapNaturalTerrainMesh || !mesh?.geometry) return false;
    const surface = naturalSurfaceFor(mesh, Array.isArray(mesh.material) ? mesh.material[0] : mesh.material); // Used to skip unrelated geometry and foliage.
    if (surface !== 'rocks' && surface !== 'cliffs' && mesh.userData?.naturalSurfaceCliffSlot == null) return false;

    const geometry = mesh.geometry; // Used to inspect whether the older single-cliff repair overwrote an already-computed island unwrap.
    if (geometry.userData?.naturalSurfaceUvMapping === 'cliff-face-stretch'
        && geometry.userData?.hobunjiSurfaceStretchSignature) {
      stats.legacyCliffUvOverridesFound++;
      delete geometry.userData.hobunjiSurfaceStretchSignature;
      delete geometry.userData.hobunjiSurfaceStretch;
    }

    const report = mapper.remapNaturalTerrainMesh(mesh, `${mesh.name || '(unnamed)'} runtime`); // Used to perform or re-perform the final authoritative UV unwrap.
    if (report) stats.islandUvReassertions++;
    return !!report;
  }

  function inspectMesh(mesh) {
    if (!mesh?.isMesh) return;
    stats.inspectedMeshes++;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; // Used to repair every natural-surface material slot on one terrain mesh.
    for (const material of materials) {
      const surface = naturalSurfaceFor(mesh, material); // Used to infer missing texture metadata from the owning rock/cliff material.
      if (surface !== 'rocks' && surface !== 'cliffs') continue;
      if (material?.map) repairTexture(material.map, surface);
    }
    reassertIslandUvs(mesh);
  }

  function inspectObject(root) {
    if (!root) return;
    if (root.isMesh) inspectMesh(root);
    root.traverse?.(child => {
      if (child !== root && child?.isMesh) inspectMesh(child);
    });
  }

  const sceneProto = THREE.Scene?.prototype; // Used to inspect terrain immediately after all previously installed Scene.add wrappers finish.
  const previousAdd = sceneProto?.add; // Used to preserve every existing Scene.add behavior before adding this final repair pass.
  if (sceneProto && typeof previousAdd === 'function' && !previousAdd.__hobunjiSurfaceStretchRuntimeWrapped) {
    function wrappedSceneAdd(...objects) {
      const result = previousAdd.apply(this, objects); // Used to let NaturalSurfaceMaterials and NaturalSurfaceRuntimeFixes finish first.
      for (const object of objects) inspectObject(object);
      return result;
    }
    wrappedSceneAdd.__hobunjiSurfaceStretchRuntimeWrapped = true;
    wrappedSceneAdd.__hobunjiSurfaceStretchRuntimeOriginal = previousAdd;
    sceneProto.add = wrappedSceneAdd;
  }

  window.NaturalSurfaceStretchRuntime = {
    installed: true,
    inspectObject,
    repairTexture,
    snapshot() {
      return Object.assign({}, stats, {
        pendingTextureRepairs: imagePromises.size,
        surfaceStretch: window.HobunjiSurfaceStretchUV?.snapshot?.() || null,
      });
    },
  };

  debugLog('installed: flat PNG placeholders self-heal and legacy cliff UV repair can no longer remain on top of surface-island mapping.');
})();