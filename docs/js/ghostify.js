(() => {
  'use strict';

  // Reusable spectral-character treatment. The material pass turns every opaque
  // texel into one authored ghost color while retaining the source alpha, then
  // the WeatherFX bridge adds one or more cheap lantern-style 2D glow sources.
  // Keeping the darkness punch-through on WeatherFX's existing overlay avoids
  // adding real per-character Three.js lights to a twenty-member formation.
  const THREE = window.THREE; // Used for cloned materials, recolored CanvasTextures, and camera-right projection for glow radii.
  const DEFAULT_COLOR = '#4fd9c6'; // Used when a caller asks for ghostification without supplying its own spectral fill color.
  const DEFAULT_OPACITY = 0.56; // Used as the reusable semi-transparent material opacity.
  const DEFAULT_EMISSIVE_INTENSITY = 1.35; // Used on material classes that expose an emissive channel.
  const GLOW_REFRESH_MS = 100; // Used to stay synchronized with WeatherFX's own 100ms lighting-overlay redraw cadence.
  const originalMaterials = new WeakMap(); // Stores each mesh's pre-ghost material so restore() can return an object to ordinary rendering.
  const generatedMaterials = new WeakMap(); // Stores generated material arrays so restore() can dispose only Ghostify-owned clones/textures.
  const ghostRoots = new WeakMap(); // Stores one handle per root to make repeated apply() calls idempotent.
  const glowProviders = new Map(); // Stores cheap formation/object glow providers consumed by the WeatherFX overlay bridge.
  const textureCacheBySource = new WeakMap(); // Reuses a solid-color alpha-preserving texture for repeated meshes sharing the same source image.
  const cameraRight = THREE ? new THREE.Vector3() : null; // Reused during glow projection to avoid allocating a vector per light per refresh.

  let lightingDeps = null; // Captured from WeatherFX.init and used by drawGlowOverlay for the same canvas/world projection as lanterns.
  let lastGlowDrawAt = 0; // Throttles spectral overlay work to WeatherFX's own redraw cadence.
  let providerSequence = 0; // Generates stable unregister tokens for reusable external glow sources.

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function normalizedColor(value) {
    try { return new THREE.Color(value || DEFAULT_COLOR); } catch (_) { return new THREE.Color(DEFAULT_COLOR); }
  }

  function imageDimensions(image) {
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width || 0); // Used to size the recolor canvas to the source texture exactly.
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height || 0); // Used alongside width to reject not-yet-loaded texture sources safely.
    return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
  }

  function recoloredTexture(sourceTexture, colorValue) {
    const image = sourceTexture?.image; // Supplies the original PNG/canvas alpha silhouette that must survive the solid-color fill.
    const dims = imageDimensions(image); // Prevents canvas reads before an image has real dimensions.
    if (!image || !dims || !THREE || typeof document === 'undefined') return null;

    let byColor = textureCacheBySource.get(image); // Reuses recolors for shared source images without coupling unrelated color choices.
    if (!byColor) {
      byColor = new Map();
      textureCacheBySource.set(image, byColor);
    }
    const color = normalizedColor(colorValue); // Converts CSS/hex input once for both cache key and byte fill values.
    const cacheKey = color.getHexString(); // Separates multiple ghost palettes derived from the same source texture.
    if (byColor.has(cacheKey)) return byColor.get(cacheKey);

    try {
      const canvas = document.createElement('canvas'); // Owns the alpha-preserving solid-color copy used only by Ghostify materials.
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Reads the local/repo texture once at ghostification time, never per frame.
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, dims.width, dims.height);
      const pixels = ctx.getImageData(0, 0, dims.width, dims.height); // Supplies source alpha while discarding every original RGB value.
      const r = Math.round(color.r * 255); // Used to replace each visible source texel with the requested spectral red component.
      const g = Math.round(color.g * 255); // Used to replace each visible source texel with the requested spectral green component.
      const b = Math.round(color.b * 255); // Used to replace each visible source texel with the requested spectral blue component.
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 3] <= 0) continue;
        pixels.data[i] = r;
        pixels.data[i + 1] = g;
        pixels.data[i + 2] = b;
      }
      ctx.putImageData(pixels, 0, 0);
      const texture = new THREE.CanvasTexture(canvas); // Replaces only the cloned material map, leaving shared source textures untouched.
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
      // A future remotely-hosted/tainted texture should degrade to material tint
      // rather than breaking the character or the whole lighting pass.
      window.__farmLog?.(`[ghostify] texture fill fallback: ${error.message}`, 'warn', 'visual');
      return null;
    }
  }

  function cloneGhostMaterial(source, options) {
    if (!source?.clone) return source;
    const material = source.clone(); // Keeps the original shader/material class so skinned portrait meshes and ordinary tool planes retain their normal transform support.
    const color = normalizedColor(options.color); // Supplies both flat fallback color and emissive channel color.
    const ghostTexture = source.map ? recoloredTexture(source.map, options.color) : null; // Produces the requested solid blue-green fill while preserving source alpha.
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
    const previous = ghostRoots.get(root); // Makes repeated calls return the already-installed treatment instead of stacking opacity/material clones.
    if (previous) return previous;
    const resolved = {
      color: options.color || DEFAULT_COLOR,
      opacity: Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : DEFAULT_OPACITY,
      emissiveIntensity: Number.isFinite(Number(options.emissiveIntensity)) ? Number(options.emissiveIntensity) : DEFAULT_EMISSIVE_INTENSITY,
    }; // Used for every mesh below so one character remains visually coherent across portrait, feet, hands, and held props.

    root.traverse(object => {
      if (!object?.isMesh || !object.material) return;
      const sources = Array.isArray(object.material) ? object.material : [object.material]; // Normalizes single- and multi-material meshes for the same restoration bookkeeping.
      originalMaterials.set(object, object.material);
      const ghosts = sources.map(source => cloneGhostMaterial(source, resolved)); // Builds independent clones so ghost opacity/tint never leaks into shared runtime materials.
      generatedMaterials.set(object, ghosts);
      object.material = Array.isArray(object.material) ? ghosts : ghosts[0];
    });

    root.userData = { ...(root.userData || {}), hobunjiGhostified: true, hobunjiGhostColor: resolved.color, hobunjiGhostOpacity: resolved.opacity };
    const handle = {
      root,
      options: Object.freeze({ ...resolved }),
      restore: () => restore(root),
    }; // Returned to callers that need to un-ghost a reusable object later.
    ghostRoots.set(root, handle);
    return handle;
  }

  function restore(root) {
    if (!root?.traverse) return false;
    let restored = false; // Reports whether this root actually had Ghostify-owned materials to replace.
    root.traverse(object => {
      const original = originalMaterials.get(object); // Restores the exact material object(s) that existed before apply().
      if (!original) return;
      const ghosts = generatedMaterials.get(object) || []; // Disposes cloned materials while leaving cache-owned recolor textures reusable for sibling meshes.
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
    const raw = Array.isArray(value) ? value : (value ? [value] : []); // Lets a provider cheaply return one formation glow or a small list of individual sources.
    return raw.filter(light => Number.isFinite(Number(light?.x)) && Number.isFinite(Number(light?.y)) && Number.isFinite(Number(light?.z)) && Number(light?.radiusTiles) > 0);
  }

  function registerGlowSource(provider) {
    if (typeof provider !== 'function') return () => {};
    const token = `ghostGlow:${++providerSequence}`; // Used only as the Map key returned to the unregister closure below.
    glowProviders.set(token, provider);
    ensureWeatherBridge();
    return () => glowProviders.delete(token);
  }

  function lightScreenRadius(light, radiusTiles) {
    if (!lightingDeps?.camera || !lightingDeps?.worldToOverlay || !cameraRight) return 0;
    cameraRight.setFromMatrixColumn(lightingDeps.camera.matrixWorld, 0);
    const center = lightingDeps.worldToOverlay(light.x, light.y, light.z); // Projects the ghost centroid onto the same 2D darkness canvas used by lanterns.
    const edge = lightingDeps.worldToOverlay(
      light.x + cameraRight.x * radiusTiles,
      light.y + cameraRight.y * radiusTiles,
      light.z + cameraRight.z * radiusTiles,
    ); // Measures radius along the camera's screen-horizontal axis, matching WeatherFX lantern behavior at any shoulder-camera yaw.
    return center?.visible ? Math.hypot(edge.x - center.x, edge.y - center.y) : 0;
  }

  function drawGlowOverlay() {
    const now = performance.now(); // Keeps this supplemental overlay on the same low-frequency cadence as WeatherFX instead of becoming per-frame work.
    if (!lightingDeps?.lctx || !lightingDeps?.worldToOverlay || now - lastGlowDrawAt < GLOW_REFRESH_MS) return;
    lastGlowDrawAt = now;
    const lights = []; // Aggregates only currently visible/provider-approved ghost sources for this refresh.
    for (const provider of glowProviders.values()) {
      try { lights.push(...normalizeGlowLights(provider())); } catch (_) {}
    }
    if (!lights.length) return;

    const ctx = lightingDeps.lctx; // Draws directly onto WeatherFX's already-existing darkness overlay; no extra canvas or Three.js lights are created.
    const projected = []; // Caches projection/radius once because both darkness clearing and colored halo passes need them.
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
      const intensity = clamp(Number(light.intensity ?? 0.75), 0, 1); // Scales the lantern-style darkness clearing without ever making a ghost halo full daylight.
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius); // Produces one cheap formation halo instead of twenty PointLights.
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
      const color = normalizedColor(light.color || DEFAULT_COLOR); // Supplies the visible spectral halo after the darkness-clearing pass.
      const r = Math.round(color.r * 255); // Used to format the 2D CSS gradient red component.
      const g = Math.round(color.g * 255); // Used to format the 2D CSS gradient green component.
      const b = Math.round(color.b * 255); // Used to format the 2D CSS gradient blue component.
      const intensity = clamp(Number(light.intensity ?? 0.75), 0, 1); // Keeps the colored halo subtler than the underlying solid ghost material.
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 0.9); // Adds the visible blue-green bloom around the darkness hole.
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
    if (!api.__hobunjiGhostifyInitWrapped && typeof api.init === 'function') {
      const originalInit = api.init.bind(api); // Preserves every existing WeatherFX initialization side effect while exposing its already-created lighting dependencies locally.
      api.init = function ghostifyWeatherInit(injectedDeps) {
        lightingDeps = injectedDeps;
        return originalInit(injectedDeps);
      };
      api.__hobunjiGhostifyInitWrapped = true;
    }
    if (!api.drawLightingOverlay?.__hobunjiGhostifyWrapped && typeof api.drawLightingOverlay === 'function') {
      const originalDraw = api.drawLightingOverlay.bind(api); // Preserves sky tint, lanterns, furniture lights, lightning, and transitions before adding spectral glow.
      const wrappedDraw = function ghostifyLightingOverlay(...args) {
        const result = originalDraw(...args);
        drawGlowOverlay();
        return result;
      };
      wrappedDraw.__hobunjiGhostifyWrapped = true;
      wrappedDraw.__hobunjiGhostifyOriginal = originalDraw;
      api.drawLightingOverlay = wrappedDraw;
    }
    return true;
  }

  function watchWeatherGlobal() {
    if (installWeatherBridge()) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'WeatherFX'); // Avoids replacing a pre-existing custom accessor installed by another runtime patch.
    if (descriptor && !descriptor.configurable) return;
    let assigned = descriptor?.value; // Temporarily stores the eventual WeatherFX namespace until weather-fx.js assigns it during parser load.
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
    debugSnapshot: () => ({ glowProviders: glowProviders.size, lightingCaptured: !!lightingDeps, weatherWrapped: !!window.WeatherFX?.drawLightingOverlay?.__hobunjiGhostifyWrapped }),
  });

  watchWeatherGlobal();
  // Re-wrap if another later-loaded atmosphere adapter replaces only
  // drawLightingOverlay after our initial hook; this is a single cheap method
  // identity check per second, not visual or entity simulation work.
  if (typeof window.setInterval === 'function') window.setInterval(ensureWeatherBridge, 1000);
})();
