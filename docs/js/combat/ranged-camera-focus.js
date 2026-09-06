// Tight ranged framing plus shared, fail-safe, change-driven 3D interaction-target aiming.
(() => {
  'use strict';

  const VERSION = 6;
  const SHOULDER_MODE = 'shoulderSurf';
  const TIGHT_DISTANCE_TILES = 1.55; // Used to pull only the native shoulder-camera distance inward while a ranged weapon is ready.
  const DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES = 0.18; // Used as the ranged-focus-only horizontal shoulder preset until the player authors another value.
  const FOCUS_HORIZONTAL_MIN_TILES = -1; // Used by the ranged-focus Settings slider and validation.
  const FOCUS_HORIZONTAL_MAX_TILES = 1; // Used by the ranged-focus Settings slider and validation.
  const FOCUS_HORIZONTAL_STEP_TILES = 0.05; // Used by the ranged-focus Settings slider for parity with normal shoulder controls.
  const FOCUS_HORIZONTAL_STORAGE_KEY = 'hobunjiRangedFocusShoulderOffsetH'; // Used to persist only the ranged-focus shoulder preset.
  const FOCUS_EASE_PER_SEC = 9; // Used to ease ready zoom and horizontal shoulder framing without a snap.
  const RESTORE_EPSILON = 0.002; // Used to snap settled focus interpolation and stop steady-state writes.
  const CAMERA_WRITE_EPSILON = 0.0005; // Used to avoid rewriting native camera config when the desired distance has not materially changed.
  const SHOULDER_WRITE_EPSILON = 0.001; // Used to avoid dispatching synthetic shoulder-slider input while the desired value is unchanged.
  const MELEE_RANGE_CAPTURE_PAD_S = 0.12; // Used to retain a windup-authored melee reach through its visible strike.
  const CROSSBOW_VERTICAL_PITCH_LIMIT_DEG = 70; // Used to clamp portrait-orbit stance pitching to the combat vertical-aim envelope.
  const SURFACE_RAY_MAX_WORLD = 40; // Used as an absolute scene-ray ceiling; attack reach still decides which surface can be selected.
  const SURFACE_BEFORE_PLAYER_PAD_WORLD = 0.12; // Used to reject camera-side geometry before the player's attack origin.
  const RAY_ORIGIN_QUANTUM_WORLD = 0.02; // Used to treat tiny camera-origin jitter below two hundredths of a tile as the same aim input.
  const RAY_DIRECTION_QUANTUM = 0.001; // Used to treat sub-tenth-degree direction jitter as the same aim input.
  const ATTACK_ORIGIN_QUANTUM_WORLD = 0.02; // Used to invalidate aim only after the player/muzzle has moved materially in world space.
  const SURFACE_NAME_IGNORE_RE = /(debug|helper|reticle|popup|particle|trail|ground[_ -]?shadow|outline)/i; // Used to exclude obvious non-world helper meshes.

  let baseUpdate = null; // Preserves the ranged system's existing update before lightweight focus bookkeeping runs.
  let baseRangedInit = null; // Preserves RangedWeapons.init while replacing only its player aim ray.
  let basePlayerIdlePose = null; // Preserves the authored ranged idle stance before adding vertical portrait-orbit rotation.
  let installed = false; // Prevents wrapping RangedWeapons.update more than once.
  let rangedAimInstalled = false; // Prevents wrapping RangedWeapons.init more than once.
  let verticalStanceInstalled = false; // Prevents wrapping playerIdlePose more than once.
  let combatInitBridgeInstalled = false; // Prevents wrapping Combat.init more than once for one-time melee hook installation.
  let meleeAimInstalled = false; // Prevents wrapping player melee aim/collision more than once.
  let meleeRangeCaptureInstalled = false; // Prevents wrapping shared melee range reports more than once.
  let rangedAimDeps = null; // Stores ranged-specific injected deps for projectile origin, interaction ray, scene and avatar metrics.
  let rawRangedGetPlayerAimRay = null; // Stores the original camera aim ray as a last-resort fallback.
  let rawRangedGetPlayerInteractionRay = null; // Stores the original centered 3D interaction ray as the common player-intent ray.
  let rawRangedGetPlayerAimPitch = null; // Stores original vertical look pitch for fallback before a resolved target exists.
  let rawMeleeAimDirection = null; // Stores original melee aim direction for fail-safe fallback.
  let rawMeleeAimPitch = null; // Stores original melee pitch for fail-safe fallback.
  let rawMeleeHit = null; // Stores original Combat.meleeHit so only player direction is decorated.
  let surfaceRaycaster = null; // Reused Three.js raycaster for first-visible-surface resolution.
  let surfaceRayCache = null; // Persistent surface-hit cache, invalidated only when scene/ray inputs actually change.
  let aimTargetCache = null; // Persistent resolved-target cache, invalidated only when ray/player/range/item/scene inputs change.
  let surfaceInvalidationSerial = 0; // Used to force a fresh scene raycast after an explicit world/scene invalidation.
  let targetInvalidationSerial = 0; // Used to force a fresh resolved target after an attack/range invalidation without necessarily reraycasting the scene.
  let lastAimInvalidation = 'boot'; // Mobile-readable reason the cached combat aim was last invalidated.
  let surfaceRaycastCount = 0; // Mobile-readable count of actual expensive scene raycasts since module load.
  let surfaceCacheHitCount = 0; // Mobile-readable count of surface queries satisfied without reraycasting the scene.
  let targetResolveCount = 0; // Mobile-readable count of actual resolved-target rebuilds since module load.
  let targetCacheHitCount = 0; // Mobile-readable count of target queries satisfied from the persistent cache.
  let lastAimError = null; // Mobile-readable record of the latest caught aim resolver error.
  let lastAimErrorSignature = ''; // Prevents the same bad scene node from spamming the in-game log.
  let blend = 0; // Drives current ranged-focus interpolation from 0 normal to 1 tight.
  let baseDistanceTiles = null; // Restores authored shoulder-camera distance after ranged focus ends.
  let baseCombatHorizontal = null; // Restores the player's authored Combat horizontal shoulder offset after focus ends.
  let focusHorizontalOffsetTiles = loadFocusHorizontalOffset(); // Independent ranged-focus horizontal target.
  let horizontalModified = false; // Tracks whether temporary Combat shoulder framing still needs restoration.
  let previousCombatStance = false; // Detects fresh melee/ranged stance entry for Combat slider capture.
  let combatCapturePending = false; // Waits one frame for game.js to sync its Combat shoulder preset before capture.
  let ownSliderDispatch = false; // Distinguishes synthetic focus writes from player-authored Settings changes.
  let sliderListenerInstalled = false; // Binds the existing Combat shoulder slider once.
  let focusControlInstalled = false; // Creates/binds the separate ranged-focus slider once.
  let activeMeleeRange = null; // Latest real melee attack reach captured at windup/release.
  let lastResolvedAimTarget = null; // Mobile-readable copy of the latest resolved ranged/melee interaction target.
  let lastVerticalStance = null; // Mobile-readable copy of the latest crossbow/scatterbow portrait-orbit transform.
  let lastFocusSignature = ''; // Keeps in-game focus logging transition-only.
  let lastAppliedDistance = null; // Used to avoid steady-state writes to Shoulder Cam distance.
  let lastAppliedHorizontal = null; // Used to avoid steady-state synthetic shoulder-slider events.
  let lastFocusSnapshotInputs = null; // Cheap per-frame refs (no cloning) for the debug snapshot() below; only cloned on demand when actually queried.

  function three() { return window.THREE || null; }
  function nowMs() { return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(); }
  function shoulderModeConfig() { return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null; }
  function horizontalSlider() { return document.getElementById('settingShoulderSurfOffsetH'); }
  function focusHorizontalSlider() { return document.getElementById('settingRangedFocusShoulderOffsetH'); }
  function focusHorizontalValueLabel() { return document.getElementById('settingRangedFocusShoulderOffsetHValue'); }
  function combatDeps() { return window.Combat?.deps || null; }

  function errorText(error) {
    return String(error?.stack || error?.message || error || 'unknown error');
  }

  function noteAimError(stage, error, object = null) {
    const objectLabel = String(object?.name || object?.type || object?.constructor?.name || 'unknown-root');
    const detail = errorText(error);
    const signature = `${stage}|${objectLabel}|${detail}`;
    lastAimError = { at: Date.now(), stage, object: objectLabel, detail };
    if (signature === lastAimErrorSignature) return;
    lastAimErrorSignature = signature;
    window.__farmLog?.(`[combat-aim] ${stage} skipped ${objectLabel}: ${detail}`, 'warn', 'combat');
  }

  function invalidateAimTarget(reason = 'manual', includeSurface = false) {
    targetInvalidationSerial++;
    aimTargetCache = null;
    lastAimInvalidation = String(reason || 'manual');
    if (includeSurface) {
      surfaceInvalidationSerial++;
      surfaceRayCache = null;
    }
    return true;
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

  function quantized(value, quantum) {
    const number = Number(value) || 0;
    const step = Number(quantum) || 1;
    return Math.round(number / step);
  }

  function vectorSignature(vector, quantum) {
    if (!vector) return '-';
    return `${quantized(vector.x, quantum)},${quantized(vector.y, quantum)},${quantized(vector.z, quantum)}`;
  }

  function interactionRaySignature(ray) {
    if (!ray) return '';
    return `${vectorSignature(ray.origin, RAY_ORIGIN_QUANTUM_WORLD)}|${vectorSignature(ray.direction, RAY_DIRECTION_QUANTUM)}`;
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
    try {
      const hitboxCenter = window.RangedWeapons?.actorHitbox?.(deps.player)?.center;
      if (hitboxCenter?.clone) return hitboxCenter.clone();
    } catch (error) {
      noteAimError('player-melee-origin', error);
    }
    const tile = Number(deps.TILE) || 64;
    return new THREE.Vector3(
      (Number(deps.player.x) || 0) / tile,
      playerWorldBaseY(deps) + 0.45,
      (Number(deps.player.y) || 0) / tile,
    );
  }

  function rawInteractionRay() {
    let raw = null;
    try {
      raw = rawRangedGetPlayerInteractionRay?.()
        || combatDeps()?.getPlayerInteractionRay?.()
        || rawRangedGetPlayerAimRay?.();
    } catch (error) {
      noteAimError('interaction-ray', error);
      try { raw = rawRangedGetPlayerAimRay?.() || null; } catch (_) { raw = null; }
    }
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

  function playerAimRoots() {
    const roots = [];
    try {
      const avatar = rangedAimDeps?.getPlayerAvatarGroup?.();
      if (avatar) roots.push(avatar);
    } catch (error) {
      noteAimError('player-avatar-root', error);
    }
    try {
      const tool = combatDeps()?.toolHolder?.();
      if (tool) roots.push(tool);
    } catch (error) {
      noteAimError('player-tool-root', error);
    }
    return roots;
  }

  function validSurfaceHit(hit, ignoredRoots) {
    const object = hit?.object;
    if (!object?.isMesh || !hit?.point || !Number.isFinite(Number(hit.distance))) return false;
    if (!hierarchyVisible(object) || !materialCanBeSurface(object) || hierarchyHasIgnoredName(object)) return false;
    if ((ignoredRoots || []).some(root => isDescendantOf(object, root))) return false;
    return true;
  }

  function activeScene() {
    try {
      return combatDeps()?.getActiveScene?.()
        || rangedAimDeps?.getActiveScene?.()
        || window.GridTileAccessors?.getActiveScene?.()
        || null;
    } catch (error) {
      noteAimError('active-scene', error);
      return null;
    }
  }

  function cachedSurfaceHits(ray, scene = activeScene()) {
    const THREE = three();
    if (!THREE?.Raycaster || !scene?.children || !ray) return [];
    const raySignature = interactionRaySignature(ray);
    const rootCount = scene.children.length;
    if (
      surfaceRayCache
      && surfaceRayCache.scene === scene
      && surfaceRayCache.raySignature === raySignature
      && surfaceRayCache.rootCount === rootCount
      && surfaceRayCache.serial === surfaceInvalidationSerial
    ) {
      surfaceCacheHitCount++;
      return surfaceRayCache.hits;
    }

    if (!surfaceRaycaster) surfaceRaycaster = new THREE.Raycaster();
    const ignoredRoots = playerAimRoots();
    const hits = [];
    try {
      surfaceRaycaster.set(ray.origin, ray.direction);
      surfaceRaycaster.near = 0;
      surfaceRaycaster.far = SURFACE_RAY_MAX_WORLD;
    } catch (error) {
      noteAimError('surface-ray-setup', error);
      surfaceRayCache = { scene, raySignature, rootCount, serial: surfaceInvalidationSerial, hits };
      return hits;
    }

    surfaceRaycastCount++;
    // Raycast each top-level scene root independently. One malformed/custom
    // scene node can throw inside Three.js; isolating roots lets us skip only
    // that root and keep the rest of combat + the native camera alive.
    for (const root of Array.from(scene.children)) {
      if (!root || ignoredRoots.some(owned => isDescendantOf(owned, root))) continue;
      const localHits = [];
      try {
        surfaceRaycaster.intersectObject(root, true, localHits);
      } catch (error) {
        noteAimError('surface-ray-root', error, root);
        continue;
      }
      for (const hit of localHits) {
        try {
          if (validSurfaceHit(hit, ignoredRoots)) hits.push(hit);
        } catch (error) {
          noteAimError('surface-hit-filter', error, hit?.object || root);
        }
      }
    }
    hits.sort((a, b) => Number(a.distance) - Number(b.distance));
    surfaceRayCache = { scene, raySignature, rootCount, serial: surfaceInvalidationSerial, hits };
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

  function resolveInteractionAimTarget(maxRangeWorld, attackOrigin, metadata = {}) {
    const ray = rawInteractionRay();
    const scene = activeScene();
    if (!ray || !attackOrigin || !Number.isFinite(Number(maxRangeWorld)) || Number(maxRangeWorld) <= 0) return null;
    try {
      const range = Number(maxRangeWorld);
      const raySignature = interactionRaySignature(ray);
      const attackOriginSignature = vectorSignature(attackOrigin, ATTACK_ORIGIN_QUANTUM_WORLD);
      const mode = metadata.mode || '-';
      const itemKey = metadata.itemKey || '-';
      const rangeSignature = Math.round(range * 10000);
      const rootCount = Number(scene?.children?.length) || 0;
      const targetKey = `${mode}|${itemKey}|${rangeSignature}|${raySignature}|${attackOriginSignature}|${rootCount}|${targetInvalidationSerial}`;
      if (
        aimTargetCache
        && aimTargetCache.scene === scene
        && aimTargetCache.surfaceSerial === surfaceInvalidationSerial
        && aimTargetCache.key === targetKey
      ) {
        targetCacheHitCount++;
        return aimTargetCache.target;
      }

      targetResolveCount++;
      const dx = attackOrigin.x - ray.origin.x;
      const dy = attackOrigin.y - ray.origin.y;
      const dz = attackOrigin.z - ray.origin.z;
      const alongToAttack = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z;
      const fallbackRayDistance = Math.max(0.5, alongToAttack + range);
      const minimumSurfaceDistance = Math.max(0, alongToAttack - SURFACE_BEFORE_PLAYER_PAD_WORLD);
      const hits = cachedSurfaceHits(ray, scene);
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
      aimTargetCache = { scene, surfaceSerial: surfaceInvalidationSerial, key: targetKey, target };
      lastResolvedAimTarget = plainAimTarget(target);
      return target;
    } catch (error) {
      noteAimError('resolve-target', error);
      try {
        const range = Number(maxRangeWorld);
        const point = attackOrigin.clone().addScaledVector(ray.direction, range);
        const fallback = {
          ...metadata,
          source: 'interaction-safe-fallback',
          maxRangeWorld: range,
          rayOrigin: ray.origin,
          rayDirection: ray.direction,
          attackOrigin,
          point,
          direction: ray.direction.clone(),
          rayDistance: range,
          attackDistance: range,
          surfaceName: null,
        };
        lastResolvedAimTarget = plainAimTarget(fallback);
        return fallback;
      } catch (_) {
        return null;
      }
    }
  }

  function rangedInteractionAimTarget(itemKey = window.RangedWeapons?.equippedRangedKey?.()) {
    try {
      if (!heldState().rangedOut) return null;
      const def = itemKey ? window.RangedWeapons?.config?.[itemKey] : null;
      const rangeTiles = Number(def?.rangeTiles);
      const origin = playerProjectileOrigin(rangedAimDeps || combatDeps());
      if (!itemKey || !origin || !Number.isFinite(rangeTiles) || rangeTiles <= 0) return null;
      return resolveInteractionAimTarget(rangeTiles, origin, { mode: 'ranged', itemKey, rangeTiles });
    } catch (error) {
      noteAimError('ranged-target', error);
      return null;
    }
  }

  function rangedInteractionAimRay() {
    try {
      const target = rangedInteractionAimTarget();
      if (target?.attackOrigin && target?.direction) return { origin: target.attackOrigin.clone(), direction: target.direction.clone() };
    } catch (error) {
      noteAimError('ranged-ray', error);
    }
    try { return rawRangedGetPlayerAimRay?.() || rawRangedGetPlayerInteractionRay?.() || null; }
    catch (_) { return null; }
  }

  function currentMeleeRangePx() {
    if (activeMeleeRange && activeMeleeRange.expiresAt >= nowMs()) return activeMeleeRange.rangePx;
    if (activeMeleeRange) {
      activeMeleeRange = null;
      invalidateAimTarget('melee-range-expired', false);
    }
    const deps = combatDeps();
    try {
      const comboId = window.Combat?.loadout?.getSlot?.('tap1') || deps?.currentComboAbilityId?.() || 'swingCombo';
      const steps = window.Combat?.comboData?.[comboId];
      const baseRange = Number(deps?.weaponAbility?.('cut')?.rangePx) || (Number(deps?.TILE) || 64) * 1.05;
      const rangeScale = Number(window.Combat?.comboData?.RANGE_SCALE);
      const scale = Number.isFinite(rangeScale) ? rangeScale : 1;
      const maxStepMul = Array.isArray(steps) && steps.length ? Math.max(...steps.map(step => Number(step?.rangeMul) || 1)) : 1;
      const effects = window.CombatProgression?.getEffects?.(deps?.currentWeaponKey?.(), comboId) || { stats: {} };
      return baseRange * maxStepMul * scale * (1 + (Number(effects?.stats?.rangeMul) || 0));
    } catch (error) {
      noteAimError('melee-range', error);
      return (Number(deps?.TILE) || 64) * 1.05;
    }
  }

  function meleeInteractionAimTarget() {
    try {
      const deps = combatDeps();
      if (!heldState().meleeOut) return null;
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
    } catch (error) {
      noteAimError('melee-target', error);
      return null;
    }
  }

  function rangedResolvedAimPitch() {
    try {
      const target = rangedInteractionAimTarget();
      if (target?.direction) return Math.asin(Math.max(-1, Math.min(1, target.direction.y)));
    } catch (error) {
      noteAimError('ranged-pitch', error);
    }
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
    try {
      const avatar = deps?.getPlayerAvatarGroup?.();
      const toolBaseY = Number(avatar?.userData?.handAttachY);
      const playerBaseY = playerWorldBaseY(deps);
      const portraitCenterY = Number(window.RangedWeapons?.actorHitbox?.(player)?.center?.y);
      if (![toolBaseY, playerBaseY, portraitCenterY].every(Number.isFinite)) return null;
      return { toolBaseY, portraitPivotY: portraitCenterY - playerBaseY };
    } catch (error) {
      noteAimError('crossbow-pivot', error);
      return null;
    }
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
      try { return transformCrossbowPose(pose); }
      catch (error) { noteAimError('crossbow-idle-pose', error); return pose; }
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
      // combat-camera-alignment-bridge.js, when installed, supplies this explicit
      // muzzle-parallel ray for our private surface resolver; getPlayerInteractionRay
      // itself always stays the real camera-centered ray for ordinary consumers.
      rawRangedGetPlayerInteractionRay = injectedDeps?.getMuzzleParallelInteractionRay || injectedDeps?.getPlayerInteractionRay || null;
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
          if (!loadedFire || !options?.pose) return rawTriggerRangedWeaponVisual(durationS, options);
          try { return rawTriggerRangedWeaponVisual(durationS, { ...options, pose: transformCrossbowPoseSet(options.pose) }); }
          catch (error) { noteAimError('crossbow-fire-pose', error); return rawTriggerRangedWeaponVisual(durationS, options); }
        };
      }
      rangedAimDeps = wrappedDeps;
      invalidateAimTarget('ranged-init', true);
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
    invalidateAimTarget(`melee-range:${source}`, false);
    return true;
  }

  function installMeleeRangeCapture() {
    const deps = combatDeps();
    if (!deps || meleeRangeCaptureInstalled) return meleeRangeCaptureInstalled;
    const rawSwing = deps.triggerWeaponSwingVisual;
    if (typeof rawSwing === 'function') {
      deps.triggerWeaponSwingVisual = function interactionRangeAwareSwing(durationS, options = {}) {
        try { captureMeleeRange(options?.coneRangePx, Number(durationS) + (Number(options?.holdS) || 0), 'swing-windup'); } catch (_) {}
        return rawSwing.apply(this, arguments);
      };
    }
    const rawHold = deps.triggerWeaponHoldVisual;
    if (typeof rawHold === 'function') {
      deps.triggerWeaponHoldVisual = function interactionRangeAwareHold(durationS, options = {}) {
        try { captureMeleeRange(options?.coneRangePx, Number(durationS) + (Number(options?.holdS) || 0), 'hold-windup'); } catch (_) {}
        return rawHold.apply(this, arguments);
      };
    }
    const rawLunge = deps.beginCombatLunge;
    if (typeof rawLunge === 'function') {
      deps.beginCombatLunge = function interactionRangeAwareLunge(distancePx, durationS, hopUnits, hitTest = null) {
        try { captureMeleeRange(hitTest?.rangePx, durationS, 'lunge/strike'); } catch (_) {}
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
      try {
        const target = meleeInteractionAimTarget();
        if (target?.direction) return plainVector(target.direction);
      } catch (error) {
        noteAimError('melee-direction-callback', error);
      }
      try { return rawMeleeAimDirection?.(); } catch (_) { return null; }
    };
    deps.getPlayerMeleeAimPitch = function sharedInteractionMeleePitch() {
      try {
        const target = meleeInteractionAimTarget();
        if (target?.direction) return Math.asin(Math.max(-1, Math.min(1, target.direction.y)));
      } catch (error) {
        noteAimError('melee-pitch-callback', error);
      }
      try { return rawMeleeAimPitch?.() || 0; } catch (_) { return 0; }
    };
    if (!rawMeleeHit && typeof window.Combat?.meleeHit === 'function') {
      rawMeleeHit = window.Combat.meleeHit.bind(window.Combat);
      window.Combat.meleeHit = function interactionTargetMeleeHit(attacker, targetActor, options = {}) {
        if (attacker === deps.player) {
          try {
            const target = meleeInteractionAimTarget();
            if (target?.direction) options = { ...options, direction: plainVector(target.direction) };
          } catch (error) {
            noteAimError('melee-hit-direction', error);
          }
        }
        return rawMeleeHit(attacker, targetActor, options);
      };
    }
    meleeAimInstalled = true;
    return true;
  }

  function installCombatInitBridge() {
    if (combatInitBridgeInstalled) return true;
    const combat = window.Combat;
    const previousInit = combat?.init;
    if (!combat || typeof previousInit !== 'function') return false;
    combat.init = function rangedFocusCombatInitBridge(...args) {
      const result = previousInit.apply(this, args);
      try {
        installMeleeRangeCapture();
        installInteractionMeleeAim();
        invalidateAimTarget('combat-init', true);
      } catch (error) {
        noteAimError('combat-init-bridge', error);
      }
      return result;
    };
    combat.init.__hobunjiRangedFocusInitBridge = true;
    combatInitBridgeInstalled = true;
    return true;
  }

  function thrownCharge(itemKey) {
    try {
      const archetypes = window.HobunjiRangedWeaponArchetypes;
      const activeItemKey = archetypes?.activeThrownChargeItemKey?.();
      return activeItemKey === itemKey ? activeItemKey : null;
    } catch (_) {
      return null;
    }
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
    const current = Number(slider.value);
    if (Number.isFinite(current) && Math.abs(current - value) <= SHOULDER_WRITE_EPSILON) {
      lastAppliedHorizontal = current;
      return false;
    }
    ownSliderDispatch = true;
    try {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      lastAppliedHorizontal = value;
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
      lastAppliedHorizontal = sliderValue;
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
    const current = Number(mode.distanceTiles);
    if (!Number.isFinite(current) || Math.abs(current - next) > CAMERA_WRITE_EPSILON) mode.distanceTiles = next;
    lastAppliedDistance = next;
    return next;
  }

  function applyHorizontal(state) {
    if (!state.combatStance || baseCombatHorizontal == null) return null;
    const next = baseCombatHorizontal + (focusHorizontalOffsetTiles - baseCombatHorizontal) * blend;
    if (Math.abs(next - baseCombatHorizontal) > RESTORE_EPSILON) {
      if (dispatchHorizontal(next)) horizontalModified = true;
    } else if (horizontalModified) {
      dispatchHorizontal(baseCombatHorizontal);
      horizontalModified = false;
    }
    return next;
  }

  function logTransition(state, distanceTiles, horizontalOffset) {
    const signature = `${state.active ? 1 : 0}|${state.reason}|${state.itemKey || '-'}|${state.rangedType}`;
    if (signature === lastFocusSignature) return;
    lastFocusSignature = signature;
    const distanceText = Number.isFinite(distanceTiles) ? distanceTiles.toFixed(2) : 'n/a';
    const horizontalText = Number.isFinite(horizontalOffset) ? horizontalOffset.toFixed(2) : 'n/a';
    window.__farmLog?.(`[ranged-camera] ${state.active ? 'focus ON' : 'focus off'}: ${state.reason}; ${state.itemKey || 'none'}; distance=${distanceText}; focusShoulder=${focusHorizontalOffsetTiles.toFixed(2)}; appliedHorizontal=${horizontalText}; native camera untouched; 3D combat aim is change-driven.`, 'combat');
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
        lastAppliedHorizontal = value;
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
    const state = focusState();
    captureCombatHorizontalAfterGameSync(state);
    blend = easeToward(blend, state.active ? 1 : 0, dt);
    if (state.active && 1 - blend < RESTORE_EPSILON) blend = 1;
    if (!state.active && blend < RESTORE_EPSILON) blend = 0;
    const distanceTiles = applyDistance();
    const horizontalOffset = applyHorizontal(state);

    // Deliberately do not resolve/raycast the combat target here. This function
    // runs from RangedWeapons.update for the focus easing only. Aim resolution
    // happens lazily in the ranged/melee consumers and persists until one of
    // its material input signatures changes.
    // Only stash cheap, unshared references here; snapshot() below does the
    // (rarely-called, debug-only) cloning, so this runs every frame for free.
    lastFocusSnapshotInputs = { state, distanceTiles, horizontalOffset };
    logTransition(state, distanceTiles, horizontalOffset);
    previousCombatStance = state.combatStance;
  }

  function aimPerformanceSnapshot() {
    return {
      surfaceRaycasts: surfaceRaycastCount,
      surfaceCacheHits: surfaceCacheHitCount,
      targetResolves: targetResolveCount,
      targetCacheHits: targetCacheHitCount,
      surfaceInvalidationSerial,
      targetInvalidationSerial,
      lastInvalidation: lastAimInvalidation,
      surfaceCacheActive: !!surfaceRayCache,
      targetCacheActive: !!aimTargetCache,
    };
  }

  function installInvalidationEvents() {
    const invalidateSurface = event => invalidateAimTarget(event?.type || 'world-change', true);
    const invalidateTarget = event => invalidateAimTarget(event?.type || 'combat-change', false);
    // These are cheap event listeners, not polling. Some events already exist;
    // the scene/world aliases are intentionally harmless hooks for current or
    // future placement/transition systems that choose to announce mutations.
    for (const type of ['hobunji-scene-change', 'hobunji-area-change', 'hobunji-world-object-change']) {
      window.addEventListener?.(type, invalidateSurface);
    }
    for (const type of ['hobunji-attack-values-loaded', 'hobunji-ranged-ammo-change', 'hobunji-combat-loadout-change']) {
      window.addEventListener?.(type, invalidateTarget);
    }
  }

  function install() {
    const ranged = window.RangedWeapons;
    if (!ranged) return false;
    installInteractionRangedAim();
    installVerticalRangedStance();
    installCombatInitBridge();
    if (typeof ranged.update !== 'function' || installed) return !!ranged;
    baseUpdate = ranged.update.bind(ranged);
    ranged.update = function rangedUpdateWithCameraFocus(dt) {
      const result = baseUpdate(dt);
      try { updateCameraFocus(dt); }
      catch (error) { noteAimError('frame-update', error); }
      return result;
    };
    installed = true;
    installSliderListener();
    installFocusOffsetControl();
    installInvalidationEvents();
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
    if (mode && baseDistanceTiles != null && Math.abs(Number(mode.distanceTiles) - baseDistanceTiles) > CAMERA_WRITE_EPSILON) {
      mode.distanceTiles = baseDistanceTiles;
    }
    const state = focusState();
    if (state.combatStance && baseCombatHorizontal != null) dispatchHorizontal(baseCombatHorizontal);
    lastAppliedDistance = baseDistanceTiles;
    lastAppliedHorizontal = baseCombatHorizontal;
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
    invalidateAimTarget,
    rangedInteractionAimRay,
    interactionAimTarget: currentInteractionAimTarget,
    attackCameraTarget: currentInteractionAimTarget,
    transformCrossbowPose,
    captureMeleeRange,
    aimPerformance: aimPerformanceSnapshot,
    snapshot: () => ({
      ...(lastFocusSnapshotInputs ? lastFocusSnapshotInputs.state : focusState()),
      blend,
      distanceTiles: lastFocusSnapshotInputs ? lastFocusSnapshotInputs.distanceTiles : undefined,
      baseDistanceTiles,
      horizontalOffset: lastFocusSnapshotInputs ? lastFocusSnapshotInputs.horizontalOffset : undefined,
      baseCombatHorizontal,
      focusHorizontalOffsetTiles,
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      horizontalModified,
      focusControlInstalled,
      rangedAimInstalled,
      combatInitBridgeInstalled,
      meleeAimInstalled,
      meleeRangeCaptureInstalled,
      verticalStanceInstalled,
      cameraMutation: 'native-shoulder-camera-only',
      aimAlignment: 'shared-3d-interaction-target-native-camera',
      aimUpdateMode: 'change-driven-persistent-cache',
      interactionAimTarget: lastResolvedAimTarget ? { ...lastResolvedAimTarget } : null,
      activeMeleeRange: activeMeleeRange ? { ...activeMeleeRange } : null,
      verticalStance: lastVerticalStance ? { ...lastVerticalStance } : null,
      lastAimError: lastAimError ? { ...lastAimError } : null,
      aimPerformance: aimPerformanceSnapshot(),
    }),
    tuning: {
      tightDistanceTiles: TIGHT_DISTANCE_TILES,
      get focusHorizontalOffsetTiles() { return focusHorizontalOffsetTiles; },
      defaultFocusHorizontalOffsetTiles: DEFAULT_FOCUS_HORIZONTAL_OFFSET_TILES,
      easePerSecond: FOCUS_EASE_PER_SEC,
      crossbowVerticalPitchLimitDeg: CROSSBOW_VERTICAL_PITCH_LIMIT_DEG,
      surfaceRayMaxWorld: SURFACE_RAY_MAX_WORLD,
      rayOriginQuantumWorld: RAY_ORIGIN_QUANTUM_WORLD,
      rayDirectionQuantum: RAY_DIRECTION_QUANTUM,
      attackOriginQuantumWorld: ATTACK_ORIGIN_QUANTUM_WORLD,
    },
  };
  window.__rangedCameraFocusDebug = window.HobunjiRangedCameraFocus;

  install();
})();
