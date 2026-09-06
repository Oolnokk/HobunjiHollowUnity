(() => {
  'use strict';
  const THREE = window.THREE;

  // Weather rolling (daily forecast + rain-window scheduling), the outdoor
  // day/night + weather lighting overlay (sky tint, lantern masks, lightning
  // flash), and the trench-flow water particle / paddy ripple FX. Extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as its sibling systems.
  //
  // lightningAlpha and sceneTransAlpha stay in game.js on purpose — both
  // are read by drawOverlays()/the scene-transition system, code well
  // outside this module's scope — and come in through deps (lightningAlpha
  // as a getter/setter pair, since updateLightningFlash both reads and
  // writes it; sceneTransAlpha as a getter only). _flowingTrenchTiles/
  // _townFlowingTrenchTiles likewise stay behind — reassigned wholesale by
  // the terrain-tick code — threaded as getters. grid/camX/camY are `let`s
  // reassigned elsewhere in game.js too, so they're getters as well, even
  // though a scan found camX/camY are never actually reassigned in
  // practice (rain-ripple placement always centers on the initial farm
  // camera position — likely stale/vestigial pre-existing behavior,
  // preserved as-is rather than "fixed" here).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }
  let debugWeatherOverride = null; // Read by updateRainState while Testing Arena weather buttons are active.

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
    // ~30% of storm days trigger a major event
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
          tile.type = deps.TileType.GRASS; tile.water = 0.6; tile.flow = false;
          trenchesHit++;
        } else if (tile.type === deps.TileType.RAISED && hitRoll < 0.18) {
          tile.type = deps.TileType.TILLED; tile.water = deps.clamp(tile.water + 0.3, 0, 1);
          raisedHit++;
        }
      }
    }

    const name = STORM_NAMES[calendar.day % STORM_NAMES.length];
    const dmgText = [
      trenchesHit > 0 ? `${trenchesHit} trench${trenchesHit > 1 ? 'es' : ''} collapsed` : null,
      raisedHit   > 0 ? `${raisedHit} raised bed${raisedHit > 1 ? 's' : ''} flattened` : null,
    ].filter(Boolean).join(', ');
    deps.showToast(`⚡ ${name}! ${dmgText || 'No structural damage.'}`, false);
    deps.debugLog(`major storm: ${name} — ${dmgText || 'no damage'}`);
  }

  // ── Lantern light masks ────────────────────────────────────────────
  // Carried by the player and any NPC tagged "watch" (the Watch). Punches
  // a soft hole through the day/night darkness tint: a short inner ring
  // where the tint is almost fully cleared (actual clarity), surrounded by
  // a much larger, dim halo (the lantern "shines" further than it actually
  // reveals detail).
  const LANTERN_CLARITY_TILES = 1.3; // fully-cleared radius, in tiles
  const LANTERN_SHINE_TILES   = 5.0; // total falloff radius, in tiles

  // Measures a world-space distance in screen pixels, but along the
  // CAMERA's own screen-horizontal axis rather than the fixed world-X axis
  // the old version used. World-X only reads as "screen-horizontal" for a
  // steep, near-overhead camera (the original default follow cam) — once
  // shoulder-surf's close, near-eye-level camera can face any azimuth, a
  // fixed world-X offset from the light is sometimes nearly along the
  // camera's own view axis (collapsing to a near-zero radius — the "can't
  // see anything" direction) and sometimes nearly full-lateral (blowing up
  // to a huge radius — the "looks like daytime" direction), with an
  // arbitrary stretched-ellipse mask in between (the "flashlight cone"
  // that only looked right facing one particular way). Projecting along
  // the camera's actual right vector instead gives the same screen radius
  // no matter which way the camera is yawed, by construction.
  const _camRightVec = new THREE.Vector3();
  function _lightScreenRadius(tx, tz, worldY, tiles) {
    _camRightVec.setFromMatrixColumn(deps.camera.matrixWorld, 0);
    const c = deps.worldToOverlay(tx, worldY, tz);
    const e = deps.worldToOverlay(tx + _camRightVec.x * tiles, worldY + _camRightVec.y * tiles, tz + _camRightVec.z * tiles);
    return Math.hypot(e.x - c.x, e.y - c.y);
  }

  function drawLanternMasks() {
    const lctx = deps.lctx;
    // Each carrier's y is used below to project its mask at avatar height;
    // player/NPC movement code already keeps these world positions grounded.
    const carriers = [{ x: deps.player.x / deps.TILE, y: deps.getPlayerWorldY() + 0.5, z: deps.player.y / deps.TILE }];
    const currentArea = deps.getCurrentArea();
    for (const w of deps.npcWalkers) {
      if (w.area === currentArea && w.rec?.tags?.includes('watch')) {
        carriers.push({ x: w.root.position.x, y: w.root.position.y + 0.5, z: w.root.position.z });
      }
    }
    lctx.globalCompositeOperation = 'destination-out';
    for (const c of carriers) {
      const center = deps.worldToOverlay(c.x, c.y, c.z);
      if (!center.visible) continue;
      const shineR = _lightScreenRadius(c.x, c.z, c.y, LANTERN_SHINE_TILES);
      if (!(shineR > 0)) continue;
      const clarityFrac = Math.min(0.9, LANTERN_CLARITY_TILES / LANTERN_SHINE_TILES);
      const grad = lctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0,                              'rgba(0,0,0,0.92)');
      grad.addColorStop(clarityFrac,                     'rgba(0,0,0,0.80)');
      grad.addColorStop(Math.min(1, clarityFrac + 0.18), 'rgba(0,0,0,0.28)');
      grad.addColorStop(1,                               'rgba(0,0,0,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
      lctx.fill();
    }
    lctx.globalCompositeOperation = 'source-over';
  }

  // Furniture uses the lantern mask technique, scaled by each real Three.js
  // light's range/intensity, plus a restrained warm glow near the source.
  function drawFurnitureLightMasks() {
    const lctx = deps.lctx;
    const visibleLights = [];
    for (const light of deps.getFurnitureLightSources()) {
      const center = deps.worldToOverlay(light.x, light.y, light.z);
      if (!center.visible) continue;
      const shineR = _lightScreenRadius(light.x, light.z, light.y, light.distance);
      if (!(shineR > 0)) continue;
      visibleLights.push({ light, center, shineR });
    }

    lctx.globalCompositeOperation = 'destination-out';
    for (const { light, center, shineR } of visibleLights) {
      const clarityFrac = Math.min(0.55, Math.max(0.18, 1.15 / light.distance));
      const strength = Math.min(0.94, 0.58 + light.intensity * 0.22);
      const grad = lctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
      grad.addColorStop(0,                              `rgba(0,0,0,${strength})`);
      grad.addColorStop(clarityFrac,                    `rgba(0,0,0,${strength * 0.78})`);
      grad.addColorStop(Math.min(1, clarityFrac + 0.3), `rgba(0,0,0,${strength * 0.22})`);
      grad.addColorStop(1,                              'rgba(0,0,0,0)');
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
      glow.addColorStop(0,   `rgba(${r},${g},${b},${glowAlpha})`);
      glow.addColorStop(0.4, `rgba(${r},${g},${b},${glowAlpha * 0.45})`);
      glow.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      lctx.fillStyle = glow;
      lctx.beginPath();
      lctx.arc(center.x, center.y, glowR, 0, Math.PI * 2);
      lctx.fill();
    }
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
    lctx.clearRect(0, 0, rect.width, rect.height);

    const currentArea = deps.getCurrentArea();
    if (currentArea === 'interior' || deps._isBuildingArea(currentArea)) {
      // A warm dim layer gives furniture masks something visible to clear,
      // while the underlying Three.js PointLights still shade nearby models.
      lctx.fillStyle = 'rgba(32,20,10,0.28)';
      lctx.fillRect(0, 0, rect.width, rect.height);
      // The carried lantern remains a local light indoors, including dens and mines.
      drawLanternMasks();
      drawFurnitureLightMasks();
      if (sceneTransAlpha > 0) {
        lctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
        lctx.fillRect(0, 0, rect.width, rect.height);
      }
      return;
    }

    const { r, g, b, a } = getLightingState();
    const W = rect.width;
    const H = rect.height;

    // Flat sky tint (ported from ScratchbonesGame's outdoor lighting):
    // screen-blend at low opacity adds warmth/brightness on clear days,
    // multiply-blend once opacity climbs darkens normally toward dusk/night.
    // The opacity transitions through near-zero at phase boundaries, hiding
    // the blend-mode switch.
    lctx.globalCompositeOperation = a < 0.09 ? 'screen' : 'multiply';
    lctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
    lctx.fillRect(0, 0, W, H);
    lctx.globalCompositeOperation = 'source-over';

    drawLanternMasks();
    drawFurnitureLightMasks();

    // Lightning flash on lighting canvas too
    if (lightningAlpha > 0) {
      lctx.fillStyle = `rgba(220, 240, 255, ${lightningAlpha * 0.45})`;
      lctx.fillRect(0, 0, W, H);
    }

    // Scene transition fade-to-black
    if (sceneTransAlpha > 0) {
      lctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
      lctx.fillRect(0, 0, W, H);
    }
  }

  function _computeRawLightingState() {
    const calendar = deps.calendar;
    const hour = window.CalendarSystem.getHour(); // 6..22
    const season = window.CalendarSystem.currentSeason();
    const isRaining = calendar.isRaining;
    const isStorm = isRaining && calendar.rainStrength >= 3;

    // Keyframe stops: [hour, r, g, b, alpha]
    const stops = [
      [6.0,  40,  30, 80, 0.55],  // pre-dawn: deep blue-purple
      [6.5,  220, 100, 40, 0.38], // sunrise: warm orange-red
      [7.5,  240, 160, 60, 0.22], // early morning: golden
      [9.0,  255, 230, 180, 0.08],// morning: near-clear
      [12.0, 255, 245, 210, 0.04],// noon: very clear, slight warm
      [15.0, 255, 225, 160, 0.10],// afternoon: slight golden
      [17.5, 255, 160, 60, 0.28], // late afternoon: amber
      [18.5, 220, 90,  30, 0.42], // sunset: deep orange
      [19.5, 130, 50,  80, 0.52], // dusk: purple-red
      [20.5, 30,  30,  80, 0.62], // early night: dark blue
      [22.0, 10,  10,  40, 0.72], // full night
    ];

    // Interpolate between stops
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

    // Overcast weather tint on top
    if (isStorm) { r = r * 0.5 + 30 * 0.5; g = g * 0.5 + 45 * 0.5; b = b * 0.5 + 70 * 0.5; a = Math.min(0.85, a + 0.25); }
    else if (isRaining) { r = r * 0.7 + 50 * 0.3; g = g * 0.7 + 65 * 0.3; b = b * 0.7 + 90 * 0.3; a = Math.min(0.78, a + 0.12); }

    return { r, g, b, a };
  }

  // Smoothed lighting state — eases toward the raw target each frame so the
  // lantern's punched-through clarity (and the sky/ambient tint) fade
  // gradually instead of snapping, most noticeably at the day-rollover
  // instant when getHour() jumps straight from ~22 back to 6.
  let _lightR = 10, _lightG = 10, _lightB = 40, _lightA = 0.72;
  let _lightingInitialized = false;
  function _advanceSmoothedLighting(dt) {
    const raw = _computeRawLightingState();
    if (!_lightingInitialized) {
      _lightR = raw.r; _lightG = raw.g; _lightB = raw.b; _lightA = raw.a;
      _lightingInitialized = true;
      return;
    }
    const tc = 1.5; // seconds — gentle fade, imperceptible as a "step"
    const k = 1 - Math.exp(-dt / tc);
    _lightR += (raw.r - _lightR) * k;
    _lightG += (raw.g - _lightG) * k;
    _lightB += (raw.b - _lightB) * k;
    _lightA += (raw.a - _lightA) * k;
  }

  function getLightingState() {
    return { r: Math.round(_lightR), g: Math.round(_lightG), b: Math.round(_lightB), a: _lightA };
  }

  const waterParticles = [];
  const MAX_PARTICLES = 120;
  function updateWaterParticles(dt) {
    // Spawn particles on flowing trench tiles.
    // _flowingTrenchTiles is rebuilt each sim tick (game.js) so no full
    // grid scan is needed.
    const flowingTiles = deps.getCurrentArea() === 'town' ? deps.getTownFlowingTrenchTiles() : deps.getFlowingTrenchTiles();
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
          type: Math.random() < 0.6 ? 'bubble' : 'foam'
        });
      }
    }
    // Update existing particles
    for (let i = waterParticles.length - 1; i >= 0; i--) {
      const p = waterParticles[i];
      p.wx += p.vx * dt;
      p.wy += p.vy * dt;
      p.life += dt;
      p.alpha = (1 - p.life / p.maxLife) * 0.85;
      // Kill if out of life or off a flowing trench
      const pc = Math.floor(p.wx / deps.TILE);
      const pr = Math.floor(p.wy / deps.TILE);
      const aGrid = deps.getActiveGrid(), aC = deps.getActiveCols(), aR = deps.getActiveRows();
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
    const aGrid = deps.getActiveGrid(), aC = deps.getActiveCols(), aR = deps.getActiveRows();
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
    // Rain ripples: spawn within the visible viewport region
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

  // Ported from ScratchbonesGame's outdoor lightning: a strike sequence is 1
  // flash (520ms fade) or, 30% of the time, 2 flashes — a bright lead
  // strike that cuts to a brief dark gap, then a dimmer second flash.
  const LIGHTNING_AVG_INTERVAL_S = 28; // average seconds between strike sequences during a storm
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
      calendar.nextRainWindows.push({ start: 11, end: 17, strength: 3 });
      calendar.nextRainWindows.push({ start: 19, end: 21, strength: 2 });
    } else if (hasRain) {
      // A fixed 5-hour window meant even a 'rain' day in the wettest season
      // (Longpour, 70% daily chance) only actually had it raining ~5/24 =
      // 21% of the time — the season label reads "wet" but the
      // moment-to-moment odds of catching rain stayed low. Scale the
      // window length with how rainy the season is so Longpour/Stormtide
      // days visibly rain for a large chunk of the day, while a Deadgrass
      // pity-timer shower stays a brief, isolated event.
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
    const activeWindow = calendar.nextRainWindows.find((window) => hour >= window.start && hour < window.end);
    calendar.isRaining = Boolean(activeWindow);
    calendar.rainStrength = activeWindow ? activeWindow.strength : 0;
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
    _advanceSmoothedLighting,
    updateWaterParticles,
    updateRipples,
    spawnRipples,
    updateLightningFlash,
    chooseWeatherForDay,
    updateRainState,
    setDebugWeather,
    getDebugWeather,
    // Debug/QA only — the player lantern's current on-screen shine radius,
    // to verify it stays roughly constant across camera azimuths instead of
    // collapsing/ballooning with view direction (see _lightScreenRadius).
    debugLanternShineR: () => _lightScreenRadius(deps.player.x / deps.TILE, deps.player.y / deps.TILE, deps.getPlayerWorldY() + 0.5, LANTERN_SHINE_TILES),
  };
})();