(() => {
  'use strict';

  const HALF_VIEW_RAD = Math.PI * 0.62; // Used to map a wide 223-degree bearing window across the compass strip.
  const UPDATE_INTERVAL_MS = 33; // Used to keep bearing motion smooth while avoiding redundant work above 30 Hz.
  const CARDINALS = Object.freeze([
    { id: 'east', label: 'E', angle: 0 },
    { id: 'south', label: 'S', angle: Math.PI / 2 },
    { id: 'west', label: 'W', angle: Math.PI },
    { id: 'north', label: 'N', angle: -Math.PI / 2 },
  ]);
  let lastUpdateAt = 0; // Used to throttle the module's lightweight requestAnimationFrame bridge.
  let lastDebug = { visible: false, areaId: '', headingDeg: 0, headingSource: 'none', markers: [], offAreaQuestTargets: 0 }; // Used by mobile Pixel Probe reports.

  function angleDiff(target, source) {
    let delta = target - source;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function normalizeAngle(angle) {
    let value = Number(angle) || 0; // Used by camera-azimuth conversion so equivalent headings share the same stable -PI..PI range.
    while (value > Math.PI) value -= Math.PI * 2;
    while (value <= -Math.PI) value += Math.PI * 2;
    return value;
  }

  function markerSize(distanceTiles) {
    const distance = Math.max(0, Number(distanceTiles) || 0); // Used to make nearby symbols conspicuously larger than distant ones.
    return Math.max(9, Math.min(25, 25 - Math.log2(distance + 1) * 3.35));
  }

  function currentDeps() {
    return window.Combat?.deps || null;
  }

  function headingFromDirection(direction) {
    const x = Number(direction?.x); // Used with z below to project a camera/aim ray onto the game's horizontal X/Z plane.
    const z = Number(direction?.z); // Used with x above so pitch never changes the compass heading.
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) < 1e-6) return null;
    return Math.atan2(z, x);
  }

  function headingFromCameraAzimuthDeg(azimuthDeg) {
    const value = Number(azimuthDeg); // activeCameraAzimuth is the target-to-camera THREE.js Y rotation; the compass needs the opposite camera-look direction.
    if (!Number.isFinite(value)) return null;
    const azimuthRad = value * Math.PI / 180;
    return normalizeAngle(-azimuthRad - Math.PI / 2); // azimuth 0 = camera south looking north, so compass heading is -PI/2.
  }

  function currentHeading(deps, player) {
    const cameraAzimuthHeading = headingFromCameraAzimuthDeg(window.__hobunjiFurnitureDebug?.activeCameraAzimuthDeg); // True rendered camera orbit; unlike the gameplay aim ray, this changes on the farm even while the character stays fixed.
    if (cameraAzimuthHeading != null) return { heading: cameraAzimuthHeading, source: 'camera-azimuth' };
    try {
      const ray = deps?.getPlayerAimRay?.(); // Secondary fallback for boot paths where the camera debug bridge has not published its azimuth yet.
      const heading = headingFromDirection(ray?.direction);
      if (heading != null) return { heading, source: 'camera-ray' };
    } catch (_) {
      // Camera-ray creation can be unavailable during scene transitions; the player fallback below keeps the HUD stable until the next frame.
    }
    const playerHeading = Number(player?.angle); // Defensive boot/transition fallback only; normal gameplay should resolve the camera azimuth above.
    return { heading: Number.isFinite(playerHeading) ? playerHeading : 0, source: 'player-fallback' };
  }

  function questTargets() {
    return window.ProceduralTasks?.compassTargets?.() || [];
  }

  function collectTargets(areaId) {
    const targets = [];
    let offAreaQuestTargets = 0; // Used to tell mobile diagnostics why an active quest has no current bearing marker.
    for (const target of questTargets()) {
      if (target.areaId !== areaId) { offAreaQuestTargets++; continue; }
      targets.push({ ...target, source: 'quest', symbol: '◆', color: '#f9e28a', priority: 0 });
    }
    // A quest-giver who hasn't been asked yet (or is mid-ask) gets a purple
    // '!' instead of the gold diamond — same visual language an Elder
    // Scrolls-style compass uses to flag "this person wants to talk to you"
    // before you've ever opened their dialogue.
    for (const target of window.ProceduralTasks?.pendingRequestCompassTargets?.() || []) {
      if (target.areaId !== areaId) { offAreaQuestTargets++; continue; }
      targets.push({ ...target, source: 'pending-request', symbol: '!', color: '#c9a0ff', priority: 0 });
    }
    for (const [id, marker] of window.BountyBoard?.markers || []) {
      if (marker.zoneId !== areaId) continue;
      targets.push({ id: `bounty:${id}`, source: 'bounty', label: `Bounty: ${marker.label}`, col: marker.col, row: marker.row, symbol: '☠', color: '#f3c64f', priority: 1 });
    }
    for (const [id, marker] of window.BanditCamps?.perceivedThreats || []) {
      if (marker.zoneId !== areaId) continue;
      targets.push({
        id: `threat:${id}`, source: marker.kind, label: marker.label,
        col: marker.col, row: marker.row,
        symbol: marker.kind === 'den' ? '▲' : '⚔',
        color: marker.kind === 'den' ? '#d7c59a' : '#ef6657', priority: 2,
      });
    }
    const deduped = targets.filter((target, index, all) => !all.some((other, otherIndex) =>
      otherIndex < index && other.priority < target.priority
      && Math.hypot(other.col - target.col, other.row - target.row) < 0.75
    ));
    return { targets: deduped, offAreaQuestTargets };
  }

  function makeIndicator(className, text) {
    const element = document.createElement('span'); // Used as one reusable cardinal or target indicator in the strip.
    element.className = className;
    element.textContent = text;
    return element;
  }

  function renderIndicators(layer, entries, heading, playerCol, playerRow) {
    layer.replaceChildren();
    const debugMarkers = [];
    for (const entry of entries) {
      const targetAngle = entry.angle ?? Math.atan2(entry.row - playerRow, entry.col - playerCol);
      const delta = angleDiff(targetAngle, heading);
      if (Math.abs(delta) > HALF_VIEW_RAD) continue;
      const leftPercent = 50 + delta / HALF_VIEW_RAD * 50;
      const edgeOpacity = Math.max(0.2, 1 - Math.pow(Math.abs(delta) / HALF_VIEW_RAD, 3));
      const distance = entry.angle == null ? Math.hypot(entry.col - playerCol, entry.row - playerRow) : null;
      const indicator = makeIndicator(entry.angle == null ? 'nav-compass-marker' : 'nav-compass-cardinal', entry.symbol || entry.label);
      indicator.style.left = `${leftPercent}%`;
      indicator.style.opacity = String(edgeOpacity);
      if (distance != null) {
        const size = markerSize(distance);
        indicator.style.setProperty('--nav-marker-size', `${size.toFixed(1)}px`);
        indicator.style.color = entry.color;
        indicator.title = `${entry.label} — ${distance.toFixed(distance < 10 ? 1 : 0)} tiles`;
        indicator.setAttribute('aria-label', indicator.title);
        debugMarkers.push({ id: entry.id, source: entry.source, label: entry.label, distanceTiles: Number(distance.toFixed(1)), sizePx: Number(size.toFixed(1)), bearingDeg: Number((delta * 180 / Math.PI).toFixed(1)) });
      }
      layer.appendChild(indicator);
    }
    return debugMarkers;
  }

  function update(now = performance.now()) {
    if (now - lastUpdateAt < UPDATE_INTERVAL_MS) return;
    lastUpdateAt = now;
    const root = document.getElementById('navigationCompass');
    const layer = document.getElementById('navigationCompassLayer');
    const deps = currentDeps();
    const areaId = deps?.getCurrentArea?.() || '';
    const player = deps?.player;
    const hidden = !root || !layer || !player || document.getElementById('menuPanel')?.classList.contains('open');
    if (root) root.classList.toggle('show', !hidden);
    if (hidden) {
      lastDebug = { ...lastDebug, visible: false, areaId };
      return;
    }
    const { heading, source: headingSource } = currentHeading(deps, player); // True camera-orbit heading; independent from character/body rotation on the farm and in Character View.
    const playerCol = player.x / deps.TILE;
    const playerRow = player.y / deps.TILE;
    const { targets, offAreaQuestTargets } = collectTargets(areaId);
    const entries = [...CARDINALS.map(cardinal => ({ ...cardinal, symbol: cardinal.label })), ...targets];
    const markers = renderIndicators(layer, entries, heading, playerCol, playerRow);
    lastDebug = { visible: true, areaId, headingDeg: Number((heading * 180 / Math.PI).toFixed(1)), headingSource, markers, offAreaQuestTargets };
  }

  function frame(now) {
    update(now);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  window.NavigationCompass = Object.freeze({
    update,
    getDebug: () => ({ ...lastDebug, markers: lastDebug.markers.map(marker => ({ ...marker })) }),
    _test: Object.freeze({ angleDiff, normalizeAngle, markerSize, headingFromDirection, headingFromCameraAzimuthDeg, currentHeading, collectTargets }),
  });
})();
