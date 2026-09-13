// Lightweight 2D loading-screen view of the same sky language used by sky-dome.js.
// The game sky itself remains a real Three.js sphere; this module only projects a
// wide UV window for the DOM loading overlay so boot/travel never needs a second
// Three.js renderer.
(() => {
  'use strict';

  if (window.LoadingScreenSkyBackdrop?.installed) return;

  const CONFIG_URL = 'config/loading-screens.json'; // Used by loadConfig() to share framing settings with the loading-screen tools/runtime.
  const ASSET_BASE = 'assets/sky_sprites/'; // Used by loadAssets() to reuse the production sun, moon, and cloud sprites.
  const CLOUD_NAMES = Array.from({ length: 8 }, (_, index) => `cloud${index + 1}.png`); // Used by loadAssets() and rebuildCloudAtlases().
  const CLOUD_COUNTS = [24, 32, 42]; // Used by buildCloudAtlas() to match the production sky's three density bands.
  const CLOUD_SPEEDS = [0.0018, 0.00105, 0.00055]; // Used by drawClouds() for the same relative cloud-band drift rates.
  const VIEW_SPAN_U = 0.44; // Used by projection helpers as the unzoomed horizontal equirectangular window around the focused body.
  const VIEW_SPAN_V = 0.34; // Used by projection helpers as the unzoomed vertical equirectangular window around the focused body.
  const DEFAULT_SETTINGS = Object.freeze({ skyFocusOffsetX: 0, skyFocusOffsetY: 0, skyZoom: 1.25 }); // Used until loading-screens.json supplies tool-authored framing values.
  const state = {
    config: null, // Used by currentSettings() after the shared JSON finishes loading.
    canvas: null, // Used by drawFrame() as the full-screen backdrop drawing surface.
    context: null, // Used by drawFrame() for all 2D sky rendering.
    root: null, // Used by ensureDom() to track the active loading-screen overlay.
    debug: null, // Used by updateDebug() for mobile-visible diagnostics tied to the loader's existing debug gesture.
    assets: { sun: null, moon: null, clouds: [] }, // Used by celestial/cloud drawing after production sky sprites load.
    assetsReady: false, // Used by debug output and drawFrame() to distinguish graceful gradient-only startup.
    configReady: false, // Used by debug output to show whether tool-authored offsets are active.
    cloudBucket: -1, // Used by ensureCloudAtlases() to rebuild deterministic density only when weather bucket changes.
    cloudAtlases: [], // Used by drawClouds() as cached equirectangular cloud textures.
    moonDay: -1, // Used by ensureMoonPhase() to regenerate the phase mask only when the calendar day changes.
    moonPhaseCanvas: null, // Used by drawCelestial() for the current masked moon image.
    startedAt: performance.now(), // Used by drawClouds() to advance the three backdrop cloud bands.
    raf: null, // Used by startLoop() to keep exactly one animation frame loop alive.
    lastFrame: null, // Used by getDebug() to expose the most recently rendered focus/projection state.
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value)); // Used throughout projection and color calculations.
  const mod = (value, modulus) => ((value % modulus) + modulus) % modulus; // Used by wrapped sky UV and lunar phase calculations.
  const lerp = (a, b, amount) => a + (b - a) * amount; // Used by production-matching sky/cloud interpolation.
  const smoothstep = (a, b, value) => { // Used by nightFactor() to match the production dawn/dusk easing.
    const amount = clamp((value - a) / Math.max(0.000001, b - a), 0, 1); // Used only inside this smoothstep calculation.
    return amount * amount * (3 - 2 * amount);
  };

  function currentSettings() {
    const configured = state.config?.settings || {}; // Used here to merge exported loading-screen framing values over safe defaults.
    return { ...DEFAULT_SETTINGS, ...configured };
  }

  function loadConfig() {
    fetch(CONFIG_URL, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`${CONFIG_URL}: HTTP ${response.status}`);
        return response.json();
      })
      .then(config => {
        state.config = config; // Used by currentSettings() from the next rendered frame onward.
        state.configReady = true; // Used by diagnostics so mobile testing can confirm the authored offset loaded.
      })
      .catch(error => {
        state.configReady = false; // Used by diagnostics to distinguish fallback framing from exported tool settings.
        try { (window.__farmLog || console.warn)(`[loading-sky] config fallback: ${error?.message || error}`, 'warn'); } catch (_) {}
      });
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image(); // Used by this promise as the decoded production sky sprite.
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`failed to load ${url}`));
      image.src = url;
    });
  }

  function loadAssets() {
    const urls = [`${ASSET_BASE}sun.png`, `${ASSET_BASE}moon.png`, ...CLOUD_NAMES.map(name => `${ASSET_BASE}${name}`)]; // Used by Promise.all() to load exactly the production sky sprite set.
    Promise.all(urls.map(loadImage))
      .then(images => {
        state.assets.sun = images[0]; // Used by drawCelestial() for daytime loading screens.
        state.assets.moon = images[1]; // Used by ensureMoonPhase() for nighttime loading screens.
        state.assets.clouds = images.slice(2); // Used by buildCloudAtlas() for all three deterministic cloud bands.
        state.assetsReady = true; // Used by drawFrame() and diagnostics after sprite decoding completes.
        state.cloudBucket = -1; // Used to force atlas creation on the next visible frame.
        state.moonDay = -1; // Used to force phase creation on the next visible frame.
      })
      .catch(error => {
        try { (window.__farmLog || console.warn)(`[loading-sky] asset fallback: ${error?.message || error}`, 'warn'); } catch (_) {}
      });
  }

  function getHour() {
    const debugHour = Number(window.HobunjiSkyDome?.getDebugState?.()?.hour); // Used first so the backdrop follows the exact represented hour of the live sky.
    if (Number.isFinite(debugHour)) return mod(debugHour, 24);
    const calendarHour = Number(window.CalendarSystem?.getHour?.()); // Used during partial initialization when only the calendar clock is ready.
    return Number.isFinite(calendarHour) ? mod(calendarHour, 24) : 12;
  }

  function nightFactor(hour) {
    const unwrapped = hour < 12 ? hour + 24 : hour; // Used here to treat dusk→midnight→dawn as one continuous interval.
    if (unwrapped < 18) return 0;
    if (unwrapped < 20) return smoothstep(18, 20, unwrapped);
    if (unwrapped < 29) return 1;
    if (unwrapped < 31) return 1 - smoothstep(29, 31, unwrapped);
    return 0;
  }

  function sunUv(hour) {
    const unwrapped = hour < 6 ? hour + 24 : hour; // Used here to preserve the production sun trajectory across midnight.
    const progress = clamp((unwrapped - 6) / 14, 0, 1); // Used to place the sun along the same 06:00→20:00 arc.
    const altitude = Math.max(0, Math.sin(Math.PI * progress)); // Used to reproduce the production sun altitude curve.
    return { u: mod(0.76 - 0.52 * progress - 0.25, 1), v: clamp(0.40 + altitude * 0.48, 0.36, 0.92) };
  }

  function moonUv(hour) {
    const unwrapped = hour < 12 ? hour + 24 : hour; // Used here to preserve the production moon trajectory across midnight.
    const progress = clamp((unwrapped - 18) / 12, 0, 1); // Used to place the moon along the same 18:00→06:00 arc.
    const altitude = Math.max(0, Math.sin(Math.PI * progress)); // Used to reproduce the production moon altitude curve.
    return { u: mod(0.76 - 0.52 * progress - 0.25, 1), v: clamp(0.40 + altitude * 0.45, 0.36, 0.89) };
  }

  function currentSkyState() {
    const skyDebug = window.HobunjiSkyDome?.getDebugState?.() || {}; // Used here to reuse live weather/moon state whenever the 3D sky is initialized.
    const hour = Number.isFinite(Number(skyDebug.hour)) ? Number(skyDebug.hour) : getHour(); // Used to choose and center the active celestial body.
    const night = nightFactor(hour); // Used by gradient, stars, focus choice, and celestial glow.
    const liveLight = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.() || null; // Used to tint the 2D projection with the same outdoor lighting state.
    const cloudCover = Number.isFinite(Number(skyDebug.cloudCover)) ? Number(skyDebug.cloudCover) : 0.34; // Used by cloud density/brightness and weather bucket selection.
    const dayOfMonth = clamp(Math.round(Number(skyDebug.dayOfMonth) || 14), 1, 28); // Used by ensureMoonPhase() to reproduce the 28-day lunar mask.
    const stars = Number.isFinite(Number(skyDebug.stars)) ? Number(skyDebug.stars) : night * (1 - clamp(cloudCover * 0.78, 0, 0.82)); // Used by drawStars() when the live sky debug state is not ready yet.
    return {
      hour,
      night,
      light: liveLight,
      cloudCover,
      cloudBucket: cloudCover >= 0.9 ? 3 : cloudCover >= 0.7 ? 2 : cloudCover >= 0.5 ? 1 : 0,
      dayOfMonth,
      stars,
      sun: skyDebug.sunUv || sunUv(hour),
      moon: skyDebug.moonUv || moonUv(hour),
      focusKind: night >= 0.5 ? 'moon' : 'sun',
    };
  }

  function mixColor(a, b, amount) {
    return [lerp(a[0], b[0], amount), lerp(a[1], b[1], amount), lerp(a[2], b[2], amount)]; // Used by skyColorAtV() to mirror the 3D shader's color ramps.
  }

  function skyColorAtV(v, sky) {
    const light = sky.light || { r: 255, g: 230, b: 180 }; // Used as the production lighting tint, with a daytime fallback during very early boot.
    const base = [clamp(Number(light.r) || 0, 0, 255), clamp(Number(light.g) || 0, 0, 255), clamp(Number(light.b) || 0, 0, 255)]; // Used to build top/mid/bottom daytime colors.
    const top = mixColor(base, [49, 93, 150], 0.52 * (1 - sky.night)); // Used as the upper-sky color from the production shader.
    const mid = mixColor(base, [125, 169, 202], 0.62 * (1 - sky.night)); // Used as the middle-sky color from the production shader.
    const bottom = mixColor(base, [195, 151, 116], 0.34 * (1 - sky.night)); // Used as the lower-sky color from the production shader.
    const upper = smoothstep(0.48, 0.92, v); // Used to blend middle→top like makeSkyMaterial().
    const lower = 1 - smoothstep(0.16, 0.53, v); // Used to blend the warmer lower horizon like makeSkyMaterial().
    let day = mixColor(mid, top, upper); // Used as the intermediate daytime gradient for this scanline.
    day = mixColor(day, bottom, lower * 0.62);
    const night = mixColor([4.6, 6.4, 19.1], [8.9, 14.0, 33.2], smoothstep(0.20, 0.85, v)); // Used as the same dark-blue night gradient as the shader.
    const rgb = mixColor(day, night, sky.night); // Used as the final scanline color before stars/clouds/celestials.
    return `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
  }

  function wrappedDeltaU(value, center) {
    let delta = value - center; // Used here to find the shortest path across the equirectangular seam.
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    return delta;
  }

  function viewCenterForFocus(focus, settings, width, height) {
    const offsetX = clamp(Number(settings.skyFocusOffsetX) || 0, -45, 45) / 100; // Used to shift the focused sun/moon horizontally by an authored screen-width percentage.
    const offsetY = clamp(Number(settings.skyFocusOffsetY) || 0, -35, 35) / 100; // Used to shift the focused sun/moon vertically by an authored screen-height percentage.
    const zoom = clamp(Number(settings.skyZoom) || 1, 0.5, 2.5); // Used to reduce/increase the UV window while keeping authored offsets screen-relative.
    const spanU = VIEW_SPAN_U / zoom; // Used as the current horizontal UV field of view after zoom.
    const spanV = VIEW_SPAN_V / zoom; // Used as the current vertical UV field of view after zoom.
    return {
      u: mod(focus.u - offsetX * spanU, 1),
      v: clamp(focus.v + offsetY * spanV, 0, 1),
      offsetX,
      offsetY,
      zoom,
      spanU,
      spanV,
      width,
      height,
    };
  }

  function projectUv(uv, center, width, height) {
    const deltaU = wrappedDeltaU(uv.u, center.u); // Used to place this sky point relative to the focused equirectangular center.
    const deltaV = uv.v - center.v; // Used to place this sky point vertically relative to the focused center.
    const spanU = center.spanU || VIEW_SPAN_U; // Used as this frame's zoom-adjusted horizontal field of view.
    const spanV = center.spanV || VIEW_SPAN_V; // Used as this frame's zoom-adjusted vertical field of view.
    return {
      x: width * (0.5 + deltaU / spanU),
      y: height * (0.5 - deltaV / spanV),
      visible: Math.abs(deltaU) <= spanU * 0.6 && Math.abs(deltaV) <= spanV * 0.65,
    };
  }

  function resizeCanvas(canvas) {
    const dpr = clamp(Number(window.devicePixelRatio) || 1, 1, 2); // Used to keep the backdrop crisp without letting high-DPI phones quadruple its cost.
    const width = Math.max(1, Math.round(window.innerWidth)); // Used as the CSS-pixel projection width for this frame.
    const height = Math.max(1, Math.round(window.innerHeight)); // Used as the CSS-pixel projection height for this frame.
    const pixelWidth = Math.round(width * dpr); // Used as the backing-store width for the canvas.
    const pixelHeight = Math.round(height * dpr); // Used as the backing-store height for the canvas.
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = state.context; // Used here to restore drawing coordinates to CSS pixels after a backing-store resize.
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, dpr };
  }

  function drawGradient(context, width, height, center, sky) {
    const rowStep = Math.max(2, Math.round(height / 180)); // Used to draw the shader-like UV gradient in a bounded number of scanline fills.
    const spanV = center.spanV || VIEW_SPAN_V; // Used as the zoom-adjusted latitude span represented by the screen.
    for (let y = 0; y < height; y += rowStep) {
      const v = clamp(center.v + (0.5 - y / height) * spanV, 0, 1); // Used to sample the global sky latitude represented by this screen row.
      context.fillStyle = skyColorAtV(v, sky);
      context.fillRect(0, y, width, rowStep + 1);
    }
  }

  function hash01(seed) {
    let value = seed | 0; // Used as the mutable integer state for deterministic star placement.
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    value = value ^ value >>> 16;
    return (value >>> 0) / 4294967296;
  }

  function drawStars(context, width, height, center, sky) {
    const opacity = clamp(Number(sky.stars) || 0, 0, 1); // Used to suppress stars during day/cloud/rain exactly as the live sky debug signal requests.
    if (opacity <= 0.01) return;
    context.save();
    context.globalAlpha = opacity;
    for (let index = 0; index < 240; index++) {
      const u = hash01(0x51f15e + index * 17); // Used as this deterministic star's global longitude.
      const v = 0.22 + hash01(0x77a11 + index * 29) * 0.72; // Used as this deterministic star's global latitude, biased away from the low horizon.
      const projected = projectUv({ u, v }, center, width, height); // Used to discard stars outside the current wide sky crop.
      if (!projected.visible) continue;
      const radius = 0.55 + hash01(0x9981 + index * 41) * 1.25; // Used as this star's screen-space core size.
      context.fillStyle = hash01(0xa91 + index * 13) > 0.5 ? '#fff7e7' : '#edf5ff';
      context.beginPath();
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function mulberry32(seed) {
    let value = seed >>> 0; // Used as the private state of the production-matching deterministic cloud-atlas generator.
    return () => {
      value |= 0;
      value = value + 0x6D2B79F5 | 0;
      let result = Math.imul(value ^ value >>> 15, 1 | value); // Used to generate this call's pseudo-random bits.
      result = result + Math.imul(result ^ result >>> 7, 61 | result) ^ result;
      return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
  }

  function buildCloudAtlas(bandIndex, sky) {
    const canvas = document.createElement('canvas'); // Used as this band's cached equirectangular cloud texture.
    canvas.width = 2048;
    canvas.height = 1024;
    const context = canvas.getContext('2d'); // Used to paint deterministic production cloud sprites into the atlas.
    const countBoost = lerp(0.92, 2.55, sky.cloudCover); // Used to match production weather-dependent cloud count.
    const spread = lerp(1, 2.15, sky.cloudCover); // Used to match production weather-dependent horizontal cloud stretching.
    const count = Math.max(1, Math.round(CLOUD_COUNTS[bandIndex] * countBoost)); // Used as the exact number of sprites painted into this band.
    const random = mulberry32((0x484f4255 + bandIndex * 7919 + sky.cloudBucket * 104729) >>> 0); // Used to reproduce the production deterministic weather-bucket seed.
    for (let index = 0; index < count; index++) {
      const image = state.assets.clouds[Math.floor(random() * state.assets.clouds.length)]; // Used as this atlas placement's production cloud sprite.
      if (!image) continue;
      const imageWidth = image.naturalWidth || image.width; // Used to preserve this cloud sprite's aspect ratio.
      const imageHeight = image.naturalHeight || image.height; // Used to preserve this cloud sprite's aspect ratio.
      const base = bandIndex === 0 ? 118 + random() * 76 : bandIndex === 1 ? 82 + random() * 60 : 56 + random() * 44; // Used to match production band scale.
      const size = base * lerp(0.92, 1.16, sky.cloudCover); // Used as the weather-adjusted base cloud size.
      const drawWidth = size * spread; // Used as this cloud's horizontally stretched atlas width.
      const drawHeight = size * (imageHeight / Math.max(1, imageWidth)); // Used as this cloud's aspect-correct atlas height.
      const x = random() * canvas.width - drawWidth * 0.5; // Used as this cloud's wrapped atlas X position.
      const y = canvas.height * (0.11 + Math.pow(random(), 0.72) * 0.62) - drawHeight * 0.5; // Used as this cloud's production-matching altitude distribution.
      context.globalAlpha = 0.68 + random() * 0.18;
      context.drawImage(image, x, y, drawWidth, drawHeight);
      if (x < 0) context.drawImage(image, x + canvas.width, y, drawWidth, drawHeight);
      if (x + drawWidth > canvas.width) context.drawImage(image, x - canvas.width, y, drawWidth, drawHeight);
    }
    context.globalAlpha = 1;
    return canvas;
  }

  function ensureCloudAtlases(sky) {
    if (!state.assetsReady || !state.assets.clouds.length || state.cloudBucket === sky.cloudBucket) return;
    state.cloudBucket = sky.cloudBucket; // Used by subsequent frames to reuse these atlases until the live weather bucket changes.
    state.cloudAtlases = [0, 1, 2].map(index => buildCloudAtlas(index, sky)); // Used by drawClouds() as the three production-like parallax bands.
  }

  function drawWrappedAtlas(context, atlas, center, width, height, offsetU, alpha) {
    const atlasWidth = atlas.width; // Used to convert global sky U into source pixels.
    const atlasHeight = atlas.height; // Used to convert global sky V into source pixels.
    const spanU = center.spanU || VIEW_SPAN_U; // Used as the zoom-adjusted horizontal crop span.
    const spanV = center.spanV || VIEW_SPAN_V; // Used as the zoom-adjusted vertical crop span.
    const leftU = mod(center.u - spanU * 0.5 + offsetU, 1); // Used as the wrapped source longitude at the left edge of the screen.
    const topV = clamp(center.v + spanV * 0.5, 0, 1); // Used as the global sky latitude at the top edge of the screen.
    const bottomV = clamp(center.v - spanV * 0.5, 0, 1); // Used as the global sky latitude at the bottom edge of the screen.
    const sourceY = (1 - topV) * atlasHeight; // Used as the CanvasTexture-flipped top crop pixel.
    const sourceHeight = Math.max(1, (topV - bottomV) * atlasHeight); // Used as the CanvasTexture-flipped crop height.
    const sourceWidth = spanU * atlasWidth; // Used as the crop width represented by this zoom level.
    const sourceX = leftU * atlasWidth; // Used as the first wrapped source pixel in this crop.
    context.save();
    context.globalAlpha = alpha;
    if (sourceX + sourceWidth <= atlasWidth) {
      context.drawImage(atlas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    } else {
      const firstWidth = atlasWidth - sourceX; // Used as the source width before crossing the longitude seam.
      const firstScreenWidth = width * (firstWidth / sourceWidth); // Used as the matching screen width before the seam.
      context.drawImage(atlas, sourceX, sourceY, firstWidth, sourceHeight, 0, 0, firstScreenWidth, height);
      context.drawImage(atlas, 0, sourceY, sourceWidth - firstWidth, sourceHeight, firstScreenWidth, 0, width - firstScreenWidth, height);
    }
    context.restore();
  }

  function drawClouds(context, width, height, center, sky, now) {
    ensureCloudAtlases(sky);
    const elapsedSeconds = Math.max(0, (now - state.startedAt) / 1000); // Used to advance cloud UV offsets while the loading screen is visible.
    const brightnessAlpha = clamp(0.96 - sky.cloudCover * 0.18, 0.66, 0.9); // Used as a cheap 2D analogue of the production cloud brightness/opacity blend.
    state.cloudAtlases.forEach((atlas, bandIndex) => {
      const offset = mod(bandIndex * 0.173 + elapsedSeconds * CLOUD_SPEEDS[bandIndex], 1); // Used as this band's production-rate wrapped UV drift.
      drawWrappedAtlas(context, atlas, center, width, height, offset, brightnessAlpha);
    });
  }

  function lunarProgress(day) {
    return mod(day, 28) / 28; // Used by buildMoonPhaseCanvas() to orient the 28-day illumination terminator.
  }

  function buildMoonPhaseCanvas(image, day) {
    const width = image.naturalWidth || image.width; // Used as the phase-mask source/output pixel width.
    const height = image.naturalHeight || image.height; // Used as the phase-mask source/output pixel height.
    const source = document.createElement('canvas'); // Used to read the production moon sprite pixels.
    source.width = width;
    source.height = height;
    const sourceContext = source.getContext('2d', { willReadFrequently: true }); // Used to extract source alpha and color pixels.
    sourceContext.drawImage(image, 0, 0, width, height);
    const input = sourceContext.getImageData(0, 0, width, height); // Used as the source moon RGBA buffer for phase masking.
    const rgba = input.data; // Used repeatedly while finding the opaque moon bounds and copying lit pixels.
    let minX = width; // Used while finding the opaque moon disc's left bound.
    let minY = height; // Used while finding the opaque moon disc's top bound.
    let maxX = -1; // Used while finding the opaque moon disc's right bound.
    let maxY = -1; // Used while finding the opaque moon disc's bottom bound.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3] > 8) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (maxX < minX) return source;
    const centerX = (minX + maxX) * 0.5; // Used to normalize phase-mask sphere coordinates horizontally.
    const centerY = (minY + maxY) * 0.5; // Used to normalize phase-mask sphere coordinates vertically.
    const radiusX = Math.max(1, (maxX - minX + 1) * 0.5); // Used to normalize the sprite's possibly non-square opaque bounds.
    const radiusY = Math.max(1, (maxY - minY + 1) * 0.5); // Used to normalize the sprite's possibly non-square opaque bounds.
    const angle = lunarProgress(day) * Math.PI * 2; // Used as the production lunar light-vector angle.
    const lightX = Math.sin(angle); // Used as the lunar illumination vector's horizontal component.
    const lightZ = -Math.cos(angle); // Used as the lunar illumination vector's toward-viewer component.
    const lit = new Uint8Array(width * height); // Used to remember which source moon pixels belong to the illuminated hemisphere.
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const index = y * width + x; // Used to address this source/output pixel in flat buffers.
      if (rgba[index * 4 + 3] <= 8) continue;
      const normalX = (x - centerX) / radiusX; // Used as the surface normal's horizontal component on the projected moon sphere.
      const normalY = (y - centerY) / radiusY; // Used as the surface normal's vertical component on the projected moon sphere.
      const radiusSquared = normalX * normalX + normalY * normalY; // Used to discard pixels outside the normalized moon disc.
      if (radiusSquared > 1) continue;
      const normalZ = Math.sqrt(Math.max(0, 1 - radiusSquared)); // Used as the visible hemisphere's toward-viewer normal component.
      if (normalX * lightX + normalZ * lightZ > 0) lit[index] = 1;
    }
    const output = document.createElement('canvas'); // Used as the transparent phase-masked moon sprite returned to drawCelestial().
    output.width = width;
    output.height = height;
    const outputContext = output.getContext('2d', { willReadFrequently: true }); // Used to write the phase-masked RGBA buffer.
    const outputImage = outputContext.createImageData(width, height); // Used as the writable destination RGBA buffer.
    const destination = outputImage.data; // Used to copy only illuminated production moon pixels.
    for (let index = 0; index < width * height; index++) if (lit[index]) {
      const pixel = index * 4; // Used to address this lit pixel's RGBA channels.
      destination[pixel] = rgba[pixel]; destination[pixel + 1] = rgba[pixel + 1]; destination[pixel + 2] = rgba[pixel + 2]; destination[pixel + 3] = rgba[pixel + 3];
    }
    outputContext.putImageData(outputImage, 0, 0);
    return output;
  }

  function ensureMoonPhase(sky) {
    if (!state.assets.moon || state.moonDay === sky.dayOfMonth) return;
    state.moonDay = sky.dayOfMonth; // Used by later frames to reuse the same phase mask for this calendar day.
    state.moonPhaseCanvas = buildMoonPhaseCanvas(state.assets.moon, sky.dayOfMonth); // Used by drawCelestial() as the current lunar body sprite.
  }

  function drawCelestial(context, width, height, center, sky, kind) {
    const uv = kind === 'sun' ? sky.sun : sky.moon; // Used to project the requested celestial body into the wide sky crop.
    const image = kind === 'sun' ? state.assets.sun : state.moonPhaseCanvas; // Used as the production-styled body image for this draw.
    if (!image) return;
    const projected = projectUv(uv, center, width, height); // Used as the body center in screen pixels.
    if (!projected.visible) return;
    const zoom = center.zoom || 1; // Used to scale the body with the authored sky camera zoom.
    const baseSize = Math.min(width, height) * (kind === 'sun' ? 0.19 : 0.17) * zoom; // Used as the prominent loading-screen body height at this zoom.
    const imageWidth = image.naturalWidth || image.width; // Used to preserve this body sprite's original aspect ratio.
    const imageHeight = image.naturalHeight || image.height; // Used to preserve this body sprite's original aspect ratio.
    const drawWidth = baseSize * (imageWidth / Math.max(1, imageHeight)); // Used as the aspect-correct body width.
    const drawHeight = baseSize; // Used as the body height in screen pixels.
    const glowRadius = baseSize * (kind === 'sun' ? 2.8 : 3.0); // Used as the soft self-light halo radius behind the body.
    const gradient = context.createRadialGradient(projected.x, projected.y, 0, projected.x, projected.y, glowRadius); // Used to reproduce the unoutlined celestial glow language.
    const glowRgb = kind === 'sun' ? '255,216,137' : '169,201,255'; // Used as the same warm/cool glow tint as sky-dome.js.
    gradient.addColorStop(0, `rgba(${glowRgb},.34)`);
    gradient.addColorStop(0.2, `rgba(${glowRgb},.18)`);
    gradient.addColorStop(0.55, `rgba(${glowRgb},.045)`);
    gradient.addColorStop(1, `rgba(${glowRgb},0)`);
    context.save();
    context.fillStyle = gradient;
    context.fillRect(projected.x - glowRadius, projected.y - glowRadius, glowRadius * 2, glowRadius * 2);
    context.drawImage(image, projected.x - drawWidth * 0.5, projected.y - drawHeight * 0.5, drawWidth, drawHeight);
    context.restore();
  }

  function drawVignette(context, width, height) {
    const gradient = context.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.12, width * 0.5, height * 0.5, Math.max(width, height) * 0.72); // Used to keep white loading copy legible without flattening the sky art.
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.72, 'rgba(0,0,0,.08)');
    gradient.addColorStop(1, 'rgba(0,0,0,.34)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  function ensureDom() {
    const root = document.getElementById('hobunjiLoadScreen'); // Used as the canonical runtime loading-screen overlay host.
    if (!root) return false;
    if (state.root !== root || !state.canvas?.isConnected) {
      state.root = root; // Used by subsequent frames to avoid re-querying/rebuilding the same backdrop DOM.
      const canvas = document.createElement('canvas'); // Used as the new full-screen sky backdrop behind the existing loader contents.
      canvas.id = 'hlsSkyBackdrop';
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      root.insertBefore(canvas, root.firstChild);
      state.canvas = canvas; // Used by resizeCanvas() and drawFrame().
      state.context = canvas.getContext('2d', { alpha: false }); // Used by every backdrop drawing routine.
      const debug = document.createElement('pre'); // Used as sky-specific diagnostics that follow the existing five-tap loader debug visibility.
      debug.id = 'hlsSkyDebug';
      Object.assign(debug.style, { display: 'none', position: 'absolute', left: 'max(4vw,24px)', bottom: 'max(9vh,58px)', maxWidth: 'min(76vw,420px)', margin: '0', padding: '8px 10px', border: '1px solid rgba(255,255,255,.28)', borderRadius: '7px', background: 'rgba(0,0,0,.78)', color: '#dcecff', font: '11px/1.35 monospace', whiteSpace: 'pre-wrap', pointerEvents: 'none' });
      root.appendChild(debug);
      state.debug = debug; // Used by updateDebug() to expose focus and config state on mobile.
    }
    return true;
  }

  function updateDebug(frame) {
    if (!state.debug || !state.root) return;
    const runtimeDebug = state.root.querySelector('#hlsDebug'); // Used to mirror the existing loader debug panel's visible state.
    const visible = !!runtimeDebug?.classList?.contains('visible'); // Used so the same five-tap gesture reveals both diagnostics panels.
    state.debug.style.display = visible ? 'block' : 'none';
    if (!visible || !frame) return;
    state.debug.textContent = [
      'SKY BACKDROP',
      `focus=${frame.focusKind} hour=${frame.hour.toFixed(2)} night=${frame.night.toFixed(2)}`,
      `focusUV=${frame.focus.u.toFixed(3)},${frame.focus.v.toFixed(3)} centerUV=${frame.center.u.toFixed(3)},${frame.center.v.toFixed(3)}`,
      `toolOffset=${(frame.center.offsetX * 100).toFixed(1)}vw, ${(frame.center.offsetY * 100).toFixed(1)}vh zoom=${frame.center.zoom.toFixed(2)}x`,
      `config=${state.configReady ? 'loaded' : 'fallback'} assets=${state.assetsReady ? 'loaded' : 'gradient-only'}`,
      `cloudCover=${frame.cloudCover.toFixed(2)} bucket=${frame.cloudBucket} stars=${frame.stars.toFixed(2)}`,
    ].join('\n');
  }

  function drawFrame(now) {
    if (!ensureDom() || !state.context || !state.canvas) return;
    const runtimeVisible = state.root.classList.contains('visible'); // Used to skip canvas work when the loading screen is not being shown.
    if (!runtimeVisible) {
      updateDebug(state.lastFrame);
      return;
    }
    const dimensions = resizeCanvas(state.canvas); // Used as this frame's CSS-pixel projection dimensions.
    const sky = currentSkyState(); // Used as the authoritative live sky/weather/lunar input for this frame.
    const settings = currentSettings(); // Used as the tool-authored framing configuration for this frame.
    const focus = sky.focusKind === 'moon' ? sky.moon : sky.sun; // Used as the body that the wide view follows by day/night.
    const center = viewCenterForFocus(focus, settings, dimensions.width, dimensions.height); // Used as the equirectangular crop center after authored offset/zoom.
    ensureMoonPhase(sky);
    state.context.clearRect(0, 0, dimensions.width, dimensions.height);
    drawGradient(state.context, dimensions.width, dimensions.height, center, sky);
    drawStars(state.context, dimensions.width, dimensions.height, center, sky);
    drawCelestial(state.context, dimensions.width, dimensions.height, center, sky, 'sun');
    drawCelestial(state.context, dimensions.width, dimensions.height, center, sky, 'moon');
    // Clouds intentionally render after both celestial bodies so their alpha can
    // occlude the sun and moon just like the nearer cloud shells in sky-dome.js.
    drawClouds(state.context, dimensions.width, dimensions.height, center, sky, now);
    drawVignette(state.context, dimensions.width, dimensions.height);
    const frame = { ...sky, focus, focusKind: sky.focusKind, center }; // Used by diagnostics and the public getDebug() accessor after this draw completes.
    state.lastFrame = frame;
    updateDebug(frame);
  }

  function tick(now) {
    drawFrame(now);
    state.raf = requestAnimationFrame(tick); // Used to keep cloud drift and live time-of-day framing current while the loader is visible.
  }

  function startLoop() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(tick); // Used as the single module-owned animation loop handle.
  }

  loadConfig();
  loadAssets();
  startLoop();

  window.LoadingScreenSkyBackdrop = Object.freeze({
    installed: true,
    getDebug: () => ({
      configReady: state.configReady,
      assetsReady: state.assetsReady,
      cloudBucket: state.cloudBucket,
      lastFrame: state.lastFrame,
      settings: currentSettings(),
    }),
    redraw: () => drawFrame(performance.now()),
  });
})();
