// Builds arm-only portrait coverage masks and the existing higher-cloud alpha cutout.
// The side masks are also consumed by the experimental PNG-plane bicep skinning rig.
(function (global) {
  'use strict';

  const previewApi = global.NpcAvatarPreview;
  const avatarApi = global.PNGPlaneAvatar;
  if (!previewApi?.renderProfileToCanvas || !avatarApi?.buildSinglePlaneAvatarModel) return;
  if (previewApi.renderProfileToCanvas.__hobunjiArmCloudAlphaWrapped) return;

  const LOGICAL_W = 200;
  const LOGICAL_H = 200;
  const LAYER_SIZE = 80;
  const DEFAULT_AX_OFFSET = 0.12;
  const imageCache = new Map();
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);

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

  function makeCanvasLike(sourceCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    return canvas;
  }

  function boundsForAlpha(canvas, threshold = 8) {
    if (!canvas?.width || !canvas?.height) return null;
    let data;
    try { data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data; }
    catch (_) { return null; }
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] <= threshold) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return right < 0 ? null : { left, right, top, bottom };
  }

  function sideForArmLayer(layer) {
    const id = String(layer?.id || '');
    if (/armL/i.test(id)) return 'left';
    if (/armR/i.test(id)) return 'right';
    return null;
  }

  async function buildArmCoverageCanvases(sourceCanvas, profile) {
    const fighter = resolvedFighterFor(profile);
    const armLayers = (fighter?.bodyLayers || profile?.fighter?.bodyLayers || [])
      .filter(layer => /arm[lr]/i.test(String(layer?.id || '')) && layer?.url);
    if (!sourceCanvas?.width || !sourceCanvas?.height || !armLayers.length) return null;

    const images = await Promise.all(armLayers.map(layer => loadImage(layer.url)));
    if (images.every(image => !image)) return null;
    const left = makeCanvasLike(sourceCanvas);
    const right = makeCanvasLike(sourceCanvas);
    const combined = makeCanvasLike(sourceCanvas);
    const sideCtx = { left: left.getContext('2d'), right: right.getContext('2d') };
    const combinedCtx = combined.getContext('2d');

    for (let index = 0; index < armLayers.length; index++) {
      const image = images[index];
      if (!image) continue;
      const layer = armLayers[index];
      const side = sideForArmLayer(layer);
      const xf = xformFor(layer);
      drawLogicalImage(combinedCtx, image, xf, combined);
      if (side) drawLogicalImage(sideCtx[side], image, xf, side === 'left' ? left : right);
    }

    return {
      left,
      right,
      combined,
      bounds: {
        left: boundsForAlpha(left),
        right: boundsForAlpha(right),
        combined: boundsForAlpha(combined),
      },
    };
  }

  async function buildArmCloudAlphaMap(sourceCanvas, profile, coverage) {
    const fighter = resolvedFighterFor(profile);
    const maskLayer = fighter?.opacityMaskLayer || profile?.fighter?.opacityMaskLayer || null;
    if (!sourceCanvas?.width || !sourceCanvas?.height || !maskLayer?.url || !coverage?.combined) return null;
    const maskImage = await loadImage(maskLayer.url);
    if (!maskImage) return null;

    const intersection = makeCanvasLike(sourceCanvas);
    const ictx = intersection.getContext('2d');
    ictx.drawImage(coverage.combined, 0, 0);

    const maskXform = xformFor(maskLayer);
    const configuredOffset = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
    maskXform.ax += Number.isFinite(configuredOffset) ? configuredOffset : DEFAULT_AX_OFFSET;
    ictx.save();
    ictx.globalCompositeOperation = 'destination-in';
    drawLogicalImage(ictx, maskImage, maskXform, intersection);
    ictx.restore();

    const alphaCanvas = makeCanvasLike(sourceCanvas);
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
    if (rendered && renderOptions?.onlyHeadSprite !== true && renderOptions?.portraitView !== 'behind' && renderOptions?.view !== 'behind') {
      try {
        const coverage = await buildArmCoverageCanvases(canvas, profile);
        canvas.hobunjiArmCoverageBySide = coverage;
        canvas.hobunjiArmCloudAlphaMap = await buildArmCloudAlphaMap(canvas, profile, coverage);
      } catch (error) {
        canvas.hobunjiArmCoverageBySide = null;
        canvas.hobunjiArmCloudAlphaMap = null;
        console.warn('[arm-cloud-mask] arm masks skipped:', error);
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
    if (avatarRoot) {
      avatarRoot.userData.armCoverageBySide = sourceCanvas?.hobunjiArmCoverageBySide || null;
      if (sourceCanvas?.hobunjiArmCloudAlphaMap) applyAlphaMap(THREE, avatarRoot, sourceCanvas.hobunjiArmCloudAlphaMap);
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
    mode: 'png-plane-alpha-map-plus-arm-coverage',
    buildArmCoverageCanvases,
    get defaultAxOffset() { return DEFAULT_AX_OFFSET; },
    get configuredAxOffset() {
      const value = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
      return Number.isFinite(value) ? value : DEFAULT_AX_OFFSET;
    },
  };
})(window);
