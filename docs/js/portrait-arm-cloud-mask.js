// Adds a second, slightly higher cloud opacity cutout to the base arm sprites only.
//
// This deliberately does NOT replace renderPortraitProfile(), drawPortraitLayer(),
// or drawPortraitLayerWarped(). The canonical portrait renderer must remain the
// sole owner of its deformation grids. Instead, after an ordinary front portrait
// finishes rendering, we build a separate alphaMap: white everywhere, with the
// intersection of raw arm alpha and the higher cloud mask punched to black.
// PNGPlaneAvatar then applies that alphaMap to the finished portrait material.
// Torso, overwear and every other portrait layer are therefore untouched.
(function (global) {
  'use strict';

  const previewApi = global.NpcAvatarPreview;
  const avatarApi = global.PNGPlaneAvatar;
  const MASK_Y_SCALE_MULTIPLIER = 0.60; // Applied to both the canonical portrait cloud mask and the arm-only copy below.
  const LOGICAL_W = 200;
  const LOGICAL_H = 200;
  const LAYER_SIZE = 80;
  const DEFAULT_AX_OFFSET = 0.12;
  const imageCache = new Map();
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);

  function scaleMaskY(xform) {
    if (!xform || typeof xform !== 'object') return xform;
    const ax = Number(xform.ax);
    const sy = Number(xform.sy);
    const resolvedAx = Number.isFinite(ax) ? ax : 0;
    const resolvedSy = Number.isFinite(sy) ? sy : 1;
    const bottomAnchorCompensation = resolvedSy * (1 - MASK_Y_SCALE_MULTIPLIER) / 2; // Counteracts center-based canvas scaling so the bottom edge stays fixed.
    return {
      ...xform,
      ax: resolvedAx - bottomAnchorCompensation,
      sy: resolvedSy * MASK_Y_SCALE_MULTIPLIER,
    };
  }

  // portrait-utils.js owns the normal full-portrait mask. Its classic-script
  // function binding is writable through window, so wrapping it here keeps the
  // authored per-species transform but halves only the cloud's vertical scale,
  // with scaleMaskY compensating position to preserve the authored bottom edge.
  // The arm-only alpha-map path below uses the same transform explicitly.
  const originalApplyPortraitOpacityMask = global.applyPortraitOpacityMask;
  if (typeof originalApplyPortraitOpacityMask === 'function' && !originalApplyPortraitOpacityMask.__hobunjiCloudMaskYScaled) {
    const scaledApplyPortraitOpacityMask = function portraitCloudMaskYScaled(ctx, image, xform) {
      return originalApplyPortraitOpacityMask(ctx, image, scaleMaskY(xform));
    };
    scaledApplyPortraitOpacityMask.__hobunjiCloudMaskYScaled = true;
    global.applyPortraitOpacityMask = scaledApplyPortraitOpacityMask;
  }

  if (!previewApi?.renderProfileToCanvas || !avatarApi?.buildSinglePlaneAvatarModel) return;
  if (previewApi.renderProfileToCanvas.__hobunjiArmCloudAlphaWrapped) return;

  function resolveAssetPath(path) {
    const raw = String(path || '');
    if (!raw) return '';
    if (/^(?:https?:|data:|blob:|file:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    if (raw.startsWith('assets/')) return new URL(raw, docsBase).href;
    return new URL(`assets/${raw.replace(/^\.\//, '')}`, docsBase).href;
  }

  function loadImage(path) {
    const url = resolveAssetPath(path);
    if (!url) return Promise.resolve(null);
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    imageCache.set(url, promise);
    return promise;
  }

  function resolvedFighterFor(profile) {
    const fighter = profile?.fighter || null;
    if (!fighter) return null;
    const fighters = global.getPortraitFighters?.() || [];
    return fighters.find(candidate => candidate?.id === fighter.id)
      || (fighter.headUrl ? fighters.find(candidate => candidate?.headUrl === fighter.headUrl) : null)
      || fighter;
  }

  function xformFor(layer) {
    if (layer?.xformPreset && typeof global.getPortraitXformPreset === 'function') {
      return global.getPortraitXformPreset(layer.xformPreset);
    }
    const xf = layer?.xform && typeof layer.xform === 'object' ? layer.xform : {};
    return {
      ax: Number(layer?.ax ?? xf.ax) || 0,
      ay: Number(layer?.ay ?? xf.ay) || 0,
      sx: Number(layer?.sx ?? xf.sx ?? xf.scaleX ?? xf.scaleMulX) || 1,
      sy: Number(layer?.sy ?? xf.sy ?? xf.scaleY ?? xf.scaleMulY) || 1,
    };
  }

  function drawLogicalImage(ctx, image, xform, canvas) {
    if (!ctx || !image || !canvas) return;
    const scaleX = canvas.width / LOGICAL_W;
    const scaleY = canvas.height / LOGICAL_H;
    const h = LAYER_SIZE * xform.sy;
    const w = (image.naturalWidth / Math.max(1, image.naturalHeight)) * LAYER_SIZE * xform.sx;
    const cx = LOGICAL_W / 2 + xform.ay * LAYER_SIZE;
    const cy = LOGICAL_H / 2 - xform.ax * LAYER_SIZE;
    ctx.drawImage(image,
      (cx - w / 2) * scaleX,
      (cy - h / 2) * scaleY,
      w * scaleX,
      h * scaleY,
    );
  }

  async function buildArmCloudAlphaMap(sourceCanvas, profile) {
    const fighter = resolvedFighterFor(profile);
    const maskLayer = fighter?.opacityMaskLayer || profile?.fighter?.opacityMaskLayer || null;
    const armLayers = (fighter?.bodyLayers || profile?.fighter?.bodyLayers || [])
      .filter(layer => /arm[lr]/i.test(String(layer?.id || '')) && layer?.url);
    if (!sourceCanvas?.width || !sourceCanvas?.height || !maskLayer?.url || !armLayers.length) return null;

    const [maskImage, ...armImages] = await Promise.all([
      loadImage(maskLayer.url),
      ...armLayers.map(layer => loadImage(layer.url)),
    ]);
    if (!maskImage || armImages.every(image => !image)) return null;

    // Build the exact arm-only coverage first. Torso/overwear never enter this canvas.
    const intersection = document.createElement('canvas');
    intersection.width = sourceCanvas.width;
    intersection.height = sourceCanvas.height;
    const ictx = intersection.getContext('2d');
    for (let index = 0; index < armLayers.length; index++) {
      const image = armImages[index];
      if (image) drawLogicalImage(ictx, image, xformFor(armLayers[index]), intersection);
    }

    // Keep only the pixels where that arm coverage intersects the higher cloud.
    const maskXform = scaleMaskY(xformFor(maskLayer));
    const configuredOffset = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
    maskXform.ax += Number.isFinite(configuredOffset) ? configuredOffset : DEFAULT_AX_OFFSET;
    ictx.save();
    ictx.globalCompositeOperation = 'destination-in';
    drawLogicalImage(ictx, maskImage, maskXform, intersection);
    ictx.restore();

    // Three.js alphaMap samples the texture's green channel. White preserves the
    // finished portrait; transparent/black pixels from destination-out remove only
    // the higher-cloud/arm intersection.
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = sourceCanvas.width;
    alphaCanvas.height = sourceCanvas.height;
    const actx = alphaCanvas.getContext('2d');
    actx.fillStyle = '#ffffff';
    actx.fillRect(0, 0, alphaCanvas.width, alphaCanvas.height);
    actx.globalCompositeOperation = 'destination-out';
    actx.drawImage(intersection, 0, 0);
    actx.globalCompositeOperation = 'source-over';
    return alphaCanvas;
  }

  const originalRenderToCanvas = previewApi.renderProfileToCanvas.bind(previewApi);
  const wrappedRenderToCanvas = async function armCloudAlphaRenderToCanvas(canvas, profile, renderOptions = {}) {
    const rendered = await originalRenderToCanvas(canvas, profile, renderOptions);
    // Head-only and behind-view canvases are auxiliary inputs to the shared neck/
    // back-face rig. Only the canonical front portrait owns this alphaMap.
    if (rendered && renderOptions?.onlyHeadSprite !== true && renderOptions?.portraitView !== 'behind' && renderOptions?.view !== 'behind') {
      try {
        canvas.hobunjiArmCloudAlphaMap = await buildArmCloudAlphaMap(canvas, profile);
      } catch (error) {
        // A decorative cloud mask must never be capable of rejecting avatar construction.
        canvas.hobunjiArmCloudAlphaMap = null;
        console.warn('[arm-cloud-mask] alpha-map build skipped:', error);
      }
    }
    return rendered;
  };
  wrappedRenderToCanvas.__hobunjiArmCloudAlphaWrapped = true;
  previewApi.renderProfileToCanvas = wrappedRenderToCanvas;

  function applyAlphaMap(THREE, avatarRoot, alphaCanvas) {
    if (!THREE?.CanvasTexture || !avatarRoot?.traverse || !alphaCanvas) return null;
    const texture = new THREE.CanvasTexture(alphaCanvas);
    texture.name = 'portrait_arm_cloud_alpha_map';
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    let applied = 0;
    avatarRoot.traverse(node => {
      if (!node?.isMesh || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material || !('map' in material)) continue;
        material.alphaMap = texture;
        material.transparent = true;
        material.needsUpdate = true;
        applied++;
      }
    });
    if (!applied) {
      texture.dispose();
      return null;
    }
    avatarRoot.userData.armCloudAlphaTexture = texture;
    return texture;
  }

  const originalBuildAvatar = avatarApi.buildSinglePlaneAvatarModel;
  const wrappedBuildAvatar = function armCloudAlphaAvatarBuild(THREE, sourceCanvas, options = {}) {
    const avatarRoot = originalBuildAvatar.call(this, THREE, sourceCanvas, options);
    if (avatarRoot && sourceCanvas?.hobunjiArmCloudAlphaMap) {
      applyAlphaMap(THREE, avatarRoot, sourceCanvas.hobunjiArmCloudAlphaMap);
    }
    return avatarRoot;
  };
  wrappedBuildAvatar.__hobunjiArmCloudAlphaWrapped = true;
  avatarApi.buildSinglePlaneAvatarModel = wrappedBuildAvatar;

  const originalDisposeAvatar = avatarApi.disposeAvatarModel?.bind(avatarApi);
  if (originalDisposeAvatar) {
    avatarApi.disposeAvatarModel = function armCloudAlphaDispose(avatarRoot) {
      avatarRoot?.userData?.armCloudAlphaTexture?.dispose?.();
      if (avatarRoot?.userData) avatarRoot.userData.armCloudAlphaTexture = null;
      return originalDisposeAvatar(avatarRoot);
    };
  }

  global.PortraitArmCloudMask = {
    mode: 'png-plane-alpha-map',
    get maskYScaleMultiplier() { return MASK_Y_SCALE_MULTIPLIER; },
    get defaultAxOffset() { return DEFAULT_AX_OFFSET; },
    get configuredAxOffset() {
      const value = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
      return Number.isFinite(value) ? value : DEFAULT_AX_OFFSET;
    },
  };
})(window);
