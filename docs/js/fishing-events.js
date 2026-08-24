// Wilderness fishing frenzies + Gullet Fish treasure encounters.
// Loaded before fishing-minigame.js; wraps the existing public Fishing/WildTreasure
// seams instead of duplicating either subsystem's core state.
(() => {
  'use strict';

  const FRENZY_CONFIG = Object.freeze({ // Used to tune the wilderness frenzy cadence/effects in one place.
    initialDelayHours: [0.25, 1.25],
    respawnDelayHours: [2.0, 5.0],
    retryDelayHours: 0.25,
    lifetimeHours: [1.0, 3.0],
    tileCount: [1, 3],
    scanRadiusTiles: 11,
    biteTimeMultiplier: 0.45,
    rarityMultiplier: Object.freeze({ common: 0.55, uncommon: 1.8, rare: 3.25 }),
    qualityBonusChance: 0.30,
  });
  const GULLET_CONFIG = Object.freeze({ // Used by the secondary-ring Gullet state machine.
    spawnChance: 0.18,
    ringRadius: 128,
    orbitSpeedDegPerSec: [170, 245],
    dashCooldownSec: [0.35, 0.9],
    dashDurationSec: [0.28, 0.42],
    hitRadius: 20,
    escapeSeconds: 10,
  });
  const AREA_TO_FISH_ZONE = Object.freeze({ // Used to keep frenzies restricted to wilderness zones that actually have authored fish.
    map_northern_cliffs: 'northernCliffs',
    map_southern_cloud_forest: 'cloudForest',
    map_western_slope: 'westernSlope',
    map_eastern_mire: 'easternMire',
  });
  const PERMANENT_WATER_TYPES = new Set(['river', 'stream', 'waterfall']); // Used to identify wilderness body-of-water edge tiles.

  let fishingDeps = null; // Used by frenzy scanning and Fishing dependency decorators after game.js injects the dependency bag.
  let treasureDeps = null; // Used to roll/grant the live buried-treasure chest pool for Gullet rewards.
  let currentCastFrenzy = false; // Used by the rarity/quality decorators for the cast currently in progress.
  let forceNextGullet = false; // Used by the mobile-safe debug panel to guarantee the next Gullet encounter.
  let previousFishingPhase = null; // Used to detect the main fish transitioning from active play into the caught view.
  let previousFishingState = null; // Used to detect minigame teardown and clean Gullet presentation reliably.

  const frenzyState = { // Used to persist the one nearby frenzy event across render frames.
    event: null,
    lastArea: null,
    lastHour: null,
    spawnDelayHours: randomRange(FRENZY_CONFIG.initialDelayHours),
    realScanCooldown: 0,
  };
  const gulletState = { // Used to track the optional secondary fish independently of the main fish.
    pendingForCast: false,
    mode: 'none',
    angleDeg: 0,
    orbitSpeedDegPerSec: 0,
    dashCooldownSec: 0,
    dashT: 0,
    dashDurationSec: 0,
    dashStart: null,
    dashEnd: null,
    x: 160,
    y: 160,
    ringGroup: null,
    ringFish: null,
    surfaceSprite: null,
    surfaceStart: null,
    surfaceEnd: null,
    surfaceElapsed: 0,
    treasureGranted: false,
  };

  let featureLoopLastMs = performance.now(); // Used to derive real-time dt for Gullet animation and low-frequency frenzy scans.
  let debugPanel = null; // Used for the optional on-screen mobile debugging controls/status.

  function randomRange(range) {
    const min = Number(range?.[0]) || 0; // Used as the inclusive lower bound for a tunable random range.
    const max = Number(range?.[1]) || min; // Used as the inclusive upper bound for a tunable random range.
    return min + Math.random() * Math.max(0, max - min);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function fishingZoneForArea(area) {
    const zone = AREA_TO_FISH_ZONE[area] || null; // Used to map a wilderness map id onto Fishing's authored zone key.
    if (!zone) return null;
    const defs = window.FishCatalog?.buildFishingDefs?.(); // Used to avoid spawning frenzies in wilderness maps with no authored fish yet.
    return defs?.[zone]?.length ? zone : null;
  }

  function tileKey(area, col, row) {
    return `${area}:${col},${row}`;
  }

  function activeTileAt(col, row) {
    try {
      return fishingDeps?.getActiveTileAt?.(col, row) || null;
    } catch (_) {
      return null;
    }
  }

  function isPermanentWaterTile(tile) {
    const type = String(tile?.type ?? '').toLowerCase(); // Used to normalize TileType string values before water-edge tests.
    return PERMANENT_WATER_TYPES.has(type);
  }

  function isWaterEdgeTile(col, row) {
    const tile = activeTileAt(col, row); // Used as the candidate permanent-water tile.
    if (!isPermanentWaterTile(tile)) return false;
    const cardinal = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // Used to identify whether the water tile touches shoreline on any cardinal side.
    return cardinal.some(([dc, dr]) => !isPermanentWaterTile(activeTileAt(col + dc, row + dr)));
  }

  function collectNearbyWaterEdges() {
    const area = fishingDeps?.getCurrentArea?.(); // Used to gate frenzy scans to fish-bearing wilderness zones.
    if (!fishingZoneForArea(area)) return [];
    const playerMesh = fishingDeps?.playerMesh; // Used to center the frenzy candidate scan around the player.
    if (!playerMesh?.position) return [];
    const centerCol = Math.floor(playerMesh.position.x); // Used as the tile-space X origin for the nearby scan.
    const centerRow = Math.floor(playerMesh.position.z); // Used as the tile-space Z origin for the nearby scan.
    const radius = FRENZY_CONFIG.scanRadiusTiles; // Used as the maximum tile distance considered "near you".
    const candidates = []; // Used to collect valid shoreline water tiles for randomized frenzy placement.
    for (let row = centerRow - radius; row <= centerRow + radius; row++) {
      for (let col = centerCol - radius; col <= centerCol + radius; col++) {
        const dist = Math.hypot(col - centerCol, row - centerRow); // Used to reject tiles outside the circular scan radius.
        if (dist > radius || !isWaterEdgeTile(col, row)) continue;
        candidates.push({ col, row, dist });
      }
    }
    return candidates;
  }

  function disposeFrenzyMarker(marker) {
    const group = marker?.group; // Used to detach and dispose one frenzy marker group.
    if (!group) return;
    group.parent?.remove(group);
    group.traverse?.(obj => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(mat => mat?.dispose?.());
      else obj.material?.dispose?.();
    });
  }

  function clearFrenzyEvent() {
    const event = frenzyState.event; // Used to remove every visual belonging to the active frenzy.
    if (event?.tiles) event.tiles.forEach(disposeFrenzyMarker);
    frenzyState.event = null;
  }

  function buildFrenzyMarker(area, col, row) {
    const THREE_NS = window.THREE; // Used to build the small water-surface disturbance marker.
    const scene = fishingDeps?.getActiveScene?.(); // Used as the parent scene for the live wilderness marker.
    const tile = activeTileAt(col, row); // Used to resolve the exact water surface elevation.
    if (!THREE_NS || !scene || !tile) return null;
    const group = new THREE_NS.Group(); // Used as the pulse root for one frenzy tile marker.
    const outerGeometry = new THREE_NS.RingGeometry(0.27, 0.39, 24); // Used as the broad pale-blue surface ripple.
    const outerMaterial = new THREE_NS.MeshBasicMaterial({ color: 0x75d8ff, transparent: true, opacity: 0.58, side: THREE_NS.DoubleSide, depthWrite: false }); // Used by the broad surface ripple.
    const outer = new THREE_NS.Mesh(outerGeometry, outerMaterial); // Used as the animated outer frenzy ripple.
    const innerGeometry = new THREE_NS.RingGeometry(0.10, 0.16, 18); // Used as the tighter inner disturbance ring.
    const innerMaterial = new THREE_NS.MeshBasicMaterial({ color: 0xd9f7ff, transparent: true, opacity: 0.8, side: THREE_NS.DoubleSide, depthWrite: false }); // Used by the inner disturbance ring.
    const inner = new THREE_NS.Mesh(innerGeometry, innerMaterial); // Used as the counter-pulsing inner frenzy ripple.
    outer.rotation.x = -Math.PI / 2;
    inner.rotation.x = -Math.PI / 2;
    group.add(outer, inner);
    const y = Number(fishingDeps?.tileSurfaceYInArea?.(tile, area)) || 0; // Used to keep the ripple just above the actual plateau water surface.
    group.position.set(col + 0.5, y + 0.04, row + 0.5);
    group.userData.frenzyOuter = outer;
    group.userData.frenzyInner = inner;
    group.userData.phase = Math.random() * Math.PI * 2;
    scene.add(group);
    return { area, col, row, key: tileKey(area, col, row), group };
  }

  function chooseFrenzyTiles(candidates) {
    if (!candidates.length) return [];
    const sorted = [...candidates].sort((a, b) => (a.dist + Math.random() * 3) - (b.dist + Math.random() * 3)); // Used to favor nearby shoreline while keeping event placement unpredictable.
    const seed = sorted[Math.floor(Math.random() * Math.min(8, sorted.length))] || sorted[0]; // Used as the center of a compact multi-tile frenzy patch.
    const wanted = Math.max(FRENZY_CONFIG.tileCount[0], Math.min(FRENZY_CONFIG.tileCount[1], FRENZY_CONFIG.tileCount[0] + Math.floor(Math.random() * (FRENZY_CONFIG.tileCount[1] - FRENZY_CONFIG.tileCount[0] + 1)))); // Used to choose 1-3 frenzy tiles.
    return sorted
      .map(candidate => ({ ...candidate, seedDist: Math.hypot(candidate.col - seed.col, candidate.row - seed.row) }))
      .filter(candidate => candidate.seedDist <= 4)
      .sort((a, b) => a.seedDist - b.seedDist)
      .slice(0, wanted);
  }

  function spawnFrenzyEvent(force = false) {
    if (frenzyState.event) return frenzyState.event;
    const area = fishingDeps?.getCurrentArea?.(); // Used to bind the event to the current wilderness scene.
    if (!fishingZoneForArea(area)) return null;
    const candidates = collectNearbyWaterEdges(); // Used as valid shoreline choices near the player.
    if (!candidates.length) {
      if (!force) frenzyState.spawnDelayHours = FRENZY_CONFIG.retryDelayHours;
      return null;
    }
    const chosen = chooseFrenzyTiles(candidates); // Used as the exact 1-3 shoreline tiles receiving the frenzy bonus.
    const markers = chosen.map(({ col, row }) => buildFrenzyMarker(area, col, row)).filter(Boolean); // Used as the live world visuals and cast-hit lookup records.
    if (!markers.length) return null;
    frenzyState.event = {
      area,
      remainingHours: randomRange(FRENZY_CONFIG.lifetimeHours),
      tiles: markers,
      ageRealSeconds: 0,
    };
    fishingDeps?.showToast?.('A fishing frenzy is churning nearby!', true);
    window.__farmLog?.(`[fishing-events] frenzy spawned area=${area} tiles=${markers.map(m => `${m.col},${m.row}`).join('|')} lifetime=${frenzyState.event.remainingHours.toFixed(2)}h`, 'fish');
    return frenzyState.event;
  }

  function frenzyAtReticle() {
    const event = frenzyState.event; // Used as the only active frenzy patch to compare against the fishing target.
    if (!event || event.area !== fishingDeps?.getCurrentArea?.()) return false;
    const reticle = fishingDeps?.getReticleTile?.(); // Used as the exact tile the cast will target.
    if (!reticle) return false;
    const key = tileKey(event.area, reticle.col, reticle.row); // Used to compare the cast tile against the active frenzy tile set.
    return event.tiles.some(tile => tile.key === key);
  }

  function updateFrenzyClock(dt) {
    const area = fishingDeps?.getCurrentArea?.(); // Used to clear event visuals immediately on a scene/zone change.
    if (area !== frenzyState.lastArea) {
      clearFrenzyEvent();
      frenzyState.lastArea = area;
      frenzyState.lastHour = null;
      frenzyState.spawnDelayHours = randomRange(FRENZY_CONFIG.initialDelayHours);
    }
    const hour = Number(fishingDeps?.getHour?.()); // Used as the live in-game clock so frenzy lifetime is measured in game-hours, not real seconds.
    if (!Number.isFinite(hour)) return;
    let deltaHours = 0; // Used to advance frenzy lifetime/cooldown across normal clock progression and midnight wrap.
    if (Number.isFinite(frenzyState.lastHour)) {
      deltaHours = (hour - frenzyState.lastHour + 24) % 24;
      if (deltaHours > 12) deltaHours = 0;
    }
    frenzyState.lastHour = hour;
    if (frenzyState.event) {
      frenzyState.event.remainingHours -= deltaHours;
      frenzyState.event.ageRealSeconds += dt;
      if (frenzyState.event.remainingHours <= 0) {
        clearFrenzyEvent();
        frenzyState.spawnDelayHours = randomRange(FRENZY_CONFIG.respawnDelayHours);
      }
    } else if (fishingZoneForArea(area)) {
      frenzyState.spawnDelayHours -= deltaHours;
      frenzyState.realScanCooldown -= dt;
      if (frenzyState.spawnDelayHours <= 0 && frenzyState.realScanCooldown <= 0) {
        frenzyState.realScanCooldown = 0.75;
        const spawned = spawnFrenzyEvent(false); // Used to attempt the due random event only when suitable shoreline is actually nearby.
        if (spawned) frenzyState.spawnDelayHours = randomRange(FRENZY_CONFIG.respawnDelayHours);
      }
    }
  }

  function animateFrenzyMarkers() {
    const event = frenzyState.event; // Used as the marker set to pulse this frame.
    if (!event) return;
    const t = event.ageRealSeconds; // Used as the continuous phase source for water-ripple animation.
    event.tiles.forEach((tile, index) => {
      const group = tile.group; // Used as the transform root for this tile's ripple pair.
      if (!group) return;
      const phase = t * 3.4 + group.userData.phase + index * 0.7; // Used to desynchronize nearby frenzy tiles.
      const scale = 0.92 + Math.sin(phase) * 0.12; // Used to make the disturbance visibly pulse instead of reading as static geometry.
      group.scale.setScalar(scale);
      if (group.userData.frenzyOuter?.material) group.userData.frenzyOuter.material.opacity = 0.42 + (Math.sin(phase) + 1) * 0.12;
      if (group.userData.frenzyInner?.material) group.userData.frenzyInner.material.opacity = 0.58 + (Math.cos(phase * 1.3) + 1) * 0.12;
    });
  }

  function rarityMultiplierForCast(rarity, baseMultiplierFn) {
    const base = typeof baseMultiplierFn === 'function' ? Number(baseMultiplierFn(rarity)) || 1 : 1; // Used to preserve skill/perk rarity modifiers already supplied by game.js.
    if (!currentCastFrenzy) return base;
    const frenzy = FRENZY_CONFIG.rarityMultiplier[String(rarity || '').toLowerCase()] ?? 1; // Used to shift frenzy catches away from commons and toward uncommon/rare fish.
    return base * frenzy;
  }

  function boostedFishingStars(baseStars) {
    const stars = clamp(Math.round(Number(baseStars) || 1), 1, 5); // Used as the original shared 1-5 quality roll.
    if (!currentCastFrenzy) return stars;
    const bonus = Math.random() < FRENZY_CONFIG.qualityBonusChance ? 2 : 1; // Used to guarantee at least +1 quality, with a smaller chance of +2.
    return clamp(stars + bonus, 1, 5);
  }

  function pointOnRing(angleDeg, radius) {
    const rad = (angleDeg - 90) * Math.PI / 180; // Used to match fishing-minigame.js's 0deg=top polar convention.
    return { x: 160 + Math.cos(rad) * radius, y: 160 + Math.sin(rad) * radius };
  }

  function pointSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1; // Used as the spear segment X axis for Gullet collision.
    const dy = y2 - y1; // Used as the spear segment Y axis for Gullet collision.
    const lengthSq = dx * dx + dy * dy; // Used to avoid division by zero on stationary spear-tip frames.
    if (lengthSq <= 0.0001) return Math.hypot(px - x1, py - y1);
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0, 1); // Used to project the Gullet onto the current spear-tip segment.
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }

  function gulletColorSpriteDataUrl() {
    const canvas = document.createElement('canvas'); // Used to render the surfaced non-silhouette Gullet Fish sprite without requiring a new binary asset.
    canvas.width = 112;
    canvas.height = 58;
    const ctx = canvas.getContext('2d'); // Used to paint the simple authored-color placeholder sprite.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4f6d5b';
    ctx.strokeStyle = '#17251f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(58, 29, 39, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#80987b';
    ctx.beginPath();
    ctx.ellipse(61, 35, 29, 10, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#4f6d5b';
    ctx.strokeStyle = '#17251f';
    ctx.beginPath();
    ctx.moveTo(21, 28); ctx.lineTo(4, 12); ctx.lineTo(7, 32); ctx.lineTo(4, 48); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d9d7b5';
    ctx.beginPath(); ctx.arc(86, 23, 5.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#131a16';
    ctx.beginPath(); ctx.arc(88, 23, 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#17251f';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(91, 34, 9, 0.15, 1.65); ctx.stroke();
    return canvas.toDataURL('image/png');
  }

  function ensureGulletRingDom() {
    if (gulletState.ringGroup?.isConnected) return true;
    const ringWrap = document.getElementById('fishRingWrap'); // Used as the existing fishing SVG host for the secondary ring.
    const svg = ringWrap?.querySelector('svg'); // Used to append Gullet visuals in the same 320x320 coordinate system as the spear bridge.
    if (!svg) return false;
    const ns = 'http://www.w3.org/2000/svg'; // Used to create SVG elements without HTML namespace mismatches.
    const group = document.createElementNS(ns, 'g'); // Used as the removable root for all in-ring Gullet visuals.
    group.setAttribute('id', 'gulletEncounterGroup');
    const ring = document.createElementNS(ns, 'circle'); // Used as the extra outer patrol ring requested for Gullet encounters.
    ring.setAttribute('cx', '160'); ring.setAttribute('cy', '160'); ring.setAttribute('r', String(GULLET_CONFIG.ringRadius));
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'rgba(166,207,180,0.48)'); ring.setAttribute('stroke-width', '3'); ring.setAttribute('stroke-dasharray', '7 5');
    const fish = document.createElementNS(ns, 'g'); // Used as the wide black silhouette while the Gullet patrols/dashes.
    fish.setAttribute('id', 'gulletFishSilhouette');
    const body = document.createElementNS(ns, 'ellipse'); // Used as the intentionally fat Gullet body silhouette.
    body.setAttribute('cx', '0'); body.setAttribute('cy', '0'); body.setAttribute('rx', '27'); body.setAttribute('ry', '13'); body.setAttribute('fill', 'rgba(12,15,13,0.94)');
    const tail = document.createElementNS(ns, 'path'); // Used as the broad triangular Gullet tail silhouette.
    tail.setAttribute('d', 'M -23 0 L -42 -15 L -38 0 L -42 15 Z'); tail.setAttribute('fill', 'rgba(12,15,13,0.94)');
    fish.append(body, tail);
    group.append(ring, fish);
    svg.appendChild(group);
    gulletState.ringGroup = group;
    gulletState.ringFish = fish;
    return true;
  }

  function removeGulletRingDom() {
    gulletState.ringGroup?.remove();
    gulletState.ringGroup = null;
    gulletState.ringFish = null;
  }

  function removeSurfaceSprite() {
    gulletState.surfaceSprite?.remove();
    gulletState.surfaceSprite = null;
  }

  function resetGulletEncounter() {
    removeGulletRingDom();
    removeSurfaceSprite();
    gulletState.pendingForCast = false;
    gulletState.mode = 'none';
    gulletState.dashStart = null;
    gulletState.dashEnd = null;
    gulletState.surfaceStart = null;
    gulletState.surfaceEnd = null;
    gulletState.surfaceElapsed = 0;
    gulletState.treasureGranted = false;
  }

  function startGulletEncounter() {
    if (gulletState.mode !== 'none' || !ensureGulletRingDom()) return false;
    gulletState.mode = 'orbit';
    gulletState.pendingForCast = false;
    gulletState.angleDeg = Math.random() * 360;
    gulletState.orbitSpeedDegPerSec = randomRange(GULLET_CONFIG.orbitSpeedDegPerSec) * (Math.random() < 0.5 ? -1 : 1);
    gulletState.dashCooldownSec = randomRange(GULLET_CONFIG.dashCooldownSec);
    const start = pointOnRing(gulletState.angleDeg, GULLET_CONFIG.ringRadius); // Used as the initial fast patrol position.
    gulletState.x = start.x;
    gulletState.y = start.y;
    window.__farmLog?.('[fishing-events] Gullet Fish encounter started', 'fish');
    return true;
  }

  function beginGulletDash(hooked = false) {
    const start = pointOnRing(gulletState.angleDeg, GULLET_CONFIG.ringRadius); // Used as one end of the guaranteed center-crossing dash chord.
    const endAngle = (gulletState.angleDeg + 180) % 360; // Used to guarantee the dash crosses the exact center pool.
    const end = pointOnRing(endAngle, GULLET_CONFIG.ringRadius); // Used as the opposite endpoint of the center-crossing dash.
    gulletState.mode = hooked ? 'hookedDash' : 'dash';
    gulletState.dashT = 0;
    gulletState.dashDurationSec = randomRange(GULLET_CONFIG.dashDurationSec);
    gulletState.dashStart = start;
    gulletState.dashEnd = end;
    gulletState.angleDeg = endAngle;
  }

  function screenPointFromFishingSvg(x, y) {
    const ringWrap = document.getElementById('fishRingWrap'); // Used to convert a 320x320 fishing-ring point into canvasWrap pixel coordinates.
    const canvasWrap = document.getElementById('canvasWrap'); // Used as the stable overlay parent for the surfaced fish.
    if (!ringWrap || !canvasWrap) return null;
    const ringRect = ringWrap.getBoundingClientRect(); // Used to scale fishing SVG coordinates into screen pixels.
    const canvasRect = canvasWrap.getBoundingClientRect(); // Used to convert viewport pixels into canvasWrap-local coordinates.
    return {
      x: ringRect.left - canvasRect.left + (x / 320) * ringRect.width,
      y: ringRect.top - canvasRect.top + (y / 320) * ringRect.height,
      width: canvasRect.width,
      height: canvasRect.height,
    };
  }

  function surfaceGullet() {
    const screen = screenPointFromFishingSvg(gulletState.x, gulletState.y); // Used as the start position for the 10-second surface escape.
    if (!screen) { resetGulletEncounter(); return; }
    removeGulletRingDom();
    const canvasWrap = document.getElementById('canvasWrap'); // Used as the parent that keeps the surfaced sprite visible even when the fishing ring hides on a main catch.
    const sprite = document.createElement('img'); // Used as the non-silhouette surfaced Gullet Fish sprite.
    sprite.src = gulletColorSpriteDataUrl();
    sprite.alt = 'Gullet Fish';
    sprite.style.cssText = 'position:absolute;width:92px;height:auto;z-index:44;pointer-events:none;transform:translate(-50%,-50%);filter:drop-shadow(0 2px 2px rgba(0,0,0,.55));';
    canvasWrap?.appendChild(sprite);
    const side = Math.floor(Math.random() * 4); // Used to choose the edge the surfaced fish will escape toward.
    const margin = 38; // Used to keep the fish visible until the end of the exact 10-second lerp.
    const end = side === 0 ? { x: margin, y: screen.y } : side === 1 ? { x: Math.max(margin, screen.width - margin), y: screen.y } : side === 2 ? { x: screen.x, y: margin } : { x: screen.x, y: Math.max(margin, screen.height - margin) }; // Used as the surface-escape destination.
    gulletState.mode = 'surface';
    gulletState.surfaceSprite = sprite;
    gulletState.surfaceStart = { x: screen.x, y: screen.y };
    gulletState.surfaceEnd = end;
    gulletState.surfaceElapsed = 0;
    updateSurfaceSpritePosition();
    fishingDeps?.showToast?.('The Gullet Fish broke loose! Land the main fish before it drifts away.', true);
  }

  function updateSurfaceSpritePosition() {
    if (!gulletState.surfaceSprite || !gulletState.surfaceStart || !gulletState.surfaceEnd) return;
    const t = clamp(gulletState.surfaceElapsed / GULLET_CONFIG.escapeSeconds, 0, 1); // Used as the exact 10-second surface escape lerp fraction.
    const x = gulletState.surfaceStart.x + (gulletState.surfaceEnd.x - gulletState.surfaceStart.x) * t; // Used as the current surfaced X position.
    const y = gulletState.surfaceStart.y + (gulletState.surfaceEnd.y - gulletState.surfaceStart.y) * t; // Used as the current surfaced Y position.
    gulletState.surfaceSprite.style.left = `${x}px`;
    gulletState.surfaceSprite.style.top = `${y}px`;
    const flip = gulletState.surfaceEnd.x < gulletState.surfaceStart.x ? -1 : 1; // Used to face the sprite roughly toward its escape edge.
    gulletState.surfaceSprite.style.transform = `translate(-50%,-50%) scaleX(${flip})`;
  }

  function treasureEntry(id) {
    return (treasureDeps?.getLootPools?.().treasureChest?.entries || []).find(entry => entry.id === id) || null;
  }

  function rollTreasureChance(id, fallbackChance) {
    const entry = treasureEntry(id); // Used as the live Loot & Shop Editor entry for this buried-chest reward component.
    if (entry && window.ConditionRegistry?.entryEligible && !window.ConditionRegistry.entryEligible(entry, treasureDeps.lootShopWorldState())) return false;
    const chance = entry?.chance != null ? entry.chance : fallbackChance; // Used to preserve buried-chest defaults when a configured entry is absent.
    return treasureDeps.rnd() < chance;
  }

  function rollTreasureMetalKeys() {
    const count = 1 + Math.floor(treasureDeps.rnd() * 3); // Used to match buried chests' 1-3 metal bars.
    const keys = []; // Used as the rolled metal-key bundle.
    for (let i = 0; i < count; i++) {
      const index = Math.min(treasureDeps.VERDIGRIS_METAL_KEYS.length - 1, Math.floor(Math.pow(treasureDeps.rnd(), 2.2) * treasureDeps.VERDIGRIS_METAL_KEYS.length)); // Used to match buried chests' low-tier-biased metal hierarchy roll.
      keys.push(treasureDeps.VERDIGRIS_METAL_KEYS[index]);
    }
    return keys;
  }

  function rollTreasureDyeItemKeys() {
    const poolKeys = Object.keys(treasureDeps.MYSTERY_DYE_ITEM_KEY_BY_POOL || {}); // Used as the same mystery-dye pool keys as buried chests.
    if (!poolKeys.length) return [];
    const count = 1 + Math.floor(treasureDeps.rnd() * 3); // Used to match buried chests' 1-3 mystery dyes.
    const keys = []; // Used as the rolled mystery-dye item keys.
    for (let i = 0; i < count; i++) keys.push(treasureDeps.MYSTERY_DYE_ITEM_KEY_BY_POOL[poolKeys[Math.floor(treasureDeps.rnd() * poolKeys.length)]]);
    return keys;
  }

  function rollTreasureBundle() {
    if (!treasureDeps?.getLootPools || !treasureDeps?.rnd) return null;
    const bundle = { metalKeys: [], dyeItemKeys: [], gold: 0, potionKey: null, recipeItemKey: null, clothing: null }; // Used as the exact buried-chest-shaped reward bundle granted by Gullet retrieval.
    if (rollTreasureChance('metalBars', 1)) bundle.metalKeys = rollTreasureMetalKeys();
    if (rollTreasureChance('mysteryDye', 1)) bundle.dyeItemKeys = rollTreasureDyeItemKeys();
    if (rollTreasureChance('gold', 0.7)) {
      const entry = treasureEntry('gold'); // Used to read the live buried-chest gold min/max/step settings.
      const min = entry?.min ?? 10; // Used as the minimum gold reward.
      const max = entry?.max ?? 42; // Used as the maximum gold reward.
      const step = entry?.step ?? 8; // Used as the configured gold increment.
      const steps = Math.floor((max - min) / step) + 1; // Used to count legal stepped gold values.
      bundle.gold = min + Math.floor(treasureDeps.rnd() * steps) * step;
    }
    if (rollTreasureChance('potion', 0.35) && window.AlchemySystem?.RECIPE_DEFS) {
      const recipes = Object.values(window.AlchemySystem.RECIPE_DEFS); // Used as the same authored-valid alchemy reactions available to buried chests.
      const chosen = recipes[Math.floor(treasureDeps.rnd() * recipes.length)]; // Used as the treasure's random authored reaction.
      if (chosen && treasureDeps.rnd() < 0.25) bundle.recipeItemKey = window.AlchemySystem.ensureRecipeScrollItemDef(chosen.id);
      else if (chosen) bundle.potionKey = window.AlchemySystem.ensureRecipeItemDef(chosen.id, Math.floor(treasureDeps.rnd() * 3));
    }
    if (rollTreasureChance('clothing', 0.25) && window.DyeSystem?.getCatalog) {
      const catalog = window.DyeSystem.getCatalog(); // Used as the same live dye catalog as buried chest clothing.
      const pieces = treasureDeps.getStoreClothingPieces?.() || []; // Used as the same clothing-piece source as buried chests and the General Store.
      if (catalog.length && pieces.length) {
        const piece = pieces[Math.floor(treasureDeps.rnd() * pieces.length)]; // Used as the random treasure clothing base piece.
        const dyeA = catalog[Math.floor(treasureDeps.rnd() * catalog.length)]; // Used as the primary random clothing dye.
        const dyeB = piece.usesB ? catalog[Math.floor(treasureDeps.rnd() * catalog.length)] : null; // Used as the optional secondary random clothing dye.
        const dyeLabel = piece.usesB && dyeB ? `${dyeA.label} & ${dyeB.label}` : dyeA.label; // Used to label the generated dyed garment.
        bundle.clothing = {
          uid: `citem_gullet_${Date.now()}_${Math.floor(treasureDeps.rnd() * 1e6)}`,
          cosmeticId: piece.id,
          slot: piece.category,
          label: `${dyeLabel} ${piece.label}`,
          baseLabel: piece.label,
          colorA: window.DyeSystem.toClothingColor(dyeA),
          colorB: window.DyeSystem.toClothingColor(dyeB),
          price: piece.price,
          sellPrice: Math.floor(piece.price * 0.4),
          sprite: treasureDeps.clothingSpriteForCosmetic(piece.id),
        };
      }
    }
    return bundle;
  }

  function grantTreasureBundle(bundle) {
    if (!bundle || !treasureDeps?.inventory) return null;
    const parts = []; // Used to build the player-facing Gullet treasure summary.
    for (const metalKey of bundle.metalKeys || []) {
      const key = treasureDeps.metalBarItemKey(metalKey); // Used as the inventory item key for the rolled metal bar.
      treasureDeps.inventory[key] = Math.min(99, (treasureDeps.inventory[key] || 0) + 1);
      parts.push(`${treasureDeps.ITEM_DEFS?.[key]?.icon || '🔶'} ${treasureDeps.METAL_DEFS?.[metalKey]?.label || metalKey} Bar`);
    }
    for (const dyeItemKey of bundle.dyeItemKeys || []) {
      treasureDeps.inventory[dyeItemKey] = Math.min(99, (treasureDeps.inventory[dyeItemKey] || 0) + 1);
      parts.push(`${treasureDeps.ITEM_DEFS?.[dyeItemKey]?.icon || '🎨'} ${treasureDeps.ITEM_DEFS?.[dyeItemKey]?.label || 'Mystery Dye'}`);
    }
    if (bundle.gold > 0) {
      treasureDeps.inventory.gold = (treasureDeps.inventory.gold || 0) + bundle.gold;
      parts.push(`💰${bundle.gold}g`);
    }
    if (bundle.potionKey) {
      treasureDeps.inventory[bundle.potionKey] = Math.min(99, (treasureDeps.inventory[bundle.potionKey] || 0) + 1);
      parts.push(`${treasureDeps.ITEM_DEFS?.[bundle.potionKey]?.icon || '🧪'} ${treasureDeps.ITEM_DEFS?.[bundle.potionKey]?.label || 'Potion'}`);
    }
    if (bundle.recipeItemKey) {
      treasureDeps.inventory[bundle.recipeItemKey] = Math.min(99, (treasureDeps.inventory[bundle.recipeItemKey] || 0) + 1);
      parts.push(`${treasureDeps.ITEM_DEFS?.[bundle.recipeItemKey]?.icon || '📜'} ${treasureDeps.ITEM_DEFS?.[bundle.recipeItemKey]?.label || 'Alchemy Recipe'}`);
    }
    if (bundle.clothing) {
      const packClothing = treasureDeps.getPackClothing?.(); // Used as the existing clothing inventory target for rolled treasure garments.
      if (packClothing) packClothing.push({ ...bundle.clothing });
      parts.push(`👘 ${bundle.clothing.label}`);
    }
    treasureDeps.refreshItemScroll?.();
    treasureDeps.buildInventoryGrid?.();
    treasureDeps.buildPackClothingSection?.();
    return parts;
  }

  function grantGulletTreasure() {
    if (gulletState.treasureGranted) return;
    const bundle = rollTreasureBundle(); // Used to roll directly from the live treasureChest pool/configuration.
    if (!bundle) {
      fishingDeps?.showToast?.('The Gullet Fish had treasure, but the treasure pool was unavailable.', false);
      window.__farmLog?.('[fishing-events] Gullet treasure grant failed: WildTreasure deps unavailable', 'fish');
      return;
    }
    const parts = grantTreasureBundle(bundle) || []; // Used as the exact list of granted treasure for UI feedback.
    gulletState.treasureGranted = true;
    fishingDeps?.showToast?.(`Gullet Fish treasure: ${parts.length ? parts.join(', ') : 'nothing this time'}`, true);
    window.__farmLog?.(`[fishing-events] Gullet treasure granted: ${parts.join(', ')}`, 'fish');
  }

  function playGulletHandRetrieval() {
    const sprite = gulletState.surfaceSprite; // Used as the visual pickup target for the placeholder hand animation.
    if (!sprite) { grantGulletTreasure(); return; }
    const canvasWrap = document.getElementById('canvasWrap'); // Used as the parent for the temporary placeholder hand.
    const hand = document.createElement('div'); // Used as the explicitly temporary hand-retrieval animation placeholder.
    hand.textContent = '🤚';
    hand.setAttribute('aria-hidden', 'true');
    hand.style.cssText = 'position:absolute;right:4%;bottom:3%;z-index:45;font-size:54px;pointer-events:none;transform-origin:center;';
    canvasWrap?.appendChild(hand);
    const spriteRect = sprite.getBoundingClientRect(); // Used to target the hand animation at the surfaced Gullet position.
    const canvasRect = canvasWrap?.getBoundingClientRect(); // Used to convert the target into canvas-local movement.
    if (hand.animate && canvasRect) {
      const targetX = spriteRect.left + spriteRect.width * 0.5 - (canvasRect.left + canvasRect.width * 0.96); // Used as the hand's horizontal travel toward the fish.
      const targetY = spriteRect.top + spriteRect.height * 0.5 - (canvasRect.top + canvasRect.height * 0.97); // Used as the hand's vertical travel toward the fish.
      const animation = hand.animate([
        { transform: 'translate(0,0) rotate(-16deg) scale(0.8)' },
        { transform: `translate(${targetX}px,${targetY}px) rotate(8deg) scale(1.05)` },
      ], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }); // Used as the placeholder reach-and-grab motion.
      animation.onfinish = () => { sprite.remove(); hand.remove(); };
    } else {
      sprite.remove();
      hand.remove();
    }
    grantGulletTreasure();
  }

  function retrieveGulletAfterMainCatch() {
    if (gulletState.mode !== 'surface' || gulletState.surfaceElapsed >= GULLET_CONFIG.escapeSeconds) return false;
    gulletState.mode = 'retrieved';
    playGulletHandRetrieval();
    fishingDeps?.showToast?.('You grabbed the Gullet Fish before it escaped!', true);
    return true;
  }

  function updateGullet(dt, fishingState) {
    if (!fishingState) return;
    if (gulletState.pendingForCast && fishingState.phase === 'active' && gulletState.mode === 'none') startGulletEncounter();
    if (gulletState.mode === 'none' || gulletState.mode === 'retrieved' || gulletState.mode === 'escaped') return;

    if (gulletState.mode === 'orbit') {
      gulletState.angleDeg = (gulletState.angleDeg + gulletState.orbitSpeedDegPerSec * dt + 360) % 360;
      const pos = pointOnRing(gulletState.angleDeg, GULLET_CONFIG.ringRadius); // Used as the current fast patrol position on the Gullet ring.
      gulletState.x = pos.x;
      gulletState.y = pos.y;
      gulletState.dashCooldownSec -= dt;
      if (gulletState.dashCooldownSec <= 0) beginGulletDash(false);
    } else if (gulletState.mode === 'dash' || gulletState.mode === 'hookedDash') {
      const previousT = gulletState.dashT; // Used to detect the exact frame the hooked fish crosses the center pool.
      gulletState.dashT = clamp(gulletState.dashT + dt / Math.max(0.01, gulletState.dashDurationSec), 0, 1);
      const t = gulletState.dashT; // Used as the linear center-crossing beeline fraction.
      gulletState.x = gulletState.dashStart.x + (gulletState.dashEnd.x - gulletState.dashStart.x) * t;
      gulletState.y = gulletState.dashStart.y + (gulletState.dashEnd.y - gulletState.dashStart.y) * t;
      if (gulletState.mode === 'hookedDash' && previousT < 0.5 && t >= 0.5) {
        surfaceGullet();
        return;
      }
      if (t >= 1) {
        gulletState.mode = 'orbit';
        gulletState.dashCooldownSec = randomRange(GULLET_CONFIG.dashCooldownSec);
      }
    } else if (gulletState.mode === 'surface') {
      gulletState.surfaceElapsed += dt;
      updateSurfaceSpritePosition();
      if (gulletState.surfaceElapsed >= GULLET_CONFIG.escapeSeconds) {
        removeSurfaceSprite();
        gulletState.mode = 'escaped';
        fishingDeps?.showToast?.('The Gullet Fish drifted away.', false);
      }
      return;
    }

    if (gulletState.ringFish) {
      const tangentAngle = gulletState.mode === 'orbit' ? gulletState.angleDeg + (gulletState.orbitSpeedDegPerSec >= 0 ? 90 : -90) : Math.atan2(gulletState.dashEnd.y - gulletState.dashStart.y, gulletState.dashEnd.x - gulletState.dashStart.x) * 180 / Math.PI; // Used to orient the wide silhouette along patrol/dash motion.
      gulletState.ringFish.setAttribute('transform', `translate(${gulletState.x.toFixed(2)} ${gulletState.y.toFixed(2)}) rotate(${tangentAngle.toFixed(2)})`);
    }

    const bridge = fishingState.bridge; // Used to compare the live spear-tip path against the independent Gullet collider.
    if ((gulletState.mode === 'orbit' || gulletState.mode === 'dash') && bridge?.spearActive) {
      const distance = pointSegmentDistance(gulletState.x, gulletState.y, bridge.prevTipX, bridge.prevTipY, bridge.tipX, bridge.tipY); // Used as the swept spear/Gullet collision distance.
      if (distance <= GULLET_CONFIG.hitRadius) {
        if (gulletState.mode === 'dash' && gulletState.dashT >= 0.5) {
          surfaceGullet();
        } else if (gulletState.mode === 'dash') {
          gulletState.mode = 'hookedDash';
        } else {
          beginGulletDash(true);
        }
        fishingDeps?.showToast?.('Gullet Fish hooked! It is diving through the center!', true);
      }
    }
  }

  function wrapFishingApi(api) {
    if (!api?.init || api.__fishingEventsWrapped) return api;
    const originalInit = api.init; // Used to preserve FishCatalog's existing Fishing.init wrapper.
    const originalBeginCast = api.beginCast; // Used to preserve the core cast/bait/camera pipeline.
    api.init = injectedDeps => {
      const originalRareMultiplier = injectedDeps?.rareFishWeightMultiplier; // Used to preserve existing skill/perk rarity weighting beneath Frenzy's modifier.
      const originalRollStars = injectedDeps?.rollItemStars; // Used to preserve the shared 1-5 quality roll beneath Frenzy's bonus.
      const decorated = { // Used as the minimally decorated dependency bag passed through FishCatalog into the core minigame.
        ...(injectedDeps || {}),
        rareFishWeightMultiplier: rarity => rarityMultiplierForCast(rarity, originalRareMultiplier),
        rollItemStars: source => {
          const baseStars = typeof originalRollStars === 'function' ? originalRollStars(source) : 1; // Used as the untouched shared quality roll for non-fishing sources and the Frenzy baseline.
          return currentCastFrenzy && source === 'fishing' ? boostedFishingStars(baseStars) : baseStars;
        },
      };
      fishingDeps = decorated;
      return originalInit.call(api, decorated);
    };
    if (typeof originalBeginCast === 'function') {
      api.beginCast = (...args) => {
        currentCastFrenzy = frenzyAtReticle();
        gulletState.pendingForCast = forceNextGullet || Math.random() < GULLET_CONFIG.spawnChance;
        forceNextGullet = false;
        const result = originalBeginCast.apply(api, args); // Used to run the untouched fish selection/cast setup after Frenzy state is known.
        const state = api.state; // Used to shorten only this cast's existing bite timer when the target is a Frenzy tile.
        if (state && currentCastFrenzy) {
          state.biteAt = Math.max(0.15, Number(state.biteAt || 0) * FRENZY_CONFIG.biteTimeMultiplier);
          state.frenzyActive = true;
          fishingDeps?.showToast?.('Fishing Frenzy: faster bites, rarer fish, better quality!', true);
        }
        return result;
      };
    }
    Object.defineProperty(api, '__fishingEventsWrapped', { value: true, configurable: true });
    return api;
  }

  function hookFishingAssignment() {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'Fishing'); // Used to layer this feature wrapper on top of FishCatalog's existing accessor without replacing its behavior.
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(window, 'Fishing', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: () => descriptor.get.call(window),
        set: value => {
          descriptor.set.call(window, value);
          wrapFishingApi(descriptor.get.call(window));
        },
      });
      wrapFishingApi(descriptor.get.call(window));
      return;
    }
    if (window.Fishing) wrapFishingApi(window.Fishing);
  }

  function hookWildTreasureInit() {
    const api = window.WildTreasure; // Used to capture the already-existing treasure subsystem's dependency bag before game.js initializes it.
    if (!api?.init || api.__gulletTreasureWrapped) return;
    const originalInit = api.init; // Used to preserve WildTreasure's normal initialization unchanged.
    api.init = injectedDeps => {
      treasureDeps = injectedDeps;
      return originalInit.call(api, injectedDeps);
    };
    Object.defineProperty(api, '__gulletTreasureWrapped', { value: true, configurable: true });
  }

  function debugEnabled() {
    const query = new URLSearchParams(window.location?.search || ''); // Used to let mobile testers enable the panel with ?fishingDebug=1.
    let stored = false; // Used as the safe localStorage fallback for persistent mobile debugging.
    try { stored = window.localStorage?.getItem('hobunjiFishingDebug') === '1'; } catch (_) {}
    return query.get('fishingDebug') === '1' || stored;
  }

  function ensureDebugPanel() {
    if (!debugEnabled() || debugPanel) return;
    debugPanel = document.createElement('div');
    debugPanel.id = 'fishingFeatureDebug';
    debugPanel.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;background:rgba(9,18,22,.88);color:#dff7ff;border:1px solid rgba(130,220,255,.5);border-radius:7px;padding:7px;font:11px/1.35 monospace;max-width:300px;pointer-events:auto;';
    debugPanel.innerHTML = '<div data-status>Fishing events: booting…</div><div style="display:flex;gap:5px;margin-top:5px"><button data-force-frenzy>Force Frenzy</button><button data-force-gullet>Next Gullet</button></div>';
    debugPanel.querySelector('[data-force-frenzy]')?.addEventListener('click', () => {
      clearFrenzyEvent();
      frenzyState.spawnDelayHours = 0;
      const spawned = spawnFrenzyEvent(true); // Used to give mobile testers a deterministic Frenzy spawn attempt without console access.
      if (!spawned) fishingDeps?.showToast?.('No nearby wilderness water-edge tile found for Frenzy.', false);
    });
    debugPanel.querySelector('[data-force-gullet]')?.addEventListener('click', () => {
      forceNextGullet = true;
      const state = window.Fishing?.state; // Used to spawn immediately if the spear ring is already active, otherwise arm the next cast.
      if (state?.phase === 'active' && gulletState.mode === 'none') {
        gulletState.pendingForCast = true;
        startGulletEncounter();
      } else fishingDeps?.showToast?.('Gullet Fish armed for the next cast.', true);
    });
    document.body.appendChild(debugPanel);
  }

  function updateDebugPanel() {
    if (!debugPanel) return;
    const event = frenzyState.event; // Used to summarize active Frenzy tile/lifetime state in the mobile debug panel.
    const status = debugPanel.querySelector('[data-status]'); // Used as the single compact status text target.
    if (!status) return;
    status.textContent = `Fishing events | area=${fishingDeps?.getCurrentArea?.() || '—'} | frenzy=${event ? `${event.tiles.map(t => `${t.col},${t.row}`).join(';')} ${event.remainingHours.toFixed(2)}h` : `none (${frenzyState.spawnDelayHours.toFixed(2)}h)`} | castFrenzy=${currentCastFrenzy ? 'yes' : 'no'} | gullet=${gulletState.mode}${gulletState.mode === 'surface' ? ` ${Math.max(0, GULLET_CONFIG.escapeSeconds - gulletState.surfaceElapsed).toFixed(1)}s` : ''}`;
  }

  function featureLoop(nowMs) {
    const dt = clamp((nowMs - featureLoopLastMs) / 1000, 0, 0.1); // Used as bounded real-time animation dt so tab-resume cannot teleport Gullet instantly.
    featureLoopLastMs = nowMs;
    if (fishingDeps) {
      updateFrenzyClock(dt);
      animateFrenzyMarkers();
      const state = window.Fishing?.state || null; // Used as the live main-fishing state observed by the independent Gullet state machine.
      if (state) updateGullet(dt, state);
      if (previousFishingPhase === 'active' && state?.phase === 'caught') retrieveGulletAfterMainCatch();
      if (previousFishingState && !state) {
        currentCastFrenzy = false;
        resetGulletEncounter();
      }
      previousFishingPhase = state?.phase || null;
      previousFishingState = state;
      ensureDebugPanel();
      updateDebugPanel();
    }
    window.requestAnimationFrame(featureLoop);
  }

  window.FishingFeatureDebug = { // Used by dev tools/tests as a console-independent inspection/force seam.
    status: () => ({
      area: fishingDeps?.getCurrentArea?.() || null,
      frenzy: frenzyState.event ? { area: frenzyState.event.area, remainingHours: frenzyState.event.remainingHours, tiles: frenzyState.event.tiles.map(tile => ({ col: tile.col, row: tile.row })) } : null,
      currentCastFrenzy,
      gulletMode: gulletState.mode,
      gulletEscapeRemaining: gulletState.mode === 'surface' ? Math.max(0, GULLET_CONFIG.escapeSeconds - gulletState.surfaceElapsed) : null,
    }),
    forceFrenzy: () => { clearFrenzyEvent(); frenzyState.spawnDelayHours = 0; return !!spawnFrenzyEvent(true); },
    forceGullet: () => { forceNextGullet = true; return true; },
    clearFrenzy: () => clearFrenzyEvent(),
  };

  hookWildTreasureInit();
  hookFishingAssignment();
  window.requestAnimationFrame(featureLoop);
})();
