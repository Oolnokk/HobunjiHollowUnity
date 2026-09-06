// Tight ranged framing plus shared 3D interaction-target aiming.
(() => {
  'use strict';

  const VERSION = 4;
  const SHOULDER_MODE = 'shoulderSurf';
  const TIGHT_DISTANCE_TILES = 1.55; // Used to pull the native shoulder camera inward while a ranged weapon is actually ready.
  const DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES = 0.18; // Used as the ranged-focus-only horizontal shoulder preset until the player authors another value.
  const FOCUS_HORIZONTAL_MIN_TILES = -1; // Used by the ranged-focus Settings slider and validation.
  const FOCUS_HORIZONTAL_MAX_TILES = 1; // Used by the ranged-focus Settings slider and validation.
  const FOCUS_HORIZONTAL_STEP_TILES = 0.05; // Used by the ranged-focus Settings slider for parity with normal shoulder controls.
  const FOCUS_HORIZONTAL_STORAGE_KEY = 'hobunjiRangedFocusShoulderOffsetH'; // Used to persist only the ranged-focus shoulder preset.
  const FOCUS_EASE_PER_SEC = 9; // Used to ease the ready zoom and horizontal shoulder framing without a snap.
  const RESTORE_EPSILON = 0.002; // Used to stop tiny interpolation residue after ranged focus ends.
  const MELEE_RANGE_CAPTURE_PAD_S = 0.12; // Used to retain a windup-authored melee reach through its visible strike.
  const CROSSBOW_VERTICAL_PITCH_LIMIT_DEG = 70; // Used to clamp portrait-orbit stance pitching to the combat vertical-aim envelope.
  const SURFACE_RAY_CACHE_MS = 16; // Used to cap the expensive recursive scene raycast to roughly once per rendered frame.
  const SURFACE_RAY_MAX_WORLD = 40; // Used as the absolute scene-ray ceiling; attack-specific reach still decides which hit may be selected.
  const SURFACE_BEFORE_PLAYER_PAD_WORLD = 0.12; // Used to reject geometry between the camera and player instead of aiming backward into camera occluders.
  const SURFACE_NAME_IGNORE_RE = /(debug|helper|reticle|popup|particle|trail|ground[_ -]?shadow|outline)/i; // Used to exclude obvious non-world helper meshes from the shared aim surface.

  let baseUpdate = null; // Used to preserve the ranged system's existing update before focus/aim bookkeeping runs.
  let baseRangedInit = null; // Used to preserve RangedWeapons.init while replacing only its player aim ray.
  let basePlayerIdlePose = null; // Used to preserve the authored ranged idle stance before adding vertical portrait-orbit rotation.
  let installed = false; // Used to avoid wrapping RangedWeapons.update more than once.
  let rangedAimInstalled = false; // Used to wrap RangedWeapons.init exactly once before game.js injects the normal camera ray.
  let verticalStanceInstalled = false; // Used to wrap playerIdlePose exactly once.
  let meleeAimInstalled = false; // Used to redirect player melee collision/HUD aim to the shared interaction target exactly once.
  let meleeRangeCaptureInstalled = false; // Used to capture real per-attack melee reach once Combat.deps exists.
  let rangedAimDeps = null; // Ranged-specific injected deps retained for projectile origin, interaction ray, and avatar metrics.
  let rawRangedGetPlayerAimRay = null; // Original camera aim ray retained as a fallback if the interaction ray is unavailable.
  let rawRangedGetPlayerInteractionRay = null; // Original 3D interaction ray used as the common player intent ray.
  let rawRangedGetPlayerAimPitch = null; // Original vertical look pitch retained only as a fallback before a resolved target exists.
  let rawMeleeAimDirection = null; // Original melee aim direction retained as a fallback if no interaction target can be built.
  let rawMeleeAimPitch = null; // Original melee pitch retained as a fallback if no interaction target can be built.
  let rawMeleeHit = null; // Original Combat.meleeHit retained so only the player aim direction is overridden.
  let surfaceRaycaster = null; // Reused Three.js raycaster for first-visible-surface resolution.
  let surfaceRayCache = null; // Same-frame cache of filtered scene hits for the current centered interaction ray.
  let blend = 0; // Used to drive current ranged-focus interpolation from 0 (normal) to 1 (tight).
  let baseDistanceTiles = null; // Used to restore the authored shoulder-camera distance after ranged focus ends.
  let baseCombatHorizontal = null; // Used to restore the player's authored Combat horizontal shoulder offset after ranged focus ends.
  let focusHorizontalOffsetTiles = loadFocusHorizontalOffset(); // Used as the independent ranged-focus horizontal target.
  let horizontalModified = false; // Used to know whether the temporary Combat shoulder value still needs restoration.
  let previousCombatStance = false; // Used to detect a fresh melee/ranged stance entry for Combat slider capture.
  let combatCapturePending = false; // Used to wait one frame for game.js to sync its Combat shoulder preset before capturing it.
  let ownSliderDispatch = false; // Used to distinguish synthetic focus writes from player-authored Settings changes.
  let sliderListenerInstalled = false; // Used to bind the existing Combat shoulder slider once.
  let focusControlInstalled = false; // Used to create/bind the separate ranged-focus slider once.
  let activeMeleeRange = null; // Latest real melee attack reach captured at windup/release, overriding idle combo reach while active.
  let lastResolvedAimTarget = null; // Mobile-readable copy of the most recently resolved ranged/melee interaction target.
  let lastVerticalStance = null; // Mobile-readable copy of the latest crossbow/scatterbow portrait-orbit transform.
  let lastFocusSignature = ''; // Used to keep the in-game debug log transition-only instead of per-frame spam.
  let lastState = null; // Used by snapshot() for mobile/debug inspection without recomputing state mid-frame.

  function three() { return window.THREE || null; }
  function nowMs() { return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(); }
  function shoulderModeConfig() { return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null; }
  function horizontalSlider() { return document.getElementById('settingShoulderSurfOffsetH'); }
  function focusHorizontalSlider() { return document.getElementById('settingRangedFocusShoulderOffsetH'); }
  function focusHorizontalValueLabel() { return document.getElementById('settingRangedFocusShoulderOffsetHValue'); }
  function combatDeps() { return window.Combat?.deps || null; }

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

  function vectorFrom(raw) {
    const THREE = three();
    if (!THREE?.Vector3 || !raw || ![raw.x, raw.y, raw.z].every(Number.isFinite)) return null;
    return new THREE.Vector3(Number(raw.x), Number(raw.y), Number(raw.z));
  }

  function plainVector(vector) {
    return vector ? { x: Number(vector.x) || 0, y: Number(vector.y) || 0, z: Number(vector.z) || 0 } : null;
  }

  function distanceBetween(a, b) {
    if (!a || !b) return Infinity;
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y), Number(a.z) - Number(b.z));
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

  function playerMeleeOrigin() {
    const deps = combatDeps();
    const THREE = three();
    if (!deps?.player || !THREE?.Vector3) return null;
    const hitboxCenter = window.RangedWeapons?.actorHitbox?.(deps.player)?.center;
    if (hitboxCenter?.clone) return hitboxCenter.clone();
    const tile = Number(deps.TILE) || 64;
    return new THREE.Vector3(
      (Number(deps.player.x) || 0) / tile,
      playerWorldBaseY(deps) + 0.45,
      (Number(deps.player.y) || 0) / tile,
    );
  }

  function rawInteractionRay() {
    const raw = rawRangedGetPlayerInteractionRay?.()
      || combatDeps()?.getPlayerInteractionRay?.()
      || rawRangedGetPlayerAimRay?.();
    const origin = vectorFrom(raw?.origin);
    const direction = vectorFrom(raw?.direction);
    if (!origin || !direction || direction.lengthSq() < 1e-8) return null;
    direction.normalize();
    return { origin, direction };
  }

  function isDescendantOf(object, root) {
    if (!object || !root) return false;
    let node = object;
    while (node) {
      if (node === root) return true;
      node = node.parent || null;
    }
    return false;
  }

  function hierarchyHasIgnoredName(object) {
    let node = object;
    while (node) {
      if (SURFACE_NAME_IGNORE_RE.test(String(node.name || ''))) return true;
      if (node.userData?.interactionAimIgnore === true || node.userData?.debugOnly === true) return true;
      node = node.parent || null;
    }
    return false;
  }

  function hierarchyVisible(object) {
    let node = object;
    while (node) {
      if (node.visible === false) return false;
      node = node.parent || null;
    }
    return true;
  }

  function materialCanBeSurface(object) {
    const materials = Array.isArray(object?.material) ? object.material : object?.material ? [object.material] : [];
    if (!materials.length) return true;
    return materials.some(material => material && material.visible !== false && (material.opacity == null || Number(material.opacity) > 0.01));
  }

  function playerOwnedAimMesh(object) {
    const avatar = rangedAimDeps?.getPlayerAvatarGroup?.() || null;
    const tool = combatDeps()?.toolHolder?.() || null;
    return isDescendantOf(object, avatar) || isDescendantOf(object, tool);
  }

  function validSurfaceHit(hit) {
    const object = hit?.object;
    if (!object?.isMesh || !hit?.point || !Number.isFinite(Number(hit.distance))) return false;
    if (!hierarchyVisible(object) || !materialCanBeSurface(object)) return false;
    if (playerOwnedAimMesh(object) || hierarchyHasIgnoredName(object)) return false;
    return true;
  }

  function interactionRaySignature(ray) {
    if (!ray) return '';
    return [ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z]
      .map(value => Number(value).toFixed(4)).join('|');
  }

  function cachedSurfaceHits(ray) {
    const THREE = three();
    const scene = combatDeps()?.getActiveScene?.() || rangedAimDeps?.getActiveScene?.() || null;
    if (!THREE?.Raycaster || !scene?.children || !ray) return [];
    const at = nowMs();
    const signature = interactionRaySignature(ray);
    if (surfaceRayCache && surfaceRayCache.scene === scene && surfaceRayCache.signature === signature && at - surfaceRayCache.at <= SURFACE_RAY_CACHE_MS) {
      return surfaceRayCache.hits;
    }
    if (!surfaceRaycaster) surfaceRaycaster = new THREE.Raycaster();
    surfaceRaycaster.set(ray.origin, ray.direction);
    surfaceRaycaster.near = 0;
    surfaceRaycaster.far = SURFACE_RAY_MAX_WORLD;
    const hits = surfaceRaycaster.intersectObjects(scene.children, true).filter(validSurfaceHit);
    surfaceRayCache = { scene, signature, at, hits };
    return hits;
  }

  function surfaceLabel(object) {
    let node = object;
    while (node) {
      if (node.name) return String(node.name);
      node = node.parent || null;
    }
    return object?.type || 'mesh';
  }

  function resolveInteractionAimTarget(maxRangeWorld, attackOrigin, metadata = {}) {
    const ray = rawInteractionRay();
    if (!ray || !attackOrigin || !Number.isFinite(Number(maxRangeWorld)) || Number(maxRangeWorld) <= 0) return null;
    const range = Number(maxRangeWorld);
    const dx = attackOrigin.x - ray.origin.x;
    const dy = attackOrigin.y - ray.origin.y;
    const dz = attackOrigin.z - ray.origin.z;
    const alongToAttack = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z;
    const fallbackRayDistance = Math.max(0.5, alongToAttack + range);
    const minimumSurfaceDistance = Math.max(0, alongToAttack - SURFACE_BEFORE_PLAYER_PAD_WORLD);
    const hits = cachedSurfaceHits(ray);
    const hit = hits.find(candidate => candidate.distance >= minimumSurfaceDistance && candidate.distance <= fallbackRayDistance + 1e-4) || null;
    const point = hit?.point?.clone?.() || ray.origin.clone().addScaledVector(ray.direction, fallbackRayDistance);
    let direction = point.clone().sub(attackOrigin);
    if (direction.lengthSq() < 1e-8) direction = ray.direction.clone();
    else direction.normalize();
    const target = {
      ...metadata,
      source: hit ? 'interaction-first-surface' : 'interaction-range-fallback',
      maxRangeWorld: range,
      rayOrigin: ray.origin,
      rayDirection: ray.direction,
      attackOrigin,
      point,
      direction,
      rayDistance: hit ? Number(hit.distance) : fallbackRayDistance,
      attackDistance: distanceBetween(attackOrigin, point),
      surfaceName: hit ? surfaceLabel(hit.object) : null,
    };
    lastResolvedAimTarget = plainAimTarget(target);
    return target;
  }

  function plainAimTarget(target) {
    if (!target) return null;
    return {
      mode: target.mode || null,
      itemKey: target.itemKey || null,
      source: target.source || null,
      maxRangeWorld: Number(target.maxRangeWorld) || 0,
      rangeTiles: target.rangeTiles ?? null,
      rangePx: target.rangePx ?? null,
      rayOrigin: plainVector(target.rayOrigin),
      rayDirection: plainVector(target.rayDirection),
      attackOrigin: plainVector(target.attackOrigin),
      point: plainVector(target.point),
      direction: plainVector(target.direction),
      rayDistance: Number(target.rayDistance) || 0,
      attackDistance: Number(target.attackDistance) || 0,
      surfaceName: target.surfaceName || null,
    };
  }

  function rangedInteractionAimTarget(itemKey = window.RangedWeapons?.equippedRangedKey?.()) {
    const def = itemKey ? window.RangedWeapons?.config?.[itemKey] : null;
    const rangeTiles = Number(def?.rangeTiles);
    const origin = playerProjectileOrigin(rangedAimDeps || combatDeps());
    if (!itemKey || !origin || !Number.isFinite(rangeTiles) || rangeTiles <= 0) return null;
    return resolveInteractionAimTarget(rangeTiles, origin, { mode: 'ranged', itemKey, rangeTiles });
  }

  function rangedInteractionAimRay() {
    const target = rangedInteractionAimTarget();
    if (target?.attackOrigin && target?.direction) return { origin: target.attackOrigin.clone(), direction: target.direction.clone() };
    return rawRangedGetPlayerAimRay?.() || rawRangedGetPlayerInteractionRay?.() || null;
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
    const maxStepMul = Array.isArray(steps) && steps.length ? Math.max(...steps.map(step => Number(step?.rangeMul) || 1)) : 1;
    const effects = window.CombatProgression?.getEffects?.(deps?.currentWeaponKey?.(), comboId) || { stats: {} };
    return baseRange * maxStepMul * scale * (1 + (Number(effects?.stats?.rangeMul) || 0));
  }

  function meleeInteractionAimTarget() {
    const deps = combatDeps();
    const origin = playerMeleeOrigin();
    if (!deps?.player || !origin) return null;
    const rangePx = currentMeleeRangePx();
    const tile = Number(deps.TILE) || 64;
    const rangeTiles = Math.max(0.05, rangePx / tile);
    return resolveInteractionAimTarget(rangeTiles, origin, {
      mode: 'melee',
      itemKey: deps.currentWeaponKey?.() || null,
      rangeTiles,
      rangePx,
    });
  }

  function rangedResolvedAimPitch() {
    const target = rangedInteractionAimTarget();
    if (target?.direction) return Math.asin(Math.max(-1, Math.min(1, target.direction.y)));
    const fallback = Number(rawRangedGetPlayerAimPitch?.());
    return Number.isFinite(fallback) ? fallback : 0;
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
    return { toolBaseY, portraitPivotY: portraitCenterY - playerBaseY };
  }

  function transformCrossbowPose(basePose, pitchRad = rangedResolvedAimPitch()) {
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
    ranged.playerIdlePose = function interactionAimAwarePlayerIdlePose(itemKey) {
      const pose = basePlayerIdlePose(itemKey);
      if (!pose || !heldState().rangedOut || !isCrossbowStyle(itemKey) || ranged.isLoaded?.(itemKey) !== true) return pose;
      return transformCrossbowPose(pose);
    };
    verticalStanceInstalled = true;
    return true;
  }

  function installInteractionRangedAim() {
    const ranged = window.RangedWeapons;
    if (rangedAimInstalled || typeof ranged?.init !== 'function') return rangedAimInstalled;
    baseRangedInit = ranged.init.bind(ranged);
    ranged.init = function interactionTargetRangedInit(injectedDeps) {
      rawRangedGetPlayerAimRay = injectedDeps?.getPlayerAimRay || null;
      rawRangedGetPlayerInteractionRay = injectedDeps?.getPlayerInteractionRay || null;
      rawRangedGetPlayerAimPitch = injectedDeps?.getPlayerAimPitch || null;
      const rawTriggerRangedWeaponVisual = injectedDeps?.triggerRangedWeaponVisual;
      const wrappedDeps = {
        ...injectedDeps,
        getPlayerAimRay: () => rangedInteractionAimRay(),
      };
      if (typeof rawTriggerRangedWeaponVisual === 'function') {
        wrappedDeps.triggerRangedWeaponVisual = function interactionAimAwareRangedVisual(durationS, options = {}) {
          const itemKey = injectedDeps?.getEquippedRangedKey?.();
          const loadedFire = itemKey && isCrossbowStyle(itemKey) && window.RangedWeapons?.isLoaded?.(itemKey) === true;
          const nextOptions = loadedFire && options?.pose ? { ...options, pose: transformCrossbowPoseSet(options.pose) } : options;
          return rawTriggerRangedWeaponVisual(durationS, nextOptions);
        };
      }
      rangedAimDeps = wrappedDeps;
      return baseRangedInit(wrappedDeps);
    };
    rangedAimInstalled = true;
    return true;
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
      deps.triggerWeaponSwingVisual = function interactionRangeAwareSwing(durationS, options = {}) {
        captureMeleeRange(options?.coneRangePx, Number(durationS) + (Number(options?.holdS) || 0), 'swing-windup');
        return rawSwing.apply(this, arguments);
      };
    }
    const rawHold = deps.triggerWeaponHoldVisual;
    if (typeof rawHold === 'function') {
      deps.triggerWeaponHoldVisual = function interactionRangeAwareHold(durationS, options = {}) {
        captureMeleeRange(options?.coneRangePx, Number(durationS) + (Number(options?.holdS) || 0), 'hold-windup');
        return rawHold.apply(this, arguments);
      };
    }
    const rawLunge = deps.beginCombatLunge;
    if (typeof rawLunge === 'function') {
      deps.beginCombatLunge = function interactionRangeAwareLunge(distancePx, durationS, hopUnits, options = {}) {
        captureMeleeRange(options?.rangePx, durationS, 'lunge/strike');
        return rawLunge.apply(this, arguments);
      };
    }
    meleeRangeCaptureInstalled = typeof rawSwing === 'function' || typeof rawHold === 'function' || typeof rawLunge === 'function';
    return meleeRangeCaptureInstalled;
  }

  function installInteractionMeleeAim() {
    const deps = combatDeps();
    if (!deps || meleeAimInstalled) return meleeAimInstalled;
    rawMeleeAimDirection = deps.getPlayerMeleeAimDirection;
    rawMeleeAimPitch = deps.getPlayerMeleeAimPitch;
    deps.getPlayerMeleeAimDirection = function sharedInteractionMeleeDirection() {
      const target = meleeInteractionAimTarget();
      return target?.direction ? plainVector(target.direction) : rawMeleeAimDirection?.();
    };
    deps.getPlayerMeleeAimPitch = function sharedInteractionMeleePitch() {
      const target = meleeInteractionAimTarget();
      return target?.direction ? Math.asin(Math.max(-1, Math.min(1, target.direction.y))) : (rawMeleeAimPitch?.() || 0);
    };
    if (!rawMeleeHit && typeof window.Combat?.meleeHit === 'function') {
      rawMeleeHit = window.Combat.meleeHit.bind(window.Combat);
      window.Combat.meleeHit = function interactionTargetMeleeHit(attacker, targetActor, options = {}) {
        if (attacker === deps.player) {
          const target = meleeInteractionAimTarget();
          if (target?.direction) options = { ...options, direction: plainVector(target.direction) };
        }
        return rawMeleeHit(attacker, targetActor, options);
      };
    }
    meleeAimInstalled = true;
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

  function logTransition(state, distanceTiles, horizontalOffset) {
    const signature = `${state.active ? 1 : 0}|${state.reason}|${state.itemKey || '-'}|${state.rangedType}`;
    if (signature === lastFocusSignature) return;
    lastFocusSignature = signature;
    const distanceText = Number.isFinite(distanceTiles) ? distanceTiles.toFixed(2) : 'n/a';
    const horizontalText = Number.isFinite(horizontalOffset) ? horizontalOffset.toFixed(2) : 'n/a';
    window.__farmLog?.(`[ranged-camera] ${state.active ? 'focus ON' : 'focus off'}: ${state.reason}; ${state.itemKey || 'none'}; distance=${distanceText}; focusShoulder=${focusHorizontalOffsetTiles.toFixed(2)}; appliedHorizontal=${horizontalText}; native camera untouched; attacks use shared 3D interaction target.`, 'combat');
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
    installInteractionMeleeAim();
    installVerticalRangedStance();
    const state = focusState();
    captureCombatHorizontalAfterGameSync(state);
    blend = easeToward(blend, state.active ? 1 : 0, dt);
    if (!state.active && blend < RESTORE_EPSILON) blend = 0;
    const distanceTiles = applyDistance();
    const horizontalOffset = applyHorizontal(state);
    const aimTarget = state.rangedOut ? rangedInteractionAimTarget(state.itemKey) : state.meleeOut ? meleeInteractionAimTarget() : null;
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
      rangedAimInstalled,
      meleeAimInstalled,
      meleeRangeCaptureInstalled,
      verticalStanceInstalled,
      cameraMutation: 'native-shoulder-camera-only',
      aimAlignment: 'shared-3d-interaction-target-native-camera',
      interactionAimTarget: plainAimTarget(aimTarget),
      activeMeleeRange: activeMeleeRange ? { ...activeMeleeRange } : null,
      verticalStance: lastVerticalStance ? { ...lastVerticalStance } : null,
    };
    logTransition(state, distanceTiles, horizontalOffset);
    previousCombatStance = state.combatStance;
  }

  function install() {
    const ranged = window.RangedWeapons;
    if (!ranged) return false;
    installInteractionRangedAim();
    installVerticalRangedStance();
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

  function currentInteractionAimTarget() {
    const state = heldState();
    if (state.rangedOut) return plainAimTarget(rangedInteractionAimTarget());
    if (state.meleeOut) return plainAimTarget(meleeInteractionAimTarget());
    return null;
  }

  window.HobunjiRangedCameraFocus = {
    version: VERSION,
    install,
    updateCameraFocus,
    restoreAuthoredCamera,
    setFocusHorizontalOffset,
    rangedInteractionAimRay,
    interactionAimTarget: currentInteractionAimTarget,
    attackCameraTarget: currentInteractionAimTarget,
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
      rangedAimInstalled,
      meleeAimInstalled,
      meleeRangeCaptureInstalled,
      verticalStanceInstalled,
      cameraMutation: 'native-shoulder-camera-only',
      aimAlignment: 'shared-3d-interaction-target-native-camera',
      interactionAimTarget: lastResolvedAimTarget ? { ...lastResolvedAimTarget } : currentInteractionAimTarget(),
      activeMeleeRange: activeMeleeRange ? { ...activeMeleeRange } : null,
      verticalStance: lastVerticalStance ? { ...lastVerticalStance } : null,
    },
    tuning: {
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      get focusHorizontalOffsetTiles() { return focusHorizontalOffsetTiles; },
      defaultFocusHorizontalOffsetTiles: DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES,
      easePerSecond: FOCUS_EASE_PER_SEC,
      crossbowVerticalPitchLimitDeg: CROSSBOW_VERTICAL_PITCH_LIMIT_DEG,
      surfaceRayCacheMs: SURFACE_RAY_CACHE_MS,
      surfaceRayMaxWorld: SURFACE_RAY_MAX_WORLD,
    },
  };
  window.__rangedCameraFocusDebug = window.HobunjiRangedCameraFocus;

  install();
})();
