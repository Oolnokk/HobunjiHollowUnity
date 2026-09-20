// Tight ranged framing plus shared, fail-safe, change-driven 3D interaction-target aiming.
(() => {
  'use strict';

  const VERSION = 9;
  const SHOULDER_MODE = 'shoulderSurf';
  const TIGHT_FOV_DEG = 34; // Optical zoom around the camera-center reticle ray; unlike changing shoulder distance this introduces no aim-point parallax.
  const FOCUS_EASE_PER_SEC = 9; // Used to ease ready optical zoom continuously without quantized Settings-control writes.
  const RESTORE_EPSILON = 0.002; // Used to snap settled focus interpolation and stop steady-state writes.
  const CAMERA_WRITE_EPSILON = 0.0005; // Used to avoid rewriting native camera FOV when the desired value has not materially changed.
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
  let rawGetPlayerPerspectiveTarget = null; // Stores the game-owned finite reticle point shared by ranged poses and melee aim.
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
  let baseFovDeg = null; // Restores the authored Shoulder Cam field-of-view after ranged focus ends.
  let activeMeleeRange = null; // Latest real melee attack reach captured at windup/release.
  let lastResolvedAimTarget = null; // Mobile-readable copy of the latest resolved ranged/melee interaction target.
  let lastVerticalStance = null; // Mobile-readable copy of the latest crossbow/scatterbow portrait-orbit transform.
  let lastFocusSignature = ''; // Keeps in-game focus logging transition-only.
  let lastAppliedFov = null; // Used to avoid steady-state writes to Shoulder Cam FOV.
  let lastFocusSnapshotInputs = null; // Cheap per-frame refs (no cloning) for the debug snapshot() below; only cloned on demand when actually queried.

  function three() { return window.THREE || null; }
  function nowMs() { return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(); }
  function shoulderModeConfig() { return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null; }
  function combatDeps() { return window.Combat?.deps || null; }
  function combatOffsetSnapshot() {
    const horizontal = Number(document.getElementById('settingShoulderSurfOffsetH')?.value); // Read-only debug copy of the same Combat horizontal offset used by melee.
    const vertical = Number(document.getElementById('settingShoulderSurfOffsetV')?.value); // Read-only debug copy of the same Combat vertical offset used by melee.
    return {
      horizontal: Number.isFinite(horizontal) ? horizontal : null,
      vertical: Number.isFinite(vertical) ? vertical : null,
    };
  }

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

  function sharedPerspectiveAimTarget(attackOrigin, metadata = {}) {
    try {
      const rawTarget = rawGetPlayerPerspectiveTarget?.() || combatDeps()?.getPlayerPerspectiveTarget?.(); // Reads the one game-owned point without performing a scene raycast.
      const point = vectorFrom(rawTarget?.point || rawTarget); // Converts the shared endpoint into this module's Three.js vector language.
      if (!point || !attackOrigin) return null;
      let direction = point.clone().sub(attackOrigin); // Re-roots the same endpoint at the actual melee or projectile origin.
      if (direction.lengthSq() < 1e-8) return null;
      direction.normalize();
      const rayOrigin = vectorFrom(rawTarget?.cameraRay?.origin); // Preserves the screen-center source ray for mobile diagnostics.
      const rayDirection = vectorFrom(rawTarget?.cameraRay?.direction); // Preserves the screen-center direction for mobile diagnostics.
      const target = {
        ...metadata,
        source: 'shared-perspective-point',
        maxRangeWorld: Number(metadata.rangeTiles) || 0,
        rayOrigin,
        rayDirection,
        attackOrigin,
        point,
        direction,
        rayDistance: Number(rawTarget?.rayDistance) || distanceBetween(rayOrigin, point),
        attackDistance: distanceBetween(attackOrigin, point),
        surfaceName: null,
      }; // Same shape as the legacy surface resolver so pose/collision consumers need no parallel path.
      lastResolvedAimTarget = plainAimTarget(target);
      return target;
    } catch (error) {
      noteAimError('shared-perspective-target', error);
      return null;
    }
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
      const sharedTarget = sharedPerspectiveAimTarget(origin, { mode: 'ranged', itemKey, rangeTiles }); // Keeps ranged pose/launch convergence on the same endpoint as the head and lunge.
      if (sharedTarget) return sharedTarget;
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
      const sharedTarget = sharedPerspectiveAimTarget(origin, {
        mode: 'melee',
        itemKey: deps.currentWeaponKey?.() || null,
        rangeTiles,
        rangePx,
      }); // Uses attack reach only for collision; the visual target point itself remains common and range-independent.
      if (sharedTarget) return sharedTarget;
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
      rawGetPlayerPerspectiveTarget = injectedDeps?.getPlayerPerspectiveTarget || null;
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

  function applyFov() {
    const mode = shoulderModeConfig();
    if (!mode) return null;
    if (baseFovDeg == null) {
      const authored = Number(mode.fovDeg);
      if (Number.isFinite(authored) && authored > 1) baseFovDeg = authored;
    }
    if (baseFovDeg == null) return null;
    const tight = Math.min(baseFovDeg, TIGHT_FOV_DEG);
    const next = baseFovDeg + (tight - baseFovDeg) * blend;
    const current = Number(mode.fovDeg);
    if (!Number.isFinite(current) || Math.abs(current - next) > CAMERA_WRITE_EPSILON) mode.fovDeg = next;

    const camera = rangedAimDeps?.getActiveCamera?.(); // Used to apply every eased FOV sample immediately, independent of Settings/select quantization or native camera refresh cadence.
    if (camera && (!Number.isFinite(Number(camera.fov)) || Math.abs(Number(camera.fov) - next) > CAMERA_WRITE_EPSILON)) {
      camera.fov = next;
      camera.updateProjectionMatrix?.();
    }
    lastAppliedFov = next;
    return next;
  }

  function logTransition(state, fovDeg, combatOffsets) {
    const signature = `${state.active ? 1 : 0}|${state.reason}|${state.itemKey || '-'}|${state.rangedType}`;
    if (signature === lastFocusSignature) return;
    lastFocusSignature = signature;
    const fovText = Number.isFinite(fovDeg) ? fovDeg.toFixed(1) : 'n/a';
    const horizontalText = Number.isFinite(combatOffsets?.horizontal) ? combatOffsets.horizontal.toFixed(2) : 'n/a';
    const verticalText = Number.isFinite(combatOffsets?.vertical) ? combatOffsets.vertical.toFixed(2) : 'n/a';
    window.__farmLog?.(`[ranged-camera] ${state.active ? 'focus ON' : 'focus off'}: ${state.reason}; ${state.itemKey || 'none'}; fov=${fovText}; combatOffsetH=${horizontalText}; combatOffsetV=${verticalText}; native Combat offsets remain untouched.`, 'combat');
  }

  function updateCameraFocus(dt) {
    const state = focusState();
    blend = easeToward(blend, state.active ? 1 : 0, dt);
    if (state.active && 1 - blend < RESTORE_EPSILON) blend = 1;
    if (!state.active && blend < RESTORE_EPSILON) blend = 0;
    const fovDeg = applyFov();
    const combatOffsets = combatOffsetSnapshot(); // Used only for mobile-readable diagnostics; ranged focus never writes either melee Combat offset.

    // Deliberately do not resolve/raycast the combat target here. This function
    // runs from RangedWeapons.update for the focus easing only. Aim resolution
    // happens lazily in the ranged/melee consumers and persists until one of
    // its material input signatures changes.
    // Only stash cheap, unshared references here; snapshot() below does the
    // (rarely-called, debug-only) cloning, so this runs every frame for free.
    lastFocusSnapshotInputs = { state, fovDeg, combatOffsets };
    logTransition(state, fovDeg, combatOffsets);
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
    installInvalidationEvents();
    return true;
  }

  function restoreAuthoredCamera() {
    blend = 0;
    const mode = shoulderModeConfig();
    if (mode && baseFovDeg != null && Math.abs(Number(mode.fovDeg) - baseFovDeg) > CAMERA_WRITE_EPSILON) {
      mode.fovDeg = baseFovDeg;
    }
    const camera = rangedAimDeps?.getActiveCamera?.(); // Used to restore the native optical framing immediately when focus is explicitly reset.
    if (camera && baseFovDeg != null && Math.abs(Number(camera.fov) - baseFovDeg) > CAMERA_WRITE_EPSILON) {
      camera.fov = baseFovDeg;
      camera.updateProjectionMatrix?.();
    }
    lastAppliedFov = baseFovDeg;
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
      fovDeg: lastFocusSnapshotInputs ? lastFocusSnapshotInputs.fovDeg : undefined,
      baseFovDeg,
      combatOffsets: lastFocusSnapshotInputs ? { ...lastFocusSnapshotInputs.combatOffsets } : combatOffsetSnapshot(),
      tightFovDeg: TIGHT_FOV_DEG,
      rangedAimInstalled,
      combatInitBridgeInstalled,
      meleeAimInstalled,
      meleeRangeCaptureInstalled,
      verticalStanceInstalled,
      cameraMutation: 'native-shoulder-fov-optical-zoom+native-combat-offsets',
      aimAlignment: rawGetPlayerPerspectiveTarget
        ? 'shared-perspective-point-native-camera'
        : 'shared-3d-interaction-target-native-camera',
      aimUpdateMode: 'change-driven-persistent-cache',
      interactionAimTarget: lastResolvedAimTarget ? { ...lastResolvedAimTarget } : null,
      activeMeleeRange: activeMeleeRange ? { ...activeMeleeRange } : null,
      verticalStance: lastVerticalStance ? { ...lastVerticalStance } : null,
      lastAimError: lastAimError ? { ...lastAimError } : null,
      aimPerformance: aimPerformanceSnapshot(),
    }),
    tuning: {
      tightFovDeg: TIGHT_FOV_DEG,
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
