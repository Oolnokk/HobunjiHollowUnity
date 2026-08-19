// Adaptive mobile gameplay zoom.
//
// Mobile rests at 200% outside combat. When a live hostile is close enough
// to matter, combat framing settles at 175%; enemies farther toward the edge
// continuously widen the view as far as 125%. Once no relevant hostile remains,
// framing smoothly returns to the 200% non-combat view.
(() => {
  'use strict';

  const OUT_OF_COMBAT_ZOOM = 2.0; // Used as the normal mobile framing when no nearby hostile is influencing combat context.
  const COMBAT_BASE_ZOOM = 1.75; // Used when relevant hostiles are all comfortably framed nearby.
  const WIDE_ZOOM = 1.25; // Used as the widest automatic combat framing for relevant distant threats.
  const FRAME_INSET = 0.92; // Used to bring the hostile's body centroid comfortably inside the viewport instead of exactly onto its edge.
  const ZOOM_PADDING = 0.018; // Used to leave a small amount of breathing room after solving the just-visible zoom.
  const RESPONSE_PER_SECOND = 4.2; // Used by the exponential lerp so zoom changes settle smoothly instead of switching instantly.
  const SCAN_INTERVAL_MS = 70; // Used to avoid projecting every hostile every render frame while keeping combat response quick.
  const DYNAMIC_OPTION_ID = 'mobileCombatZoomDynamicOption'; // Used for intermediate 125-200% values in the existing camera-zoom select.

  let currentZoom = OUT_OF_COMBAT_ZOOM; // Used as the helper's authoritative automatic zoom value after initialization.
  let targetZoom = OUT_OF_COMBAT_ZOOM; // Used as the combat-context zoom that the render-frame lerp approaches.
  let lastAppliedZoom = NaN; // Used to avoid dispatching redundant setting-change events for imperceptible differences.
  let lastFrameAt = performance.now(); // Used to make the lerp frame-rate independent.
  let nextScanAt = 0; // Used to throttle the hostile visibility solve separately from the smooth per-frame interpolation.
  let influencingHostiles = 0; // Used by the exposed debug surface to show how many enemies currently affect combat framing.
  let initialized = false; // Used to ensure the mobile 200% default is applied only after game.js has installed its zoom listener.

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function isMobileViewport() {
    return !!window.matchMedia?.('(pointer: coarse)')?.matches; // Used to leave desktop mouse/keyboard zoom behavior completely unchanged.
  }

  function zoomSelect() {
    return document.getElementById('settingZoom');
  }

  function ensureDynamicOption(select) {
    let option = document.getElementById(DYNAMIC_OPTION_ID);
    if (option?.parentElement === select) return option;
    option = document.createElement('option');
    option.id = DYNAMIC_OPTION_ID;
    option.hidden = true;
    select.appendChild(option);
    return option;
  }

  function applyZoom(value, force = false) {
    const select = zoomSelect();
    if (!select) return false;
    const zoom = clamp(value, WIDE_ZOOM, OUT_OF_COMBAT_ZOOM);
    if (!force && Number.isFinite(lastAppliedZoom) && Math.abs(zoom - lastAppliedZoom) < 0.0015) return true;

    const exact = [...select.options].find(option =>
      option.id !== DYNAMIC_OPTION_ID && Number.isFinite(Number(option.value)) && Math.abs(Number(option.value) - zoom) < 0.0005
    );
    if (exact) {
      select.value = exact.value;
    } else {
      const option = ensureDynamicOption(select); // Used so game.js's existing change listener receives an exact intermediate zoom value.
      option.value = zoom.toFixed(4);
      option.textContent = `Auto ${Math.round(zoom * 100)}%`;
      select.value = option.value;
    }

    // game.js already owns setCameraZoomScale() and all canopy/cutscene camera
    // safeguards. Routing through its existing Settings change event keeps
    // this helper from duplicating or bypassing that camera logic.
    select.dispatchEvent(new Event('change', { bubbles: true }));
    lastAppliedZoom = zoom;
    return true;
  }

  function targetRoot(target) {
    return target?.avatarRef?.group || target?.root || target?.group || target?.mesh || null;
  }

  function currentAreaHostiles() {
    const deps = window.Combat?.deps;
    const area = deps?.getCurrentArea?.();
    const hostiles = deps?.hostileObjects;
    if (!area || !Array.isArray(hostiles)) return [];
    return hostiles.filter(hostile => {
      if (!hostile || !(Number(hostile.health) > 0) || hostile.areaId !== area) return false;
      const root = targetRoot(hostile);
      return !!(root && root.parent);
    });
  }

  function cameraSnapshot() {
    const debug = window.__climbDebug?.getCameraDebug?.();
    const container = document.getElementById('threeContainer');
    if (!debug?.camPos || !debug?.camTarget || !container?.clientWidth || !container?.clientHeight || typeof THREE === 'undefined') return null;

    const cameraCfg = window.SCRATCHBONES_CONFIG?.game?.camera || {};
    const defaultMode = cameraCfg.defaultMode || 'default';
    const fovDeg = Number(cameraCfg.modes?.[defaultMode]?.fovDeg) || 42;
    return {
      camera: new THREE.Vector3(debug.camPos.x, debug.camPos.y, debug.camPos.z),
      target: new THREE.Vector3(debug.camTarget.x, debug.camTarget.y, debug.camTarget.z),
      aspect: container.clientWidth / container.clientHeight,
      tanHalfFov: Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5),
    };
  }

  function projectionBasis(snapshot, candidateZoom) {
    // updateCameraPosition uses distanceTiles / zoomScale. Scaling the current
    // target→camera vector by currentZoom/candidateZoom reconstructs the same
    // camera ray at any candidate 125-200% zoom without needing private game.js
    // camera variables.
    const targetToCamera = snapshot.camera.clone().sub(snapshot.target);
    if (targetToCamera.lengthSq() < 1e-8) return null;
    const candidateCamera = snapshot.target.clone().add(targetToCamera.multiplyScalar(currentZoom / candidateZoom));
    const forward = snapshot.target.clone().sub(candidateCamera).normalize();
    let right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    else right.normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    return { camera: candidateCamera, forward, right, up };
  }

  function isPointVisibleAtZoom(point, candidateZoom, snapshot) {
    const basis = projectionBasis(snapshot, candidateZoom);
    if (!basis) return false;
    const relative = point.clone().sub(basis.camera);
    const depth = relative.dot(basis.forward);
    if (!(depth > 0.001)) return false;

    const halfHeight = depth * snapshot.tanHalfFov;
    const halfWidth = halfHeight * snapshot.aspect;
    if (!(halfWidth > 0) || !(halfHeight > 0)) return false;
    const nx = Math.abs(relative.dot(basis.right)) / halfWidth;
    const ny = Math.abs(relative.dot(basis.up)) / halfHeight;
    return nx <= FRAME_INSET && ny <= FRAME_INSET;
  }

  function combatZoomForHostile(hostile, snapshot) {
    const root = targetRoot(hostile);
    const point = root && window.WorldPopupText?.avatarCentroidWorld?.(root); // Used to test the same live body centroid used by combat popup text.
    if (!point) return null;

    // Anything outside even the 125% frame is too far/off-angle to count as
    // current combat context. A hostile that fits at 175% is "closeby" and
    // simply activates the combat baseline instead of pulling the camera wider.
    if (!isPointVisibleAtZoom(point, WIDE_ZOOM, snapshot)) return null;
    if (isPointVisibleAtZoom(point, COMBAT_BASE_ZOOM, snapshot)) return COMBAT_BASE_ZOOM;

    // Between those thresholds, binary-search the highest zoom that still
    // includes the hostile. This keeps the distance/edge response continuous
    // instead of snapping from 175% straight to 125%.
    let visibleZoom = WIDE_ZOOM;
    let hiddenZoom = COMBAT_BASE_ZOOM;
    for (let iteration = 0; iteration < 9; iteration++) {
      const candidate = (visibleZoom + hiddenZoom) * 0.5;
      if (isPointVisibleAtZoom(point, candidate, snapshot)) visibleZoom = candidate;
      else hiddenZoom = candidate;
    }
    return clamp(visibleZoom - ZOOM_PADDING, WIDE_ZOOM, COMBAT_BASE_ZOOM);
  }

  function solveTargetZoom() {
    const snapshot = cameraSnapshot();
    if (!snapshot) {
      influencingHostiles = 0;
      return OUT_OF_COMBAT_ZOOM;
    }

    let solved = OUT_OF_COMBAT_ZOOM;
    let count = 0;
    for (const hostile of currentAreaHostiles()) {
      const hostileZoom = combatZoomForHostile(hostile, snapshot);
      if (hostileZoom == null) continue;
      solved = Math.min(solved, hostileZoom); // Used so the widest relevant enemy determines framing when several are in combat context.
      count++;
    }
    influencingHostiles = count;
    return count > 0 ? solved : OUT_OF_COMBAT_ZOOM;
  }

  function shouldSuspendDynamicScan() {
    const debug = window.__climbDebug;
    return debug?.isPaused?.() || debug?.isMenuOpen?.() || debug?.isDialogueOpen?.(); // Used to prevent combat framing from fighting scripted/menu/dialogue camera behavior.
  }

  function dependenciesReady() {
    return isMobileViewport()
      && window.__hobunjiGameStarted === true
      && !!window.Combat?.deps
      && typeof window.__climbDebug?.getCameraDebug === 'function'
      && typeof window.WorldPopupText?.avatarCentroidWorld === 'function'
      && !!zoomSelect();
  }

  function frame(nowMs) {
    if (!isMobileViewport()) return; // Desktop never gets a background zoom loop.
    if (!dependenciesReady()) {
      requestAnimationFrame(frame);
      return;
    }

    if (!initialized) {
      initialized = true;
      currentZoom = OUT_OF_COMBAT_ZOOM;
      targetZoom = OUT_OF_COMBAT_ZOOM;
      lastFrameAt = nowMs;
      nextScanAt = nowMs;
      applyZoom(OUT_OF_COMBAT_ZOOM, true); // Used to preserve 200% as the mobile default whenever combat context is absent.
    }

    const dt = Math.min(0.08, Math.max(0, (nowMs - lastFrameAt) / 1000));
    lastFrameAt = nowMs;

    if (shouldSuspendDynamicScan()) {
      // Keep the current zoom untouched while another system owns camera
      // framing. Reset the scan deadline so combat context is re-evaluated
      // immediately on the first gameplay frame after returning.
      influencingHostiles = 0;
      nextScanAt = 0;
      requestAnimationFrame(frame);
      return;
    }

    if (nowMs >= nextScanAt) {
      targetZoom = solveTargetZoom();
      nextScanAt = nowMs + SCAN_INTERVAL_MS;
    }

    const alpha = 1 - Math.exp(-RESPONSE_PER_SECOND * dt); // Exponential lerp gives the same feel at 30, 60, or 120 Hz.
    currentZoom += (targetZoom - currentZoom) * alpha;
    if (Math.abs(targetZoom - currentZoom) < 0.0005) currentZoom = targetZoom;
    applyZoom(currentZoom);
    requestAnimationFrame(frame);
  }

  window.MobileCombatZoom = {
    getState: () => ({
      active: isMobileViewport() && initialized,
      currentZoom,
      targetZoom,
      influencingHostiles,
      outOfCombatZoom: OUT_OF_COMBAT_ZOOM,
      combatBaseZoom: COMBAT_BASE_ZOOM,
      restZoom: OUT_OF_COMBAT_ZOOM, // Backward-compatible alias for existing debug callers.
      wideZoom: WIDE_ZOOM,
    }),
    refresh: () => { nextScanAt = 0; },
  };

  requestAnimationFrame(frame);
})();
