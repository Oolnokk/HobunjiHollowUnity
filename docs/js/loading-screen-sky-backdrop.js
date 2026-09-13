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
  const DEFAULT_SETTINGS = Object.freeze({ skyFocusOffsetX: 8, skyFocusOffsetY: 0, skyZoom: 3.25 }); // Used until loading-screens.json supplies tool-authored framing values.
  const state = {
    config: null,
    canvas: null,
    context: null,
    root: null,
    debug: null,
    assets: { sun: null, moon: null, clouds: [] },
    assetsReady: false,
    configReady: false,
    cloudBucket: -1,
    cloudAtlases: [],
    moonDay: -1,
    moonPhaseCanvas: null,
    startedAt: performance.now(),
    raf: null,
    lastFrame: null,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mod = (value, modulus) => ((value % modulus) + modulus) % modulus;
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const smoothstep = (a, b, value) => {
    const amount = clamp((value - a) / Math.max(0.000001, b - a), 0, 1);
    return amount * amount * (3 - 2 * amount);
  };

  function currentSettings() {
    const configured = state.config?.settings || {};
    return { ...DEFAULT_SETTINGS, ...configured };
  }

  function loadConfig() {
    fetch(CONFIG_URL, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`${CONFIG_URL}: HTTP ${response.status}`);
        return response.json();
      })
      .then(config => {
        state.config = config;
        state.configReady = true;
      })
      .catch(error => {
        state.configReady = false;
        try { (window.__farmLog || console.warn)(`[loading-sky] config fallback: ${error?.message || error}`, 'warn'); } catch (_) {}
      });
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`failed to load ${url}`));
      image.src = url;
    });
  }

  function loadAssets() {
    const urls = [`${ASSET_BASE}sun.png`, `${ASSET_BASE}moon.png`, ...CLOUD_NAMES.map(name => `${ASSET_BASE}${name}`)];
    Promise.all(urls.map(loadImage))
      .then(images => {
        state.assets.sun = images[0];
        state.assets.moon = images[1];
        state.assets.clouds = images.slice(2);
        state.assetsReady = true;
        state.cloudBucket = -1;
        state.moonDay = -1;
      })
      .catch(error => {
        try { (window.__farmLog || console.warn)(`[loading-sky] asset fallback: ${error?.message || error}`, 'warn'); } catch (_) {}
      });
  }

  function getHour() {
    const debugHour = Number(window.HobunjiSkyDome?.getDebugState?.()?.hour);
    if (Number.isFinite(debugHour)) return mod(debugHour, 24);
    const calendarHour = Number(window.CalendarSystem?.getHour?.());
    return Number.isFinite(calendarHour) ? mod(calendarHour, 24) : 12;
  }

  function nightFactor(hour) {
    const unwrapped = hour < 12 ? hour + 24 : hour;
    if (unwrapped < 18) return 0;
    if (unwrapped < 20) return smoothstep(18, 20, unwrapped);
    if (unwrapped < 29) return 1;
    if (unwrapped < 31) return 1 - smoothstep(29, 31, unwrapped);
    return 0;
  }

  function sunUv(hour) {
    const unwrapped = hour < 6 ? hour + 24 : hour;
    const progress = clamp((unwrapped - 6) / 14, 0, 1);
    const altitude = Math.max(0, Math.sin(Math.PI * progress));
    return { u: mod(0.76 - 0.52 * progress - 0.25, 1), v: clamp(0.40 + altitude * 0.48, 0.36, 0.92) };
  }

  function moonUv(hour) {
    const unwrapped = hour < 12 ? hour + 24 : hour;
    const progress = clamp((unwrapped - 18) / 12, 0, 1);
    const altitude = Math.max(0, Math.sin(Math.PI * progress));
    return { u: mod(0.76 - 0.52 * progress - 0.25, 1), v: clamp(0.40 + altitude * 0.45, 0.36, 0.89) };
  }

  function currentSkyState() {
    const skyDebug = window.HobunjiSkyDome?.getDebugState?.() || {};
    const hour = Number.isFinite(Number(skyDebug.hour)) ? Number(skyDebug.hour) : getHour();
    const night = nightFactor(hour);
    const liveLight = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.() || null;
    const cloudCover = Number.isFinite(Number(skyDebug.cloudCover)) ? Number(skyDebug.cloudCover) : 0.34;
    const dayOfMonth = clamp(Math.round(Number(skyDebug.dayOfMonth) || 14), 1, 28);
    const stars = Number.isFinite(Number(skyDebug.stars)) ? Number(skyDebug.stars) : night * (1 - clamp(cloudCover * 0.78, 0, 0.82));
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
    return [lerp(a[0], b[0], amount), lerp(a[1], b[1], amount), lerp(a[2], b[2], amount)];
  }

  function skyColorAtV(v, sky) {
    const light = sky.light || { r: 255, g: 230, b: 180 };
    const base = [clamp(Number(light.r) || 0, 0, 255), clamp(Number(light.g) || 0, 0, 255), clamp(Number(light.b) || 0, 0, 255)];
    const top = mixColor(base, [49, 93, 150], 0.52 * (1 - sky.night));
    const mid = mixColor(base, [125, 169, 202], 0.62 * (1 - sky.night));
    const bottom = mixColor(base, [195, 151, 116], 0.34 * (1 - sky.night));
    const upper = smoothstep(0.48, 0.92, v);
    const lower = 1 - smoothstep(0.16, 0.53, v);
    let day = mixColor(mid, top, upper);
    day = mixColor(day, bottom, lower * 0.62);
    const night = mixColor([4.6, 6.4, 19.1], [8.9, 14.0, 33.2], smoothstep(0.20, 0.85, v));
    const rgb = mixColor(day, night, sky.night);
    return `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
  }

  function wrappedDeltaU(value, center) {
    let delta = value - center;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    return delta;
  }

  function viewCenterForFocus(focus, settings, width, height) {
    const offsetX = clamp(Number(settings.skyFocusOffsetX) || 0, -45, 45) / 100;
    const offsetY = clamp(Number(settings.skyFocusOffsetY) || 0, -35, 35) / 100;
    const zoom = clamp(Number(settings.skyZoom) || 1, 0.5, 4);
    const spanU = VIEW_SPAN_U / zoom;
    const spanV = VIEW_SPAN_V / zoom;
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
    const deltaU = wrappedDeltaU(uv.u, center.u);
    const deltaV = uv.v - center.v;
    const spanU = center.spanU || VIEW_SPAN_U;
    const spanV = center.spanV || VIEW_SPAN_V;
    return {
      x: width * (0.5 + deltaU / spanU),
      y: height * (0.5 - deltaV / spanV),
      visible: Math.abs(deltaU) <= spanU * 0.6 && Math.abs(deltaV) <= spanV * 0.65,
    };
  }

  function resizeCanvas(canvas) {
    const dpr = clamp(Number(window.devicePixelRatio) || 1, 1, 2);
    const width = Math.max(1, Math.round(window.innerWidth));
    const height = Math.max(1, Math.round(window.innerHeight));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = state.context;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, dpr };
  }

  function drawGradient(context, width, height, center, sky) {
    const rowStep = Math.max(2, Math.round(height / 180));
    const spanV = center.spanV || VIEW_SPAN_V;
    for (let y = 0; y < height; y += rowStep) {
      const v = clamp(center.v + (0.5 - y / height) * spanV, 0, 1);
      context.fillStyle = skyColorAtV(v, sky);
      context.fillRect(0, y, width, rowStep + 1);
    }
  }

  function hash01(seed) {
    let value = seed | 0;
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    value = value ^ value >>> 16;
    return (value >>> 0) / 4294967296;
  }

  function drawStars(context, width, height, center, sky) {
    const opacity = clamp(Number(sky.stars) || 0, 0, 1);
    if (opacity <= 0.01) return;
    context.save();
    context.globalAlpha = opacity;
    for (let index = 0; index < 240; index++) {
      const u = hash01(0x51f15e + index * 17);
      const v = 0.22 + hash01(0x77a11 + index * 29) * 0.72;
      const projected = projectUv({ u, v }, center, width, height);
      if (!projected.visible) continue;
      const radius = 0.55 + hash01(0x9981 + index * 41) * 1.25;
      context.fillStyle = hash01(0xa91 + index * 13) > 0.5 ? '#fff7e7' : '#edf5ff';
      context.beginPath();
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value |= 0;
      value = value + 0x6D2B79F5 | 0;
      let result = Math.imul(value ^ value >>> 15, 1 | value);
      result = result + Math.imul(result ^ result >>> 7, 61 | result) ^ result;
      return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
  }

  function buildCloudAtlas(bandIndex, sky) {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    const countBoost = lerp(0.92, 2.55, sky.cloudCover);
    const spread = lerp(1, 2.15, sky.cloudCover);
    const count = Math.max(1, Math.round(CLOUD_COUNTS[bandIndex] * countBoost));
    const random = mulberry32((0x484f4255 + bandIndex * 7919 + sky.cloudBucket * 104729) >>> 0);
    for (let index = 0; index < count; index++) {
      const image = state.assets.clouds[Math.floor(random() * state.assets.clouds.length)];
      if (!image) continue;
      const imageWidth = image.naturalWidth || image.width;
      const imageHeight = image.naturalHeight || image.height;
      const base = bandIndex === 0 ? 118 + random() * 76 : bandIndex === 1 ? 82 + random() * 60 : 56 + random() * 44;
      const size = base * lerp(0.92, 1.16, sky.cloudCover);
      const drawWidth = size * spread;
      const drawHeight = size * (imageHeight / Math.max(1, imageWidth));
      const x = random() * canvas.width - drawWidth * 0.5;
      const y = canvas.height * (0.11 + Math.pow(random(), 0.72) * 0.62) - drawHeight * 0.5;
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
    state.cloudBucket = sky.cloudBucket;
    state.cloudAtlases = [0, 1, 2].map(index => buildCloudAtlas(index, sky));
  }

  function drawWrappedAtlas(context, atlas, center, width, height, offsetU, alpha) {
    const atlasWidth = atlas.width;
    const atlasHeight = atlas.height;
    const spanU = center.spanU || VIEW_SPAN_U;
    const spanV = center.spanV || VIEW_SPAN_V;
    const leftU = mod(center.u - spanU * 0.5 + offsetU, 1);
    const topV = clamp(center.v + spanV * 0.5, 0, 1);
    const bottomV = clamp(center.v - spanV * 0.5, 0, 1);
    const sourceY = (1 - topV) * atlasHeight;
    const sourceHeight = Math.max(1, (topV - bottomV) * atlasHeight);
    const sourceWidth = spanU * atlasWidth;
    const sourceX = leftU * atlasWidth;
    context.save();
    context.globalAlpha = alpha;
    if (sourceX + sourceWidth <= atlasWidth) {
      context.drawImage(atlas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    } else {
      const firstWidth = atlasWidth - sourceX;
      const firstScreenWidth = width * (firstWidth / sourceWidth);
      context.drawImage(atlas, sourceX, sourceY, firstWidth, sourceHeight, 0, 0, firstScreenWidth, height);
      context.drawImage(atlas, 0, sourceY, sourceWidth - firstWidth, sourceHeight, firstScreenWidth, 0, width - firstScreenWidth, height);
    }
    context.restore();
  }

  function drawClouds(context, width, height, center, sky, now) {
    ensureCloudAtlases(sky);
    const elapsedSeconds = Math.max(0, (now - state.startedAt) / 1000);
    const brightnessAlpha = clamp(0.96 - sky.cloudCover * 0.18, 0.66, 0.9);
    state.cloudAtlases.forEach((atlas, bandIndex) => {
      const offset = mod(bandIndex * 0.173 + elapsedSeconds * CLOUD_SPEEDS[bandIndex], 1);
      drawWrappedAtlas(context, atlas, center, width, height, offset, brightnessAlpha);
    });
  }

  function lunarProgress(day) {
    return mod(day, 28) / 28;
  }

  function buildMoonPhaseCanvas(image, day) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0, width, height);
    const input = sourceContext.getImageData(0, 0, width, height);
    const rgba = input.data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3] > 8) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (maxX < minX) return source;
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const radiusX = Math.max(1, (maxX - minX + 1) * 0.5);
    const radiusY = Math.max(1, (maxY - minY + 1) * 0.5);
    const angle = lunarProgress(day) * Math.PI * 2;
    const lightX = Math.sin(angle);
    const lightZ = -Math.cos(angle);
    const lit = new Uint8Array(width * height);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const index = y * width + x;
      if (rgba[index * 4 + 3] <= 8) continue;
      const normalX = (x - centerX) / radiusX;
      const normalY = (y - centerY) / radiusY;
      const radiusSquared = normalX * normalX + normalY * normalY;
      if (radiusSquared > 1) continue;
      const normalZ = Math.sqrt(Math.max(0, 1 - radiusSquared));
      if (normalX * lightX + normalZ * lightZ > 0) lit[index] = 1;
    }
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputContext = output.getContext('2d', { willReadFrequently: true });
    const outputImage = outputContext.createImageData(width, height);
    const destination = outputImage.data;
    for (let index = 0; index < width * height; index++) if (lit[index]) {
      const pixel = index * 4;
      destination[pixel] = rgba[pixel]; destination[pixel + 1] = rgba[pixel + 1]; destination[pixel + 2] = rgba[pixel + 2]; destination[pixel + 3] = rgba[pixel + 3];
    }
    outputContext.putImageData(outputImage, 0, 0);
    return output;
  }

  function ensureMoonPhase(sky) {
    if (!state.assets.moon || state.moonDay === sky.dayOfMonth) return;
    state.moonDay = sky.dayOfMonth;
    state.moonPhaseCanvas = buildMoonPhaseCanvas(state.assets.moon, sky.dayOfMonth);
  }

  function drawCelestial(context, width, height, center, sky, kind) {
    const uv = kind === 'sun' ? sky.sun : sky.moon;
    const image = kind === 'sun' ? state.assets.sun : state.moonPhaseCanvas;
    if (!image) return;
    const projected = projectUv(uv, center, width, height);
    if (!projected.visible) return;
    const zoom = center.zoom || 1;
    const baseSize = Math.min(width, height) * (kind === 'sun' ? 0.19 : 0.17) * zoom;
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const drawWidth = baseSize * (imageWidth / Math.max(1, imageHeight));
    const drawHeight = baseSize;
    const glowRadius = baseSize * (kind === 'sun' ? 2.8 : 3.0);
    const gradient = context.createRadialGradient(projected.x, projected.y, 0, projected.x, projected.y, glowRadius);
    const glowRgb = kind === 'sun' ? '255,216,137' : '169,201,255';
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
    const gradient = context.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.12, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.72, 'rgba(0,0,0,.08)');
    gradient.addColorStop(1, 'rgba(0,0,0,.34)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  function ensureDom() {
    const root = document.getElementById('hobunjiLoadScreen');
    if (!root) return false;
    if (state.root !== root || !state.canvas?.isConnected) {
      state.root = root;
      const canvas = document.createElement('canvas');
      canvas.id = 'hlsSkyBackdrop';
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '0', pointerEvents: 'none' });
      root.insertBefore(canvas, root.firstChild);
      state.canvas = canvas;
      state.context = canvas.getContext('2d', { alpha: false });
      const debug = document.createElement('pre');
      debug.id = 'hlsSkyDebug';
      Object.assign(debug.style, { display: 'none', position: 'absolute', left: 'max(4vw,24px)', bottom: 'max(9vh,58px)', maxWidth: 'min(76vw,420px)', margin: '0', padding: '8px 10px', border: '1px solid rgba(255,255,255,.28)', borderRadius: '7px', background: 'rgba(0,0,0,.78)', color: '#dcecff', font: '11px/1.35 monospace', whiteSpace: 'pre-wrap', pointerEvents: 'none', zIndex: '2' });
      root.appendChild(debug);
      state.debug = debug;
    }
    return true;
  }

  function updateDebug(frame) {
    if (!state.debug || !state.root) return;
    const runtimeDebug = state.root.querySelector('#hlsDebug');
    const visible = !!runtimeDebug?.classList?.contains('visible');
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
    const runtimeVisible = state.root.classList.contains('visible');
    if (!runtimeVisible) {
      updateDebug(state.lastFrame);
      return;
    }
    const dimensions = resizeCanvas(state.canvas);
    const sky = currentSkyState();
    const settings = currentSettings();
    const focus = sky.focusKind === 'moon' ? sky.moon : sky.sun;
    const center = viewCenterForFocus(focus, settings, dimensions.width, dimensions.height);
    ensureMoonPhase(sky);
    state.context.clearRect(0, 0, dimensions.width, dimensions.height);
    drawGradient(state.context, dimensions.width, dimensions.height, center, sky);
    drawStars(state.context, dimensions.width, dimensions.height, center, sky);
    drawCelestial(state.context, dimensions.width, dimensions.height, center, sky, 'sun');
    drawCelestial(state.context, dimensions.width, dimensions.height, center, sky, 'moon');
    drawClouds(state.context, dimensions.width, dimensions.height, center, sky, now);
    drawVignette(state.context, dimensions.width, dimensions.height);
    const frame = { ...sky, focus, focusKind: sky.focusKind, center };
    state.lastFrame = frame;
    updateDebug(frame);
  }

  function tick(now) {
    drawFrame(now);
    state.raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(tick);
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
