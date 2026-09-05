(() => {
  'use strict';

  const THREE = window.THREE;
  const WallBuilder = window.WallBuilder;
  if (!THREE || !WallBuilder?.prototype?.tintDefaultGlb) return;

  const proto = WallBuilder.prototype;
  const originalTintDefaultGlb = proto.tintDefaultGlb;
  if (originalTintDefaultGlb.__hobunjiStructuralOutlineSuppressed) return;

  const DEFAULT_WALL_GLB_NAME = 'Roughbrick1.glb'; // Used to resolve the shared house-brick template inside each WallBuilder instance.
  const BUILDING_BRICK_TEXTURE_RE = /(?:^|\/)carved_smooth\.png(?:$|[?#])/i; // Used to scope cleanup to the authored texture currently assigned to house masonry.
  const BUILDING_BRICK_TINT = '#4d4d4d'; // Used to distinguish house masonry from other WallBuilder users that happen to reuse carved_smooth.png.
  const cleanedSourceCache = new WeakMap(); // Used to avoid repeating the edge-connected outline removal for the same loaded source image.
  let cleanedTextureCount = 0; // Debug counter: unique structural texture sources that had edge-connected dark pixels removed.
  let cleanedPixelCount = 0; // Debug counter: total source pixels replaced before shade-fill tinting.
  let lastError = ''; // Mobile-friendly diagnostic surfaced through snapshot() if canvas processing fails.

  function srgbChannelToLinear(value) {
    const c = Math.max(0, Math.min(255, Number(value) || 0)) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(r, g, b) {
    return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
  }

  function isNearBlack(data, offset, threshold) {
    return data[offset + 3] > 8 && relativeLuminance(data[offset], data[offset + 1], data[offset + 2]) <= threshold;
  }

  // carved_smooth.png is mapped once across every Roughbrick1 instance. Its authored
  // near-black border was being deliberately preserved by the portrait shade-fill
  // algorithm, which turns that border into a repeated non-shell outline around
  // every house brick. Remove ONLY near-black pixels connected to the PNG's outside
  // edge, then propagate the nearest interior texture colors outward. Internal dark
  // grain/carving that is not connected to the image edge is left untouched.
  function removeEdgeConnectedOutline(source, threshold) {
    const cachedByThreshold = cleanedSourceCache.get(source);
    const cacheKey = Number(threshold).toFixed(5);
    if (cachedByThreshold?.has(cacheKey)) return cachedByThreshold.get(cacheKey);

    const width = source?.naturalWidth || source?.width || 0;
    const height = source?.naturalHeight || source?.height || 0;
    if (!width || !height) return { source, pixels: 0 };

    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const original = imageData.data;
    const marked = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;

    const trySeed = (x, y) => {
      const index = y * width + x;
      if (marked[index]) return;
      if (!isNearBlack(original, index * 4, threshold)) return;
      marked[index] = 1;
      queue[tail++] = index;
    };

    for (let x = 0; x < width; x++) {
      trySeed(x, 0);
      if (height > 1) trySeed(x, height - 1);
    }
    for (let y = 1; y < height - 1; y++) {
      trySeed(0, y);
      if (width > 1) trySeed(width - 1, y);
    }

    const visit = (index) => {
      if (index < 0 || index >= width * height || marked[index]) return;
      if (!isNearBlack(original, index * 4, threshold)) return;
      marked[index] = 1;
      queue[tail++] = index;
    };

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) visit(index - 1);
      if (x + 1 < width) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y + 1 < height) visit(index + width);
    }

    const markedCount = tail;
    if (!markedCount) {
      const result = { source, pixels: 0 };
      const map = cachedByThreshold || new Map();
      map.set(cacheKey, result);
      cleanedSourceCache.set(source, map);
      return result;
    }

    const output = new Uint8ClampedArray(original);
    const filled = new Uint8Array(width * height);
    for (let index = 0; index < width * height; index++) {
      if (!marked[index] && original[index * 4 + 3] > 8) filled[index] = 1;
    }

    let remaining = markedCount;
    const maxPasses = Math.max(width, height);
    for (let pass = 0; pass < maxPasses && remaining > 0; pass++) {
      const pending = [];
      for (let index = 0; index < width * height; index++) {
        if (!marked[index] || filled[index]) continue;
        const x = index % width;
        const y = Math.floor(index / width);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const neighbor = ny * width + nx;
            if (!filled[neighbor]) continue;
            const offset = neighbor * 4;
            r += output[offset];
            g += output[offset + 1];
            b += output[offset + 2];
            count++;
          }
        }
        if (count) pending.push([index, r / count, g / count, b / count]);
      }
      if (!pending.length) break;
      for (const [index, r, g, b] of pending) {
        const offset = index * 4;
        output[offset] = r;
        output[offset + 1] = g;
        output[offset + 2] = b;
        filled[index] = 1;
        remaining--;
      }
    }

    imageData.data.set(output);
    ctx.putImageData(imageData, 0, 0);
    const result = { source: canvas, pixels: markedCount - remaining };
    const map = cachedByThreshold || new Map();
    map.set(cacheKey, result);
    cleanedSourceCache.set(source, map);
    cleanedTextureCount++;
    cleanedPixelCount += result.pixels;
    return result;
  }

  function isBuildingBrickTint(pngPath, fillColor) {
    return BUILDING_BRICK_TEXTURE_RE.test(String(pngPath || ''))
      && String(fillColor || '').trim().toLowerCase() === BUILDING_BRICK_TINT;
  }

  function tintBuildingBricksWithoutBakedOutline(pngPath, fillColor) {
    this._defaultGlbTintRequest = { pngPath, fillColor };
    const model = this.glbLibrary.get(DEFAULT_WALL_GLB_NAME);
    if (!model) return;

    const tintKey = `${pngPath}|${fillColor || ''}|structural-no-outline-v1`;
    if (this._defaultGlbTintKey === tintKey && this._defaultGlbTintModel === model.mesh) return;
    this._defaultGlbTintKey = tintKey;
    this._defaultGlbTintModel = model.mesh;
    const materials = Array.isArray(model.mesh.material) ? model.mesh.material : [model.mesh.material];

    new THREE.TextureLoader().load(pngPath, (texture) => {
      const rgb = fillColor && window.parseHexColor?.(fillColor);
      let finalTexture = texture;
      if (rgb && typeof window.getShadeFillCanvas === 'function') {
        const baseOptions = typeof window.getPortraitTintingConfig === 'function' ? window.getPortraitTintingConfig() : {};
        let cleaned = { source: texture.image, pixels: 0 };
        try {
          cleaned = removeEdgeConnectedOutline(texture.image, Number(baseOptions.outlineThreshold) || 0.08);
          lastError = '';
        } catch (error) {
          lastError = String(error?.message || error || 'unknown canvas cleanup error');
        }
        const tintedCanvas = window.getShadeFillCanvas(cleaned.source, `${pngPath}|${fillColor}|structural-no-outline-v1`, {
          mode: 'shadeFill',
          rgb: [rgb.r, rgb.g, rgb.b],
          options: { ...baseOptions, preserveNearBlackOutlines: false },
        });
        finalTexture = new THREE.CanvasTexture(tintedCanvas);
      }
      finalTexture.wrapS = finalTexture.wrapT = THREE.RepeatWrapping;
      finalTexture.needsUpdate = true;
      materials.forEach((material) => {
        if (!material) return;
        material.map = finalTexture;
        if (material.color) material.color.setHex(0xffffff);
        material.needsUpdate = true;
      });
    }, undefined, () => {
      if (this._defaultGlbTintModel === model.mesh) {
        this._defaultGlbTintKey = '';
        this._defaultGlbTintModel = null;
      }
    });
  }

  function patchedTintDefaultGlb(pngPath, fillColor) {
    if (!isBuildingBrickTint(pngPath, fillColor)) return originalTintDefaultGlb.call(this, pngPath, fillColor);
    return tintBuildingBricksWithoutBakedOutline.call(this, pngPath, fillColor);
  }

  patchedTintDefaultGlb.__hobunjiStructuralOutlineSuppressed = true;
  patchedTintDefaultGlb.__hobunjiStructuralOutlineOriginal = originalTintDefaultGlb;
  proto.tintDefaultGlb = patchedTintDefaultGlb;

  window.StructuralBrickOutlineSuppression = {
    installed: true,
    snapshot() {
      return {
        installed: true,
        texture: 'carved_smooth.png',
        tint: BUILDING_BRICK_TINT,
        cleanedTextureCount,
        cleanedPixelCount,
        lastError,
      };
    },
  };
})();