// Tight ranged framing plus attack-authoritative Shoulder Cam convergence.
(() => {
  'use strict';

  const VERSION = 3;
  const SHOULDER_MODE = 'shoulderSurf';
  const TIGHT_DISTANCE_TILES = 1.55; // Used to pull the active shoulder camera in while a ranged focus state is active.
  const DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES = 0.18; // Used as the ranged-focus-only shoulder offset until the player authors another value.
  const FOCUS_HORIZONTAL_MIN_TILES = -1; // Used by the ranged-focus Settings slider and input validation.
  const FOCUS_HORIZONTAL_MAX_TILES = 1; // Used by the ranged-focus Settings slider and input validation.
  const FOCUS_HORIZONTAL_STEP_TILES = 0.05; // Used by the ranged-focus Settings slider for the same granularity as the normal shoulder offset.
  const FOCUS_HORIZONTAL_STORAGE_KEY = 'hobunjiRangedFocusShoulderOffsetH'; // Used to persist only the ranged-focus shoulder preset between sessions.
  const FOCUS_EASE_PER_SEC = 9; // Used to ease both zoom and horizontal framing without a snap.
  const RESTORE_EPSILON = 0.002; // Used to stop tiny residual interpolation from keeping the camera in a modified state forever.
  const MELEE_RANGE_CAPTURE_PAD_S = 0.12; // Used to keep a windup-authored attack range active through the end of its visible strike.
  const CROSSBOW_VERTICAL_PITCH_LIMIT_DEG = 70; // Used to keep portrait-orbit stance rotation inside the same practical vertical-aim envelope as combat.
  const MAIN_CAMERA_POSITION_EPSILON = 0.0001; // Used to distinguish the gameplay PerspectiveCamera from editor/preview cameras sharing the Three.js prototype.

  let baseUpdate = null; // Used to preserve the ranged system's existing per-frame update before camera-focus work runs.
  let baseRangedInit = null; // Used to preserve RangedWeapons.init while substituting only its player shot ray.
  let basePlayerIdlePose = null; // Used to preserve the authored ranged idle stance before adding vertical portrait-orbit rotation.
  let installed = false; // Used to avoid wrapping RangedWeapons.update more than once.
  let rangedAimAuthorityInstalled = false; // Used to wrap RangedWeapons.init exactly once before game.js injects its camera-derived aim ray.
  let verticalStanceInstalled = false; // Used to wrap playerIdlePose exactly once for crossbow/scatterbow vertical aiming.
  let cameraLookAtInstalled = false; // Used to install the attack-range look-at redirect on PerspectiveCamera once.
  let meleeRangeCaptureInstalled = false; // Used to wrap the shared melee visual/lunge range reports once Combat.deps exists.
  let rangedAimDeps = null; // Ranged-specific injected deps retained for authoritative shot origin/pitch and portrait metrics.
  let rawRangedGetPlayerAimRay = null; // Original center-camera ray retained only as a fallback when player-facing data is unavailable.
  let rawRangedGetPlayerAimPitch = null; // Existing vertical look input remains the authored vertical attack pitch.
  let rawRangedGetPlayerAimAngle = null; // Existing aim angle retained only as a boot/fallback source before player.angle is valid.
  let blend = 0; // Used to drive the current focus interpolation from 0 (normal) to 1 (tight).
  let baseDistanceTiles = null; // Used to restore the authored shoulder-camera distance after focus ends.
  let baseCombatHorizontal = null; // Used to restore the player's authored Combat horizontal shoulder offset after focus ends.
  let focusHorizontalOffsetTiles = loadFocusHorizontalOffset(); // Used as the independent ranged-focus shoulder target instead of overwriting the authored Combat preset.
  let horizontalModified = false; // Used to know whether the hidden Combat preset still needs restoration after leaving combat stance.
  let previousCombatStance = false; // Used to detect a fresh melee/ranged combat-stance entry.
  let combatCapturePending = false; // Used to wait one frame for game.js to sync the Combat slider before capturing its authored value.
  let ownSliderDispatch = false; // Used to distinguish this module's synthetic Combat-slider writes from a player's live Settings edit.
  let sliderListenerInstalled = false; // Used to attach the normal Combat Settings listener once even if this module loads before the slider exists.
  let focusControlInstalled = false; // Used to create/bind the ranged-focus-only Settings row exactly once.
  let activeMeleeRange = null; // Latest real attack cone/lunge reach captured at windup start, overriding the idle combo range until that attack ends.
  let lastAttackCameraTarget = null; // Mobile-readable copy of the last point Shoulder Cam was redirected toward.
  let lastVerticalStance = null; // Mobile-readable copy of the latest crossbow/scatterbow portrait-orbit transform.
  let lastFocusSignature = ''; // Used to keep the mobile-visible debug log transition-only instead of spamming every frame.
  let lastState = null; // Used by snapshot() for mobile/debug inspection without recomputing state mid-frame.

  function three() {
    return window.THREE || null;
  }

  function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  }

  function shoulderModeConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null;
  }

  function horizontalSlider() {
    return document.getElementById('settingShoulderSurfOffsetH');
  }

  function focusHorizontalSlider() {
    return document.getElementById('settingRangedFocusShoulderOffsetH');
  }

  function focusHorizontalValueLabel() {
    return document.getElementById('settingRangedFocusShoulderOffsetHValue');
  }

  function clampFocusHorizontal(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES;
    return Math.max(FOCUS_HORIZONTAL_MIN_TILES, Math.min(FOCUS_HORIZONTAL_MAX_TILES, number));
  }

  function loadFocusHorizontalOffset() {
    try {
      const saved = window.localStorage?.getItem?.(FOCUS_HORIZONTAL_STORAGE_KEY);
      if (saved == null || saved === '') return DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES;
      return clampFocusHorizontal(saved);
    } catch (_) {
      return DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES;
    }
  }

  function saveFocusHorizontalOffset() {
    try { window.localStorage?.setItem?.(FOCUS_HORIZONTAL_STORAGE_KEY, String(focusHorizontalOffsetTiles)); } catch (_) {}
  }

  function setFocusHorizontalOffset(value, persist = true) {
    focusHorizontalOffsetTiles = clampFocusHorizontal(value);
    if (persist) saveFocusHorizontalOffset();
    const slider = focusHorizontalSlider();
    const valueLabel = focusHorizontalValueLabel();
    if (slider) slider.value = String(focusHorizontalOffsetTiles);
    if (valueLabel) valueLabel.textContent = focusHorizontalOffsetTiles.toFixed(2);
    return focusHorizontalOffsetTiles;
  }

  function combatDeps() {
    return window.Combat?.deps || null;
  }

  function heldState() {
    const deps = combatDeps();
    const heldMode = deps?.getHeldMode?.();
    const activeTool = deps?.getActiveTool?.();
    return {
      heldMode,
      activeTool,
      combatStance: heldMode === 'tool' && (activeTool === 'weapon' || activeTool === 'ranged'),
      meleeOut: heldMode === 'tool' && activeTool === 'weapon',
      rangedOut: heldMode === 'tool' && activeTool === 'ranged',
    };
  }

  function playerFacingAngle(deps = combatDeps()) {
    const playerAngle = Number(deps?.player?.angle ?? rangedAimDeps?.player?.angle);
    if (Number.isFinite(playerAngle)) return playerAngle;
    const fallback = Number(rawRangedGetPlayerAimAngle?.());
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function rangedAimPitch() {
    const pitch = Number(rawRangedGetPlayerAimPitch?.());
    return Number.isFinite(pitch) ? pitch : 0;
  }

  function directionFromAngles(angle, pitch) {
    const THREE = three();
    if (!THREE?.Vector3) return null;
    const horizontal = Math.cos(Number(pitch) || 0);
    return new THREE.Vector3(
      Math.cos(Number(angle) || 0) * horizontal,
      Math.sin(Number(pitch) || 0),
      Math.sin(Number(angle) || 0) * horizontal,
    ).normalize();
  }

  function playerWorldBaseY(deps) {
    const player = deps?.player;
    const rendered = Number(deps?.getActorWorldY?.(player));
    if (Number.isFinite(rendered)) return rendered;
    const surface = Number(deps?.worldSurfaceY?.(Number(player?.x) || 0, Number(player?.y) || 0));
    return Number.isFinite(surface) ? surface : 0;
  }

  function playerProjectileOrigin(deps = rangedAimDeps || combatDeps()) {
    const THREE = three();
    const player = deps?.player;
    const tile = Number(deps?.TILE) || 64;
    if (!THREE?.Vector3 || !player) return null;
    return new THREE.Vector3(
      (Number(player.x) || 0) / tile,
      playerWorldBaseY(deps) + 0.55,
      (Number(player.y) || 0) / tile,
    );
  }

  function authoritativeRangedAimRay() {
    const deps = rangedAimDeps;
    if (!deps?.player) return rawRangedGetPlayerAimRay?.() || null;
    const origin = playerProjectileOrigin(deps);
    const direction = directionFromAngles(playerFacingAngle(deps), rangedAimPitch());
    if (!origin || !direction) return rawRangedGetPlayerAimRay?.() || null;
    return { origin, direction };
  }

  function isCrossbowStyle(itemKey) {
    if (!itemKey) return false;
    const rangedType = window.RangedWeapons?.config?.[itemKey]?.rangedType;
    return itemKey === 'crossbow' || itemKey === 'scatterbow' || rangedType === 'crossbow' || rangedType === 'scatterbow';
  }

  function crossbowPortraitMetrics() {
    const deps = rangedAimDeps || combatDeps();
    const player = deps?.player;
    if (!player) return null;
    const avatar = deps?.getPlayerAvatarGroup?.();
    const toolBaseY = Number(avatar?.userData?.handAttachY);
    const playerBaseY = playerWorldBaseY(deps);
    const portraitCenterY = Number(window.RangedWeapons?.actorHitbox?.(player)?.center?.y);
    if (![toolBaseY, playerBaseY, portraitCenterY].every(Number.isFinite)) return null;
    return {
      toolBaseY,
      portraitPivotY: portraitCenterY - playerBaseY,
    };
  }

  function transformCrossbowPose(basePose, pitchRad = rangedAimPitch()) {
    if (!basePose || typeof basePose !== 'object') return basePose;
    const pitchDeg = Math.max(-CROSSBOW_VERTICAL_PITCH_LIMIT_DEG, Math.min(CROSSBOW_VERTICAL_PITCH_LIMIT_DEG, (Number(pitchRad) || 0) * 180 / Math.PI));
    const rotation = -pitchDeg * Math.PI / 180;
    const out = { ...basePose, pitch: (Number(basePose.pitch) || 0) - pitchDeg };
    const metrics = crossbowPortraitMetrics();
    if (metrics) {
      const dy = metrics.toolBaseY + (Number(basePose.y) || 0) - metrics.portraitPivotY;
      const dz = Number(basePose.z) || 0;
      const cos = Math.cos(rotation), sin = Math.sin(rotation);
      const rotatedY = dy * cos - dz * sin;
      const rotatedZ = dy * sin + dz * cos;
      out.y = metrics.portraitPivotY + rotatedY - metrics.toolBaseY;
      out.z = rotatedZ;
      lastVerticalStance = {
        pitchDeg,
        toolBaseY: metrics.toolBaseY,
        portraitPivotY: metrics.portraitPivotY,
        source: { y: Number(basePose.y) || 0, z: Number(basePose.z) || 0, pitch: Number(basePose.pitch) || 0 },
        applied: { y: out.y, z: out.z, pitch: out.pitch },
      };
    } else {
      lastVerticalStance = { pitchDeg, toolBaseY: null, portraitPivotY: null, source: { ...basePose }, applied: { ...out } };
    }
    return out;
  }

  function transformCrossbowPoseSet(poseSet) {
    if (!poseSet || typeof poseSet !== 'object') return poseSet;
    return {
      ...poseSet,
      neutral: transformCrossbowPose(poseSet.neutral),
      windup: transformCrossbowPose(poseSet.windup),
      strike: transformCrossbowPose(poseSet.strike),
    };
  }

  function installVerticalRangedStance() {
    const ranged = window.RangedWeapons;
    if (verticalStanceInstalled || typeof ranged?.playerIdlePose !== 'function') return verticalStanceInstalled;
    basePlayerIdlePose = ranged.playerIdlePose.bind(ranged);
    ranged.playerIdlePose = function verticalAimAwarePlayerIdlePose(itemKey) {
      const pose = basePlayerIdlePose(itemKey);
      if (!pose || !heldState().rangedOut || !isCrossbowStyle(itemKey) || ranged.isLoaded?.(itemKey) !== true) return pose;
      return transformCrossbowPose(pose);
    };
    verticalStanceInstalled = true;
    return true;
  }

  function installAuthoritativeRangedAim() {
    const ranged = window.RangedWeapons;
    if (rangedAimAuthorityInstalled || typeof ranged?.init !== 'function') return rangedAimAuthorityInstalled;
    baseRangedInit = ranged.init.bind(ranged);
    ranged.init = function attackAuthoritativeRangedInit(injectedDeps) {
      rawRangedGetPlayerAimRay = injectedDeps?.getPlayerAimRay || null;
      rawRangedGetPlayerAimPitch = injectedDeps?.getPlayerAimPitch || null;
      rawRangedGetPlayerAimAngle = injectedDeps?.getPlayerAimAngle || null;
      const rawTriggerRangedWeaponVisual = injectedDeps?.triggerRangedWeaponVisual;
      const wrappedDeps = {
        ...injectedDeps,
        getPlayerAimRay: () => authoritativeRangedAimRay(),
      };
      if (typeof rawTriggerRangedWeaponVisual === 'function') {
        wrappedDeps.triggerRangedWeaponVisual = function verticalAimAwareRangedVisual(durationS, options = {}) {
          const itemKey = injectedDeps?.getEquippedRangedKey?.();
          const loadedFire = itemKey && isCrossbowStyle(itemKey) && window.RangedWeapons?.isLoaded?.(itemKey) === true;
          const nextOptions = loadedFire && options?.pose
            ? { ...options, pose: transformCrossbowPoseSet(options.pose) }
            : options;
          return rawTriggerRangedWeaponVisual(durationS, nextOptions);
        };
      }
      rangedAimDeps = wrappedDeps;
      return baseRangedInit(wrappedDeps);
    };
    rangedAimAuthorityInstalled = true;
    return true;
  }

  function thrownCharge(itemKey) {
    const snapshot = window.HobunjiRangedWeaponArchetypes?.debugSnapshot?.();
    return snapshot?.thrownCharge?.itemKey === itemKey ? snapshot.thrownCharge : null;
  }

  function focusState() {
    const ranged = window.RangedWeapons;
    const held = heldState();
    const itemKey = ranged?.equippedRangedKey?.() || null;
    const def = itemKey ? ranged?.config?.[itemKey] : null;
    const rangedType = def?.rangedType || 'load-fire';
    const charging = rangedType === 'thrown' && !!thrownCharge(itemKey);
    const loaded = rangedType !== 'thrown' && !!itemKey && ranged?.isLoaded?.(itemKey) === true;
    const active = held.rangedOut && !!itemKey && (charging || loaded);
    return {
      active,
      reason: !held.rangedOut ? 'ranged-not-out' : !itemKey ? 'no-ranged-item' : charging ? 'thrown-windup' : loaded ? 'loaded' : 'not-ready',
      itemKey,
      rangedType,
      charging,
      loaded,
      ...held,
    };
  }

  function easeToward(current, target, dt) {
    const seconds = Math.max(0, Math.min(0.1, Number(dt) || 0));
    const amount = 1 - Math.exp(-FOCUS_EASE_PER_SEC * seconds);
    return current + (target - current) * amount;
  }

  function dispatchHorizontal(value) {
    const slider = horizontalSlider();
    if (!slider || !Number.isFinite(value)) return false;
    ownSliderDispatch = true;
    try {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      ownSliderDispatch = false;
    }
    return true;
  }

  function captureCombatHorizontalAfterGameSync(state) {
    if (!state.combatStance) {
      combatCapturePending = false;
      return;
    }
    if (!previousCombatStance) {
      combatCapturePending = true;
      if (horizontalModified && !state.active && baseCombatHorizontal != null) {
        dispatchHorizontal(baseCombatHorizontal);
        horizontalModified = false;
      }
      return;
    }
    if (!combatCapturePending || baseCombatHorizontal != null || horizontalModified) return;
    const sliderValue = Number(horizontalSlider()?.value);
    if (Number.isFinite(sliderValue)) {
      baseCombatHorizontal = sliderValue;
      combatCapturePending = false;
    }
  }

  function applyDistance() {
    const mode = shoulderModeConfig();
    if (!mode) return null;
    if (baseDistanceTiles == null) {
      const authored = Number(mode.distanceTiles);
      if (Number.isFinite(authored) && authored > 0) baseDistanceTiles = authored;
    }
    if (baseDistanceTiles == null) return null;
    const next = baseDistanceTiles + (TIGHT_DISTANCE_TILES - baseDistanceTiles) * blend;
    mode.distanceTiles = next;
    return next;
  }

  function applyHorizontal(state) {
    if (!state.combatStance || baseCombatHorizontal == null) return null;
    const next = baseCombatHorizontal + (focusHorizontalOffsetTiles - baseCombatHorizontal) * blend;
    if (Math.abs(next - baseCombatHorizontal) > RESTORE_EPSILON) {
      if (dispatchHorizontal(next)) horizontalModified = true;
    } else if (horizontalModified) {
      if (dispatchHorizontal(baseCombatHorizontal)) horizontalModified = false;
    }
    return next;
  }

  function captureMeleeRange(rangePx, durationS = 0, source = 'attack') {
    const reach = Number(rangePx);
    if (!Number.isFinite(reach) || reach <= 0) return false;
    activeMeleeRange = {
      rangePx: reach,
      source,
      startedAt: nowMs(),
      expiresAt: nowMs() + (Math.max(0.05, Number(durationS) || 0) + MELEE_RANGE_CAPTURE_PAD_S) * 1000,
    };
    return true;
  }

  function installMeleeRangeCapture() {
    const deps = combatDeps();
    if (!deps || meleeRangeCaptureInstalled) return meleeRangeCaptureInstalled;
    const rawSwing = deps.triggerWeaponSwingVisual;
    if (typeof rawSwing === 'function') {
      deps.triggerWeaponSwingVisual = function attackCameraRangeAwareSwing(durationS, options = {}) {
        captureMeleeRange(options?.coneRangePx, Number(durationS) + (Number(options?.holdS) || 0), 'swing-windup');
        return rawSwing.apply(this, arguments);
      };
    }
    const rawHold = deps.triggerWeaponHoldVisual;
    if (typeof rawHold === 'function') {
      deps.triggerWeaponHoldVisual = function attackCameraRangeAwareHold(durationS, options = {}) {
        captureMeleeRange(options?.coneRangePx, Number(durationS) + (Number(options?.holdS) || 0), 'hold-windup');
        return rawHold.apply(this, arguments);
      };
    }
    const rawLunge = deps.beginCombatLunge;
    if (typeof rawLunge === 'function') {
      deps.beginCombatLunge = function attackCameraRangeAwareLunge(distancePx, durationS, hopUnits, options = {}) {
        captureMeleeRange(options?.rangePx, durationS, 'lunge/strike');
        return rawLunge.apply(this, arguments);
      };
    }
    meleeRangeCaptureInstalled = typeof rawSwing === 'function' || typeof rawHold === 'function' || typeof rawLunge === 'function';
    return meleeRangeCaptureInstalled;
  }

  function currentMeleeRangePx() {
    if (activeMeleeRange && activeMeleeRange.expiresAt >= nowMs()) return activeMeleeRange.rangePx;
    if (activeMeleeRange) activeMeleeRange = null;
    const deps = combatDeps();
    const comboId = window.Combat?.loadout?.getSlot?.('tap1') || deps?.currentComboAbilityId?.() || 'swingCombo';
    const steps = window.Combat?.comboData?.[comboId];
    const baseRange = Number(deps?.weaponAbility?.('cut')?.rangePx) || (Number(deps?.TILE) || 64) * 1.05;
    const rangeScale = Number(window.Combat?.comboData?.RANGE_SCALE);
    const scale = Number.isFinite(rangeScale) ? rangeScale : 1;
    const maxStepMul = Array.isArray(steps) && steps.length
      ? Math.max(...steps.map(step => Number(step?.rangeMul) || 1))
      : 1;
    const effects = window.CombatProgression?.getEffects?.(deps?.currentWeaponKey?.(), comboId) || { stats: {} };
    return baseRange * maxStepMul * scale * (1 + (Number(effects?.stats?.rangeMul) || 0));
  }

  function rangedAttackCameraTarget(state) {
    const ranged = window.RangedWeapons;
    const def = state.itemKey ? ranged?.config?.[state.itemKey] : null;
    const rangeTiles = Number(def?.rangeTiles);
    if (!state.rangedOut || !state.itemKey || !Number.isFinite(rangeTiles) || rangeTiles <= 0) return null;
    const origin = playerProjectileOrigin(rangedAimDeps || combatDeps());
    const direction = directionFromAngles(playerFacingAngle(rangedAimDeps || combatDeps()), rangedAimPitch());
    if (!origin || !direction) return null;
    return {
      mode: 'ranged',
      source: 'weapon-max-range',
      itemKey: state.itemKey,
      rangeTiles,
      origin,
      direction,
      point: origin.clone().addScaledVector(direction, rangeTiles),
    };
  }

  function meleeAttackCameraTarget(state) {
    const deps = combatDeps();
    if (!state.meleeOut || !deps?.player) return null;
    const tile = Number(deps.TILE) || 64;
    const rangePx = currentMeleeRangePx();
    const rangeTiles = Math.max(0.05, rangePx / tile);
    const hitboxCenter = window.RangedWeapons?.actorHitbox?.(deps.player)?.center;
    const THREE = three();
    const origin = hitboxCenter?.clone?.() || (THREE?.Vector3 ? new THREE.Vector3(
      (Number(deps.player.x) || 0) / tile,
      playerWorldBaseY(deps) + 0.45,
      (Number(deps.player.y) || 0) / tile,
    ) : null);
    const pitch = Number(deps.getPlayerMeleeAimPitch?.()) || 0;
    const direction = directionFromAngles(playerFacingAngle(deps), pitch);
    if (!origin || !direction) return null;
    return {
      mode: 'melee',
      source: activeMeleeRange ? activeMeleeRange.source : 'combo-max-range',
      itemKey: deps.currentWeaponKey?.() || null,
      rangeTiles,
      rangePx,
      origin,
      direction,
      point: origin.clone().addScaledVector(direction, rangeTiles),
    };
  }

  function attackCameraTarget() {
    const state = focusState();
    if (!state.combatStance) return null;
    return state.rangedOut ? rangedAttackCameraTarget(state) : meleeAttackCameraTarget(state);
  }

  function plainAttackTarget(target) {
    if (!target) return null;
    return {
      mode: target.mode,
      source: target.source,
      itemKey: target.itemKey,
      rangeTiles: target.rangeTiles,
      rangePx: target.rangePx ?? null,
      origin: target.origin ? { x: target.origin.x, y: target.origin.y, z: target.origin.z } : null,
      direction: target.direction ? { x: target.direction.x, y: target.direction.y, z: target.direction.z } : null,
      point: target.point ? { x: target.point.x, y: target.point.y, z: target.point.z } : null,
    };
  }

  function isMainShoulderCamera(camera) {
    if (!camera?.isPerspectiveCamera) return false;
    const state = window.__hobunjiFurnitureDebug?.camState;
    if (state?.mode !== SHOULDER_MODE || !state?.position) return false;
    return Math.abs((Number(camera.position?.x) || 0) - Number(state.position.x)) <= MAIN_CAMERA_POSITION_EPSILON
      && Math.abs((Number(camera.position?.y) || 0) - Number(state.position.y)) <= MAIN_CAMERA_POSITION_EPSILON
      && Math.abs((Number(camera.position?.z) || 0) - Number(state.position.z)) <= MAIN_CAMERA_POSITION_EPSILON;
  }

  function installAttackCameraLookAt() {
    const THREE = three();
    const proto = THREE?.PerspectiveCamera?.prototype;
    if (cameraLookAtInstalled || !proto || typeof proto.lookAt !== 'function') return cameraLookAtInstalled;
    const rawLookAt = proto.lookAt;
    proto.lookAt = function attackAuthoritativeShoulderLookAt(...args) {
      if (isMainShoulderCamera(this)) {
        const target = attackCameraTarget();
        if (target?.point) {
          lastAttackCameraTarget = plainAttackTarget(target);
          return rawLookAt.call(this, target.point);
        }
      }
      return rawLookAt.apply(this, args);
    };
    cameraLookAtInstalled = true;
    return true;
  }

  function logTransition(state, distanceTiles, horizontalOffset) {
    const signature = `${state.active ? 1 : 0}|${state.reason}|${state.itemKey || '-'}|${state.rangedType}`;
    if (signature === lastFocusSignature) return;
    lastFocusSignature = signature;
    const distanceText = Number.isFinite(distanceTiles) ? distanceTiles.toFixed(2) : 'n/a';
    const horizontalText = Number.isFinite(horizontalOffset) ? horizontalOffset.toFixed(2) : 'n/a';
    window.__farmLog?.(`[ranged-camera] ${state.active ? 'focus ON' : 'focus off'}: ${state.reason}; ${state.itemKey || 'none'}; distance=${distanceText}; focusShoulder=${focusHorizontalOffsetTiles.toFixed(2)}; appliedHorizontal=${horizontalText}; attack camera follows player-facing range point.`, 'combat');
  }

  function installSliderListener() {
    if (sliderListenerInstalled) return true;
    const slider = horizontalSlider();
    if (!slider) return false;
    slider.addEventListener('input', () => {
      if (ownSliderDispatch) return;
      const state = focusState();
      if (!state.combatStance) return;
      const value = Number(slider.value);
      if (Number.isFinite(value)) {
        baseCombatHorizontal = value;
        horizontalModified = false;
      }
    });
    sliderListenerInstalled = true;
    return true;
  }

  function bindFocusControl(slider) {
    if (!slider || slider.dataset?.hobunjiRangedFocusBound === '1') return !!slider;
    if (slider.dataset) slider.dataset.hobunjiRangedFocusBound = '1';
    slider.value = String(focusHorizontalOffsetTiles);
    slider.addEventListener('input', () => setFocusHorizontalOffset(slider.value, true));
    const valueLabel = focusHorizontalValueLabel();
    if (valueLabel) valueLabel.textContent = focusHorizontalOffsetTiles.toFixed(2);
    focusControlInstalled = true;
    return true;
  }

  function installFocusOffsetControl() {
    const existing = focusHorizontalSlider();
    if (existing) return bindFocusControl(existing);
    const combatSlider = horizontalSlider();
    const combatRow = combatSlider?.closest?.('.settings-row') || combatSlider?.parentElement?.parentElement || null;
    if (!combatRow || typeof document.createElement !== 'function') return false;

    const row = document.createElement('label');
    row.className = 'settings-row';
    row.dataset.rangedFocusShoulderSetting = '1';
    row.innerHTML = `
      <div class="settings-label">
        <div class="settings-name">Ranged Focus Shoulder Offset</div>
        <div class="settings-desc">Horizontal shoulder framing used only while a ranged weapon is loaded or being wound up</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="range" id="settingRangedFocusShoulderOffsetH" min="${FOCUS_HORIZONTAL_MIN_TILES}" max="${FOCUS_HORIZONTAL_MAX_TILES}" step="${FOCUS_HORIZONTAL_STEP_TILES}" value="${focusHorizontalOffsetTiles}" style="align-self:center">
        <span id="settingRangedFocusShoulderOffsetHValue" class="settings-slider-value">${focusHorizontalOffsetTiles.toFixed(2)}</span>
      </div>`;
    if (typeof combatRow.insertAdjacentElement === 'function') combatRow.insertAdjacentElement('afterend', row);
    else combatRow.parentElement?.insertBefore?.(row, combatRow.nextSibling || null);
    return bindFocusControl(focusHorizontalSlider());
  }

  function updateCameraFocus(dt) {
    installSliderListener();
    installFocusOffsetControl();
    installMeleeRangeCapture();
    installAttackCameraLookAt();
    installVerticalRangedStance();
    const state = focusState();
    captureCombatHorizontalAfterGameSync(state);
    blend = easeToward(blend, state.active ? 1 : 0, dt);
    if (!state.active && blend < RESTORE_EPSILON) blend = 0;

    const distanceTiles = applyDistance();
    const horizontalOffset = applyHorizontal(state);
    const attackTarget = attackCameraTarget();

    lastState = {
      ...state,
      blend,
      distanceTiles,
      baseDistanceTiles,
      horizontalOffset,
      baseCombatHorizontal,
      focusHorizontalOffsetTiles,
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      horizontalModified,
      focusControlInstalled,
      rangedAimAuthorityInstalled,
      cameraLookAtInstalled,
      meleeRangeCaptureInstalled,
      verticalStanceInstalled,
      aimAlignment: 'camera-to-authoritative-attack-range-point',
      attackCameraTarget: plainAttackTarget(attackTarget),
      activeMeleeRange: activeMeleeRange ? { ...activeMeleeRange } : null,
      verticalStance: lastVerticalStance ? { ...lastVerticalStance } : null,
    };
    logTransition(state, distanceTiles, horizontalOffset);
    previousCombatStance = state.combatStance;
  }

  function install() {
    const ranged = window.RangedWeapons;
    if (!ranged) return false;
    installAuthoritativeRangedAim();
    installVerticalRangedStance();
    installAttackCameraLookAt();
    if (typeof ranged.update !== 'function' || installed) return !!ranged;
    baseUpdate = ranged.update.bind(ranged);
    ranged.update = function rangedUpdateWithCameraFocus(dt) {
      const result = baseUpdate(dt);
      updateCameraFocus(dt);
      return result;
    };
    installed = true;
    installSliderListener();
    installFocusOffsetControl();
    if ((!sliderListenerInstalled || !focusControlInstalled) && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        installSliderListener();
        installFocusOffsetControl();
        installAttackCameraLookAt();
      }, { once: true });
    }
    return true;
  }

  function restoreAuthoredCamera() {
    blend = 0;
    const mode = shoulderModeConfig();
    if (mode && baseDistanceTiles != null) mode.distanceTiles = baseDistanceTiles;
    const state = focusState();
    if (state.combatStance && baseCombatHorizontal != null) dispatchHorizontal(baseCombatHorizontal);
    horizontalModified = false;
  }

  window.HobunjiRangedCameraFocus = {
    version: VERSION,
    install,
    updateCameraFocus,
    restoreAuthoredCamera,
    setFocusHorizontalOffset,
    authoritativeRangedAimRay,
    attackCameraTarget: () => plainAttackTarget(attackCameraTarget()),
    transformCrossbowPose,
    captureMeleeRange,
    snapshot: () => lastState ? { ...lastState } : {
      ...focusState(),
      blend,
      baseDistanceTiles,
      baseCombatHorizontal,
      focusHorizontalOffsetTiles,
      horizontalModified,
      focusControlInstalled,
      rangedAimAuthorityInstalled,
      cameraLookAtInstalled,
      meleeRangeCaptureInstalled,
      verticalStanceInstalled,
      aimAlignment: 'camera-to-authoritative-attack-range-point',
      attackCameraTarget: lastAttackCameraTarget ? { ...lastAttackCameraTarget } : plainAttackTarget(attackCameraTarget()),
      activeMeleeRange: activeMeleeRange ? { ...activeMeleeRange } : null,
      verticalStance: lastVerticalStance ? { ...lastVerticalStance } : null,
    },
    tuning: {
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      get focusHorizontalOffsetTiles() { return focusHorizontalOffsetTiles; },
      defaultFocusHorizontalOffsetTiles: DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES,
      easePerSecond: FOCUS_EASE_PER_SEC,
      crossbowVerticalPitchLimitDeg: CROSSBOW_VERTICAL_PITCH_LIMIT_DEG,
    },
  };
  window.__rangedCameraFocusDebug = window.HobunjiRangedCameraFocus;

  install();
})();
