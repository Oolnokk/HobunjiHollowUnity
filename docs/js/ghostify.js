(() => {
  'use strict';

  // Reusable spectral-character treatment. The material pass turns every opaque
  // texel into one authored ghost color while retaining the source alpha, then
  // the WeatherFX bridge adds one or more cheap lantern-style 2D glow sources.
  // Keeping the darkness punch-through on WeatherFX's existing overlay avoids
  // adding real per-character Three.js lights to a twenty-member formation.
  const THREE = window.THREE;
  const DEFAULT_COLOR = '#4fd9c6';
  const DEFAULT_OPACITY = 0.56;
  const DEFAULT_EMISSIVE_INTENSITY = 1.35;
  const GLOW_REFRESH_MS = 100;
  const originalMaterials = new WeakMap();
  const generatedMaterials = new WeakMap();
  const ghostRoots = new WeakMap();
  const glowProviders = new Map();
  const textureCacheBySource = new WeakMap();
  const cameraRight = THREE ? new THREE.Vector3() : null;

  let lightingDeps = null;
  let lastGlowDrawAt = 0;
  let providerSequence = 0;

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function normalizedColor(value) {
    try { return new THREE.Color(value || DEFAULT_COLOR); } catch (_) { return new THREE.Color(DEFAULT_COLOR); }
  }

  function imageDimensions(image) {
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height || 0);
    return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
  }

  function recoloredTexture(sourceTexture, colorValue) {
    const image = sourceTexture?.image;
    const dims = imageDimensions(image);
    if (!image || !dims || !THREE || typeof document === 'undefined') return null;

    let byColor = textureCacheBySource.get(image);
    if (!byColor) {
      byColor = new Map();
      textureCacheBySource.set(image, byColor);
    }
    const color = normalizedColor(colorValue);
    const cacheKey = color.getHexString();
    if (byColor.has(cacheKey)) return byColor.get(cacheKey);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, dims.width, dims.height);
      const pixels = ctx.getImageData(0, 0, dims.width, dims.height);
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 3] <= 0) continue;
        pixels.data[i] = r;
        pixels.data[i + 1] = g;
        pixels.data[i + 2] = b;
      }
      ctx.putImageData(pixels, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.flipY = sourceTexture.flipY;
      texture.wrapS = sourceTexture.wrapS;
      texture.wrapT = sourceTexture.wrapT;
      texture.magFilter = sourceTexture.magFilter;
      texture.minFilter = sourceTexture.minFilter;
      texture.generateMipmaps = sourceTexture.generateMipmaps;
      texture.needsUpdate = true;
      texture.userData = { ...(sourceTexture.userData || {}), hobunjiGhostifyOwned: true };
      byColor.set(cacheKey, texture);
      return texture;
    } catch (error) {
      window.__farmLog?.(`[ghostify] texture fill fallback: ${error.message}`, 'warn', 'visual');
      return null;
    }
  }

  function cloneGhostMaterial(source, options) {
    if (!source?.clone) return source;
    const material = source.clone();
    const color = normalizedColor(options.color);
    const ghostTexture = source.map ? recoloredTexture(source.map, options.color) : null;
    if (ghostTexture) {
      material.map = ghostTexture;
      material.color?.set?.(0xffffff);
    } else {
      material.color?.copy?.(color);
    }
    material.transparent = true;
    material.opacity = clamp(Number(options.opacity), 0.05, 1);
    material.depthWrite = false;
    if ('alphaTest' in material) material.alphaTest = Math.min(Number(material.alphaTest) || 0, 0.01);
    if (material.emissive?.copy) {
      material.emissive.copy(color);
      if ('emissiveIntensity' in material) material.emissiveIntensity = Math.max(0, Number(options.emissiveIntensity) || DEFAULT_EMISSIVE_INTENSITY);
    }
    material.userData = { ...(material.userData || {}), hobunjiGhostified: true, hobunjiGhostifyOwned: true };
    material.needsUpdate = true;
    return material;
  }

  function apply(root, options = {}) {
    if (!root?.traverse || !THREE) return null;
    const previous = ghostRoots.get(root);
    if (previous) return previous;
    const resolved = {
      color: options.color || DEFAULT_COLOR,
      opacity: Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : DEFAULT_OPACITY,
      emissiveIntensity: Number.isFinite(Number(options.emissiveIntensity)) ? Number(options.emissiveIntensity) : DEFAULT_EMISSIVE_INTENSITY,
    };

    root.traverse(object => {
      if (!object?.isMesh || !object.material) return;
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      originalMaterials.set(object, object.material);
      const ghosts = sources.map(source => cloneGhostMaterial(source, resolved));
      generatedMaterials.set(object, ghosts);
      object.material = Array.isArray(object.material) ? ghosts : ghosts[0];
    });

    root.userData = { ...(root.userData || {}), hobunjiGhostified: true, hobunjiGhostColor: resolved.color, hobunjiGhostOpacity: resolved.opacity };
    const handle = {
      root,
      options: Object.freeze({ ...resolved }),
      restore: () => restore(root),
    };
    ghostRoots.set(root, handle);
    return handle;
  }

  function restore(root) {
    if (!root?.traverse) return false;
    let restored = false;
    root.traverse(object => {
      const original = originalMaterials.get(object);
      if (!original) return;
      const ghosts = generatedMaterials.get(object) || [];
      for (const material of ghosts) material?.dispose?.();
      object.material = original;
      originalMaterials.delete(object);
      generatedMaterials.delete(object);
      restored = true;
    });
    if (root.userData) {
      delete root.userData.hobunjiGhostified;
      delete root.userData.hobunjiGhostColor;
      delete root.userData.hobunjiGhostOpacity;
    }
    ghostRoots.delete(root);
    return restored;
  }

  function normalizeGlowLights(value) {
    const raw = Array.isArray(value) ? value : (value ? [value] : []);
    return raw.filter(light => Number.isFinite(Number(light?.x)) && Number.isFinite(Number(light?.y)) && Number.isFinite(Number(light?.z)) && Number(light?.radiusTiles) > 0);
  }

  function registerGlowSource(provider) {
    if (typeof provider !== 'function') return () => {};
    const token = `ghostGlow:${++providerSequence}`;
    glowProviders.set(token, provider);
    ensureWeatherBridge();
    return () => glowProviders.delete(token);
  }

  function lightScreenRadius(light, radiusTiles) {
    if (!lightingDeps?.camera || !lightingDeps?.worldToOverlay || !cameraRight) return 0;
    cameraRight.setFromMatrixColumn(lightingDeps.camera.matrixWorld, 0);
    const center = lightingDeps.worldToOverlay(light.x, light.y, light.z);
    const edge = lightingDeps.worldToOverlay(
      light.x + cameraRight.x * radiusTiles,
      light.y + cameraRight.y * radiusTiles,
      light.z + cameraRight.z * radiusTiles,
    );
    return center?.visible ? Math.hypot(edge.x - center.x, edge.y - center.y) : 0;
  }

  function drawGlowOverlay() {
    const now = performance.now();
    if (!lightingDeps?.lctx || !lightingDeps?.worldToOverlay || now - lastGlowDrawAt < GLOW_REFRESH_MS) return;
    lastGlowDrawAt = now;
    const lights = [];
    for (const provider of glowProviders.values()) {
      try { lights.push(...normalizeGlowLights(provider())); } catch (_) {}
    }
    if (!lights.length) return;

    const ctx = lightingDeps.lctx;
    const projected = [];
    for (const light of lights) {
      const center = lightingDeps.worldToOverlay(light.x, light.y, light.z);
      if (!center?.visible) continue;
      const radius = lightScreenRadius(light, Number(light.radiusTiles));
      if (!(radius > 0)) continue;
      projected.push({ light, center, radius });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const { light, center, radius } of projected) {
      const intensity = clamp(Number(light.intensity ?? 0.75), 0, 1);
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
      gradient.addColorStop(0, `rgba(0,0,0,${0.62 * intensity})`);
      gradient.addColorStop(0.35, `rgba(0,0,0,${0.36 * intensity})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'screen';
    for (const { light, center, radius } of projected) {
      const color = normalizedColor(light.color || DEFAULT_COLOR);
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      const intensity = clamp(Number(light.intensity ?? 0.75), 0, 1);
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 0.9);
      gradient.addColorStop(0, `rgba(${r},${g},${b},${0.16 * intensity})`);
      gradient.addColorStop(0.45, `rgba(${r},${g},${b},${0.07 * intensity})`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function installWeatherBridge(api = window.WeatherFX) {
    if (!api) return false;

    // Harlyao atmosphere must sit beneath Ghostify. Calling install here also
    // gives it a chance to repair itself after CloudForestFog replaces the
    // lighting renderer later in parser order.
    window.HarlyaoNightMarchAtmosphere?.install?.(api);

    if (!api.__hobunjiGhostifyInitWrapped && typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function ghostifyWeatherInit(injectedDeps) {
        lightingDeps = injectedDeps;
        return originalInit(injectedDeps);
      };
      api.__hobunjiGhostifyInitWrapped = true;
    }
    if (!api.drawLightingOverlay?.__hobunjiGhostifyWrapped && typeof api.drawLightingOverlay === 'function') {
      const priorDraw = api.drawLightingOverlay;
      const originalDraw = priorDraw.bind(api);
      const wrappedDraw = function ghostifyLightingOverlay(...args) {
        const result = originalDraw(...args);
        drawGlowOverlay();
        return result;
      };
      Object.assign(wrappedDraw, priorDraw);
      wrappedDraw.__hobunjiGhostifyWrapped = true;
      wrappedDraw.__hobunjiGhostifyOriginal = originalDraw;
      api.drawLightingOverlay = wrappedDraw;
    }

    // The locator must be outermost so its all-distance cue is never painted
    // back over by Harlyao darkness or the ordinary ghost halo.
    window.HarlyaoNightMarchBeacon?.ensureWeatherBridge?.();
    return true;
  }

  function watchWeatherGlobal() {
    if (installWeatherBridge()) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'WeatherFX');
    if (descriptor && !descriptor.configurable) return;
    let assigned = descriptor?.value;
    Object.defineProperty(window, 'WeatherFX', {
      configurable: true,
      enumerable: true,
      get: () => assigned,
      set(value) {
        assigned = value;
        Object.defineProperty(window, 'WeatherFX', { configurable: true, enumerable: true, writable: true, value });
        installWeatherBridge(value);
      },
    });
  }

  function ensureWeatherBridge() {
    installWeatherBridge(window.WeatherFX);
  }

  window.Ghostify = Object.freeze({
    apply,
    restore,
    registerGlowSource,
    installWeatherBridge,
    constants: Object.freeze({ DEFAULT_COLOR, DEFAULT_OPACITY, DEFAULT_EMISSIVE_INTENSITY }),
    debugSnapshot: () => ({
      glowProviders: glowProviders.size,
      lightingCaptured: !!lightingDeps,
      weatherWrapped: !!window.WeatherFX?.drawLightingOverlay?.__hobunjiGhostifyWrapped,
    }),
  });

  watchWeatherGlobal();
  // CloudForestFog intentionally becomes the base full-day lighting authority
  // later in parser order. Repair the composable Harlyao wrappers around that
  // final authority without doing any visual/entity work here.
  if (typeof window.setInterval === 'function') window.setInterval(ensureWeatherBridge, 1000);
})();
