// Lightweight real-time title sky.
// Maps the current Eastern civil date into Khymeryya's 336-day Southern-Hemisphere calendar
// while preserving the real wall-clock time of day. Rendering is intentionally Canvas2D:
// no second WebGL context, no Three.js scene, and no per-frame animation loop.
(() => {
  'use strict';

  if (window.HobunjiTitleRealtimeSky?.installed) return;

  const TIME_ZONE = 'America/New_York'; // Used by title-screen real-time calendar mapping and debug output.
  const CANVAS_ID = 'hobunjiTitleSky'; // Used by title-screen-runtime.js CSS and teardown.
  const CLOUD_LAYER_ID = 'hobunjiTitleCloudLayer'; // Hosts compositor-driven cloud sprites so synchronous loading work cannot stall their transforms.
  const ASSET_BASE = 'assets/sky_sprites/'; // Reuses the authored gameplay sky sprites.
  const CLOUD_NAMES = Object.freeze(['cloud1.png','cloud2.png','cloud3.png','cloud4.png','cloud5.png','cloud6.png','cloud7.png','cloud8.png']);
  const MONTH_NAMES = Object.freeze([
    'Firstrise', 'Secondrise', 'Thirdrise',
    'Waxingheat', 'Highheat', 'Waningheat',
    'Firstfall', 'Secondfall', 'Thirdfall',
    'Shallowfrost', 'Deepfrost', 'Pouringfrost',
  ]);
  const DAYS_PER_MONTH = 28; // Used to map each three-month season into 84 fictional civil days.
  const DAYS_PER_SEASON = DAYS_PER_MONTH * 3; // Used by real-date -> Khymeryyan-date scaling.
  const DRAW_INTERVAL_MS = 250; // Used by the intentionally low-frequency decorative title animation.
  const CALENDAR_REFRESH_MS = 30000; // Used to avoid recomputing Intl/date mapping on every canvas redraw.
  const MAX_BACKING_PIXELS = 900000; // Used to cap title-canvas fill rate on large/high-DPI displays.
  const MAX_BACKING_EDGE = 1280; // Used to keep the decorative background below gameplay-resolution cost.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }); // Used by wallClockParts() to avoid dependence on the browser's host timezone.

  let canvas = null; // Used as the lightweight title-sky base drawing surface.
  let ctx = null; // Used by draw() for gradient/stars/celestial rendering.
  let cloudLayer = null; // Used as the compositor-owned DOM layer for uninterrupted cloud drift during synchronous loading work.
  let cloudNodes = []; // Used to update cloud opacity and rebuild the responsive compositor layout on resize.
  let timer = 0; // Used to own the 4 FPS base-sky redraw interval.
  let resizePending = true; // Used to rebuild cached backing-size-dependent layers only when necessary.
  let starsCanvas = null; // Used as a cached static star field instead of a per-pixel shader.
  let assets = { sun:null, moon:null, clouds:[] }; // Used by draw() after asynchronous sprite loading.
  let assetsReady = false; // Used by debug state and draw() to distinguish fallback-only rendering.
  let loadError = null; // Used by mobile-friendly debug output when a sprite fails to load.
  let moonPhaseCanvas = null; // Used to cache the current lunar mask instead of regenerating it per redraw.
  let moonPhaseDay = -1; // Used to invalidate moonPhaseCanvas only when the mapped civil day changes.
  let mappedSnapshot = null; // Used by draw() between slow calendar refreshes.
  let mappedSnapshotAt = 0; // Used to throttle Intl/date mapping work.
  let drawCount = 0; // Used by debug output to confirm the bounded redraw cadence.
  let lastDrawAt = 0; // Used by debug output to expose whether the canvas is still animating.
  let reducedMotion = false; // Used to render a static sky for users requesting reduced motion.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / Math.max(0.000001, b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function wallClockParts(date = new Date()) {
    const parts = {}; // Used to collect named fields from Intl.formatToParts().
    for (const part of formatter.formatToParts(date)) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
      millisecond: date.getMilliseconds(),
    };
  }

  function mappedSeason(parts) {
    const year = parts.year; // Used to anchor the surrounding meteorological season boundaries.
    const month = parts.month; // Used to select the Southern-Hemisphere season.
    if (month >= 9 && month <= 11) {
      return { name:'Spring', monthBase:0, start:Date.UTC(year,8,1), end:Date.UTC(year,11,1) };
    }
    if (month === 12 || month <= 2) {
      const startYear = month === 12 ? year : year - 1; // Used to keep summer continuous across New Year.
      return { name:'Summer', monthBase:3, start:Date.UTC(startYear,11,1), end:Date.UTC(startYear + 1,2,1) };
    }
    if (month >= 3 && month <= 5) {
      return { name:'Fall', monthBase:6, start:Date.UTC(year,2,1), end:Date.UTC(year,5,1) };
    }
    return { name:'Winter', monthBase:9, start:Date.UTC(year,5,1), end:Date.UTC(year,8,1) };
  }

  function mapRealtimeToKhymeryya(date = new Date()) {
    const eastern = wallClockParts(date); // Used as the real-world civil clock being emulated.
    const season = mappedSeason(eastern); // Used to map the real date into the equivalent fictional season.
    const localDateMs = Date.UTC(eastern.year, eastern.month - 1, eastern.day); // Used to scale only the date; time-of-day stays real.
    const seasonProgress = clamp((localDateMs - season.start) / Math.max(1, season.end - season.start), 0, 0.999999999999);
    const fictionalDayIndex = Math.floor(seasonProgress * DAYS_PER_SEASON); // Used to select one of 84 fictional days in the season.
    const monthInSeason = Math.floor(fictionalDayIndex / DAYS_PER_MONTH); // Used to select the season's first/second/third month.
    const monthIndex = season.monthBase + monthInSeason; // Used by title/debug output as the canonical 0..11 month index.
    const dayOfMonth = fictionalDayIndex % DAYS_PER_MONTH + 1; // Used as the 1..28 lunar/civil day.
    const hour = eastern.hour + eastern.minute / 60 + eastern.second / 3600 + eastern.millisecond / 3600000; // Used directly by sky lighting/celestial placement.
    return {
      timeZone: TIME_ZONE,
      eastern,
      season: season.name,
      seasonProgress,
      monthIndex,
      monthName: MONTH_NAMES[monthIndex],
      dayOfMonth,
      lunarDay: dayOfMonth,
      hour,
    };
  }

  function nightFactor(hour) {
    const h = hour < 12 ? hour + 24 : hour; // Used to treat dusk->midnight->dawn as one continuous interval.
    if (h < 18) return 0;
    if (h < 20) return smoothstep(18, 20, h);
    if (h < 29) return 1;
    if (h < 31) return 1 - smoothstep(29, 31, h);
    return 0;
  }

  function lightingRgb(hour) {
    const h = hour < 6 ? hour + 24 : hour; // Used to interpolate continuously through midnight toward dawn.
    const stops = [
      [6,40,30,80], [6.5,220,100,40], [7.5,240,160,60],
      [9,255,230,180], [12,255,245,210], [15,255,225,160],
      [17.5,255,160,60], [18.5,220,90,30], [19.5,130,50,80],
      [20.5,30,30,80], [22,10,10,40], [24,6,9,25],
      [26,5,8,23], [28,8,10,30], [29,18,16,48], [30,40,30,80],
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (h < a[0] || h > b[0]) continue;
      const t = (h - a[0]) / Math.max(0.000001, b[0] - a[0]); // Used to blend between gameplay-compatible lighting stops.
      return { r:lerp(a[1],b[1],t), g:lerp(a[2],b[2],t), b:lerp(a[3],b[3],t) };
    }
    return { r:10, g:10, b:40 };
  }

  function mixRgb(a, b, amount) {
    return {
      r: Math.round(lerp(a.r, b.r, amount)),
      g: Math.round(lerp(a.g, b.g, amount)),
      b: Math.round(lerp(a.b, b.b, amount)),
    };
  }

  function skyPalette(hour) {
    const base = lightingRgb(hour); // Used to seed the same broad day/night colors as the gameplay skydome.
    const night = nightFactor(hour); // Used to darken the palette and reveal stars.
    const nightTop = { r:5, g:8, b:23 };
    const nightMid = { r:9, g:14, b:38 };
    const nightBottom = { r:15, g:18, b:45 };
    const dayTop = mixRgb(base, { r:49, g:93, b:150 }, 0.52);
    const dayMid = mixRgb(base, { r:125, g:169, b:202 }, 0.62);
    const dayBottom = mixRgb(base, { r:195, g:151, b:116 }, 0.34);
    return {
      top: mixRgb(dayTop, nightTop, night),
      mid: mixRgb(dayMid, nightMid, night),
      bottom: mixRgb(dayBottom, nightBottom, night),
      night,
    };
  }

  function celestialOpacity(kind, hour) {
    if (kind === 'sun') {
      const h = hour < 6 ? hour + 24 : hour; // Used to keep sunrise/sunset opacity continuous.
      return clamp(smoothstep(5.7, 6.5, h) * (1 - smoothstep(18.5, 20, h)), 0, 1);
    }
    const h = hour < 12 ? hour + 24 : hour; // Used to keep moonrise/moonset opacity continuous.
    return clamp(smoothstep(17.2, 19, h) * (1 - smoothstep(29, 30.7, h)), 0, 1);
  }

  function celestialScreenPosition(kind, hour, width, height) {
    const isSun = kind === 'sun';
    const h = hour < (isSun ? 6 : 12) ? hour + 24 : hour; // Used to unwrap each celestial arc.
    const start = isSun ? 6 : 18;
    const duration = isSun ? 14 : 12;
    const t = clamp((h - start) / duration, 0, 1); // Used to traverse east->overhead->west.
    const altitude = Math.max(0, Math.sin(Math.PI * t)); // Used to lift the body toward the top of the title sky.
    return {
      x: lerp(width * 0.88, width * 0.12, t),
      y: lerp(height * 0.72, height * 0.16, altitude),
    };
  }

  function lunarIllumination(day) {
    const progress = (((day % 28) + 28) % 28) / 28; // Used to keep the 28-day phase cycle stable.
    return (1 - Math.cos(progress * Math.PI * 2)) * 0.5;
  }

  function rgba(rgb, alpha) {
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
  }

  function fitCanvas() {
    if (!canvas || !ctx) return;
    const cssWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1); // Used to size the CSS-fitted title sky.
    const cssHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1); // Used with cssWidth for backing-buffer budget.
    let scale = Math.min(1, MAX_BACKING_EDGE / Math.max(cssWidth, cssHeight));
    scale = Math.min(scale, Math.sqrt(MAX_BACKING_PIXELS / Math.max(1, cssWidth * cssHeight)));
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round(cssHeight * scale));
    if (canvas.width === width && canvas.height === height && !resizePending) return;
    canvas.width = width;
    canvas.height = height;
    resizePending = false;
    starsCanvas = buildStars(width, height);
  }

  function seededRandom(seed) {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; // Used only for deterministic decorative star/cloud placement.
    return x - Math.floor(x);
  }

  function buildStars(width, height) {
    const layer = document.createElement('canvas'); // Used to cache the static star field at the current backing size.
    layer.width = width;
    layer.height = height;
    const starCtx = layer.getContext('2d');
    if (!starCtx) return null;
    const count = Math.max(40, Math.round(width * height / 9000)); // Used to keep density roughly stable across title sizes.
    for (let i = 0; i < count; i++) {
      const x = seededRandom(i * 3 + 1) * width;
      const y = seededRandom(i * 3 + 2) * height * 0.78;
      const radius = 0.45 + seededRandom(i * 3 + 3) * 1.15;
      const alpha = 0.28 + seededRandom(i * 7 + 4) * 0.72;
      starCtx.fillStyle = 'rgba(255,250,236,' + alpha.toFixed(3) + ')';
      starCtx.beginPath();
      starCtx.arc(x, y, radius, 0, Math.PI * 2);
      starCtx.fill();
    }
    return layer;
  }

  function loadImage(path) {
    return new Promise((resolve, reject) => {
      const image = new Image(); // Used to load one authored sky sprite without involving WebGL texture upload.
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('failed to load ' + path));
      image.src = path;
    });
  }

  function buildMoonPhase(image, day) {
    const width = Math.max(1, image.naturalWidth || image.width || 1);
    const height = Math.max(1, image.naturalHeight || image.height || 1);
    const phaseCanvas = document.createElement('canvas'); // Used to cache one phase-masked moon sprite for the current mapped day.
    phaseCanvas.width = width;
    phaseCanvas.height = height;
    const phaseCtx = phaseCanvas.getContext('2d');
    if (!phaseCtx) return image;
    phaseCtx.clearRect(0, 0, width, height);
    phaseCtx.drawImage(image, 0, 0, width, height);
    const illum = lunarIllumination(day);
    const progress = (((day % 28) + 28) % 28) / 28;
    const waxing = progress <= 0.5;
    phaseCtx.save();
    phaseCtx.globalCompositeOperation = 'source-atop';
    phaseCtx.fillStyle = 'rgba(0,0,8,' + (0.22 + (1 - illum) * 0.72).toFixed(3) + ')';
    const shadowWidth = width * (1 - illum);
    if (shadowWidth > 0.5) {
      const shadowX = waxing ? 0 : width - shadowWidth;
      phaseCtx.fillRect(shadowX, 0, shadowWidth, height);
    }
    phaseCtx.restore();
    return phaseCanvas;
  }

  function ensureMoonPhase(day) {
    if (!assets.moon || moonPhaseDay === day) return;
    moonPhaseCanvas = buildMoonPhase(assets.moon, day);
    moonPhaseDay = day;
  }

  function cloudLayout(index, viewportWidth) {
    const band = index % 3; // Used to give the compositor three distinct apparent cloud depths.
    const phase = seededRandom(index * 11 + 2); // Used as a negative animation delay so clouds begin distributed across the sky instead of entering in a line.
    const topVh = 8 + seededRandom(index * 11 + 3) * 52;
    const speed = [2.1, 1.35, 0.8][band];
    const widthVw = 8 + seededRandom(index * 11 + 4) * 12;
    const travelPx = Math.max(1, viewportWidth) * 1.4;
    const durationSeconds = Math.max(1, travelPx / speed);
    return {
      band,
      phase,
      topVh,
      widthVw,
      alpha: [0.28, 0.24, 0.20][band],
      durationSeconds,
    };
  }

  function cloudCount() {
    return Math.min(18, Math.max(10, Math.round(Math.max(1, window.innerWidth || 1) / 80)));
  }

  function cloudOpacity(index, snapshot) {
    const daylight = 1 - nightFactor(snapshot.hour);
    return cloudLayout(index, window.innerWidth || 1).alpha * lerp(0.72, 1, daylight);
  }

  function updateCloudOpacity(snapshot) {
    for (let i = 0; i < cloudNodes.length; i++) {
      cloudNodes[i].style.opacity = cloudOpacity(i, snapshot).toFixed(3);
    }
  }

  function rebuildCloudLayer(snapshot = refreshSnapshot(false)) {
    if (!assets.clouds.length || !document.documentElement) return;
    if (!cloudLayer) {
      cloudLayer = document.getElementById(CLOUD_LAYER_ID) || document.createElement('div');
      cloudLayer.id = CLOUD_LAYER_ID;
      cloudLayer.setAttribute('aria-hidden', 'true');
      if (!cloudLayer.parentNode) document.documentElement.appendChild(cloudLayer);
    }

    cloudLayer.textContent = '';
    cloudNodes = [];
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const count = cloudCount();
    for (let i = 0; i < count; i++) {
      const source = assets.clouds[i % assets.clouds.length];
      const placement = cloudLayout(i, viewportWidth);
      const image = document.createElement('img'); // Uses CSS transform animation so the browser compositor can keep drifting clouds while loading JS blocks the main thread.
      image.alt = '';
      image.draggable = false;
      image.src = source.currentSrc || source.src;
      image.style.top = placement.topVh.toFixed(3) + 'vh';
      image.style.width = placement.widthVw.toFixed(3) + 'vw';
      image.style.opacity = cloudOpacity(i, snapshot).toFixed(3);
      image.style.animationDuration = placement.durationSeconds.toFixed(3) + 's';
      image.style.animationDelay = (-placement.phase * placement.durationSeconds).toFixed(3) + 's';
      image.style.animationPlayState = reducedMotion ? 'paused' : 'running';
      cloudLayer.appendChild(image);
      cloudNodes.push(image);
    }
  }

  function drawGradient(snapshot, width, height) {
    const palette = skyPalette(snapshot.hour); // Used to color the title background from the mapped real-world clock.
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, rgba(palette.top, 1));
    gradient.addColorStop(0.56, rgba(palette.mid, 1));
    gradient.addColorStop(1, rgba(palette.bottom, 1));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    if (starsCanvas && palette.night > 0.02) {
      ctx.save();
      ctx.globalAlpha = clamp(palette.night * 0.78, 0, 0.78);
      ctx.drawImage(starsCanvas, 0, 0);
      ctx.restore();
    }
  }

  function drawCelestial(kind, image, snapshot, width, height) {
    if (!image) return;
    const opacity = celestialOpacity(kind, snapshot.hour);
    if (opacity <= 0.01) return;
    const pos = celestialScreenPosition(kind, snapshot.hour, width, height);
    const source = kind === 'moon' ? (moonPhaseCanvas || image) : image;
    const size = Math.max(28, Math.min(width, height) * (kind === 'sun' ? 0.12 : 0.10)); // Used to keep celestial bodies readable without giant WebGL glow quads.
    ctx.save();
    ctx.globalAlpha = opacity;
    const glow = ctx.createRadialGradient(pos.x, pos.y, size * 0.08, pos.x, pos.y, size * 1.2);
    glow.addColorStop(0, kind === 'sun' ? 'rgba(255,225,150,0.38)' : 'rgba(175,205,255,0.24)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(source, pos.x - size * 0.5, pos.y - size * 0.5, size, size);
    ctx.restore();
  }

  function refreshSnapshot(force = false) {
    const now = Date.now();
    if (!force && mappedSnapshot && now - mappedSnapshotAt < CALENDAR_REFRESH_MS) return mappedSnapshot;
    mappedSnapshot = mapRealtimeToKhymeryya(new Date(now));
    mappedSnapshotAt = now;
    ensureMoonPhase(mappedSnapshot.lunarDay);
    return mappedSnapshot;
  }

  function draw(forceCalendar = false) {
    if (!canvas || !ctx || document.hidden) return;
    fitCanvas();
    const snapshot = refreshSnapshot(forceCalendar);
    const width = canvas.width;
    const height = canvas.height;
    drawGradient(snapshot, width, height);
    drawCelestial('sun', assets.sun, snapshot, width, height);
    drawCelestial('moon', assets.moon, snapshot, width, height);
    updateCloudOpacity(snapshot);
    drawCount += 1;
    lastDrawAt = performance.now();
  }

  async function loadAssets() {
    try {
      const [sun, moon, ...clouds] = await Promise.all([
        loadImage(ASSET_BASE + 'sun.png'),
        loadImage(ASSET_BASE + 'moon.png'),
        ...CLOUD_NAMES.map(name => loadImage(ASSET_BASE + name)),
      ]);
      assets = { sun, moon, clouds };
      assetsReady = true;
      const snapshot = refreshSnapshot(true);
      ensureMoonPhase(snapshot.lunarDay);
      rebuildCloudLayer(snapshot);
      draw(true);
    } catch (error) {
      loadError = String(error?.message || error);
      draw(true);
    }
  }

  function onResize() {
    resizePending = true;
    rebuildCloudLayer(refreshSnapshot(false));
    draw(false);
  }

  function start() {
    if (canvas) return canvas;
    canvas = document.getElementById(CANVAS_ID) || document.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.pointerEvents = 'none';
    if (!canvas.parentNode) document.documentElement.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha:false, desynchronized:true }) || canvas.getContext('2d');
    if (!ctx) {
      loadError = 'Canvas2D unavailable';
      return canvas;
    }
    reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    resizePending = true;
    window.addEventListener('resize', onResize, { passive:true });
    draw(true);
    loadAssets();
    if (!reducedMotion) timer = window.setInterval(() => draw(false), DRAW_INTERVAL_MS);
    return canvas;
  }

  function destroy() {
    if (timer) window.clearInterval(timer);
    timer = 0;
    window.removeEventListener('resize', onResize);
    canvas?.remove?.();
    cloudLayer?.remove?.();
    canvas = null;
    ctx = null;
    cloudLayer = null;
    cloudNodes = [];
    starsCanvas = null;
    moonPhaseCanvas = null;
  }

  function getDebug() {
    return {
      installed:true,
      active:Boolean(canvas),
      renderer:'canvas2d+css-compositor',
      drawIntervalMs:DRAW_INTERVAL_MS,
      cloudMotion:'compositor-transform',
      cloudLayerActive:Boolean(cloudLayer),
      cloudCount:cloudNodes.length,
      calendarRefreshMs:CALENDAR_REFRESH_MS,
      maxBackingPixels:MAX_BACKING_PIXELS,
      backingSize:canvas ? { width:canvas.width, height:canvas.height } : null,
      assetsReady,
      loadError,
      reducedMotion,
      drawCount,
      lastDrawAt,
      mappedCalendar:mappedSnapshot,
    };
  }

  window.HobunjiTitleRealtimeSky = Object.freeze({
    installed:true,
    start,
    destroy,
    draw:() => draw(true),
    getRealtimeCalendar:mapRealtimeToKhymeryya,
    getDebug,
  });
})();
