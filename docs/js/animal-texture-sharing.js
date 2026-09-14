(() => {
  'use strict';

  if (window.AnimalTextureSharing) return;

  const stats = {
    installs: 0,
    patchedAvatars: 0,
    mirroredBackGeometries: 0,
    baseTextureLoadsAvoided: 0,
    privateBackTexturesDisposed: 0,
    suppressedBackMapAssignments: 0,
    fallbackRenderAliases: 0,
  }; // Small runtime counters exposed for mobile diagnostics without retaining avatar/texture references.

  function textureTransformSnapshot(texture) {
    if (!texture) return null;
    return {
      wrapS: texture.wrapS,
      wrapT: texture.wrapT,
      repeatX: Number(texture.repeat?.x),
      repeatY: Number(texture.repeat?.y),
      offsetX: Number(texture.offset?.x),
      offsetY: Number(texture.offset?.y),
    }; // Captures the source-facing texture state before the legacy builder temporarily treats the same object as its mirrored back texture.
  }

  function restoreTextureTransform(texture, snapshot) {
    if (!texture || !snapshot) return;
    texture.wrapS = snapshot.wrapS;
    texture.wrapT = snapshot.wrapT;
    if (texture.repeat?.set && Number.isFinite(snapshot.repeatX) && Number.isFinite(snapshot.repeatY)) {
      texture.repeat.set(snapshot.repeatX, snapshot.repeatY);
    }
    if (texture.offset?.set && Number.isFinite(snapshot.offsetX) && Number.isFinite(snapshot.offsetY)) {
      texture.offset.set(snapshot.offsetX, snapshot.offsetY);
    }
    texture.needsUpdate = true;
  }

  function uvAttribute(geometry) {
    return geometry?.getAttribute?.('uv') || geometry?.attributes?.uv || null;
  }

  function mirrorBackGeometryUv(frontPlane, backPlane) {
    if (!backPlane?.geometry) return false;
    if (backPlane.geometry === frontPlane?.geometry && typeof backPlane.geometry.clone === 'function') {
      backPlane.geometry = backPlane.geometry.clone(); // Keeps the source-facing card's UVs untouched if a future builder shares one geometry object between both faces.
    }
    const geometry = backPlane.geometry;
    geometry.userData = geometry.userData || {};
    if (geometry.userData.hobunjiAnimalBackUvMirrored) return true;
    const uv = uvAttribute(geometry);
    if (!uv || typeof uv.getX !== 'function' || typeof uv.setX !== 'function') return false;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    uv.needsUpdate = true;
    geometry.userData.hobunjiAnimalBackUvMirrored = true;
    stats.mirroredBackGeometries++;
    return true;
  }

  function primaryMaterial(plane) {
    if (!plane?.material) return null;
    return Array.isArray(plane.material) ? plane.material[0] || null : plane.material;
  }

  function aliasBackMaterialMap(frontPlane, backPlane) {
    const frontMaterial = primaryMaterial(frontPlane);
    const backMaterial = primaryMaterial(backPlane);
    if (!frontMaterial || !backMaterial) return false;
    if (frontMaterial === backMaterial) return true;

    const privateBackMap = backMaterial.map; // Legacy builder-owned reverse texture; safe to release once the reverse card follows the front map instead.
    backMaterial.map = frontMaterial.map;
    backMaterial.userData = backMaterial.userData || {};
    backMaterial.userData.hobunjiAnimalSharedFrontMap = true;

    try {
      Object.defineProperty(backMaterial, 'map', {
        configurable: true,
        enumerable: true,
        get() { return frontMaterial.map; },
        set(value) {
          // game.js and farm-animals.js still assign their legacy mirrored
          // cache entry after assigning the front map. Ignore that duplicate:
          // the back card's geometry now performs the horizontal mirror.
          if (value !== frontMaterial.map) stats.suppressedBackMapAssignments++;
        },
      });
    } catch (_) {
      // Extremely old/locked-down Three builds may expose a non-configurable
      // material map property. Fall back to rebinding immediately before the
      // back draw; Three uploads material textures after onBeforeRender.
      const priorBeforeRender = backPlane.onBeforeRender;
      backPlane.onBeforeRender = function sharedAnimalBackMapBeforeRender(...args) {
        backMaterial.map = frontMaterial.map;
        backMaterial.needsUpdate = true;
        return priorBeforeRender?.apply(this, args);
      };
      stats.fallbackRenderAliases++;
    }

    if (privateBackMap && privateBackMap !== frontMaterial.map) {
      privateBackMap.dispose?.();
      stats.privateBackTexturesDisposed++;
    }
    backMaterial.needsUpdate = true;
    return true;
  }

  function currentAnimalPlanes(avatarRef) {
    const children = avatarRef?.group?.children || [];
    const frontPlane = children.find(child => String(child?.name || '').endsWith('_front_plane')) || avatarRef?.frontPlane || children[0] || null;
    const backPlane = children.find(child => String(child?.name || '').endsWith('_back_plane')) || avatarRef?.backPlane || children[1] || null;
    return { frontPlane, backPlane };
  }

  function patchAvatar(avatarRef) {
    const { frontPlane, backPlane } = currentAnimalPlanes(avatarRef);
    if (!frontPlane || !backPlane || backPlane.userData?.hobunjiAnimalTextureSharing) return avatarRef;
    if (!mirrorBackGeometryUv(frontPlane, backPlane)) return avatarRef;
    if (!aliasBackMaterialMap(frontPlane, backPlane)) return avatarRef;
    frontPlane.userData = frontPlane.userData || {};
    backPlane.userData = backPlane.userData || {};
    frontPlane.userData.hobunjiAnimalTextureSharing = true;
    backPlane.userData.hobunjiAnimalTextureSharing = true;
    avatarRef.frontPlane = frontPlane;
    avatarRef.backPlane = backPlane;
    stats.patchedAvatars++;
    return avatarRef;
  }

  function buildWithOneBaseTexture(originalBuild, THREE, spriteUrl, options) {
    const loaderPrototype = THREE?.TextureLoader?.prototype;
    const originalLoad = loaderPrototype?.load;
    if (typeof originalLoad !== 'function') return patchAvatar(originalBuild(THREE, spriteUrl, options));

    let sharedTexture = null; // First matching sprite load; the legacy second front/back request reuses this exact Texture object.
    let sourceTransform = null; // Original unmirrored transform restored after the legacy builder mutates its back texture.
    let duplicateLoads = 0; // Number of same-URL TextureLoader calls avoided during this one synchronous avatar build.
    loaderPrototype.load = function sharedAnimalBaseTextureLoad(url, ...args) {
      if (String(url) !== String(spriteUrl)) return originalLoad.call(this, url, ...args);
      if (sharedTexture) {
        duplicateLoads++;
        return sharedTexture;
      }
      sharedTexture = originalLoad.call(this, url, ...args);
      sourceTransform = textureTransformSnapshot(sharedTexture);
      return sharedTexture;
    };

    let avatarRef;
    try {
      avatarRef = originalBuild(THREE, spriteUrl, options);
    } finally {
      loaderPrototype.load = originalLoad;
      restoreTextureTransform(sharedTexture, sourceTransform);
      stats.baseTextureLoadsAvoided += duplicateLoads;
    }
    return patchAvatar(avatarRef);
  }

  function install() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel) return false;
    if (api.__animalTextureSharingInstalled) return true;
    const originalBuild = api.buildAnimalPlaneAvatarModel.bind(api); // Captures the fully installed head-rig-aware builder; only newly built animal avatars are changed.
    api.buildAnimalPlaneAvatarModel = function sharedTextureAnimalPlaneAvatarModel(THREE, spriteUrl, options = {}) {
      return buildWithOneBaseTexture(originalBuild, THREE, spriteUrl, options);
    };
    api.__animalTextureSharingInstalled = true;
    stats.installs++;
    return true;
  }

  window.AnimalTextureSharing = {
    install,
    patchAvatar,
    getDebug: () => ({ ...stats, installed: !!window.PNGPlaneAvatar?.__animalTextureSharingInstalled }),
  };

  if (!install() && typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
})();
