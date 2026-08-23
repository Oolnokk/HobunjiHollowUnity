(() => {
  'use strict';
  const THREE = window.THREE;

  // Weather rolling (daily forecast + rain-window scheduling), outdoor
  // day/night + weather lighting, lightning, and water/ripple FX.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }
  let debugWeatherOverride = null;
  let _lastAtmosphereDebugKey = '';
  let _lastMaskProjectionWarningMs = 0; // Used by _safeLightScreenRadius to rate-limit mobile debug output.
  const thunderDebug = { triggers: 0, lastTriggerMs: 0, lastPitch: 1 };

  const STORM_NAMES = [
    'Squall Ashgrave', 'Tempest Hollowbell', 'Gale Duskmire', 'Storm Fenwrack',
    'Tempest Rimewind', 'Squall Cindermoor', 'Gale Thornhollow', 'Storm Marrowdeep',
    'Tempest Sootveil', 'Gale Bramblegust', 'Squall Wraithrain', 'Storm Emberfall',
  ];
  let lastStormDay = 0;

  function checkForMajorStorm() {
    const calendar = deps.calendar;
    if (calendar.weather !== 'storm') return;
    if (calendar.day === lastStormDay) return;
    const roll = deps.seededRandom(calendar.day * 6173 + 41);
    if (roll > 0.30) return;
    lastStormDay = calendar.day;

    const grid = deps.getGrid();
    let trenchesHit = 0, raisedHit = 0;
    for (let row = 0; row < deps.ROWS; row++) {
      for (let col = 0; col < deps.COLS; col++) {
        const tile = grid[row][col];
        const hitRoll = deps.seededRandom(col * 17 + row * 31 + calendar.day * 7);
        if (tile.type === deps.TileType.TRENCH && hitRoll < 0.22) {
          tile.type = deps.TileType.GRASS;
          tile.water = 0.6;
          tile.flow = false;
          trenchesHit++;
        } else if (tile.type === deps.TileType.RAISED && hitRoll < 0.18) {
          tile.type = deps.TileType.TILLED;
          tile.water = deps.clamp(tile.water + 0.3, 0, 1);
          raisedHit++;
        }
      }
    }

    const name = STORM_NAMES[calendar.day % STORM_NAMES.length];
    const dmgText = [
      trenchesHit > 0 ? `${trenchesHit} trench${trenchesHit > 1 ? 'es' : ''} collapsed` : null,
      raisedHit > 0 ? `${raisedHit} raised bed${raisedHit > 1 ? 's' : ''} flattened` : null,
    ].filter(Boolean).join(', ');
    deps.showToast(`⚡ ${name}! ${dmgText || 'No structural damage.'}`, false);
    deps.debugLog(`major storm: ${name} — ${dmgText || 'no damage'}`);
  }

  // ── Lantern/furniture light masks ────────────────────────────────
  const LANTERN_CLARITY_TILES = 1.3;
  const LANTERN_SHINE_TILES = 5.0;
  const _camRightVec = new THREE.Vector3();

  function _warnBadMaskProjection(message) {
    const now = performance.now();
    if (now - _lastMaskProjectionWarningMs < 3000) return;
    _lastMaskProjectionWarningMs = now;
    deps.debugLog?.(`lighting mask guard: ${message}`);
  }

  // Seated/close cameras can put one of the projection samples extremely near
  // the camera plane. That can yield a gigantic screen radius; Canvas2D then
  // attempts an enormous radial gradient/arc and can stall the main thread.
  // Clamp to a screen-relative maximum and reject non-finite projections.
  function _safeLightScreenRadius(tx, tz, worldY, tiles) {
    _camRightVec.setFromMatrixColumn(deps.camera.matrixWorld, 0);
    const c = deps.worldToOverlay(tx, worldY, tz);
    const e = deps.worldToOverlay(
      tx + _camRightVec.x * tiles,
      worldY + _camRightVec.y * tiles,
      tz + _camRightVec.z * tiles,
    );
    const coords = [c?.x, c?.y, e?.x, e?.y];
    if (!coords.every(Number.isFinite)) {
      _warnBadMaskProjection('skipped non-finite camera projection');
      return 0;
    }

    const rawRadius = Math.hypot(e.x - c.x, e.y - c.y);
    if (!Number.isFinite(rawRadius) || rawRadius <= 0) {
      _warnBadMaskProjection('skipped invalid projected radius');
      return 0;
    }

    const rect = deps.getThreeRect?.();
    const width = Number(rect?.width) || 0;
    const height = Number(rect?.height) || 0;
    const screenDiagonal = Math.hypot(width, height);
    const maxRadius = Math.max(128, screenDiagonal * 1.35);
    if (rawRadius > maxRadius) {
      _warnBadMaskProjection(`clamped ${Math.round(rawRadius)}px radius to ${Math.round(maxRadius)}px`);
      return maxRadius;
    }
    return rawRadius;
  }

  function drawLanternMasks() {
    const lctx = deps.lctx;
    const carriers = [{
      x: deps.player.x / deps.TILE,
      y: deps.getPlayerWorldY() + 0.5,
      z: deps.player.y / deps.TILE,
    }];
    const currentArea = deps.getCurrentArea();
    for (const w of deps.npcWalkers) {
      if (w.area === currentArea && w.rec?.tags?.includes('watch')) {
        carriers.push({ x: w.root.position.x, y: w.root.position.y + 0.5, z: w.root.position.z });
      }
    }

    lctx.globalCompositeOperation = 'destination-out';
    for (const c of carriers) {
      const center = deps.worldToOverlay(c.x, c.y, c.z);
      if (!center?.visible || !Number.isFinite(center.x) || !Number.isFinite(center.y)) continue;
      const shineR = _safeLightScreenRadius(c.x, c.z, c.y, LANTERN_SHINE_TILES);
      if (!(shineR > 0)) continue;
      const clarityFrac = Math.min(0.9, LANTERN_CLARITY_TILES / LANTERN_SHINE_TILES);
      const grad = lctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0, 'rgba(0,0,0,0.92)');
      grad.addColorStop(clarityFrac, 'rgba(0,0,0,0.80)');
      grad.addColorStop(Math.min(1, clarityFrac + 0.18), 'rgba(0,0,0,0.28)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      lctx.fill();
    }
    lctx.globalCompositeOperation = 'source-over';
  }

  function drawFurnitureLightMasks() {
    const lctx = deps.lctx;
    const visibleLights = [];
    for (const light of deps.getFurnitureLightSources()) {
      const center = deps.worldToOverlay(light.x, light.y, light.z);
      if (!center?.visible || !Number.isFinite(center.x) || !Number.isFinite(center.y)) continue;
      const shineR = _safeLightScreenRadius(light.x, light.z, light.y, light.distance);
      if (!(shineR > 0)) continue;
      visibleLights.push({ light, center, shineR });
    }

    lctx.globalCompositeOperation = 'destination-out';
    for (const { light, center, shineR } of visibleLights) {
      const clarityFrac = Math.min(0.55, Math.max(0.18, 1.15 / light.distance));
      const strength = Math.min(0.94, 0.58 + light.intensity * 0.22);
      const grad = lctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0, `rgba(0,0,0,${strength})`);
      grad.addColorStop(clarityFrac, `rgba(0,0,0,${strength * 0.78})`);
      grad.addColorStop(Math.min(1, clarityFrac + 0.3), `rgba(0,0,0,${strength * 0.22})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      lctx.fill();
    }

    lctx.globalCompositeOperation = 'source-over';
    for (const { light, center, shineR } of visibleLights) {
      const glowR = shineR * 0.62;
      const glowAlpha = Math.min(0.18, 0.055 + light.intensity * 0.055);
      const { r, g, b } = light.color;
      const glow = lctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, glowR);
      glow.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
      glow.addColorStop(0.4, `rgba(${r},${g},${b},${glowAlpha * 0.45})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      lctx.fillStyle = glow;
      lctx.beginPath();
      lctx.arc(center.x, center.y, glowR, 0, Math.PI * 2);
      lctx.fill();
    }
  }

  // ── Time/weather sky ─────────────────────────────────────────────
  const SKY_STOPS = [
    [6.0, 24, 35, 65],
    [6.5, 196, 98, 88],
    [7.5, 126, 171, 207],
    [9.0, 96, 165, 218],
    [12.0, 86, 176, 232],
    [15.0, 105, 174, 220],
    [17.5, 210, 154, 101],
    [18.5, 215, 101, 88],
    [19.5, 101, 82, 132],
    [20.5, 40, 54, 88],
    [22.0, 15, 25, 47],
  ];

  function _mixChannel(value, target, amount) {
    return value + (target - value) * amount;
  }

  function _computeRawSkyState() {
    const calendar = deps.calendar;
    const hour = window.CalendarSystem.getHour();
    let r = SKY_STOPS[0][1], g = SKY_STOPS[0][2], b = SKY_STOPS[0][3];
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
      const [h0, r0, g0, b0] = SKY_STOPS[i];
      const [h1, r1, g1, b1] = SKY_STOPS[i + 1];
      if (hour >= h0 && hour <= h1) {
        const t = (hour - h0) / (h1 - h0);
        r = r0 + (r1 - r0) * t;
        g = g0 + (g1 - g0) * t;
        b = b0 + (b1 - b0) * t;
        break;
      }
    }
    if (hour >= SKY_STOPS[SKY_STOPS.length - 1][0]) {
      [, r, g, b] = SKY_STOPS[SKY_STOPS.length - 1];
    }

    const activeRain = calendar.isRaining;
    const activeStorm = activeRain && calendar.rainStrength >= 3;
    const forecast = String(calendar.weather || 'clear').toLowerCase();
    let kind = 'clear';
    let weatherMix = 0;
    let wr = 112, wg = 128, wb = 139;
    if (activeStorm) {
      kind = 'storm'; weatherMix = 0.72; wr = 48; wg = 65; wb = 84;
    } else if (activeRain) {
      kind = 'rain'; weatherMix = 0.48; wr = 89; wg = 108; wb = 124;
    } else if (forecast === 'storm') {
      kind = 'storm-clouds'; weatherMix = 0.22; wr = 77; wg = 94; wb = 110;
    } else if (forecast === 'rain') {
      kind = 'clouds'; weatherMix = 0.10;
    }
    r = _mixChannel(r, wr, weatherMix);
    g = _mixChannel(g, wg, weatherMix);
    b = _mixChannel(b, wb, weatherMix);

    const phase = hour < 7.4 ? 'dawn' : hour < 17 ? 'day' : hour < 19.6 ? 'sunset' : 'night';
    const alpha = activeStorm ? 0.58 : activeRain ? 0.50 : forecast === 'storm' ? 0.46 : 0.42;
    return { r, g, b, a: alpha, kind, phase, hour };
  }

  let _lastLightingOverlayTime = 0;
  function drawLightingOverlay() {
    const lctx = deps.lctx;
    const now = performance.now();
    const lightningAlpha = deps.getLightningAlpha();
    const sceneTransAlpha = deps.getSceneTransAlpha();
    if (now - _lastLightingOverlayTime < 100 && lightningAlpha <= 0 && sceneTransAlpha <= 0) return;
    _lastLightingOverlayTime = now;

    const rect = deps.getThreeRect();
    const W = Number(rect?.width) || 0;
    const H = Number(rect?.height) || 0;
    if (!(W > 0 && H > 0)) return;
    lctx.clearRect(0, 0, W, H);

    const currentArea = deps.getCurrentArea();
    if (currentArea === 'interior' || deps._isBuildingArea(currentArea)) {
      lctx.fillStyle = 'rgba(32,20,10,0.28)';
      lctx.fillRect(0, 0, W, H);
      drawFurnitureLightMasks();
      if (sceneTransAlpha > 0) {
        lctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
        lctx.fillRect(0, 0, W, H);
      }
      return;
    }

    const { r, g, b, a } = getLightingState();
    const sky = getSkyState();

    lctx.globalCompositeOperation = a < 0.09 ? 'screen' : 'multiply';
    lctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
    lctx.fillRect(0, 0, W, H);
    lctx.globalCompositeOperation = 'source-over';

    // This sky layer is deliberately rendered AFTER the Three.js frame, so
    // Fog/FogExp2 can haze world geometry but can never cover the sky itself.
    // Keep a little sky color through the horizon/lower frame instead of
    // fading to zero early (which exposed the static fog-colored background).
    const skyGradient = lctx.createLinearGradient(0, 0, 0, H);
    skyGradient.addColorStop(0, `rgba(${sky.r},${sky.g},${sky.b},${sky.a})`);
    skyGradient.addColorStop(0.48, `rgba(${sky.r},${sky.g},${sky.b},${sky.a * 0.34})`);
    skyGradient.addColorStop(0.72, `rgba(${sky.r},${sky.g},${sky.b},${sky.a * 0.14})`);
    skyGradient.addColorStop(1, `rgba(${sky.r},${sky.g},${sky.b},${sky.a * 0.025})`);
    lctx.fillStyle = skyGradient;
    lctx.fillRect(0, 0, W, H);

    drawLanternMasks();
    drawFurnitureLightMasks();

    if (lightningAlpha > 0) {
      lctx.fillStyle = `rgba(220, 240, 255, ${lightningAlpha * 0.45})`;
      lctx.fillRect(0, 0, W, H);
    }
    if (sceneTransAlpha > 0) {
      lctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
      lctx.fillRect(0, 0, W, H);
    }
  }

  function _computeRawLightingState() {
    const calendar = deps.calendar;
    const hour = window.CalendarSystem.getHour();
    const isRaining = calendar.isRaining;
    const isStorm = isRaining && calendar.rainStrength >= 3;
    const stops = [
      [6.0, 40, 30, 80, 0.55],
      [6.5, 220, 100, 40, 0.38],
      [7.5, 240, 160, 60, 0.22],
      [9.0, 255, 230, 180, 0.08],
      [12.0, 255, 245, 210, 0.04],
      [15.0, 255, 225, 160, 0.10],
      [17.5, 255, 160, 60, 0.28],
      [18.5, 220, 90, 30, 0.42],
      [19.5, 130, 50, 80, 0.52],
      [20.5, 30, 30, 80, 0.62],
      [22.0, 10, 10, 40, 0.72],
    ];

    let r = 10, g = 10, b = 40, a = 0.72;
    for (let i = 0; i < stops.length - 1; i++) {
      const [h0, r0, g0, b0, a0] = stops[i];
      const [h1, r1, g1, b1, a1] = stops[i + 1];
      if (hour >= h0 && hour <= h1) {
        const t = (hour - h0) / (h1 - h0);
        r = r0 + (r1 - r0) * t;
        g = g0 + (g1 - g0) * t;
        b = b0 + (b1 - b0) * t;
        a = a0 + (a1 - a0) * t;
        break;
      }
    }

    if (isStorm) {
      r = r * 0.5 + 30 * 0.5;
      g = g * 0.5 + 45 * 0.5;
      b = b * 0.5 + 70 * 0.5;
      a = Math.min(0.85, a + 0.25);
    } else if (isRaining) {
      r = r * 0.7 + 50 * 0.3;
      g = g * 0.7 + 65 * 0.3;
      b = b * 0.7 + 90 * 0.3;
      a = Math.min(0.78, a + 0.12);
    }
    return { r, g, b, a };
  }

  let _lightR = 10, _lightG = 10, _lightB = 40, _lightA = 0.72;
  let _skyR = 15, _skyG = 25, _skyB = 47, _skyA = 0.42;
  let _skyKind = 'clear', _skyPhase = 'night';
  let _lightingInitialized = false;

  function _advanceSmoothedLighting(dt) {
    const raw = _computeRawLightingState();
    const rawSky = _computeRawSkyState();
    if (!_lightingInitialized) {
      _lightR = raw.r; _lightG = raw.g; _lightB = raw.b; _lightA = raw.a;
      _skyR = rawSky.r; _skyG = rawSky.g; _skyB = rawSky.b; _skyA = rawSky.a;
      _skyKind = rawSky.kind; _skyPhase = rawSky.phase;
      _lightingInitialized = true;
    } else {
      const tc = 1.5;
      const k = 1 - Math.exp(-dt / tc);
      _lightR += (raw.r - _lightR) * k;
      _lightG += (raw.g - _lightG) * k;
      _lightB += (raw.b - _lightB) * k;
      _lightA += (raw.a - _lightA) * k;
      _skyR += (rawSky.r - _skyR) * k;
      _skyG += (rawSky.g - _skyG) * k;
      _skyB += (rawSky.b - _skyB) * k;
      _skyA += (rawSky.a - _skyA) * k;
      _skyKind = rawSky.kind; _skyPhase = rawSky.phase;
    }

    const debugKey = `${rawSky.phase}:${rawSky.kind}`;
    if (debugKey !== _lastAtmosphereDebugKey) {
      _lastAtmosphereDebugKey = debugKey;
      deps.debugLog?.(`atmosphere: ${rawSky.phase} / ${rawSky.kind} sky rgb(${Math.round(rawSky.r)},${Math.round(rawSky.g)},${Math.round(rawSky.b)})`);
    }
  }

  function getLightingState() {
    return { r: Math.round(_lightR), g: Math.round(_lightG), b: Math.round(_lightB), a: _lightA };
  }

  function getSkyState() {
    return {
      r: Math.round(_skyR), g: Math.round(_skyG), b: Math.round(_skyB), a: _skyA,
      kind: _skyKind, phase: _skyPhase,
    };
  }

  function getAtmosphereDebugState() {
    return {
      sky: getSkyState(),
      weather: deps?.calendar?.weather || 'unknown',
      isRaining: Boolean(deps?.calendar?.isRaining),
      rainStrength: Number(deps?.calendar?.rainStrength) || 0,
      thunder: { ...thunderDebug },
    };
  }

  // ── Water/ripple FX ──────────────────────────────────────────────
  const waterParticles = [];
  const MAX_PARTICLES = 120;
  function updateWaterParticles(dt) {
    const flowingTiles = deps.getCurrentArea() === 'town'
      ? deps.getTownFlowingTrenchTiles()
      : deps.getFlowingTrenchTiles();
    for (const { col, row } of flowingTiles) {
      if (waterParticles.length < MAX_PARTICLES && Math.random() < 0.12) {
        const tx = col * deps.TILE + 10 + Math.random() * (deps.TILE - 20);
        const ty = row * deps.TILE + 8 + Math.random() * (deps.TILE - 16);
        waterParticles.push({
          wx: tx, wy: ty,
          vx: (Math.random() - 0.5) * 4,
          vy: 4 + Math.random() * 12,
          alpha: 0.7 + Math.random() * 0.3,
          radius: 1 + Math.random() * 2.5,
          life: 0,
          maxLife: 0.4 + Math.random() * 0.6,
          type: Math.random() < 0.6 ? 'bubble' : 'foam',
        });
      }
    }
    for (let i = waterParticles.length - 1; i >= 0; i--) {
      const p = waterParticles[i];
      p.wx += p.vx * dt;
      p.wy += p.vy * dt;
      p.life += dt;
      p.alpha = (1 - p.life / p.maxLife) * 0.85;
      const pc = Math.floor(p.wx / deps.TILE);
      const pr = Math.floor(p.wy / deps.TILE);
      const aGrid = deps.getActiveGrid();
      const aC = deps.getActiveCols();
      const aR = deps.getActiveRows();
      const onFlow = pc >= 0 && pc < aC && pr >= 0 && pr < aR
        && aGrid[pr][pc].type === deps.TileType.TRENCH && aGrid[pr][pc].flow;
      if (p.life >= p.maxLife || !onFlow) waterParticles.splice(i, 1);
    }
  }

  const ripples = [];
  function updateRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age >= ripples[i].maxAge) ripples.splice(i, 1);
    }
  }

  function spawnRipples() {
    const aGrid = deps.getActiveGrid();
    const aC = deps.getActiveCols();
    const aR = deps.getActiveRows();
    for (let row = 0; row < aR; row++) {
      for (let col = 0; col < aC; col++) {
        const tile = aGrid[row][col];
        const isWet = (tile.type === deps.TileType.PADDY && tile.water >= 0.5)
          || (tile.type !== deps.TileType.TRENCH && tile.water >= 0.7);
        if (!isWet) continue;
        if (Math.random() < 0.22 && ripples.length < 60) {
          const rx = col * deps.TILE + deps.TILE * 0.3 + Math.random() * deps.TILE * 0.4;
          const ry = row * deps.TILE + deps.TILE * 0.3 + Math.random() * deps.TILE * 0.4;
          ripples.push({ x: rx, y: ry, age: 0, maxAge: 1.2 + Math.random() * 0.8 });
        }
      }
    }

    const calendar = deps.calendar;
    if (calendar.isRaining) {
      const rect = deps.threeContainer.getBoundingClientRect();
      const drops = calendar.rainStrength === 3 ? 8 : 3;
      const camX = deps.getCamX(), camY = deps.getCamY();
      for (let i = 0; i < drops; i++) {
        const rx = (camX - rect.width / 2) + Math.random() * rect.width;
        const ry = (camY - rect.height / 2) + Math.random() * rect.height;
        ripples.push({ x: rx, y: ry, age: 0, maxAge: 0.5 + Math.random() * 0.4 });
      }
    }
  }

  // ── Lightning/thunder ────────────────────────────────────────────
  const THUNDER_SFX = Object.freeze({ url: 'assets/audio/sfx/sfx_thunder1.mp3', volume: 0.92 });
  function playThunderSfx() {
    const playOneShot = window.AudioSystem?.playOneShotSfx;
    const pitch = 0.94 + Math.random() * 0.08;
    thunderDebug.triggers += 1;
    thunderDebug.lastTriggerMs = performance.now();
    thunderDebug.lastPitch = pitch;
    if (typeof playOneShot !== 'function') {
      deps.debugLog?.('weather thunder sfx unavailable: AudioSystem.playOneShotSfx missing');
      return false;
    }
    playOneShot(THUNDER_SFX, 1, pitch);
    deps.debugLog?.(`weather thunder sfx triggered #${thunderDebug.triggers} pitch=${pitch.toFixed(2)}`);
    return true;
  }

  const LIGHTNING_AVG_INTERVAL_S = 28;
  let lightningStrikesRemaining = 0;
  let lightningTimer = 6 + Math.random() * 8;
  let lightningDecayRate = 0;
  let lightningGapTimer = 0;
  function updateLightningFlash(dt) {
    const calendar = deps.calendar;
    const stormActive = calendar.isRaining && calendar.rainStrength >= 3;
    if (stormActive && lightningStrikesRemaining <= 0) {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        lightningStrikesRemaining = Math.random() < 0.30 ? 2 : 1;
        deps.setLightningAlpha(0.72);
        lightningDecayRate = 0.72 / (lightningStrikesRemaining > 1 ? 0.09 : 0.52);
        lightningTimer = LIGHTNING_AVG_INTERVAL_S * (0.4 + Math.random() * 1.2);
        playThunderSfx();
      }
    }
    if (lightningStrikesRemaining > 0) {
      const currentLightningAlpha = deps.getLightningAlpha();
      if (currentLightningAlpha > 0) {
        deps.setLightningAlpha(Math.max(0, currentLightningAlpha - lightningDecayRate * dt));
        if (deps.getLightningAlpha() <= 0 && lightningStrikesRemaining > 1) lightningGapTimer = 0.055;
      } else if (lightningGapTimer > 0) {
        lightningGapTimer -= dt;
        if (lightningGapTimer <= 0) {
          lightningStrikesRemaining -= 1;
          if (lightningStrikesRemaining > 0) {
            deps.setLightningAlpha(0.52);
            lightningDecayRate = 0.52 / (lightningStrikesRemaining > 1 ? 0.09 : 0.52);
          }
        }
      } else {
        lightningStrikesRemaining = 0;
      }
    }
  }

  // ── Daily weather ────────────────────────────────────────────────
  function chooseWeatherForDay() {
    const calendar = deps.calendar;
    const season = window.CalendarSystem.currentSeason();
    deps.applySeasonalGrassAppearance();
    const seed = deps.seededRandom(calendar.day * 991 + season.name.length * 37);
    const stormRoll = deps.seededRandom(calendar.day * 373 + 11);
    const hasStorm = stormRoll < season.stormChance;
    const droughtDays = calendar.day - calendar.lastRainDay;
    const hasRain = hasStorm || seed < season.rainChance || droughtDays >= deps.RAIN_PITY_DAYS;
    calendar.weather = hasStorm ? 'storm' : hasRain ? 'rain' : 'clear';
    calendar.nextRainWindows = [];

    if (hasStorm) {
      // A storm-labelled day should never visibly claim "Storm" while the
      // world is dry. The core 11–17 window remains the thunder/lightning
      // storm; the shoulders of the day are ordinary rain.
      calendar.nextRainWindows.push({ start: 6, end: 11, strength: 2 });
      calendar.nextRainWindows.push({ start: 11, end: 17, strength: 3 });
      calendar.nextRainWindows.push({ start: 17, end: 22, strength: 2 });
    } else if (hasRain) {
      const windowHours = Math.round(4 + season.rainChance * 8);
      const start = 8 + Math.floor(deps.seededRandom(calendar.day * 157) * 6);
      calendar.nextRainWindows.push({ start, end: start + windowHours, strength: 2 });
    }
    if (hasRain) calendar.lastRainDay = calendar.day;
    updateRainState();
  }

  function updateRainState() {
    const calendar = deps.calendar;
    if (debugWeatherOverride) {
      calendar.weather = debugWeatherOverride;
      calendar.isRaining = debugWeatherOverride !== 'clear';
      calendar.rainStrength = debugWeatherOverride === 'storm' ? 3 : debugWeatherOverride === 'rain' ? 2 : 0;
      return;
    }

    const hour = window.CalendarSystem.getHour();
    const windows = Array.isArray(calendar.nextRainWindows) ? calendar.nextRainWindows : [];
    const activeWindow = windows.find((window) => hour >= window.start && hour < window.end);
    if (activeWindow) {
      calendar.isRaining = true;
      calendar.rainStrength = activeWindow.strength;
      return;
    }

    // Backward compatibility for saves made before storm days received
    // full-day rain shoulders: keep old saved storm forecasts wet rather
    // than displaying Storm over a dry world until the next day reroll.
    if (calendar.weather === 'storm' && hour >= 6 && hour < 22) {
      calendar.isRaining = true;
      calendar.rainStrength = 2;
      return;
    }

    calendar.isRaining = false;
    calendar.rainStrength = 0;
  }

  function setDebugWeather(mode = null) {
    debugWeatherOverride = ['clear', 'rain', 'storm'].includes(mode) ? mode : null;
    updateRainState();
  }

  function getDebugWeather() {
    return debugWeatherOverride;
  }

  window.WeatherFX = {
    init,
    checkForMajorStorm,
    drawLightingOverlay,
    getLightingState,
    getSkyState,
    getAtmosphereDebugState,
    _advanceSmoothedLighting,
    updateWaterParticles,
    updateRipples,
    spawnRipples,
    updateLightningFlash,
    chooseWeatherForDay,
    updateRainState,
    setDebugWeather,
    getDebugWeather,
    debugLanternShineR: () => _safeLightScreenRadius(
      deps.player.x / deps.TILE,
      deps.player.y / deps.TILE,
      deps.getPlayerWorldY() + 0.5,
      LANTERN_SHINE_TILES,
    ),
  };
})();
